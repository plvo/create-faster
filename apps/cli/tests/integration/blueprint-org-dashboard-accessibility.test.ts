import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';

interface Page {
  file: string;
  exportName: string;
}

interface Blueprint {
  name: string;
  routerStubs: Record<string, string>;
  pages: Record<
    'userDetail' | 'userTable' | 'usersClient' | 'contactDetail' | 'contactTable' | 'contactsClient' | 'roles',
    Page
  >;
}

const NEXT_APP = 'src/app/(dashboard)';
const COMPONENTS = 'src/components';

const BLUEPRINTS: Blueprint[] = [
  {
    name: 'org-dashboard-nextjs',
    routerStubs: {
      'next/link': './next-link.mjs',
      'next/navigation': './next-navigation.mjs',
      '@/lib/auth/session': './session.mjs',
    },
    pages: {
      userDetail: { file: `${NEXT_APP}/admin/users/[id]/user-detail.tsx`, exportName: 'UserDetail' },
      userTable: { file: `${COMPONENTS}/admin/user-table.tsx`, exportName: 'UserTable' },
      usersClient: { file: `${NEXT_APP}/admin/users/users.client.tsx`, exportName: 'UsersClient' },
      contactDetail: { file: `${NEXT_APP}/contacts/[id]/contact.client.tsx`, exportName: 'ContactDetail' },
      contactTable: { file: `${COMPONENTS}/contacts/contact-table.tsx`, exportName: 'ContactTable' },
      contactsClient: { file: `${NEXT_APP}/contacts/contacts.client.tsx`, exportName: 'ContactsClient' },
      roles: { file: `${NEXT_APP}/admin/roles/page.tsx`, exportName: 'default' },
    },
  },
  {
    name: 'org-dashboard-tanstack-start',
    routerStubs: { '@tanstack/react-router': './tanstack-router.mjs' },
    pages: {
      userDetail: { file: `${COMPONENTS}/admin/user-detail.tsx`, exportName: 'UserDetail' },
      userTable: { file: `${COMPONENTS}/admin/user-table.tsx`, exportName: 'UserTable' },
      usersClient: { file: `${COMPONENTS}/admin/users-client.tsx`, exportName: 'UsersClient' },
      contactDetail: { file: `${COMPONENTS}/contacts/contact-detail.tsx`, exportName: 'ContactDetail' },
      contactTable: { file: `${COMPONENTS}/contacts/contact-table.tsx`, exportName: 'ContactTable' },
      contactsClient: { file: `${COMPONENTS}/contacts/contacts-client.tsx`, exportName: 'ContactsClient' },
      roles: { file: `${COMPONENTS}/admin/roles-page.tsx`, exportName: 'RolesPage' },
    },
  },
];

// Stand-ins for the packages the generated pages import. Elements are plain `{ type, props }` objects, the
// router link becomes an `a`, and an icon is an `svg` marked aria-hidden, as lucide-react renders it.
const STUBS: Record<string, string> = {
  'react.mjs': `export const Fragment = Symbol.for('fragment');
export const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
// A component reads its useState values, in call order, from the list the test sets.
let calls = 0;
let values = [];
export const setStates = (list) => { values = list; calls = 0; };
export const useState = (initial) => [calls < values.length ? values[calls++] : initial, () => {}];`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const ArrowLeft = icon('ArrowLeft');
export const Check = icon('Check');
export const Copy = icon('Copy');
export const KeyRound = icon('KeyRound');
export const Plus = icon('Plus');`,
  'button.mjs': `export const Button = ({ asChild, children, ...props }) =>
  asChild ? children[0] : { type: 'button', props: { ...props, children } };`,
  'next-link.mjs': `export default ({ href, children, ...props }) => ({ type: 'a', props: { href, ...props, children } });`,
  'next-navigation.mjs': 'export const useRouter = () => ({ push() {} });',
  'tanstack-router.mjs': `export const Link = ({ to, children, ...props }) => ({ type: 'a', props: { href: to, ...props, children } });
export const useNavigate = () => () => {};`,
  'query.mjs': `const deep = () => new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : deep()), apply: () => ({}) });
export const useTRPC = () => deep();
export const useSuspenseQuery = () => ({ data: globalThis.__testQueryData });
export const useMutation = () => ({ mutate() {}, isPending: false });
export const useQueryClient = () => ({ invalidateQueries() {} });`,
  'form.mjs': `export const useForm = () => ({
  state: { values: {} },
  Field: ({ children }) => children[0]({ state: { value: '' }, handleChange() {} }),
});`,
  'sonner.mjs': 'export const toast = { success() {}, error() {} };',
  'passthrough.mjs': 'export const Can = ({ children }) => children;',
  'leaf.mjs': `export const ContactForm = () => null;
export const ContactDialog = () => null;
export const ContactTable = () => null;
export const UserTable = () => null;
export const CreateUserDialog = () => null;
export const UserActions = () => null;`,
  'session.mjs': 'export const requireAdmin = async () => {};',
  'permissions.mjs': `export const statement = { user: ['create', 'list'], contact: ['create', 'read'] };
export const roleDefinitions = {
  admin: { user: ['create', 'list'], contact: ['create', 'read'] },
  manager: { contact: ['read'] },
};`,
};

const COMMON_IMPORTS: Record<string, string> = {
  react: './react.mjs',
  'lucide-react': './icons.mjs',
  '@repo/ui/components/ui/button': './button.mjs',
  '@tanstack/react-query': './query.mjs',
  '@tanstack/react-form': './form.mjs',
  '@/trpc/providers': './query.mjs',
  sonner: './sonner.mjs',
  '@/components/can': './passthrough.mjs',
  '@/components/contacts/contact-form': './leaf.mjs',
  '@/components/contacts/contact-dialog': './leaf.mjs',
  '@/components/contacts/contact-table': './leaf.mjs',
  '@/components/admin/user-table': './leaf.mjs',
  '@/components/admin/create-user-dialog': './leaf.mjs',
  './user-actions': './leaf.mjs',
  '@repo/auth/permissions': './permissions.mjs',
};

interface Element {
  tag: string;
  props: Record<string, unknown>;
  children: Child[];
}
type Child = Element | string;
type Component = (props: Record<string, unknown>) => unknown;

async function render(node: unknown): Promise<Child[]> {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) {
    const rendered: Child[] = [];
    for (const item of node) rendered.push(...(await render(item)));
    return rendered;
  }
  const { type, props } = node as { type: unknown; props: Record<string, unknown> };
  if (typeof type === 'function') return render(await (type as Component)(props));
  const children = await render(props.children);
  return typeof type === 'string' ? [{ tag: type, props, children }] : children;
}

const isElement = (child: Child): child is Element => typeof child !== 'string';

function elements(children: Child[]): Element[] {
  return children.filter(isElement).flatMap((element) => [element, ...elements(element.children)]);
}

// The text a screen reader reads: aria-hidden subtrees (icons) are skipped.
function textOf(child: Child): string {
  if (!isElement(child)) return child;
  return child.props['aria-hidden'] === 'true' ? '' : child.children.map(textOf).join('');
}

function accessibleName(element: Element, page: Element[]): string {
  const label = element.props['aria-label'];
  if (typeof label === 'string') return label;
  if (element.tag === 'input') {
    const associated = page.find((candidate) => candidate.tag === 'label' && candidate.props.htmlFor === element.props.id);
    return associated ? textOf(associated).trim() : '';
  }
  return textOf(element).trim();
}

const NAMED_TAGS = ['a', 'button', 'input'];

function namesOf(tree: Child[], tag: string): string[] {
  const all = elements(tree);
  return all.filter((element) => element.tag === tag).map((element) => accessibleName(element, all));
}

function unnamedControls(tree: Child[]): string[] {
  const all = elements(tree);
  return all
    .filter((element) => NAMED_TAGS.includes(element.tag))
    .filter((element) => accessibleName(element, all) === '')
    .map((element) => element.tag);
}

const items = (element: Element): string[] =>
  elements(element.children)
    .filter((child) => child.tag === 'li')
    .map((child) => textOf(child));

const USER = {
  id: 'u1',
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '',
  role: 'admin',
  banned: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const CONTACT = {
  id: 'c1',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.com',
  phone: '',
  company: '',
  notes: '',
};

describe.each(BLUEPRINTS)('$name pages, rendered', (blueprint) => {
  let tempDir: string;
  let renderPage: (page: keyof Blueprint['pages'], options?: { data?: unknown; states?: unknown[] }) => Promise<Child[]>;
  let setStates: (list: unknown[]) => void;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint.name, '--blueprint', blueprint.name, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    setStates = (await import(join(stubs, 'react.mjs'))).setStates;

    const imports = { ...COMMON_IMPORTS, ...blueprint.routerStubs };
    renderPage = async (page, options = {}) => {
      const { file, exportName } = blueprint.pages[page];
      const source = await readTextFile(join(tempDir, blueprint.name, 'apps/web', file));
      const module = await evaluateGeneratedModule<Record<string, Component>>(source, join(stubs, `${page}.mjs`), imports, 'tsx');
      (globalThis as { __testQueryData?: unknown }).__testQueryData = options.data;
      setStates(options.states ?? []);
      const component = module[exportName];
      if (!component) throw new Error(`${file} does not export ${exportName}`);
      return render(await component({ id: 'x' }));
    };
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('user detail', () => {
    // The generated password is the only state that starts as null, and it is the first one the page declares.
    const withPassword = { data: USER, states: ['s3cret-Passw0rd', false] };

    test('the back link, the copy button and the generated password have an accessible name', async () => {
      const page = await renderPage('userDetail', withPassword);
      const all = elements(page);
      const backLink = all.find((element) => element.tag === 'a' && element.props.href === '/admin/users');
      expect(backLink && accessibleName(backLink, all)).toBe('Back to users');
      expect(namesOf(page, 'button')).toContain('Copy password');
      expect(namesOf(page, 'input')).toContain('Generated password');
      expect(unnamedControls(page)).toEqual([]);
    });

    test('every field of the form has a label', async () => {
      const page = await renderPage('userDetail', { data: USER, states: [null, false] });
      expect(namesOf(page, 'input')).toEqual(['First name', 'Last name', 'Name', 'Phone']);
    });

    test('the email and the join date are a description list', async () => {
      const page = await renderPage('userDetail', { data: USER, states: [null, false] });
      const list = elements(page).find((element) => element.tag === 'dl');
      expect(list && elements(list.children).filter((element) => element.tag === 'dt').map(textOf)).toEqual(['Email', 'Joined']);
      expect(list && elements(list.children).find((element) => element.tag === 'dd' && textOf(element) === 'ada@example.com')).toBeDefined();
    });
  });

  describe('roles page', () => {
    test('exposes a table whose columns and rows have headers', async () => {
      const page = await renderPage('roles');
      const tables = elements(page).filter((element) => element.tag === 'table');
      expect(tables).toHaveLength(2);
      for (const table of tables) {
        const headers = elements(table.children).filter((element) => element.tag === 'th');
        expect(headers.map((header) => header.props.scope).sort()).toEqual(['col', 'col', 'col', 'row', 'row']);
        const rows = elements(table.children).filter((element) => element.tag === 'tr');
        for (const row of rows.slice(1)) expect(elements(row.children)[0]?.props.scope).toBe('row');
      }
    });

    test('lists a granted action under Allowed and a denied one under Denied', async () => {
      const page = await renderPage('roles');
      const manager = elements(page).filter((element) => element.tag === 'table')[1];
      const rows = elements(manager?.children ?? []).filter((element) => element.tag === 'tr');
      const cells = (resource: string) => {
        const row = rows.find((candidate) => textOf(candidate).startsWith(resource));
        return elements(row?.children ?? [])
          .filter((element) => element.tag === 'td')
          .map((cell) => (items(cell).length > 0 ? items(cell) : [textOf(cell)]));
      };

      expect(cells('contact')).toEqual([['read'], ['create']]);
      expect(cells('user')).toEqual([['None'], ['create', 'list']]);
    });
  });

  describe('contact pages', () => {
    test('the back link, the cancel button and the actions use the Button and an icon with a visible name', async () => {
      const viewing = await renderPage('contactDetail', { data: CONTACT, states: [false, false] });
      expect(namesOf(viewing, 'a')).toEqual(['Contacts']);
      expect(namesOf(viewing, 'button')).toEqual(['Edit', 'Delete']);
      expect(elements(viewing).some((element) => element.props['data-icon'] === 'ArrowLeft')).toBe(true);

      const confirming = await renderPage('contactDetail', { data: CONTACT, states: [false, true] });
      expect(namesOf(confirming, 'button')).toEqual(['Edit', 'Confirm', 'Cancel']);

      const editing = await renderPage('contactDetail', { data: CONTACT, states: [true, false] });
      expect(namesOf(editing, 'button')).toEqual(['Cancel']);
      expect(elements(editing).some((element) => element.props['data-icon'] === 'ArrowLeft')).toBe(true);
    });

    test('no page draws an arrow with a character', async () => {
      for (const states of [[false, false], [false, true], [true, false]]) {
        const page = await renderPage('contactDetail', { data: CONTACT, states });
        expect(page.map(textOf).join('')).not.toMatch(/[←→]/);
      }
    });

    test('the email and phone are a description list', async () => {
      const page = await renderPage('contactDetail', { data: CONTACT, states: [false, false] });
      const terms = elements(page).filter((element) => element.tag === 'dt').map(textOf);
      expect(terms).toEqual(['Email', 'Phone', 'Company', 'Notes']);
    });

    test('the contacts list has a named create button and named links', async () => {
      const client = await renderPage('contactsClient');
      expect(namesOf(client, 'button')).toEqual(['New Contact']);
      const table = await renderPage('contactTable', { data: [CONTACT] });
      expect(namesOf(table, 'a')).toEqual(['Grace Hopper']);
      expect(unnamedControls(table)).toEqual([]);
    });
  });

  describe('users pages', () => {
    test('the users page has a named create button', async () => {
      const client = await renderPage('usersClient');
      expect(namesOf(client, 'button')).toEqual(['Create User']);
    });

    test('the users table links each user by name and labels its columns', async () => {
      const table = await renderPage('userTable', { data: [USER] });
      expect(namesOf(table, 'a')).toEqual(['Ada Lovelace']);
      expect(elements(table).filter((element) => element.tag === 'th').map(textOf)).toEqual([
        'Name',
        'Email',
        'Role',
        'Status',
        'Actions',
      ]);
    });
  });
});
