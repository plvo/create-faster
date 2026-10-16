import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_ELEMENT_STUB,
  type RenderedChild,
  type RenderedElement,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { NEXTJS_PAGES, type OrgDashboardPageName, TANSTACK_START_PAGES } from './org-dashboard-pages';

interface Blueprint {
  name: string;
  routerStubs: Record<string, string>;
  pages: typeof NEXTJS_PAGES;
}

const BLUEPRINTS: Blueprint[] = [
  {
    name: 'org-dashboard-nextjs',
    routerStubs: {
      'next/link': './next-link.mjs',
      'next/navigation': './next-navigation.mjs',
      '@/lib/auth/session': './session.mjs',
    },
    pages: NEXTJS_PAGES,
  },
  {
    name: 'org-dashboard-tanstack-start',
    routerStubs: { '@tanstack/react-router': './tanstack-router.mjs' },
    pages: TANSTACK_START_PAGES,
  },
];

// Stand-ins for the packages the generated pages import. The router link becomes an `a`, an icon is an `svg`
// marked aria-hidden as lucide-react renders it, and Button marks what it renders with data-component so a test
// can tell the component from a hand-written button.
const STUBS: Record<string, string> = {
  'react.mjs': `${REACT_ELEMENT_STUB}
// useState behaves as React's does: a component reads its slots in call order, and a setter writes its slot.
let slots = [];
let next = 0;
export const resetState = () => { slots = []; next = 0; };
export const startRender = () => { next = 0; };
export const useState = (initial) => {
  const store = slots;
  const index = next++;
  if (!(index in store)) store[index] = initial;
  return [store[index], (value) => { store[index] = typeof value === 'function' ? value(store[index]) : value; }];
};`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const ArrowLeft = icon('ArrowLeft');
export const Check = icon('Check');
export const Copy = icon('Copy');
export const KeyRound = icon('KeyRound');
export const Plus = icon('Plus');`,
  'button.mjs': `export const Button = ({ asChild, children, ...props }) =>
  asChild
    ? { ...children[0], props: { ...children[0].props, 'data-component': 'Button', variant: props.variant, size: props.size } }
    : { type: 'button', props: { 'data-component': 'Button', ...props, children } };`,
  'next-link.mjs': `export default ({ href, children, ...props }) => ({ type: 'a', props: { href, ...props, children } });`,
  'next-navigation.mjs': 'export const useRouter = () => ({ push() {} });',
  'tanstack-router.mjs': `export const Link = ({ to, children, ...props }) => ({ type: 'a', props: { href: to, ...props, children } });
export const useNavigate = () => () => {};`,
  'query.mjs': `// trpc.a.b.queryOptions(x) and mutationOptions(x) hand their argument back, as the real helpers do.
const deep = () => new Proxy(function () {}, { get: (_, key) => (key === 'then' ? undefined : deep()), apply: (_, __, args) => args[0] ?? {} });
export const useTRPC = () => deep();
export const useSuspenseQuery = () => ({ data: globalThis.__testQueryData });
export const useMutation = (options) => ({ mutate: (variables) => options.onSuccess?.(globalThis.__testMutationResult, variables), isPending: false });
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

type Handler = () => unknown;
type Component = (props: Record<string, unknown>) => unknown;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not in the rendered page`);
  return value;
}

function accessibleName(element: RenderedElement, page: RenderedElement[]): string {
  const label = element.props['aria-label'];
  if (typeof label === 'string') return label;
  if (element.tag === 'input') {
    const associated = page.find((candidate) => candidate.tag === 'label' && candidate.props.htmlFor === element.props.id);
    return associated ? textOf(associated).trim() : '';
  }
  return textOf(element).trim();
}

const NAMED_TAGS = ['a', 'button', 'input'];

function namesOf(tree: RenderedChild[], tag: string): string[] {
  const all = elementsOf(tree);
  return all.filter((element) => element.tag === tag).map((element) => accessibleName(element, all));
}

function unnamedControls(tree: RenderedChild[]): string[] {
  const all = elementsOf(tree);
  return all
    .filter((element) => NAMED_TAGS.includes(element.tag))
    .filter((element) => accessibleName(element, all) === '')
    .map((element) => element.tag);
}

const classesOf = (element: RenderedElement): string[] => String(element.props.className ?? '').split(/\s+/);

function expectClasses(element: RenderedElement | undefined, ...expected: string[]): void {
  expect(classesOf(must(element, `an element with ${expected.join(' ')}`))).toEqual(expect.arrayContaining(expected));
}

const find = (tree: RenderedChild[] | RenderedElement, predicate: (element: RenderedElement) => boolean) =>
  elementsOf(Array.isArray(tree) ? tree : [tree]).find(predicate);

const withTag = (tree: RenderedChild[] | RenderedElement, tag: string): RenderedElement[] =>
  elementsOf(Array.isArray(tree) ? tree : [tree]).filter((element) => element.tag === tag);

const heading = (tree: RenderedChild[], tag: string, text: string) =>
  find(tree, (element) => element.tag === tag && textOf(element) === text);

const items = (element: RenderedElement): string[] => withTag(element, 'li').map(textOf);

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

interface Mounted {
  tree: RenderedChild[];
  click: (name: string) => Promise<void>;
}

describe.each(BLUEPRINTS)('$name pages, rendered', (blueprint) => {
  let tempDir: string;
  let mount: (page: OrgDashboardPageName, options?: { data?: unknown; mutationResult?: unknown }) => Promise<Mounted>;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint.name, '--blueprint', blueprint.name, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    const { resetState, startRender } = await import(join(stubs, 'react.mjs'));
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });

    const imports = { ...COMMON_IMPORTS, ...blueprint.routerStubs };
    mount = async (page, options = {}) => {
      const { file, exportName } = blueprint.pages[page];
      const source = await readTextFile(join(tempDir, blueprint.name, 'apps/web', file));
      const module = await evaluateGeneratedModule<Record<string, Component>>(source, join(stubs, `${page}.mjs`), imports, 'tsx');
      const component = module[exportName];
      if (!component) throw new Error(`${file} does not export ${exportName}`);
      (globalThis as { __testQueryData?: unknown }).__testQueryData = options.data;
      (globalThis as { __testMutationResult?: unknown }).__testMutationResult = options.mutationResult;
      resetState();
      const draw = async () => {
        startRender();
        return renderElementTree(await component({ id: 'x' }));
      };

      const mounted: Mounted = {
        tree: await draw(),
        click: async (name) => {
          const all = elementsOf(mounted.tree);
          const target = must(
            all.find((element) => (element.tag === 'button' || element.tag === 'a') && accessibleName(element, all) === name),
            `a control named ${name}`,
          );
          await (target.props.onClick as Handler | undefined)?.();
          mounted.tree = await draw();
        },
      };
      return mounted;
    };
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('user detail', () => {
    const generatePassword = async (): Promise<Mounted> => {
      const page = await mount('userDetail', { data: USER, mutationResult: { password: 's3cret-Passw0rd' } });
      await page.click('Generate password');
      return page;
    };

    test('the back link, the copy button and the generated password have an accessible name', async () => {
      const page = await generatePassword();
      const all = elementsOf(page.tree);
      const backLink = must(find(page.tree, (element) => element.tag === 'a' && element.props.href === '/admin/users'), 'the back link');
      expect(accessibleName(backLink, all)).toBe('Users');
      expect(backLink.props['data-component']).toBe('Button');
      expect(backLink.children.some((child) => typeof child !== 'string' && child.props['data-icon'] === 'ArrowLeft')).toBe(true);
      expect(namesOf(page.tree, 'button')).toContain('Copy password');
      expect(namesOf(page.tree, 'input')).toContain('Generated password');
      expect(unnamedControls(page.tree)).toEqual([]);
    });

    test('copying the password announces the result through the button name', async () => {
      const page = await generatePassword();
      await page.click('Copy password');
      expect(namesOf(page.tree, 'button')).toContain('Copied');
      expect(namesOf(page.tree, 'button')).not.toContain('Copy password');
    });

    test('every field of the form has a label', async () => {
      const page = await mount('userDetail', { data: USER });
      expect(namesOf(page.tree, 'input')).toEqual(['First name', 'Last name', 'Name', 'Phone']);
    });

    test('the email and the join date are a description list', async () => {
      const page = await mount('userDetail', { data: USER });
      const list = must(find(page.tree, (element) => element.tag === 'dl'), 'the description list');
      expect(withTag(list, 'dt').map(textOf)).toEqual(['Email', 'Joined']);
      expect(withTag(list, 'dd').map(textOf)[0]).toBe('ada@example.com');
    });

    test('the first and last name stack on a phone, and a long name wraps instead of widening the page', async () => {
      const page = await mount('userDetail', { data: USER });
      const firstName = must(find(page.tree, (element) => element.props.id === 'firstName'), 'the first name input');
      const grid = must(find(page.tree, (element) => element.tag === 'div' && withTag(element, 'input').includes(firstName) && classesOf(element).includes('grid')), 'the name grid');
      expectClasses(grid, 'sm:grid-cols-2');
      expect(classesOf(grid)).not.toContain('grid-cols-2');
      const title = must(heading(page.tree, 'h1', USER.name), 'the title');
      expectClasses(title, 'min-w-0', 'break-words');
      const header = must(find(page.tree, (element) => withTag(element, 'h1').includes(title) && classesOf(element).includes('flex')), 'the header');
      expectClasses(header, 'flex-wrap');
    });
  });

  describe('roles page', () => {
    test('exposes a table per role whose columns and rows have headers', async () => {
      const page = await mount('roles');
      const tables = withTag(page.tree, 'table');
      expect(tables).toHaveLength(2);
      for (const table of tables) {
        const headers = withTag(table, 'th');
        expect(headers.map((header) => header.props.scope).sort()).toEqual(['col', 'col', 'col', 'row', 'row']);
        for (const row of withTag(table, 'tr').slice(1)) expect(withTag(row, 'th')[0]?.props.scope).toBe('row');
      }
    });

    test('each table and each phone list is named by the heading of its role', async () => {
      const page = await mount('roles');
      for (const section of withTag(page.tree, 'section')) {
        const title = must(withTag(section, 'h2')[0], 'the role heading');
        expect(title.props.id).toEqual(expect.any(String));
        for (const named of [...withTag(section, 'table'), ...withTag(section, 'ul').filter((list) => list.props['aria-labelledby'])]) {
          expect(named.props['aria-labelledby']).toBe(title.props.id);
        }
        expect(withTag(section, 'table')).toHaveLength(1);
      }
      expect(withTag(page.tree, 'h2').map(textOf)).toEqual(['admin', 'manager']);
    });

    test('lists a granted action under Allowed and a denied one as plain text under Denied', async () => {
      const page = await mount('roles');
      const manager = must(withTag(page.tree, 'section')[1], 'the manager section');
      const rows = withTag(must(withTag(manager, 'table')[0], 'the manager table'), 'tr');
      const cells = (resource: string): RenderedElement[] => {
        const row = must(rows.find((candidate) => textOf(candidate).startsWith(resource)), `the ${resource} row`);
        return withTag(row, 'td');
      };

      const [contactAllowed, contactDenied] = cells('contact');
      expect(items(must(contactAllowed, 'the allowed cell'))).toEqual(['read']);
      expect(textOf(must(contactDenied, 'the denied cell'))).toBe('create');
      expect(withTag(must(contactDenied, 'the denied cell'), 'li')).toEqual([]);

      const [userAllowed, userDenied] = cells('user');
      expect(textOf(must(userAllowed, 'the allowed cell'))).toBe('None allowed');
      expect(textOf(must(userDenied, 'the denied cell'))).toBe('create, list');
    });

    test('a phone sees each resource stacked: its name, the allowed actions as pills, the denied ones as muted text', async () => {
      const page = await mount('roles');
      const manager = must(withTag(page.tree, 'section')[1], 'the manager section');
      const list = must(withTag(manager, 'ul').find((candidate) => candidate.props['aria-labelledby']), 'the phone list');
      expectClasses(list, 'sm:hidden');
      const [user, contact] = withTag(list, 'li').filter((item) => withTag(item, 'p').length > 0);
      expect(withTag(must(user, 'the user item'), 'p').map(textOf)).toEqual(['user', 'Not allowed: create, list']);
      expect(textOf(must(user, 'the user item'))).toContain('None allowed');
      expect(withTag(must(contact, 'the contact item'), 'p').map(textOf)).toEqual(['contact', 'Not allowed: create']);
      const pill = must(withTag(must(contact, 'the contact item'), 'ul')[0]?.children.find((child) => typeof child !== 'string'), 'a pill');
      expect(textOf(pill)).toBe('read');
      expectClasses(pill, 'whitespace-nowrap');
    });

    test('the table replaces the phone list from the sm breakpoint', async () => {
      const page = await mount('roles');
      expectClasses(withTag(page.tree, 'table')[0], 'hidden', 'sm:table');
    });
  });

  describe('contact pages', () => {
    test('the back link, the actions and the cancel buttons are Buttons, and the back controls carry an icon', async () => {
      const viewing = await mount('contactDetail', { data: CONTACT });
      const backLink = must(find(viewing.tree, (element) => element.tag === 'a'), 'the back link');
      expect(namesOf(viewing.tree, 'a')).toEqual(['Contacts']);
      expect(backLink.props['data-component']).toBe('Button');
      expect(namesOf(viewing.tree, 'button')).toEqual(['Edit', 'Delete']);
      expect(withTag(viewing.tree, 'button').map((button) => button.props['data-component'])).toEqual(['Button', 'Button']);
      expect(find(viewing.tree, (element) => element.props['data-icon'] === 'ArrowLeft')).toBeDefined();

      await viewing.click('Delete');
      expect(namesOf(viewing.tree, 'button')).toEqual(['Edit', 'Confirm', 'Cancel']);
      expect(withTag(viewing.tree, 'button').map((button) => button.props['data-component'])).toEqual(['Button', 'Button', 'Button']);

      const editing = await mount('contactDetail', { data: CONTACT });
      await editing.click('Edit');
      expect(namesOf(editing.tree, 'button')).toEqual(['Cancel']);
      expect(withTag(editing.tree, 'button')[0]?.props['data-component']).toBe('Button');
      expect(find(editing.tree, (element) => element.props['data-icon'] === 'ArrowLeft')).toBeDefined();
    });

    test('Delete takes the destructive variant instead of a hand-written class string', async () => {
      const page = await mount('contactDetail', { data: CONTACT });
      const remove = must(find(page.tree, (element) => element.tag === 'button' && textOf(element) === 'Delete'), 'the Delete button');
      expect(remove.props.variant).toBe('destructive');
      expect(remove.props.className).toBeUndefined();
    });

    test('no state draws an arrow with a character', async () => {
      const page = await mount('contactDetail', { data: CONTACT });
      expect(page.tree.map(textOf).join('')).not.toMatch(/[←→]/);
      await page.click('Edit');
      expect(page.tree.map(textOf).join('')).not.toMatch(/[←→]/);
    });

    test('every field of the contact is a term of a description list', async () => {
      const page = await mount('contactDetail', { data: CONTACT });
      const list = must(find(page.tree, (element) => element.tag === 'dl'), 'the description list');
      expect(withTag(list, 'dt').map(textOf)).toEqual(['Email', 'Phone', 'Company', 'Notes']);
    });

    test('the header wraps on a phone and a long name wraps instead of widening the page', async () => {
      const page = await mount('contactDetail', { data: CONTACT });
      const title = must(find(page.tree, (element) => element.tag === 'h1'), 'the title');
      expectClasses(title, 'min-w-0', 'break-words');
      const header = must(find(page.tree, (element) => withTag(element, 'h1').includes(title) && classesOf(element).includes('flex-wrap')), 'the header');
      expect(withTag(header, 'button').map(textOf)).toEqual(['Edit', 'Delete']);
    });

    test('the contacts list has a named create button and named links', async () => {
      const client = await mount('contactsClient');
      expect(namesOf(client.tree, 'button')).toEqual(['New Contact']);
      expect(withTag(client.tree, 'button')[0]?.props['data-component']).toBe('Button');
      const table = await mount('contactTable', { data: [CONTACT] });
      expect(namesOf(table.tree, 'a')).toEqual(['Grace Hopper']);
      expect(unnamedControls(table.tree)).toEqual([]);
    });

    test('the contact table scrolls inside its frame and drops Phone and Company on small screens', async () => {
      const table = await mount('contactTable', { data: [CONTACT] });
      const frame = must(find(table.tree, (element) => element.tag === 'div' && withTag(element, 'table').length === 1), 'the table frame');
      expectClasses(frame, 'overflow-x-auto');
      expectClasses(heading(table.tree, 'th', 'Phone'), 'hidden', 'sm:table-cell');
      expectClasses(heading(table.tree, 'th', 'Company'), 'hidden', 'md:table-cell');
    });
  });

  describe('users pages', () => {
    test('the create button is a Button with a name', async () => {
      const client = await mount('usersClient');
      expect(namesOf(client.tree, 'button')).toEqual(['Create User']);
      expect(withTag(client.tree, 'button')[0]?.props['data-component']).toBe('Button');
    });

    test('the users table links each user by name and labels its columns', async () => {
      const table = await mount('userTable', { data: [USER] });
      expect(namesOf(table.tree, 'a')).toEqual(['Ada Lovelace']);
      expect(withTag(table.tree, 'th').map(textOf)).toEqual(['Name', 'Email', 'Role', 'Status', 'Actions']);
    });

    test('the users table scrolls inside its frame and drops Email below sm and Role below md', async () => {
      const table = await mount('userTable', { data: [USER] });
      const frame = must(find(table.tree, (element) => element.tag === 'div' && withTag(element, 'table').length === 1), 'the table frame');
      expectClasses(frame, 'overflow-x-auto');
      expectClasses(heading(table.tree, 'th', 'Email'), 'hidden', 'sm:table-cell');
      expectClasses(heading(table.tree, 'th', 'Role'), 'hidden', 'md:table-cell');
      expectClasses(find(table.tree, (element) => element.tag === 'td' && textOf(element) === USER.email), 'hidden', 'sm:table-cell');
      expectClasses(find(table.tree, (element) => element.tag === 'td' && textOf(element) === USER.role), 'hidden', 'md:table-cell');
    });

    test('the email shows under the name where the Email column is hidden', async () => {
      const table = await mount('userTable', { data: [USER] });
      const nameCell = must(find(table.tree, (element) => element.tag === 'td' && textOf(element).startsWith(USER.name)), 'the name cell');
      const subline = must(find(nameCell, (element) => element.tag === 'span' && textOf(element) === USER.email), 'the email line');
      expectClasses(subline, 'sm:hidden', 'text-muted-foreground');
    });
  });
});
