import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_HOOKS_STUB,
  type RenderedChild,
  type RenderedElement,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  filesUnder,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { NEXTJS_PAGES, TANSTACK_START_PAGES } from './org-dashboard-pages';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface DetailPage {
  file: string;
  exportName: string;
}

interface Blueprint {
  name: string;
  router: 'next' | 'start';
  userProcedure: string;
  user: DetailPage;
  contact?: { procedure: string; page: DetailPage };
}

const BLUEPRINTS: Blueprint[] = [
  {
    name: 'cloudflare-fullstack-nextjs',
    router: 'next',
    userProcedure: 'users.get',
    user: { file: 'src/app/(dashboard)/admin/users/[id]/user.client.tsx', exportName: 'UserClient' },
  },
  {
    name: 'org-dashboard-nextjs',
    router: 'next',
    userProcedure: 'user.getById',
    user: NEXTJS_PAGES.userDetail,
    contact: { procedure: 'contact.getById', page: NEXTJS_PAGES.contactDetail },
  },
  {
    name: 'org-dashboard-tanstack-start',
    router: 'start',
    userProcedure: 'user.getById',
    user: TANSTACK_START_PAGES.userDetail,
    contact: { procedure: 'contact.getById', page: TANSTACK_START_PAGES.contactDetail },
  },
];

const SAMPLE_ID = 'k3x9z2q8';
const WEB = 'apps/web';

// Stand-ins for the packages the generated header and detail pages import. The router link becomes an `a`; a
// breadcrumb link given asChild hands back its child, as the shadcn component does. `trpc.a.b.queryOptions(input)`
// returns the procedure and its input, and both query hooks record what they were asked, so a test can compare the
// query the header reads with the one the page reads.
const STUBS: Record<string, string> = {
  'react.mjs': REACT_HOOKS_STUB,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const ArrowLeft = icon('ArrowLeft');
export const Check = icon('Check');
export const Copy = icon('Copy');
export const KeyRound = icon('KeyRound');
export const FileText = icon('FileText');
export const LayoutDashboard = icon('LayoutDashboard');
export const Shield = icon('Shield');
export const ShieldCheck = icon('ShieldCheck');
export const Users = icon('Users');`,
  'breadcrumb.mjs': `import { createElement } from './react.mjs';
const host = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const Breadcrumb = host('nav');
export const BreadcrumbList = host('ol');
export const BreadcrumbItem = host('li');
export const BreadcrumbPage = ({ children, ...props }) => createElement('span', { 'aria-current': 'page', ...props }, ...children);
export const BreadcrumbSeparator = () => createElement('li', { role: 'presentation', 'aria-hidden': 'true' });
export const BreadcrumbLink = ({ asChild, children, ...props }) =>
  asChild ? children[0] : createElement('a', props, ...children);`,
  'sidebar.mjs': `import { createElement } from './react.mjs';
export const SidebarTrigger = () => createElement('button', { 'aria-label': 'Toggle sidebar' });`,
  'skeleton.mjs': `export const Skeleton = (props) => ({ type: 'div', props: { 'data-component': 'Skeleton', ...props, children: [] } });`,
  'separator.mjs': `import { createElement } from './react.mjs';
export const Separator = () => createElement('hr', {});`,
  'next-link.mjs': `export default ({ href, children, ...props }) => ({ type: 'a', props: { href, ...props, children } });`,
  'next-navigation.mjs': `export const notFound = () => { throw { kind: 'notFound' }; };
export const usePathname = () => globalThis.__pathname;
export const useParams = () => ({ id: globalThis.__routeId });
export const useRouter = () => ({ push() {} });`,
  'tanstack-router.mjs': `export const notFound = () => ({ kind: 'notFound' });
export const Link = ({ to, children, ...props }) => ({ type: 'a', props: { href: to, ...props, children } });
export const useLocation = ({ select }) => select({ pathname: globalThis.__pathname });
export const useNavigate = () => () => {};`,
  'query.mjs': `const procedures = (path) => new Proxy(function () {}, {
  get: (_, key) => (key === 'then' ? undefined : key === 'queryOptions' || key === 'queryKey' ? (input) => ({ procedure: path.join('.'), input }) : procedures([...path, key])),
  apply: (_, __, args) => args[0] ?? {},
});
export const useTRPC = () => procedures([]);
const read = (options) => {
  globalThis.__queries.push(options);
  const status = globalThis.__queryStatus ?? 'success';
  return { data: status === 'success' ? globalThis.__queryData?.[options.procedure] : undefined, isPending: status === 'pending' };
};
// useQuery creates a query (an observer), useSuspenseQuery too; getQueryData only looks in the cache.
export const useQuery = (options) => {
  globalThis.__observed.push(options);
  return read(options);
};
export const useSuspenseQuery = read;
export const useMutation = () => ({ mutate() {}, isPending: false });
export const useQueryClient = () => ({
  invalidateQueries() {},
  getQueryCache: () => ({
    subscribe: (listener) => {
      globalThis.__cacheListeners?.push(listener);
      return () => {};
    },
  }),
  getQueryData: (key) => {
    globalThis.__queries.push(key);
    return (globalThis.__queryStatus ?? 'success') === 'success' ? globalThis.__queryData?.[key.procedure] : undefined;
  },
});`,
  'form.mjs': `export const useForm = () => ({
  state: { values: {} },
  Field: ({ children }) => children[0]({ state: { value: '' }, handleChange() {} }),
});`,
  'sonner.mjs': 'export const toast = { success() {}, error() {} };',
  'button.mjs': `export const Button = ({ asChild, children, ...props }) =>
  asChild ? children[0] : { type: 'button', props: { ...props, children } };`,
  'leaf.mjs': `export const Can = ({ children }) => children;
export const ContactForm = () => null;
export const EditUser = () => null;
export const GeneratedPassword = () => null;
export const formatDate = () => '';`,
  'invalidate-paged-list.mjs': 'export const invalidatePagedList = async () => {};',
};

const IMPORTS: Record<string, string> = {
  react: './react.mjs',
  'lucide-react': './icons.mjs',
  '@repo/ui/components/ui/breadcrumb': './breadcrumb.mjs',
  '@repo/ui/components/ui/sidebar': './sidebar.mjs',
  '@repo/ui/components/ui/separator': './separator.mjs',
  '@repo/ui/components/ui/skeleton': './skeleton.mjs',
  '@/components/navigation/app-breadcrumb': './app-breadcrumb.mjs',
  '@repo/ui/components/ui/button': './button.mjs',
  '@tanstack/react-query': './query.mjs',
  '@tanstack/react-form': './form.mjs',
  '@/trpc/providers': './query.mjs',
  sonner: './sonner.mjs',
  '@/components/can': './leaf.mjs',
  '@/components/contacts/contact-form': './leaf.mjs',
  '@/components/admin/edit-user': './leaf.mjs',
  '@/components/admin/generated-password': './leaf.mjs',
  '@/lib/format-date': './leaf.mjs',
  '@/lib/constants': './constants.mjs',
  '@/lib/invalidate-paged-list': './invalidate-paged-list.mjs',
};

const ROUTER_IMPORTS = {
  next: { 'next/link': './next-link.mjs', 'next/navigation': './next-navigation.mjs' },
  start: { '@tanstack/react-router': './tanstack-router.mjs' },
};

type Component = (props: Record<string, unknown>) => unknown;
type QueryData = Record<string, unknown>;
type QueryStatus = 'success' | 'pending' | 'error';
interface RecordedQuery {
  procedure: string;
  input: unknown;
}

const globals = globalThis as {
  __pathname?: string;
  __routeId?: string;
  __queries?: RecordedQuery[];
  __observed?: RecordedQuery[];
  __queryData?: QueryData;
  __queryStatus?: QueryStatus;
  __serverRender?: boolean;
  __subscriptions?: ((notify: () => void) => () => void)[];
  __cacheListeners?: ((event: { type: string }) => void)[];
};

const withoutGroups = (path: string): string => path.replace(/\([^/]+\)\//g, '');

async function nextjsPageUrls(web: string): Promise<string[]> {
  const root = join(web, 'src/app');
  // The catch-all page answers not found for every URL no page matches, so it is not a page of the app.
  const pages = (await filesUnder(join(root, '(dashboard)'))).filter(
    (file) => file.endsWith('/page.tsx') && !file.includes('/[...'),
  );
  return pages
    .map((file) => withoutGroups(file.slice(root.length + 1)).replace(/\/?page\.tsx$/, ''))
    .map((route) => `/${route}`.replace(/\[(\w+)\]/g, ':$1'));
}

// A TanStack Start file route is a page when it is not a layout (a sibling directory holds its children) and does
// not answer 404 for every visit. `_auth` routes are not part of the dashboard.
async function startPageUrls(web: string): Promise<string[]> {
  const root = join(web, 'src/routes/_dashboard');
  const files = (await filesUnder(root)).map((file) => file.slice(root.length + 1));
  const directories = new Set(files.flatMap((file) => file.split('/').slice(0, -1)));
  const urls: string[] = [];
  for (const file of files) {
    const route = file.replace(/\.tsx$/, '');
    if (directories.has(route)) continue;
    const source = await readTextFile(join(root, file));
    if (/beforeLoad:\s*\(\)\s*=>\s*\{\s*throw notFound\(\)/.test(source)) continue;
    urls.push(`/${route.replace(/\/?index$/, '')}`.replace(/\$(\w+)/g, ':$1'));
  }
  return urls;
}

const isDynamic = (url: string): boolean => url.includes(':');
const sampleOf = (url: string): string => url.replace(/:\w+/g, SAMPLE_ID);

interface Rendered {
  tree: RenderedChild[];
  crumbs: RenderedElement[];
  queries: RecordedQuery[];
  observed: RecordedQuery[];
}

const classesOf = (element: RenderedElement): string[] => String(element.props.className ?? '').split(/\s+/);

function expectClasses(element: RenderedElement | undefined, ...expected: string[]): void {
  expect(classesOf(must(element, `an element with ${expected.join(' ')}`))).toEqual(expect.arrayContaining(expected));
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not in the rendered header`);
  return value;
}

describe.each(BLUEPRINTS)('$name breadcrumb', (blueprint) => {
  let tempDir: string;
  let web: string;
  let pageUrls: string[];
  let header: Component;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let loadComponent: (page: DetailPage) => Promise<Component>;

  // A render starts from fresh hook state unless `keepState` asks for the re-render that follows a commit.
  const renderHeader = async (
    pathname: string,
    queryData: QueryData = {},
    status: QueryStatus = 'success',
    keepState = false,
  ): Promise<Rendered> => {
    if (keepState) react.beginRender();
    else react.resetState();
    globals.__pathname = pathname;
    globals.__queries = [];
    globals.__observed = [];
    globals.__queryData = queryData;
    globals.__queryStatus = status;
    const tree = await renderElementTree(await header({}));
    const crumbs = elementsOf(tree).filter((element) => element.tag === 'li' && element.props['aria-hidden'] !== 'true');
    return { tree, crumbs, queries: globals.__queries, observed: globals.__observed };
  };

  const links = (rendered: Rendered): RenderedElement[] =>
    elementsOf(rendered.tree).filter((element) => element.tag === 'a');

  const lastCrumbText = (rendered: Rendered): string => textOf(must(rendered.crumbs.at(-1), 'a crumb'));

  // A record the label cannot name: Start's query ends in error or has no data, a Next.js page puts null in the cache
  // for a record that is gone (an entry that is not in the cache yet is still loading).
  const unreadable = (procedure: string): { data: QueryData; status: QueryStatus }[] =>
    blueprint.router === 'start'
      ? [
          { data: {}, status: 'error' },
          { data: {}, status: 'success' },
        ]
      : [{ data: { [procedure]: null }, status: 'success' }];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint.name, '--blueprint', blueprint.name, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    web = join(tempDir, blueprint.name, WEB);
    pageUrls = blueprint.router === 'next' ? await nextjsPageUrls(web) : await startPageUrls(web);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;
    const imports = { ...IMPORTS, ...ROUTER_IMPORTS[blueprint.router] };
    await evaluateGeneratedModule(await readTextFile(join(web, 'src/lib/constants.ts')), join(stubs, 'constants.mjs'), imports);
    await evaluateGeneratedModule(
      await readTextFile(join(web, 'src/components/navigation/app-breadcrumb.tsx')),
      join(stubs, 'app-breadcrumb.mjs'),
      imports,
      'tsx',
    );

    loadComponent = async (page) => {
      const source = await readTextFile(join(web, page.file));
      const module = await evaluateGeneratedModule<Record<string, Component>>(
        source,
        join(stubs, `${page.exportName}-${page.file.replace(/\W/g, '_')}.mjs`),
        imports,
        'tsx',
      );
      return must(module[page.exportName], `${page.exportName} of ${page.file}`) as Component;
    };
    header = await loadComponent({ file: 'src/components/navigation/app-header.tsx', exportName: 'AppHeader' });
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the dashboard has pages to check', () => {
    expect(pageUrls).toContain('/admin/users');
    expect(pageUrls).toContain('/admin/users/:id');
    expect(pageUrls).not.toContain('/admin');
  });

  test('the last crumb of a user page is the name of the user, not the id', async () => {
    const rendered = await renderHeader(`/admin/users/${SAMPLE_ID}`, {
      [blueprint.userProcedure]: { id: SAMPLE_ID, name: 'Ada Lovelace' },
    });
    expect(lastCrumbText(rendered)).toBe('Ada Lovelace');
    expect(textOf({ tag: 'div', props: {}, children: rendered.tree }).toLowerCase()).not.toContain(SAMPLE_ID);
  });

  test('the user crumb reads the query the page already reads, so no request is added', async () => {
    const rendered = await renderHeader(`/admin/users/${SAMPLE_ID}`);
    const page = await loadComponent(blueprint.user);
    globals.__routeId = SAMPLE_ID;
    globals.__queries = [];
    globals.__queryData = {
      [blueprint.userProcedure]: { id: SAMPLE_ID, name: 'Ada Lovelace', email: 'ada@example.com', createdAt: '2024-01-01' },
    };
    await renderElementTree(await page({ id: SAMPLE_ID }));
    expect(rendered.queries).toEqual([{ procedure: blueprint.userProcedure, input: { id: SAMPLE_ID } }]);
    expect(globals.__queries).toEqual(rendered.queries);
  });

  // The header sits in the layout, above the page's hydration boundary. A query it creates keeps the page from
  // hydrating its own copy of the record (TanStack Query hydrates an existing entry in an effect), and the browser
  // fetches the record again: on the server render, and on a soft navigation from a list.
  test.if(blueprint.router === 'next')('the record crumb only reads the cache, on the server and in the browser', async () => {
    const trails = [`/admin/users/${SAMPLE_ID}`, ...(blueprint.contact ? [`/contacts/${SAMPLE_ID}`] : [])];
    for (const serverRender of [true, false]) {
      globals.__serverRender = serverRender;
      try {
        for (const trail of trails) expect((await renderHeader(trail)).observed, `${trail} ${serverRender}`).toEqual([]);
      } finally {
        globals.__serverRender = false;
      }
    }
  });

  // The query cache emits events while another component renders (useSuspenseQuery reports its result as it renders).
  // React refuses a store update that starts in a render, so the crumb hears the cache only after the render is over.
  test.if(blueprint.router === 'next')('the record crumb hears the query cache after the render that changed it', async () => {
    globals.__subscriptions = [];
    globals.__cacheListeners = [];
    try {
      await renderHeader(`/admin/users/${SAMPLE_ID}`);
      const subscribe = must(globals.__subscriptions.at(-1), 'the crumb subscription');
      let notified = 0;
      subscribe(() => {
        notified += 1;
      });
      expect(globals.__cacheListeners.length).toBeGreaterThan(0);
      for (const listener of globals.__cacheListeners) listener({ type: 'updated' });
      expect(notified, 'a store update inside the render that emitted the event').toBe(0);
      await Promise.resolve();
      expect(notified).toBeGreaterThan(0);
    } finally {
      globals.__subscriptions = undefined;
      globals.__cacheListeners = undefined;
    }
  });

  // A page whose record is gone answers not found before it hydrates anything, so the cache never receives the
  // record: a crumb still waiting after the page committed is for a record that is not coming.
  test.if(blueprint.router === 'next')('a record the page never put in the cache stops loading once the page has committed', async () => {
    const trails = [`/admin/users/${SAMPLE_ID}`, ...(blueprint.contact ? [`/contacts/${SAMPLE_ID}`] : [])];
    for (const trail of trails) {
      const loading = await renderHeader(trail, {}, 'success');
      expect(elementsOf(loading.tree).some((element) => element.props['data-component'] === 'Skeleton'), trail).toBe(true);
      react.flushEffects();
      const settled = await renderHeader(trail, {}, 'success', true);
      expect(elementsOf(settled.tree).some((element) => element.props['data-component'] === 'Skeleton'), trail).toBe(false);
      expect(lastCrumbText(settled)).toBe(trail.startsWith('/contacts') ? 'Contact' : 'User');
    }
  });

  test.if(blueprint.router === 'next')('the record crumb fills in once the page has put the record in the cache', async () => {
    const name = 'Ada Lovelace';
    const rendered = await renderHeader(`/admin/users/${SAMPLE_ID}`, { [blueprint.userProcedure]: { id: SAMPLE_ID, name } });
    expect(lastCrumbText(rendered)).toBe(name);
    expect(rendered.queries).toEqual([{ procedure: blueprint.userProcedure, input: { id: SAMPLE_ID } }]);
  });

  // A refetch can find the record gone while its page is open: the page answers the framework's not found, and no
  // inline state is left to drift from the one an unknown id gets.
  test('a detail page whose record is gone answers not found', async () => {
    const pages = [
      { page: blueprint.user, procedure: blueprint.userProcedure },
      ...(blueprint.contact ? [{ page: blueprint.contact.page, procedure: blueprint.contact.procedure }] : []),
    ];
    for (const { page, procedure } of pages) {
      const component = await loadComponent(page);
      globals.__routeId = SAMPLE_ID;
      globals.__queries = [];
      globals.__queryData = { [procedure]: null };
      let thrown: unknown;
      try {
        await renderElementTree(await component({ id: SAMPLE_ID }));
      } catch (error) {
        thrown = error;
      }
      expect(thrown, page.file).toEqual({ kind: 'notFound' });
    }
  });

  test('a page without a detail record reads nothing', async () => {
    for (const pathname of ['/', '/admin/users', '/admin/roles', '/profile/account']) {
      expect((await renderHeader(pathname)).queries).toEqual([]);
    }
  });

  test('the Admin crumb is plain text, because /admin has no page', async () => {
    const rendered = await renderHeader('/admin/users');
    const admin = must(
      rendered.crumbs.find((crumb) => textOf(crumb) === 'Admin'),
      'the Admin crumb',
    );
    expect(elementsOf(admin.children).some((element) => element.tag === 'a')).toBe(false);
    expect(links(rendered).map((link) => link.props.href)).toEqual(['/']);
  });

  test('no crumb of any page links to a route that has no page', async () => {
    expect(pageUrls.length).toBeGreaterThan(4);
    for (const url of pageUrls) {
      const rendered = await renderHeader(sampleOf(url));
      const hrefs = links(rendered).map((link) => String(link.props.href));
      for (const href of hrefs) {
        expect(pageUrls, `the crumb link ${href} on ${sampleOf(url)}`).toContain(href);
      }
      const last = must(rendered.crumbs.at(-1), 'a crumb');
      expect(elementsOf([last]).some((element) => element.tag === 'a'), `last crumb of ${sampleOf(url)}`).toBe(false);
    }
  });

  test('the pages the breadcrumb links to are exactly the static pages of the app', async () => {
    const staticUrls = pageUrls.filter((url) => !isDynamic(url) && url !== '/');
    const candidates = new Set(
      staticUrls.flatMap((url) => {
        const segments = url.split('/').filter(Boolean);
        return segments.map((_, index) => `/${segments.slice(0, index + 1).join('/')}`);
      }),
    );
    const linked: string[] = [];
    for (const candidate of candidates) {
      const rendered = await renderHeader(`${candidate}/below`);
      if (links(rendered).some((link) => link.props.href === candidate)) linked.push(candidate);
    }
    expect(linked.sort()).toEqual(staticUrls.sort());
  });

  test('on the home page Home is the current page, not a link to itself', async () => {
    const rendered = await renderHeader('/');
    expect(links(rendered)).toEqual([]);
    const current = elementsOf(rendered.tree).filter((element) => element.props['aria-current'] === 'page');
    expect(current.map(textOf)).toEqual(['Home']);
  });

  test('exactly one crumb is the current page, and Home links on every other page', async () => {
    for (const url of pageUrls.filter((candidate) => candidate !== '/')) {
      const rendered = await renderHeader(sampleOf(url));
      const current = elementsOf(rendered.tree).filter((element) => element.props['aria-current'] === 'page');
      expect(current, `current crumb on ${sampleOf(url)}`).toHaveLength(1);
      expect(links(rendered)[0]?.props.href).toBe('/');
    }
  });

  test('a long last crumb truncates on one line and keeps its full name in a title', async () => {
    const name = 'Alexandria Montgomery-Featherstonehaugh the Third';
    const rendered = await renderHeader(`/admin/users/${SAMPLE_ID}`, {
      [blueprint.userProcedure]: { id: SAMPLE_ID, name },
    });
    const all = elementsOf(rendered.tree);
    expectClasses(all.find((element) => element.tag === 'nav'), 'min-w-0');
    expectClasses(all.find((element) => element.tag === 'ol'), 'flex-nowrap');
    const page = must(
      all.find((element) => element.props['aria-current'] === 'page'),
      'the current crumb',
    );
    expectClasses(page, 'truncate');
    expect(all.find((element) => element.props.title === name && textOf(element) === name)).toBeDefined();
    expectClasses(rendered.crumbs.at(-1), 'min-w-0');
    for (const earlier of rendered.crumbs.slice(0, -1)) expectClasses(earlier, 'shrink-0');
  });

  test('every crumb of a trail keeps its full label in a title', async () => {
    const rendered = await renderHeader('/admin/roles');
    const titled = elementsOf(rendered.tree).filter((element) => typeof element.props.title === 'string');
    expect(titled.map((element) => element.props.title)).toEqual(['Admin', 'Roles']);
  });

  test('the user crumb shows a skeleton while loading, and the fallback when the user cannot be read', async () => {
    const loading = await renderHeader(`/admin/users/${SAMPLE_ID}`, {}, 'pending');
    expect(elementsOf(loading.tree).some((element) => element.props['data-component'] === 'Skeleton')).toBe(true);
    expect(lastCrumbText(loading)).toBe('');
    for (const { data, status } of unreadable(blueprint.userProcedure)) {
      const settled = await renderHeader(`/admin/users/${SAMPLE_ID}`, data, status);
      expect(elementsOf(settled.tree).some((element) => element.props['data-component'] === 'Skeleton')).toBe(false);
      expect(lastCrumbText(settled)).toBe('User');
    }
  });

  test('every crumb whose route has a page is a link', async () => {
    for (const url of pageUrls.filter((candidate) => !isDynamic(candidate))) {
      const rendered = await renderHeader(url);
      const ancestors = url.split('/').filter(Boolean).slice(0, -1).map((_, index, all) => `/${all.slice(0, index + 1).join('/')}`);
      const expected = ancestors.filter((ancestor) => pageUrls.includes(ancestor));
      const linked = links(rendered).map((link) => String(link.props.href)).filter((href) => href !== '/');
      expect(linked, `links on ${url}`).toEqual(expected);
    }
    const rendered = await renderHeader(`/admin/users/${SAMPLE_ID}`);
    expect(links(rendered).map((link) => link.props.href)).toEqual(['/', '/admin/users']);
  });

  if (blueprint.contact) {
    const { procedure, page } = blueprint.contact;

    test('the last crumb of a contact page is the name of the contact, not the id', async () => {
      const rendered = await renderHeader(`/contacts/${SAMPLE_ID}`, {
        [procedure]: { id: SAMPLE_ID, firstName: 'Grace', lastName: 'Hopper' },
      });
      expect(lastCrumbText(rendered)).toBe('Grace Hopper');
      expect(textOf({ tag: 'div', props: {}, children: rendered.tree }).toLowerCase()).not.toContain(SAMPLE_ID);
    });

    test('the contact crumb shows a skeleton while loading, and the fallback when the contact cannot be read', async () => {
      const loading = await renderHeader(`/contacts/${SAMPLE_ID}`, {}, 'pending');
      expect(elementsOf(loading.tree).some((element) => element.props['data-component'] === 'Skeleton')).toBe(true);
      expect(lastCrumbText(loading)).toBe('');
      for (const { data, status } of unreadable(procedure)) {
        const settled = await renderHeader(`/contacts/${SAMPLE_ID}`, data, status);
        expect(elementsOf(settled.tree).some((element) => element.props['data-component'] === 'Skeleton')).toBe(false);
        expect(lastCrumbText(settled)).toBe('Contact');
      }
    });

    test('the contact crumb reads the query the page already reads, so no request is added', async () => {
      const rendered = await renderHeader(`/contacts/${SAMPLE_ID}`);
      const component = await loadComponent(page);
      globals.__queries = [];
      globals.__queryData = {
        [procedure]: { id: SAMPLE_ID, firstName: 'Grace', lastName: 'Hopper', email: '', phone: '', company: '', notes: '' },
      };
      await renderElementTree(await component({ id: SAMPLE_ID }));
      expect(rendered.queries).toEqual([{ procedure, input: { id: SAMPLE_ID } }]);
      expect(globals.__queries).toEqual(rendered.queries);
    });
  }
});
