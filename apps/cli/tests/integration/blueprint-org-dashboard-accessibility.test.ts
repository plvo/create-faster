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
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const GENERATED_PASSWORD = { file: 'src/components/admin/generated-password.tsx', exportName: 'GeneratedPassword' };
const GENERATED_PASSWORD_MODULE = { '@/components/admin/generated-password': { ...GENERATED_PASSWORD, stub: 'generated-password.mjs' } };

const FORMAT_DATE_MODULE = {
  '@/lib/format-date': { file: 'src/lib/format-date.ts', exportName: 'formatDate', stub: 'format-date.mjs' },
};

const TABLE_PAGINATION_MODULE = {
  '@/components/table-pagination': { file: 'src/components/table-pagination.tsx', exportName: 'TablePagination', stub: 'table-pagination.mjs' },
};

const FORMAT_FILE_SIZE_MODULE = {
  '@/lib/format-file-size': { file: 'src/lib/format-file-size.ts', exportName: 'formatFileSize', stub: 'format-file-size.mjs' },
};

const CONFIRM_DIALOG_MODULE = {
  '@/components/confirm-dialog': { file: 'src/components/confirm-dialog.tsx', exportName: 'ConfirmDialog', stub: 'confirm-dialog.mjs' },
};

const MENU_CONFIRMATION_MODULE = {
  '@/hooks/use-menu-confirmation': { file: 'src/hooks/use-menu-confirmation.ts', exportName: 'useMenuConfirmation', stub: 'use-menu-confirmation.mjs' },
};

const USER_ACTIONS = { file: 'src/components/admin/user-actions.tsx', exportName: 'UserActions' };

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
export const cache = (fn) => fn;
export const resetState = () => { slots = []; next = 0; };
export const startRender = () => { next = 0; };
export const useState = (initial) => {
  const store = slots;
  const index = next++;
  if (!(index in store)) store[index] = initial;
  return [store[index], (value) => { store[index] = typeof value === 'function' ? value(store[index]) : value; }];
};
export const useId = () => useState('id-' + next)[0];
export const useRef = (initial) => ({ current: initial });
export const useEffect = () => {};
export const Suspense = ({ children }) => children;`,
  'icons.mjs': `import { createElement } from './react.mjs';
// lucide-react passes the props of the caller to the svg and marks it aria-hidden unless the caller names it.
const hasAccessibleName = (props) => Object.keys(props).some((key) => key.startsWith('aria-') || key === 'role' || key === 'title');
const icon = (name) => (props) =>
  createElement('svg', { ...(hasAccessibleName(props) ? {} : { 'aria-hidden': 'true' }), 'data-icon': name, ...props });
export const ArrowLeft = icon('ArrowLeft');
export const Check = icon('Check');
export const ChevronLeft = icon('ChevronLeft');
export const ChevronRight = icon('ChevronRight');
export const Copy = icon('Copy');
export const InfoIcon = icon('InfoIcon');
export const KeyRound = icon('KeyRound');
export const Minus = icon('Minus');
export const MoreHorizontal = icon('MoreHorizontal');
export const Plus = icon('Plus');
export const Trash2 = icon('Trash2');
export const Upload = icon('Upload');
export const X = icon('X');`,
  'button.mjs': `export const Button = ({ asChild, children, ...props }) =>
  asChild
    ? { ...children[0], props: { ...children[0].props, 'data-component': 'Button', variant: props.variant, size: props.size } }
    : { type: 'button', props: { 'data-component': 'Button', ...props, children } };`,
  'next-link.mjs': `export default ({ href, children, ...props }) => ({ type: 'a', props: { href, ...props, children } });`,
  'next-navigation.mjs': `export const useRouter = () => ({ push() {} });
export const useParams = () => ({ id: 'u1' });
export const redirect = (path) => { throw new Error('redirected to ' + path); };
export const notFound = () => { throw new Error('not found'); };`,
  'next-headers.mjs': 'export const headers = async () => ({});',
  'trpc-server.mjs': `export const HydrateClient = ({ children }) => children;
export const prefetch = () => {};
export const getQueryClient = () => ({ fetchQuery: async () => ({}) });
export const trpc = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ queryOptions: (input) => input ?? {} }) }) });`,
  'skeleton.mjs': 'export const Skeleton = () => null;',
  'server.mjs': `export const getAuth = async () => ({ api: { getSession: async () => ({ user: { role: 'admin' } }) } });`,
  'tanstack-router.mjs': `export const Link = ({ to, children, ...props }) => ({ type: 'a', props: { href: to, ...props, children } });
export const useNavigate = () => () => {};
export const notFound = () => ({ kind: 'notFound' });`,
  'query.mjs': `// trpc.a.b.queryOptions(x) and mutationOptions(x) hand their argument back, as the real helpers do.
// __path names the router a procedure belongs to (trpc.user), for a test that asks which list was refreshed.
const deep = (path = []) => new Proxy(function () {}, {
  get: (_, key) => (key === 'then' ? undefined : key === '__path' ? path.join('.') : deep([...path, String(key)])),
  apply: (_, __, args) => args[0] ?? {},
});
export const useTRPC = () => deep();
export const useSuspenseQuery = () => ({ data: globalThis.__testQueryData });
// A list page asks for its rows and its total together: the rows are __testQueryData.items, the total .total.
export const useSuspenseQueries = () => [{ data: globalThis.__testQueryData.items }, { data: globalThis.__testQueryData.total }];
export const useMutation = (options) => ({
  mutate: (variables) => options.onSuccess?.(globalThis.__testMutationResult, variables),
  mutateAsync: async (variables) => { options.onSuccess?.(globalThis.__testMutationResult, variables); return globalThis.__testMutationResult; },
  isPending: false,
});
export const useQueryClient = () => ({ invalidateQueries() {} });`,
  'form.mjs': `export const useForm = () => ({
  state: { values: {} },
  Field: ({ children }) => children[0]({ state: { value: '' }, handleChange() {} }),
});`,
  'sonner.mjs': `// Records what the user is told, in order.
const record = (kind) => (message) => { (globalThis.__toasts ??= []).push({ kind, message }); };
export const toast = { success: record('success'), error: record('error') };`,
  'passthrough.mjs': 'export const Can = ({ children }) => (globalThis.__testDenied ? null : children);',
  'leaf.mjs': `export const ContactForm = () => null;
export const ContactDialog = () => null;
export const ContactTable = () => null;
export const UserTable = () => null;
export const CreateUserDialog = () => null;
export const UserActions = () => null;
export const EditUser = () => null;
export const UsersClient = () => null;
export const UserClient = () => null;
export const AppHeader = () => null;
export const AppSidebar = () => null;
export const CommandPaletteProvider = ({ children }) => children;`,
  'sidebar.mjs': `import { createElement } from './react.mjs';
export const SidebarProvider = ({ children }) => children;
// SidebarInset renders the main landmark of the page, as the generated ui component does.
export const SidebarInset = ({ children, ...props }) => createElement('main', props, children);`,
  'table.mjs': `import { createElement } from './react.mjs';
const part = (tag) => ({ children, ...props }) => createElement(tag, props, children);
// Table wraps the table in a scrolling container, as the generated ui component does.
export const Table = ({ children, ...props }) => createElement('div', { className: 'relative w-full overflow-x-auto' }, createElement('table', props, children));
export const TableHeader = part('thead');
export const TableBody = part('tbody');
export const TableRow = part('tr');
export const TableHead = part('th');
export const TableCell = part('td');
export const TableCaption = part('caption');`,
  'utils.mjs': "export const cn = (...classes) => classes.filter(Boolean).join(' ');",
  'field.mjs': `import { createElement } from './react.mjs';
export const Field = ({ children }) => createElement('div', {}, children);
export const FieldLabel = ({ children, ...props }) => createElement('label', props, children);`,
  'popover.mjs': `export const Popover = () => null;
export const PopoverContent = () => null;
export const PopoverTrigger = () => null;`,
  'textarea.mjs': `import { createElement } from './react.mjs';
export const Textarea = (props) => createElement('textarea', props);`,
  'form-context.mjs': 'export const useFieldContext = () => globalThis.__testField;',
  'session.mjs': `const session = { user: { role: 'admin' } };
export const requireSession = async () => session;
export const requireAdmin = async () => session;`,
  'badge.mjs': `import { createElement } from './react.mjs';
export const Badge = ({ children, ...props }) => createElement('span', props, children);`,
  'input.mjs': `import { createElement } from './react.mjs';
export const Input = (props) => createElement('input', props);`,
  'select.mjs': `import { createElement } from './react.mjs';
// Select keeps its props on a wrapper so a test reads the value and calls onValueChange as a pick would.
export const Select = ({ children, ...props }) => createElement('div', { 'data-component': 'Select', ...props }, children);
export const SelectTrigger = ({ children, ...props }) => createElement('button', { role: 'combobox', ...props }, children);
export const SelectContent = ({ children }) => createElement('div', { role: 'listbox' }, children);
export const SelectItem = ({ children, value }) => createElement('div', { role: 'option', 'data-value': value }, children);
export const SelectValue = () => null;`,
  'page-params.mjs': `// The page the URL names, and what the table asks the URL for.
export const usePageParams = () => ({
  ...globalThis.__testPage,
  setPage: (page) => (globalThis.__pageCalls ??= []).push(['page', page]),
  setPageSize: (pageSize) => (globalThis.__pageCalls ??= []).push(['pageSize', pageSize]),
});`,
  'pagination.mjs': `export const PAGE_SIZES = [10, 25, 50, 100];
export const pageOffset = ({ page, pageSize }) => (page - 1) * pageSize;
export const pageCountOf = (total, pageSize) => Math.max(1, Math.ceil(total / pageSize));
export const COUNT_STALE_TIME = 60000;`,
  // Records the router of each list a mutation refreshes: its list and its count are fetched again together.
  'invalidate-paged-list.mjs': `export const invalidatePagedList = (_client, procedures) => { (globalThis.__invalidated ??= []).push(procedures.__path); };`,
  'responsive-dialog.mjs': `const part = ({ children }) => children;
export const ResponsiveDialog = part;
export const ResponsiveDialogBody = part;
export const ResponsiveDialogContent = part;
export const ResponsiveDialogDescription = part;
export const ResponsiveDialogFooter = part;
export const ResponsiveDialogHeader = part;
export const ResponsiveDialogTitle = part;`,
  // The users table of the fullstack blueprint reads its list from the URL: the first page, newest first.
  'user-list.mjs': `export const DEFAULT_USER_SORT = '-createdAt';
export const USER_SORTS = ['-createdAt', 'name', '-name', 'email', '-email'];
export const parseUserListParams = () => ({ page: 1, pageSize: 10, search: '', sort: DEFAULT_USER_SORT });`,
  // The app form of the org dashboards has no inline edit field; the fullstack blueprint replaces this stand-in.
  'inline-edit.mjs': 'export const InlineEditField = () => null;',
  'user-list-params.mjs': `export const useUserListParams = () => ({
  page: 1, pageSize: 10, search: '', sort: '-createdAt', setPage() {}, setPageSize() {}, setSearch() {}, setSort() {},
});`,
  'search-input.mjs': 'export const SearchInput = () => null;',
  'paged-list.mjs': 'export const PagedList = ({ children }) => children;',
  'dialog.mjs': `import { createElement } from './react.mjs';
export const Dialog = ({ children }) => children;
export const DialogTrigger = ({ children }) => children;
export const DialogContent = ({ children, ...props }) => createElement('div', { role: 'dialog', ...props }, children);
export const DialogHeader = ({ children }) => children;
export const DialogFooter = ({ children }) => children;
export const DialogTitle = ({ children }) => children;
export const DialogDescription = ({ children }) => children;`,
  'dropdown-menu.mjs': `import { createElement } from './react.mjs';
export const DropdownMenu = ({ children }) => children;
export const DropdownMenuTrigger = ({ children }) => children[0];
export const DropdownMenuContent = ({ children }) => createElement('div', { role: 'menu' }, ...children);
export const DropdownMenuItem = ({ children, onClick }) => createElement('div', { role: 'menuitem', onClick }, children);
export const DropdownMenuSeparator = () => null;`,
  'zod.mjs': 'export const z = new Proxy(() => {}, { get: () => z, apply: () => z });',
  'auth-client.mjs': `// The signed-in user is another one than the users the pages show, unless a test makes them the same.
export const authClient = { admin: {}, useSession: () => ({ data: { user: { id: globalThis.__testViewerId ?? 'viewer' } } }) };`,
  'app-form.mjs': `import { createElement } from './react.mjs';
import { InlineEditField } from './inline-edit.mjs';
// A field is the one the generated library renders, fed the value of the form, so a test reads what a page asks of it.
const fieldOf = (name, options) => ({
  name,
  state: { value: options.defaultValues[name], meta: { isValid: true, errors: [] } },
  handleChange() {},
  form: { handleSubmit: async () => {} },
});
const field = {
  InlineEditField,
  InputField: (props) => createElement('input', { 'aria-label': props.label }),
  TextareaField: (props) => createElement('textarea', { 'aria-label': props.label }),
  SelectField: (props) => createElement('button', { role: 'combobox', 'aria-label': props.label }),
};
export const useAppForm = (options) => {
  globalThis.__testFormOptions = options;
  return {
  AppField: ({ name, children }) => {
    globalThis.__testField = fieldOf(name, options);
    return children[0](field);
  },
  AppForm: ({ children }) => children,
  SubmitButton: ({ children }) => createElement('button', { type: 'submit' }, children),
  handleSubmit: () => options.onSubmit({ value: options.defaultValues }),
  reset() {},
  };
};`,
  'data-table-shell.mjs': `import { createElement } from './react.mjs';
// Renders the column definitions of a page as a table: the header of a column, and its cell for each row.
export const DataTableShell = ({ columns, data }) =>
  createElement('table', {},
    createElement('thead', {}, createElement('tr', {}, ...columns.map((column) => createElement('th', { className: column.meta?.className }, column.header)))),
    createElement('tbody', {}, ...data.map((row) =>
      createElement('tr', {}, ...columns.map((column) => createElement('td', { className: column.meta?.className }, column.cell({ row: { original: row } })))))));`,
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
  '@/components/admin/edit-user': './leaf.mjs',
  './user-actions': './leaf.mjs',
  './users.client': './leaf.mjs',
  './user.client': './leaf.mjs',
  '@repo/auth/permissions': './permissions.mjs',
  '@repo/auth/auth-client': './auth-client.mjs',
  zod: './zod.mjs',
  '@repo/ui/components/ui/badge': './badge.mjs',
  '@repo/ui/components/ui/input': './input.mjs',
  '@repo/ui/components/ui/select': './select.mjs',
  '@repo/ui/components/ui/dialog': './dialog.mjs',
  '@repo/ui/components/ui/dropdown-menu': './dropdown-menu.mjs',
  '@repo/ui/lib/form': './app-form.mjs',
  '@/components/shared/data-table-shell': './data-table-shell.mjs',
  '@repo/ui/components/ui/sidebar': './sidebar.mjs',
  '@repo/ui/components/ui/table': './table.mjs',
  '@/components/navigation/app-header': './leaf.mjs',
  '@/components/navigation/app-sidebar': './leaf.mjs',
  '@/components/navigation/command-palette': './leaf.mjs',
  '@repo/ui/lib/utils': './utils.mjs',
  '../../field': './field.mjs',
  '../../input': './input.mjs',
  '../../popover': './popover.mjs',
  '../../textarea': './textarea.mjs',
  './form-context': './form-context.mjs',
  'next/headers': './next-headers.mjs',
  '@/lib/server': './server.mjs',
  '@/hooks/use-page-params': './page-params.mjs',
  '@repo/api/pagination': './pagination.mjs',
  '@/lib/invalidate-paged-list': './invalidate-paged-list.mjs',
  '@repo/ui/components/block/shuip/responsive-dialog': './responsive-dialog.mjs',
};

type Handler = () => unknown;
type Component = (props: Record<string, unknown>) => unknown;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not in the rendered page`);
  return value;
}

// The text of the elements an element is named by through aria-labelledby, which may include the element itself.
function labelledByText(element: RenderedElement, page: RenderedElement[]): string {
  const ids = String(element.props['aria-labelledby'] ?? '').split(/\s+/);
  return ids
    .map((id) => page.find((candidate) => candidate.props.id === id))
    .map((referenced) => (referenced ? textOf(referenced).trim() : ''))
    .join(' ')
    .trim();
}

function accessibleName(element: RenderedElement, page: RenderedElement[]): string {
  if (element.props['aria-labelledby']) return labelledByText(element, page);
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
  act: (action: () => unknown) => Promise<void>;
}

interface PageSource {
  file: string;
  exportName: string;
}

interface MountOptions {
  data?: unknown;
  mutationResult?: unknown;
  props?: Record<string, unknown>;
}

type Mount<Name extends string> = (page: Name, options?: MountOptions) => Promise<Mounted>;

interface Mounter<Name extends string> {
  mount: Mount<Name>;
  // The module of a generated page, for what it exports besides the component (Next.js `metadata`).
  load: (page: Name) => Promise<Record<string, unknown>>;
}

interface Globals {
  __testViewerId?: string;
  __testQueryData?: unknown;
  __testPage?: { page: number; pageSize: number };
  __pageCalls?: [string, number][];
  __testMutationResult?: unknown;
  __toasts?: { kind: string; message: string }[];
  __invalidated?: string[];
  __testFormOptions?: { onSubmit: (submission: { value: Record<string, unknown> }) => unknown; defaultValues: Record<string, unknown> };
}

// Writes the stand-ins, then returns functions that render a generated page of the project with them. `modules`
// are generated files the pages import that run for real, as paths relative to the project's web app.
async function createMounter<Name extends string>(
  tempDir: string,
  webDir: string,
  pages: Record<Name, PageSource>,
  imports: Record<string, string>,
  modules: Record<string, PageSource & { stub: string }> = {},
): Promise<Mounter<Name>> {
  const stubs = join(tempDir, 'stubs');
  await mkdir(stubs, { recursive: true });
  for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
  const { resetState, startRender } = await import(join(stubs, 'react.mjs'));
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });

  const withModules = { ...imports };
  for (const [specifier, module] of Object.entries(modules)) {
    const source = await readTextFile(join(webDir, module.file));
    await evaluateGeneratedModule(source, join(stubs, module.stub), withModules, 'tsx');
    withModules[specifier] = `./${module.stub}`;
  }

  const load = async (page: Name): Promise<Record<string, unknown>> => {
    const source = await readTextFile(join(webDir, pages[page].file));
    return evaluateGeneratedModule<Record<string, unknown>>(source, join(stubs, `${page}.mjs`), withModules, 'tsx');
  };

  const mount: Mount<Name> = async (page, options = {}) => {
    const { file, exportName } = pages[page];
    const component = (await load(page))[exportName] as Component | undefined;
    if (!component) throw new Error(`${file} does not export ${exportName}`);
    const globals = globalThis as Globals;
    globals.__testQueryData = options.data;
    globals.__testMutationResult = options.mutationResult;
    globals.__toasts = [];
    globals.__invalidated = [];
    resetState();
    const draw = async () => {
      startRender();
      return renderElementTree(await component(options.props ?? { id: 'x' }));
    };

    const mounted: Mounted = {
      tree: await draw(),
      act: async (action) => {
        await action();
        mounted.tree = await draw();
      },
      click: async (name) => {
        const all = elementsOf(mounted.tree);
        const target = must(
          all.find((element) => (element.tag === 'button' || element.tag === 'a') && accessibleName(element, all) === name),
          `a control named ${name}`,
        );
        await mounted.act(async () => (target.props.onClick as Handler | undefined)?.());
      },
    };
    return mounted;
  };

  return { mount, load };
}

const toasts = (): { kind: string; message: string }[] => (globalThis as Globals).__toasts ?? [];

describe.each(BLUEPRINTS)('$name pages, rendered', (blueprint) => {
  let tempDir: string;
  let mount: Mount<OrgDashboardPageName | 'userActions' | 'contactForm' | 'createUserDialog'>;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint.name, '--blueprint', blueprint.name, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    ({ mount } = await createMounter(
      tempDir,
      join(tempDir, blueprint.name, 'apps/web'),
      {
        ...blueprint.pages,
        userActions: USER_ACTIONS,
        contactForm: { file: 'src/components/contacts/contact-form.tsx', exportName: 'ContactForm' },
        createUserDialog: { file: 'src/components/admin/create-user-dialog.tsx', exportName: 'CreateUserDialog' },
      },
      { ...COMMON_IMPORTS, ...blueprint.routerStubs },
      { ...GENERATED_PASSWORD_MODULE, ...TABLE_PAGINATION_MODULE, ...FORMAT_DATE_MODULE, ...MENU_CONFIRMATION_MODULE },
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('a mutation that adds or removes a row refreshes its list and its count', () => {
    const invalidated = () => (globalThis as Globals).__invalidated;
    const submit = async (dialog: Mounted) => {
      const form = must(find(dialog.tree, (element) => element.tag === 'form'), 'the form');
      await dialog.act(async () => (form.props.onSubmit as (event: { preventDefault(): void }) => unknown)({ preventDefault() {} }));
    };

    test('deleting a contact', async () => {
      const page = await mount('contactDetail', { data: CONTACT });
      await page.click('Delete');
      await page.click('Confirm');
      expect(invalidated()).toEqual(['contact']);
    });

    test('creating a contact', async () => {
      await submit(await mount('contactForm', { props: {} }));
      expect(invalidated()).toEqual(['contact']);
    });

    test('creating a user', async () => {
      await submit(await mount('createUserDialog', { props: { open: true, onOpenChange() {} }, mutationResult: { password: 'x' } }));
      expect(invalidated()).toEqual(['user']);
    });
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

    test('regenerating a password does not keep the Copied state of the previous one', async () => {
      const page = await generatePassword();
      await page.click('Copy password');
      expect(namesOf(page.tree, 'button')).toContain('Copied');
      (globalThis as Globals).__testMutationResult = { password: 'next-Passw0rd' };
      await page.click('Regenerate');
      expect(namesOf(page.tree, 'button')).toContain('Copy password');
      expect(namesOf(page.tree, 'button')).not.toContain('Copied');
      expect(must(find(page.tree, (element) => element.tag === 'input' && element.props.readOnly === true), 'the password field').props.value).toBe('next-Passw0rd');
    });

    test('a refused clipboard tells the user and keeps the button as it was', async () => {
      const page = await generatePassword();
      const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
      try {
        await page.click('Copy password');
        expect(namesOf(page.tree, 'button')).toContain('Copy password');
        expect(toasts().filter((toast) => toast.kind === 'error')).toHaveLength(1);
        expect(toasts().some((toast) => toast.message === 'Password copied')).toBe(false);
      } finally {
        if (clipboard) Object.defineProperty(globalThis.navigator, 'clipboard', clipboard);
      }
    });

    test('every field of the form has a label', async () => {
      const page = await mount('userDetail', { data: USER });
      expect(namesOf(page.tree, 'input')).toEqual(['First name', 'Last name', 'Name', 'Phone']);
    });

    test('the email and the join date are a description list', async () => {
      const page = await mount('userDetail', { data: USER });
      const list = must(find(page.tree, (element) => element.tag === 'dl'), 'the description list');
      expect(withTag(list, 'dt').map(textOf)).toEqual(['Email', 'Joined']);
      const email = must(withTag(list, 'dd')[0], 'the email');
      expect(textOf(email)).toBe('ada@example.com');
      expectClasses(email, 'wrap-anywhere');
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

    test('the allowed list is named by its column header in the table and labelled in the phone list', async () => {
      const page = await mount('roles');
      const section = must(withTag(page.tree, 'section')[0], 'the first section');
      const inTable = withTag(must(withTag(section, 'table')[0], 'the table'), 'ul');
      expect(inTable.length).toBeGreaterThan(0);
      for (const list of inTable) expect(list.props['aria-label']).toBeUndefined();
      const phoneList = must(withTag(section, 'ul').find((candidate) => candidate.props['aria-labelledby']), 'the phone list');
      for (const list of withTag(phoneList, 'ul').filter((candidate) => candidate !== phoneList)) expect(list.props['aria-label']).toBe('Allowed');
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

    test('Delete rests as a quiet outline button with destructive text and Confirm is solid destructive', async () => {
      const page = await mount('contactDetail', { data: CONTACT });
      const remove = must(find(page.tree, (element) => element.tag === 'button' && textOf(element) === 'Delete'), 'the Delete button');
      expect(remove.props.variant).toBe('outline');
      expect(remove.props.className).toBe('text-destructive');

      await page.click('Delete');
      const confirm = must(find(page.tree, (element) => element.tag === 'button' && textOf(element) === 'Confirm'), 'the Confirm button');
      expect(confirm.props.variant).toBe('destructive');
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
      const table = await mount('contactTable', { data: { items: [CONTACT], total: 1 } });
      expect(namesOf(table.tree, 'a')).toEqual(['Grace Hopper']);
      expect(unnamedControls(table.tree)).toEqual([]);
    });

    test('the contact table scrolls inside its frame and drops Phone and Company on small screens', async () => {
      const table = await mount('contactTable', { data: { items: [CONTACT], total: 1 } });
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
      const table = await mount('userTable', { data: { items: [USER], total: 1 } });
      expect(namesOf(table.tree, 'a')).toEqual(['Ada Lovelace']);
      expect(withTag(table.tree, 'th').map(textOf)).toEqual(['Name', 'Email', 'Role', 'Status', 'Actions']);
    });

    test('the users table scrolls inside its frame and drops Email below sm and Role below md', async () => {
      const table = await mount('userTable', { data: { items: [USER], total: 1 } });
      const frame = must(find(table.tree, (element) => element.tag === 'div' && withTag(element, 'table').length === 1), 'the table frame');
      expectClasses(frame, 'overflow-x-auto');
      expectClasses(heading(table.tree, 'th', 'Email'), 'hidden', 'sm:table-cell');
      expectClasses(heading(table.tree, 'th', 'Role'), 'hidden', 'md:table-cell');
      expectClasses(find(table.tree, (element) => element.tag === 'td' && textOf(element) === USER.email), 'hidden', 'sm:table-cell');
      expectClasses(find(table.tree, (element) => element.tag === 'td' && textOf(element) === USER.role), 'hidden', 'md:table-cell');
    });

    test('the email and the role show under the name where their columns are hidden', async () => {
      const table = await mount('userTable', { data: { items: [USER], total: 1 } });
      const nameCell = must(find(table.tree, (element) => element.tag === 'td' && textOf(element).startsWith(USER.name)), 'the name cell');
      const subline = must(find(nameCell, (element) => element.tag === 'div'), 'the line under the name');
      expectClasses(subline, 'md:hidden');
      const email = must(find(subline, (element) => element.tag === 'span' && textOf(element) === USER.email), 'the email line');
      expectClasses(email, 'sm:hidden', 'text-muted-foreground');
      const role = must(find(subline, (element) => element.tag === 'span' && textOf(element) === USER.role), 'the role pill');
      expect(classesOf(role)).not.toContain('sm:hidden');
    });
  });
  describe('pagination', () => {
    const TABLES: { name: string; table: 'contactTable' | 'userTable'; row: object; noun: string; empty: string }[] = [
      { name: 'contact table', table: 'contactTable', row: CONTACT, noun: 'contacts', empty: 'No contacts yet' },
      { name: 'user table', table: 'userTable', row: USER, noun: 'users', empty: 'No users found' },
    ];

    describe.each(TABLES)('$name', ({ table, row, noun, empty }) => {
      const showing = async (page: number, data: { items: unknown[]; total: number }, pageSize = 10): Promise<Mounted> => {
        const globals = globalThis as Globals;
        globals.__testPage = { page, pageSize };
        globals.__pageCalls = [];
        return mount(table, { data });
      };
      const calls = (): [string, number][] => (globalThis as Globals).__pageCalls ?? [];
      const button = (tree: RenderedChild[], name: string) => {
        const all = elementsOf(tree);
        return must(all.find((element) => element.tag === 'button' && accessibleName(element, all) === name), `a button named ${name}`);
      };

      test('says which rows it shows out of how many, in a live region', async () => {
        const page = await showing(2, { items: [row], total: 25 });
        const status = must(find(page.tree, (element) => element.props['aria-live'] === 'polite'), 'the status line');
        expect(textOf(status)).toBe(`Showing 11\u201320 of 25 ${noun}`);
        expect(textOf(must(find(page.tree, (element) => textOf(element).startsWith('Page 2')), 'the page indicator'))).toBe('Page 2 of 3');
      });

      test('the last page shows the remainder', async () => {
        const page = await showing(3, { items: [row], total: 25 });
        const status = must(find(page.tree, (element) => element.props['aria-live'] === 'polite'), 'the status line');
        expect(textOf(status)).toBe(`Showing 21\u201325 of 25 ${noun}`);
      });

      test('moves between pages with named buttons', async () => {
        const page = await showing(2, { items: [row], total: 25 });
        await page.click('Next page');
        await page.click('Previous page');
        expect(calls()).toEqual([
          ['page', 3],
          ['page', 1],
        ]);
      });

      test('cannot go before the first page or past the last', async () => {
        const first = await showing(1, { items: [row], total: 25 });
        expect(button(first.tree, 'Previous page').props.disabled).toBe(true);
        expect(button(first.tree, 'Next page').props.disabled).toBeFalsy();

        const last = await showing(3, { items: [row], total: 25 });
        expect(button(last.tree, 'Next page').props.disabled).toBe(true);
        expect(button(last.tree, 'Previous page').props.disabled).toBeFalsy();

        const only = await showing(1, { items: [row], total: 1 });
        expect(button(only.tree, 'Previous page').props.disabled).toBe(true);
        expect(button(only.tree, 'Next page').props.disabled).toBe(true);
      });

      test('offers the allowed page sizes in a labelled select and asks for the one picked', async () => {
        const page = await showing(2, { items: [row], total: 25 });
        const select = must(find(page.tree, (element) => element.props['data-component'] === 'Select'), 'the page size select');
        expect(select.props.value).toBe('10');
        expect(withTag(select, 'div').filter((element) => element.props.role === 'option').map((element) => element.props['data-value'])).toEqual([
          '10',
          '25',
          '50',
          '100',
        ]);
        expect(namesOf(page.tree, 'button')).toContain('Rows per page');
        (select.props.onValueChange as (value: string) => void)('25');
        expect(calls()).toEqual([['pageSize', 25]]);
      });

      test('a page past the end says so, with a way back to the last page', async () => {
        const page = await showing(9, { items: [], total: 25 });
        expect(withTag(page.tree, 'table')).toHaveLength(0);
        const message = must(find(page.tree, (element) => textOf(element).includes('page 9') && element.props.role === 'status'), 'the message');
        expect(textOf(message)).toBe(`There are no ${noun} on page 9.`);
        expect(find(page.tree, (element) => textOf(element) === 'Page 9')).toBeDefined();
        expect(textOf(must(find(page.tree, (element) => element.props['aria-live'] === 'polite'), 'the status line'))).toBe(
          `25 ${noun} in total`,
        );
        await page.click('Go to the last page');
        await page.click('Previous page');
        expect(calls()).toEqual([
          ['page', 3],
          ['page', 3],
        ]);
      });

      test('a table with no rows at all says so and has no pager', async () => {
        const page = await showing(1, { items: [], total: 0 });
        expect(page.tree.map(textOf).join('')).toContain(empty);
        expect(namesOf(page.tree, 'button')).toEqual([]);
      });

      test('every control is a named button, so the keyboard reaches all of them', async () => {
        const page = await showing(2, { items: [row], total: 25 });
        expect(unnamedControls(page.tree)).toEqual([]);
        for (const name of ['Previous page', 'Next page']) {
          expect(button(page.tree, name).props['data-component']).toBe('Button');
        }
      });
    });
  });

  describe('user actions', () => {
    const actions = (): Promise<Mounted> =>
      mount('userActions', { props: { user: { id: 'u1', name: 'Ada Lovelace', role: 'admin', banned: false } } });

    test('the trigger is a Button named Actions, drawn with an icon the name does not depend on', async () => {
      const page = await actions();
      const buttons = withTag(page.tree, 'button');
      expect(buttons).toHaveLength(1);
      const trigger = must(buttons[0], 'the trigger');
      expect(accessibleName(trigger, elementsOf(page.tree))).toBe('Actions');
      expect(trigger.props['data-component']).toBe('Button');
      expect(trigger.props.variant).toBe('ghost');
      expect(trigger.props.size).toBe('icon');
      expect(find(trigger, (element) => element.props['data-icon'] === 'MoreHorizontal')).toBeDefined();
      expect(textOf(trigger)).toBe('');
    });

    test('the menu offers the other roles and the ban', async () => {
      const page = await actions();
      const menu = must(find(page.tree, (element) => element.props.role === 'menu'), 'the menu');
      const entries = elementsOf(menu.children).filter((element) => element.props.role === 'menuitem');
      expect(entries.map(textOf)).toEqual(['Set role: user', 'Set role: manager', 'Ban User']);
    });

    test('the signed-in user gets no action on their own row', async () => {
      (globalThis as Globals).__testViewerId = 'u1';
      try {
        const page = await actions();
        expect(page.tree).toEqual([]);
      } finally {
        (globalThis as Globals).__testViewerId = undefined;
      }
    });
  });
});

// The fullstack blueprint writes its own admin pages: a data table over `users`, a role matrix, inline-edit fields.
const APP = 'src/app/(dashboard)';
const FULLSTACK_PAGES = {
  dashboardLayout: { file: `${APP}/layout.tsx`, exportName: 'default' },
  usersRoute: { file: `${APP}/admin/users/page.tsx`, exportName: 'default' },
  usersPage: { file: `${APP}/admin/users/users.client.tsx`, exportName: 'UsersClient' },
  userRoute: { file: `${APP}/admin/users/[id]/page.tsx`, exportName: 'default' },
  userDetailPage: { file: `${APP}/admin/users/[id]/user.client.tsx`, exportName: 'UserClient' },
  userTable: { file: 'src/components/admin/user-table.tsx', exportName: 'UserTable' },
  editUser: { file: 'src/components/admin/edit-user.tsx', exportName: 'EditUser' },
  createUserDialog: { file: 'src/components/admin/create-user-dialog.tsx', exportName: 'CreateUserDialog' },
  generatedPassword: GENERATED_PASSWORD,
  roles: { file: `${APP}/admin/roles/page.tsx`, exportName: 'default' },
  documents: { file: `${APP}/documents.client.tsx`, exportName: 'DocumentsClient' },
};

const INLINE_EDIT_MODULE = {
  '@repo/ui/components/ui/shuip/tanstack-form/inline-edit': {
    file: '../../packages/ui/src/components/ui/shuip/tanstack-form/inline-edit.tsx',
    exportName: 'InlineEditField',
    stub: 'inline-edit.mjs',
  },
};

const RESPONSE_ERROR_MODULE = {
  '@/lib/response-error': { file: 'src/lib/response-error.ts', exportName: 'responseErrorMessage', stub: 'response-error.mjs' },
};

const DATA_TABLE = { file: '../../packages/ui/src/components/block/shuip/data-table.tsx', exportName: 'DataTable' };

// A stand-in for each module a generated file imports that `explicit` does not cover: every name it imports
// renders nothing, except the `exports` a module is given (name to code). Returns the specifier to stand-in map,
// with the stand-ins written to `stubs`.
async function emptyStubsFor(
  source: string,
  stubs: string,
  explicit: Record<string, string>,
  exports: Record<string, Record<string, string>> = {},
): Promise<Record<string, string>> {
  const imports: Record<string, string> = { ...explicit };
  const declarations = source.matchAll(/^import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm);
  let count = 0;
  for (const [, clause, specifier] of declarations) {
    if (!clause || !specifier || specifier in imports) continue;
    const named = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '' && !name.startsWith('type '))
      .map((name) => name.split(/\s+as\s+/)[0] ?? name);
    const defaultName = clause.split('{')[0]?.replace(/,\s*$/, '').trim();
    const given = exports[specifier] ?? {};
    const lines = named.filter((name) => !(name in given)).map((name) => `export const ${name} = () => null;`);
    lines.push(...Object.entries(given).map(([name, code]) => `export const ${name} = ${code};`));
    if (defaultName && !defaultName.startsWith('*')) lines.push('export default () => null;');
    const file = `empty-${count++}.mjs`;
    await Bun.write(join(stubs, file), lines.join('\n'));
    imports[specifier] = `./${file}`;
  }
  return imports;
}

const PASSWORD = 's3cret-Passw0rd';

describe('cloudflare-fullstack-nextjs admin pages, rendered', () => {
  const blueprint = 'cloudflare-fullstack-nextjs';
  let tempDir: string;
  let mount: Mount<keyof typeof FULLSTACK_PAGES>;
  let load: Mounter<keyof typeof FULLSTACK_PAGES>['load'];
  let mountDataTable: Mount<'dataTable'>;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const web = join(tempDir, blueprint, 'apps/web');
    ({ mount, load } = await createMounter(
      tempDir,
      web,
      FULLSTACK_PAGES,
      {
        ...COMMON_IMPORTS,
        'next/link': './next-link.mjs',
        'next/navigation': './next-navigation.mjs',
        '@/lib/auth/session': './session.mjs',
        '@/trpc/server': './trpc-server.mjs',
        '@repo/ui/components/ui/skeleton': './skeleton.mjs',
        '@repo/ui/components/ui/search-input': './search-input.mjs',
        '@repo/ui/components/ui/field': './field.mjs',
        '@repo/api/user-list': './user-list.mjs',
        '@/hooks/use-user-list-params': './user-list-params.mjs',
        '@/components/table-pagination': './paged-list.mjs',
      },
      {
        ...GENERATED_PASSWORD_MODULE,
        ...INLINE_EDIT_MODULE,
        ...RESPONSE_ERROR_MODULE,
        ...FORMAT_DATE_MODULE,
        ...FORMAT_FILE_SIZE_MODULE,
        ...CONFIRM_DIALOG_MODULE,
      },
    ));

    // The data table block runs for real against a hand-made table instance, so the stand-ins around it are its own.
    const dataTableDir = join(tempDir, 'data-table');
    const source = await readTextFile(join(web, DATA_TABLE.file));
    const imports = await emptyStubsFor(
      source,
      join(dataTableDir, 'stubs'),
      { react: './react.mjs', '../../ui/table': './table.mjs', '../../../lib/utils': './utils.mjs' },
      { '@tanstack/react-table': { flexRender: "(component, context) => (typeof component === 'function' ? component(context) : component)" } },
    );
    ({ mount: mountDataTable } = await createMounter(dataTableDir, web, { dataTable: DATA_TABLE }, imports));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('page titles and headings', () => {
    test('the users list, a user and the roles are each titled, under the project template', async () => {
      expect((await load('usersRoute')).metadata).toEqual({ title: 'Users' });
      const { generateMetadata } = (await load('userRoute')) as {
        generateMetadata: (props: { params: Promise<{ id: string }> }) => Promise<unknown>;
      };
      expect(await generateMetadata({ params: Promise.resolve({ id: 'u1' }) })).toEqual({ title: 'User' });
      expect((await load('roles')).metadata).toEqual({ title: 'Roles' });
    });

    test('the users list and the roles page have a level one heading', async () => {
      const users = await mount('usersPage');
      expect(withTag(users.tree, 'h1').map(textOf)).toEqual(['Users']);
      const roles = await mount('roles');
      expect(withTag(roles.tree, 'h1').map(textOf)).toEqual(['Roles']);
    });

    test('a viewer who may not list users still gets the page heading', async () => {
      (globalThis as { __testDenied?: boolean }).__testDenied = true;
      try {
        const users = await mount('usersPage');
        expect(withTag(users.tree, 'h1').map(textOf)).toEqual(['Users']);
        expect(withTag(users.tree, 'table')).toEqual([]);
      } finally {
        (globalThis as { __testDenied?: boolean }).__testDenied = false;
      }
    });

    test('the three pages share one heading scale', async () => {
      const titles = [
        withTag((await mount('usersPage')).tree, 'h1')[0],
        withTag((await mount('editUser', { props: { user: USER } })).tree, 'h1')[0],
        withTag((await mount('roles')).tree, 'h1')[0],
      ];
      for (const title of titles) expectClasses(title, 'text-3xl', 'font-bold');
    });

    test('the dashboard has one main landmark and a smaller padding on a phone', async () => {
      const layout = await mount('dashboardLayout', { props: { children: 'Page body' } });
      expect(withTag(layout.tree, 'main')).toHaveLength(1);
      const body = must(elementsOf(layout.tree).filter((element) => textOf(element) === 'Page body').at(-1), 'the page body');
      expectClasses(body, 'p-4', 'sm:p-6');
    });
  });

  describe('users table', () => {
    const BANNED_USER = { ...USER, id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', role: null, banned: true };

    test('links each user by name and labels its columns', async () => {
      const table = await mount('userTable', { data: { items: [USER], total: 1 } });
      expect(namesOf(table.tree, 'a')).toEqual(['Ada Lovelace']);
      expect(withTag(table.tree, 'th').map(textOf)).toEqual(['Name', 'Email', 'Role']);
      expect(unnamedControls(table.tree)).toEqual([]);
    });

    test('drops Email below sm and Role below md, in the header and in every row', async () => {
      const table = await mount('userTable', { data: { items: [USER], total: 1 } });
      expectClasses(heading(table.tree, 'th', 'Email'), 'hidden', 'sm:table-cell');
      expectClasses(heading(table.tree, 'th', 'Role'), 'hidden', 'md:table-cell');
      expectClasses(find(table.tree, (element) => element.tag === 'td' && textOf(element) === USER.email), 'hidden', 'sm:table-cell');
      expectClasses(find(table.tree, (element) => element.tag === 'td' && textOf(element) === USER.role), 'hidden', 'md:table-cell');
    });

    test('the email and the role show under the name where their columns are hidden', async () => {
      const table = await mount('userTable', { data: { items: [USER], total: 1 } });
      const nameCell = must(find(table.tree, (element) => element.tag === 'td' && textOf(element).startsWith(USER.name)), 'the name cell');
      const subline = must(find(nameCell, (element) => classesOf(element).includes('md:hidden')), 'the line under the name');
      const email = must(find(subline, (element) => element.tag === 'span' && textOf(element) === USER.email), 'the email line');
      expectClasses(email, 'sm:hidden');
      expect(find(subline, (element) => textOf(element) === USER.role)).toBeDefined();
    });

    test('a banned user is marked with text that wraps beside a long name, and a user with no role reads as user', async () => {
      const table = await mount('userTable', { data: { items: [BANNED_USER], total: 1 } });
      const nameCell = must(find(table.tree, (element) => element.tag === 'td' && textOf(element).startsWith(BANNED_USER.name)), 'the name cell');
      expect(textOf(nameCell)).toContain('Banned');
      const lines = elementsOf(nameCell.children).filter((element) => withTag(element, 'a').length === 1 && textOf(element).includes('Banned'));
      const line = must(lines.at(-1), 'the name line');
      expectClasses(line, 'flex', 'flex-wrap');
      expect(find(table.tree, (element) => element.tag === 'td' && textOf(element) === 'user')).toBeDefined();
    });
  });

  // Every mutation that adds, removes or edits a row stales a page of its list, and the total of a search.
  describe('a mutation that changes a row refreshes its list and its count', () => {
    const invalidated = () => (globalThis as Globals).__invalidated;
    const submit = async (dialog: Mounted) => {
      const form = must(find(dialog.tree, (element) => element.tag === 'form'), 'the form');
      await dialog.act(async () => (form.props.onSubmit as (event: { preventDefault(): void }) => unknown)({ preventDefault() {} }));
    };

    test('creating a user', async () => {
      await submit(await mount('createUserDialog', { mutationResult: { password: PASSWORD } }));
      expect(invalidated()).toEqual(['users']);
    });

    test.each([
      ['editing the profile', async (page: Mounted) => page.act(() => (globalThis as Globals).__testFormOptions?.onSubmit({ value: { name: 'Ada' } }))],
      [
        'changing the role',
        async (page: Mounted) => {
          const select = must(find(page.tree, (element) => element.props['data-component'] === 'Select'), 'the role select');
          await page.act(() => (select.props.onValueChange as (role: string) => void)('manager'));
        },
      ],
      [
        'banning',
        async (page: Mounted) => {
          await page.click('Ban user');
          await page.click('Confirm ban');
        },
      ],
      [
        'deleting',
        async (page: Mounted) => {
          await page.click('Delete user');
          await page.click('Confirm delete');
        },
      ],
    ])('%s a user', async (_, act) => {
      const page = await mount('editUser', { props: { user: USER } });
      await act(page);
      expect(invalidated()).toEqual(['users']);
    });

    test('resetting a password changes no row of the list', async () => {
      const page = await mount('editUser', { props: { user: USER }, mutationResult: { password: PASSWORD } });
      await page.click('Generate new password');
      expect(invalidated()).toEqual([]);
    });

    test('deleting a document', async () => {
      const documents = { items: [{ id: 'd1', title: 'Plan', size: 2048, createdAt: new Date(0) }], total: 1 };
      const page = await mount('documents', { data: documents });
      await page.click('Delete');
      expect(invalidated(), 'the confirm button deletes nothing while no document is chosen').toEqual([]);
      await page.click('Delete Plan');
      expect(invalidated(), 'choosing a document to delete deletes nothing yet').toEqual([]);
      await page.click('Delete');
      expect(invalidated()).toEqual(['documents']);
    });

    test('unbanning a user', async () => {
      const page = await mount('editUser', { props: { user: { ...USER, banned: true } } });
      await page.click('Unban user');
      expect(invalidated()).toEqual(['users']);
    });

    test('uploading a document', async () => {
      const page = await mount('documents', { data: { items: [], total: 0 } });
      const picker = must(find(page.tree, (element) => element.tag === 'input' && element.props.type === 'file'), 'the file picker');
      (picker.props.ref as { current: unknown }).current = { files: [{ name: 'plan.pdf' }], value: 'plan.pdf' };
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async () => ({ ok: true })) as unknown as typeof fetch;
      try {
        await page.act(() =>
          (globalThis as Globals).__testFormOptions?.onSubmit({ value: { title: 'Plan' }, formApi: { reset() {} } } as never),
        );
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(invalidated()).toEqual(['documents']);
    });
  });

  describe('a failed document upload', () => {
    const uploadAnswering = async (response: Response) => {
      const page = await mount('documents', { data: { items: [], total: 0 } });
      const picker = must(find(page.tree, (element) => element.tag === 'input' && element.props.type === 'file'), 'the file picker');
      (picker.props.ref as { current: unknown }).current = { files: [{ name: 'plan.pdf' }], value: 'plan.pdf' };
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async () => response) as unknown as typeof fetch;
      try {
        await page.act(() =>
          (globalThis as Globals).__testFormOptions?.onSubmit({ value: { title: 'Plan' }, formApi: { reset() {} } } as never),
        );
      } finally {
        globalThis.fetch = realFetch;
      }
    };

    test('tells the user so when the server answers with an empty body', async () => {
      await uploadAnswering(new Response('', { status: 500 }));
      expect(toasts()).toEqual([{ kind: 'error', message: 'Upload failed' }]);
    });

    test('shows the reason the server gave', async () => {
      await uploadAnswering(new Response('File too large (25 MB max)', { status: 413 }));
      expect(toasts()).toEqual([{ kind: 'error', message: 'File too large (25 MB max)' }]);
    });
  });

  describe('banning a user', () => {
    const invalidated = () => (globalThis as Globals).__invalidated;

    test('asks for a confirmation before it acts, and cancelling leaves the user as is', async () => {
      const page = await mount('editUser', { props: { user: USER } });
      await page.click('Ban user');

      expect(invalidated()).toEqual([]);
      expect(toasts()).toEqual([]);
      const names = withTag(page.tree, 'button').map((button) => accessibleName(button, elementsOf(page.tree)));
      expect(names).toContain('Confirm ban');
      expect(names).not.toContain('Ban user');

      await page.click('Cancel');
      expect(invalidated()).toEqual([]);
      const afterCancel = withTag(page.tree, 'button').map((button) => accessibleName(button, elementsOf(page.tree)));
      expect(afterCancel).toContain('Ban user');
      expect(afterCancel).not.toContain('Confirm ban');
    });
  });

  describe('data table block', () => {
    const column = (id: string, header: string, meta?: { className: string }) => ({
      id,
      columnDef: { header, cell: () => `${id} value`, meta },
      getIsPinned: () => false,
      getSize: () => 100,
    });
    const columns = [column('name', 'Name'), column('email', 'Email', { className: 'hidden sm:table-cell' })];
    const table = {
      getVisibleLeafColumns: () => columns,
      getHeaderGroups: () => [
        { id: 'headers', headers: columns.map((each) => ({ id: each.id, colSpan: 1, column: each, isPlaceholder: false, getContext: () => ({}) })) },
      ],
      getRowModel: () => ({
        rows: [
          {
            id: 'row',
            original: {},
            getIsSelected: () => false,
            getVisibleCells: () => columns.map((each) => ({ id: `row_${each.id}`, column: each, getContext: () => ({}) })),
          },
        ],
      }),
      getState: () => ({ pagination: { pageSize: 10 } }),
      getTotalSize: () => 200,
    };

    test('a column with its own classes gets them on its header and on every cell, and no other column does', async () => {
      const page = await mountDataTable('dataTable', { props: { table, layout: 'auto' } });
      expectClasses(heading(page.tree, 'th', 'Email'), 'hidden', 'sm:table-cell');
      expectClasses(find(page.tree, (element) => element.tag === 'td' && textOf(element) === 'email value'), 'hidden', 'sm:table-cell');
      expect(classesOf(must(heading(page.tree, 'th', 'Name'), 'the Name header'))).not.toContain('hidden');
      expect(classesOf(must(find(page.tree, (element) => element.tag === 'td' && textOf(element) === 'name value'), 'a Name cell'))).not.toContain('hidden');
    });

    test('the placeholder rows of a loading table hide the same column', async () => {
      const page = await mountDataTable('dataTable', { props: { table, layout: 'auto', isLoading: true } });
      const cells = withTag(must(withTag(page.tree, 'tbody')[0], 'the body'), 'td');
      expect(cells).toHaveLength(20);
      const hidden = cells.filter((cell) => classesOf(cell).includes('hidden'));
      expect(hidden).toHaveLength(10);
      for (const cell of hidden) expectClasses(cell, 'sm:table-cell');
    });
  });

  describe('user detail', () => {
    test('the back link is a Button with an icon and a name', async () => {
      const page = await mount('userDetailPage', { data: USER });
      const backLink = must(find(page.tree, (element) => element.tag === 'a'), 'the back link');
      expect(backLink.props.href).toBe('/admin/users');
      expect(accessibleName(backLink, elementsOf(page.tree))).toBe('Back to users');
      expect(backLink.props['data-component']).toBe('Button');
      expect(find(backLink, (element) => element.props['data-icon'] === 'ArrowLeft')).toBeDefined();
    });

    test('the page is titled by the user and its sections are headings below it', async () => {
      const page = await mount('editUser', { props: { user: USER } });
      expect(withTag(page.tree, 'h1').map(textOf)).toEqual([USER.name]);
      expect(withTag(page.tree, 'h2').map(textOf)).toEqual(['Profile', 'Role', 'Password', 'Danger zone']);
      expectClasses(withTag(page.tree, 'h1')[0], 'min-w-0', 'break-words');
      expectClasses(find(page.tree, (element) => element.tag === 'p' && textOf(element) === USER.email), 'wrap-anywhere');
    });

    test('every profile field is a native button named by its term and its value', async () => {
      const page = await mount('editUser', { props: { user: USER } });
      const all = elementsOf(page.tree);
      const fields = withTag(page.tree, 'button').filter((button) => button.props['data-slot'] === 'inline-edit');
      expect(fields.map((field) => accessibleName(field, all))).toEqual(['Display name Ada Lovelace', 'First name Ada', 'Last name Lovelace', 'Phone —']);
      for (const field of fields) {
        expect(field.props.type).toBe('button');
        expect(field.props.role).toBeUndefined();
        expect(field.props.tabIndex).toBeUndefined();
      }
      expect(withTag(page.tree, 'dt').map((term) => term.props.id)).toEqual(fields.map((field) => String(field.props['aria-labelledby']).split(' ')[0]));
    });

    test('the signed-in user cannot change their own role, ban or delete themselves', async () => {
      (globalThis as Globals).__testViewerId = USER.id;
      try {
        const page = await mount('editUser', { props: { user: USER } });
        expect(withTag(page.tree, 'h2').map(textOf)).toEqual(['Profile', 'Password']);
        expect(find(page.tree, (element) => element.props.role === 'combobox')).toBeUndefined();
        const actions = withTag(page.tree, 'button').filter((button) => button.props['data-component'] === 'Button');
        expect(actions.map((button) => accessibleName(button, elementsOf(page.tree)))).toEqual(['Generate new password']);
      } finally {
        (globalThis as Globals).__testViewerId = undefined;
      }
    });

    test('the role select has a name', async () => {
      const page = await mount('editUser', { props: { user: USER } });
      const select = must(find(page.tree, (element) => element.props.role === 'combobox'), 'the role select');
      expect(accessibleName(select, elementsOf(page.tree))).toBe('Role');
    });

    test('every action is a Button with a name', async () => {
      const page = await mount('editUser', { props: { user: USER } });
      const actions = withTag(page.tree, 'button').filter((button) => button.props['data-component'] === 'Button');
      expect(actions.map((button) => accessibleName(button, elementsOf(page.tree)))).toEqual(['Generate new password', 'Ban user', 'Delete user']);
      expect(unnamedControls(page.tree)).toEqual([]);
    });

    test('a generated password is a labelled field with a named copy button', async () => {
      const page = await mount('editUser', { props: { user: USER }, mutationResult: { password: PASSWORD } });
      await page.click('Generate new password');
      const field = must(find(page.tree, (element) => element.tag === 'input'), 'the password field');
      expect(accessibleName(field, elementsOf(page.tree))).toBe('Generated password');
      expect(field.props.value).toBe(PASSWORD);
      expect(field.props.readOnly).toBe(true);
      expect(namesOf(page.tree, 'button')).toContain('Copy password');
      expect(unnamedControls(page.tree)).toEqual([]);
    });

    test('a new password does not keep the Copied state of the previous one', async () => {
      const page = await mount('editUser', { props: { user: USER }, mutationResult: { password: PASSWORD } });
      await page.click('Generate new password');
      await page.click('Copy password');
      expect(namesOf(page.tree, 'button')).toContain('Copied');
      (globalThis as Globals).__testMutationResult = { password: 'next-Passw0rd' };
      await page.click('Generate new password');
      expect(namesOf(page.tree, 'button')).toContain('Copy password');
      expect(namesOf(page.tree, 'button')).not.toContain('Copied');
    });

    test('the sections get a smaller padding on a phone', async () => {
      const page = await mount('editUser', { props: { user: USER } });
      for (const section of withTag(page.tree, 'section')) expectClasses(section, 'p-4', 'sm:p-6');
    });
  });

  describe('generated password', () => {
    test('copying announces the result through the button name', async () => {
      const page = await mount('generatedPassword', { props: { password: PASSWORD } });
      expect(namesOf(page.tree, 'button')).toEqual(['Copy password']);
      await page.click('Copy password');
      expect(namesOf(page.tree, 'button')).toEqual(['Copied']);
      expect(toasts()).toEqual([{ kind: 'success', message: 'Password copied' }]);
    });

    test('a refused clipboard tells the user and leaves the button unchanged', async () => {
      const page = await mount('generatedPassword', { props: { password: PASSWORD } });
      const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
      try {
        await page.click('Copy password');
        expect(namesOf(page.tree, 'button')).toEqual(['Copy password']);
        expect(toasts().map((toast) => toast.kind)).toEqual(['error']);
      } finally {
        if (clipboard) Object.defineProperty(globalThis.navigator, 'clipboard', clipboard);
      }
    });
  });

  describe('create user dialog', () => {
    test('the form scrolls inside the dialog instead of running off a short phone screen', async () => {
      const dialog = await mount('createUserDialog');
      expectClasses(find(dialog.tree, (element) => element.props.role === 'dialog'), 'max-h-11/12', 'overflow-y-auto');
    });

    test('the first and last name stack on a phone', async () => {
      const dialog = await mount('createUserDialog');
      const names = (element: RenderedElement): string => withTag(element, 'input').map((input) => input.props['aria-label']).join();
      const grid = must(find(dialog.tree, (element) => element.tag === 'div' && names(element) === 'First name,Last name'), 'the name grid');
      expectClasses(grid, 'grid', 'sm:grid-cols-2');
      expect(classesOf(grid)).not.toContain('grid-cols-2');
    });

    test('the created password is a labelled field with a named copy button', async () => {
      const dialog = await mount('createUserDialog', { mutationResult: { password: PASSWORD } });
      const form = must(find(dialog.tree, (element) => element.tag === 'form'), 'the form');
      await dialog.act(async () => (form.props.onSubmit as (event: { preventDefault(): void }) => unknown)({ preventDefault() {} }));
      const field = must(find(dialog.tree, (element) => element.tag === 'input'), 'the password field');
      expect(accessibleName(field, elementsOf(dialog.tree))).toBe('Generated password');
      expect(field.props.value).toBe(PASSWORD);
      expect(namesOf(dialog.tree, 'button')).toEqual(['Create user', 'Copy password', 'Done']);
      expect(unnamedControls(dialog.tree)).toEqual([]);
    });
  });

  describe('roles page', () => {
    const PERMISSIONS = ['user.create', 'user.list', 'contact.create', 'contact.read'];
    const table = async (): Promise<RenderedElement> => must(withTag((await mount('roles')).tree, 'table')[0], 'the table');
    const headers = (element: RenderedElement, scope: string): RenderedElement[] => withTag(element, 'th').filter((header) => header.props.scope === scope);

    test('is one table named by a caption, with a header for each column and each row', async () => {
      const roles = await table();
      expect(textOf(must(withTag(roles, 'caption')[0], 'the caption'))).toBe('Permissions granted to each role');
      expect(headers(roles, 'col').map(textOf)).toEqual(['Permission', 'admin(you)', 'manager']);
      expect(headers(roles, 'row').map(textOf)).toEqual(PERMISSIONS);
      for (const row of withTag(must(withTag(roles, 'tbody')[0], 'the body'), 'tr')) expect(withTag(row, 'th')[0]?.props.scope).toBe('row');
    });

    test('says Allowed or Denied in text and draws a check or a dash, so colour never carries it', async () => {
      const roles = await table();
      const verdicts = (permission: string): string[] => {
        const row = must(withTag(roles, 'tr').find((candidate) => withTag(candidate, 'th').some((header) => textOf(header) === permission)), `the ${permission} row`);
        return withTag(row, 'td').map(textOf);
      };
      expect(verdicts('user.create')).toEqual(['Allowed', 'Denied']);
      expect(verdicts('contact.create')).toEqual(['Allowed', 'Denied']);
      expect(verdicts('contact.read')).toEqual(['Allowed', 'Allowed']);

      for (const cell of withTag(roles, 'td')) {
        const allowed = textOf(cell) === 'Allowed';
        const icon = must(find(cell, (element) => element.tag === 'svg'), 'the icon');
        expect(icon.props['data-icon']).toBe(allowed ? 'Check' : 'Minus');
        expect(icon.props['aria-hidden']).toBe('true');
        expect(icon.props['aria-label']).toBeUndefined();
        expectClasses(icon, allowed ? 'text-primary' : 'text-muted-foreground');
        expect(classesOf(icon)).not.toContain('text-muted-foreground/40');
      }
    });

    test('marks the role of the signed-in admin with text', async () => {
      const roles = await table();
      expect(headers(roles, 'col').map(textOf).filter((name) => name.includes('(you)'))).toEqual(['admin(you)']);
    });

    test('is compact enough to fit a phone and scrolls inside its frame when it does not', async () => {
      const page = await mount('roles');
      const frame = must(find(page.tree, (element) => classesOf(element).includes('overflow-x-auto')), 'the table frame');
      expect(withTag(frame, 'table')).toHaveLength(1);
      for (const cell of [...withTag(page.tree, 'th'), ...withTag(page.tree, 'td')]) expectClasses(cell, 'px-2', 'sm:px-4');
      expectClasses(headers(must(withTag(page.tree, 'table')[0], 'the table'), 'row')[0], 'whitespace-normal', 'wrap-anywhere');
    });

    test('rounds its corners over the header row and the current role column', async () => {
      const page = await mount('roles');
      const frame = must(find(page.tree, (element) => classesOf(element).includes('rounded-lg') && withTag(element, 'table').length === 1), 'the rounded frame');
      expectClasses(frame, 'border', 'overflow-hidden');
    });
  });
});
