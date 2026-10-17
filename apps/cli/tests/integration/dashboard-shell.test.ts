import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_ELEMENT_STUB,
  type RenderedChild,
  type RenderedElement,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  fileExists,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const NEXTJS_BLUEPRINTS: string[] = ['org-dashboard-nextjs', 'cloudflare-fullstack-nextjs', 'multitenant-saas-nextjs'];
const START_BLUEPRINT = 'org-dashboard-tanstack-start';
const BLUEPRINTS = [...NEXTJS_BLUEPRINTS, START_BLUEPRINT];
const SIGNED_OUT_GUARD_BLUEPRINTS: string[] = ['org-dashboard-nextjs', 'cloudflare-fullstack-nextjs'];
const DETAIL_PAGE_BLUEPRINTS: string[] = ['org-dashboard-nextjs', 'cloudflare-fullstack-nextjs'];
const PROJECT_NAME = 'shell-check';

type Component = (props: Record<string, unknown>) => unknown;

// Stand-ins for the packages the generated shell components import. Components render to `{ type, props }` objects
// (see `renderElementTree`); hooks keep their state in slots that survive a re-render, and effects wait for
// `flushEffects` the way React runs them after a commit.
const STUBS: Record<string, string> = {
  'react.mjs': `${REACT_ELEMENT_STUB}
let slots = [];
let next = 0;
let effects = [];
export const beginRender = () => { next = 0; };
export const resetState = () => { slots = []; next = 0; effects = []; };
export const flushEffects = () => { const pending = effects; effects = []; for (const effect of pending) effect(); };
export const useState = (initial) => {
  const store = slots;
  const index = next++;
  if (!(index in store)) store[index] = initial;
  return [store[index], (value) => { store[index] = typeof value === 'function' ? value(store[index]) : value; }];
};
export const useEffect = (effect) => { effects.push(effect); };
export const useSyncExternalStore = (_subscribe, getSnapshot, getServerSnapshot) =>
  globalThis.__serverRender ? getServerSnapshot() : getSnapshot();
export const cache = (fn) => fn;
export const Suspense = ({ children }) => children[0];
export default { useState, useEffect, useSyncExternalStore, createElement, Fragment };`,
  'ui.mjs': `import { createElement } from './react.mjs';
const host = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const Box = host('div');
export const Section = host('section');
export const Heading = host('h3');
export const List = host('ul');
export const Item = host('li');
export const Rule = () => createElement('hr', {});
export const Button = ({ asChild, children, ...props }) => (asChild ? children[0] : createElement('button', props, ...children));
export const MenuItem = ({ asChild, children, ...props }) =>
  asChild ? children[0] : createElement('div', { role: 'menuitem', ...props }, ...children);
export const useSidebar = () => ({ isMobile: false });`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const ChevronsUpDown = icon('ChevronsUpDown');
export const LogOut = icon('LogOut');
export const Moon = icon('Moon');
export const Sun = icon('Sun');
export const UserIcon = icon('UserIcon');
export const LayoutDashboard = icon('LayoutDashboard');
export const Users = icon('Users');
export const Shield = icon('Shield');
export const ShieldCheck = icon('ShieldCheck');
export const FileText = icon('FileText');
export const ArrowUpDownIcon = 'ArrowUpDownIcon';
export const Logout01Icon = 'Logout01Icon';
export const Moon02Icon = 'Moon02Icon';
export const Sun03Icon = 'Sun03Icon';
export const HugeiconsIcon = ({ icon: name }) => createElement('svg', { 'aria-hidden': 'true', 'data-icon': String(name) });`,
  'themes.mjs': `export const useTheme = () => ({ theme: globalThis.__theme, resolvedTheme: globalThis.__theme, setTheme() {} });`,
  'next-navigation.mjs': `export const useRouter = () => ({ push() {} });
export const usePathname = () => globalThis.__pathname ?? '/';
export const useSearchParams = () => new URLSearchParams();
export const notFound = () => { throw { kind: 'notFound' }; };
export const redirect = (url) => { throw { redirectTo: url }; };`,
  'next-link.mjs': `export default ({ href, children, ...props }) => ({ type: 'a', props: { href, ...props, children } });`,
  'next-headers.mjs': `export const headers = async () => ({ get: (name) => globalThis.__requestHeaders?.[name.toLowerCase()] ?? null });`,
  'next-server.mjs': `export const NextResponse = { next: (init) => ({ init }) };`,
  'tanstack-router.mjs': `export const Link = ({ to, children, ...props }) => ({ type: 'a', props: { href: to, ...props, children } });
export const useRouter = () => ({ navigate: async () => {} });
export const useLocation = ({ select }) => select({ pathname: globalThis.__pathname ?? '/' });
export const notFound = () => ({ kind: 'notFound' });
export const Outlet = () => ({ type: 'div', props: { 'data-component': 'Outlet', children: [] } });
export const createFileRoute = () => (options) => ({ options, useRouteContext: () => ({ session: {} }) });`,
  'query.mjs': `export const useQueryClient = () => ({ clear() {} });`,
  'auth-client.mjs': `export const authClient = { signOut: async () => {} };`,
  'auth.mjs': `export const auth = { api: { getSession: async () => globalThis.__session ?? null } };
export const getAuth = async () => auth;`,
  'permission.mjs': `const DEFINITIONS = {
  admin: { user: ['list', 'create'], contact: ['create', 'read', 'update', 'delete'] },
  user: { contact: ['create', 'read', 'update', 'delete'] },
  manager: { contact: ['read'] },
};
const allowed = (permissions) => {
  const granted = DEFINITIONS[globalThis.__role] ?? {};
  return Object.entries(permissions).every(([resource, actions]) => actions.every((action) => granted[resource]?.includes(action)));
};
export const useCan = () => allowed;
export const usePermission = (permissions) => allowed(permissions);`,
  'trpc-server.mjs': `export const getQueryClient = () => ({ fetchQuery: async (options) => globalThis.__records?.[options.procedure] });
const procedures = (path) => new Proxy(function () {}, {
  get: (_, key) => (key === 'then' ? undefined : key === 'queryOptions' ? (input) => ({ procedure: path.join('.'), input }) : procedures([...path, key])),
});
export const trpc = procedures([]);
export const HydrateClient = ({ children }) => children[0];`,
  'session.mjs': `export const requireAdmin = async () => ({});
export const requirePermission = async () => ({});
export const requireSession = async () => ({});`,
  'leaf.mjs': `export const Skeleton = () => null;
export const QueryBoundary = ({ children }) => children[0];
export const UserDetail = () => null;
export const UserClient = () => null;
export const ContactDetail = () => null;
export const ContactClient = () => null;
export const DetailPending = () => null;
export const AppSidebar = () => null;
export const AppHeader = () => null;
export const Card = ({ children }) => children[0];
export const Separator = () => null;
export const DashboardNotFound = () => null;`,
};

const UI_IMPORTS: Record<string, string> = {
  react: './react.mjs',
  'lucide-react': './icons.mjs',
  '@hugeicons/core-free-icons': './icons.mjs',
  '@hugeicons/react': './icons.mjs',
  'next-themes': './themes.mjs',
  'next/navigation': './next-navigation.mjs',
  'next/link': './next-link.mjs',
  'next/headers': './next-headers.mjs',
  'next/server': './next-server.mjs',
  '@tanstack/react-router': './tanstack-router.mjs',
  '@tanstack/react-query': './query.mjs',
  '@repo/auth/auth-client': './auth-client.mjs',
  '@/lib/auth/auth': './auth.mjs',
  '@/lib/server': './auth.mjs',
  '@/hooks/use-permission': './permission.mjs',
  '@/lib/auth/session': './session.mjs',
  '@/trpc/server': './trpc-server.mjs',
  '@/components/query-boundary': './leaf.mjs',
  '@/components/detail-pending': './leaf.mjs',
  '@/components/navigation/app-sidebar': './leaf.mjs',
  '@/components/navigation/app-header': './leaf.mjs',
  '@/components/dashboard-not-found': './leaf.mjs',
  '@/lib/auth/guards': './session.mjs',
  '@repo/ui/components/ui/separator': './leaf.mjs',
  '@/components/admin/user-detail': './leaf.mjs',
  '@repo/ui/components/ui/skeleton': './leaf.mjs',
  '@repo/ui/components/ui/dropdown-menu': './dropdown-menu.mjs',
  '@repo/ui/components/ui/sidebar': './sidebar.mjs',
  '@repo/ui/components/ui/avatar': './avatar.mjs',
  '@repo/ui/components/ui/button': './button.mjs',
};

const SIBLING_COMPONENTS = {
  './user-detail': './leaf.mjs',
  './user.client': './leaf.mjs',
  './contact.client': './leaf.mjs',
};

const MODULES: Record<string, string> = {
  'dropdown-menu.mjs': `import { Box, Rule, MenuItem } from './ui.mjs';
export const DropdownMenu = Box;
export const DropdownMenuTrigger = ({ asChild, children, ...props }) => (asChild ? children[0] : Box({ children, ...props }));
export const DropdownMenuContent = Box;
export const DropdownMenuGroup = Box;
export const DropdownMenuLabel = Box;
export const DropdownMenuSeparator = Rule;
export const DropdownMenuItem = MenuItem;`,
  'sidebar.mjs': `import { createElement } from './react.mjs';
import { Box, Section, Heading, List, Item, Button, useSidebar } from './ui.mjs';
export { useSidebar };
export const SidebarMenu = List;
export const SidebarMenuItem = Item;
export const SidebarMenuButton = Button;
export const SidebarGroup = Section;
export const SidebarGroupLabel = Heading;
export const SidebarProvider = Box;
export const SidebarInset = ({ children, ...props }) => createElement('main', props, ...children);
export const SidebarTrigger = () => null;`,
  'avatar.mjs': `import { Box } from './ui.mjs';
export const Avatar = Box;
export const AvatarFallback = Box;
export const AvatarImage = () => null;`,
  'button.mjs': `import { Button } from './ui.mjs';
export { Button };`,
  'page-title.mjs': `export const pageTitle = (title = 'Home') => title + ' | ${PROJECT_NAME}';`,
};

interface FakeEvent {
  defaultPrevented: boolean;
  preventDefault: () => void;
}

const fakeEvent = (): FakeEvent => {
  const event: FakeEvent = {
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };
  return event;
};

const globals = globalThis as {
  __serverRender?: boolean;
  __theme?: string;
  __role?: string;
  __pathname?: string;
  __requestHeaders?: Record<string, string>;
  __session?: unknown;
  __records?: Record<string, unknown>;
};

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

const treeText = (tree: RenderedChild[]): string => textOf({ tag: 'div', props: {}, children: tree });
const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not there`);
  return value;
};

describe('dashboard shell', () => {
  let tempDir: string;
  let stubs: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  const webOf = (blueprint: string): string => join(tempDir, blueprint, 'apps/web');
  const read = (blueprint: string, file: string): Promise<string> => readTextFile(join(webOf(blueprint), file));

  const load = async <T,>(
    blueprint: string,
    file: string,
    extra: Record<string, string> = {},
    loader: 'ts' | 'tsx' = 'tsx',
  ): Promise<T> => {
    const imports = { ...UI_IMPORTS, ...extra };
    const target = join(stubs, `${blueprint}-${file.replace(/\W/g, '_')}.mjs`);
    return evaluateGeneratedModule<T>(await read(blueprint, file), target, imports, loader);
  };

  const render = async (component: Component, props: Record<string, unknown> = {}): Promise<RenderedChild[]> => {
    react.beginRender();
    return renderElementTree({ type: component, props });
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of BLUEPRINTS) {
      const result = await runCli(
        [blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode, result.stderr).toBe(0);
    }
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries({ ...STUBS, ...MODULES })) await Bun.write(join(stubs, name), source);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe.each(BLUEPRINTS)('%s user menu', (blueprint) => {
    test('selecting Logout keeps the menu open and shows the confirmation', async () => {
      const { NavUser } = await load<{ NavUser: Component }>(blueprint, 'src/components/navigation/nav-user.tsx');
      react.resetState();
      const session = { user: { name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin', image: null } };
      const logout = (tree: RenderedChild[]): RenderedElement | undefined =>
        elementsOf(tree).find((element) => element.props.role === 'menuitem' && textOf(element) === 'Logout');

      const before = await render(NavUser, { session });
      const item = must(logout(before), 'the Logout menu item');
      expect(treeText(before)).not.toContain('Are you sure?');
      const select = item.props.onSelect as ((event: FakeEvent) => void) | undefined;
      expect(select, 'a Radix item closes the menu on select unless onSelect prevents it').toBeInstanceOf(Function);
      const event = fakeEvent();
      select?.(event);
      expect(event.defaultPrevented).toBe(true);

      const after = await render(NavUser, { session });
      expect(treeText(after)).toContain('Are you sure?');
      expect(logout(after)).toBeUndefined();
    });
  });

  describe.each(BLUEPRINTS)('%s theme preference', (blueprint) => {
    const file = 'src/components/profile/preferences.tsx';

    test('the server render marks no theme, so the client markup matches it', async () => {
      const { Preferences } = await load<{ Preferences: Component }>(blueprint, file);
      globals.__theme = 'dark';
      const buttons = async (serverRender: boolean): Promise<Record<string, unknown>> => {
        globals.__serverRender = serverRender;
        try {
          react.resetState();
          const tree = await render(Preferences);
          return Object.fromEntries(
            elementsOf(tree)
              .filter((element) => element.tag === 'button')
              .map((element) => [textOf(element), element.props.variant]),
          );
        } finally {
          globals.__serverRender = false;
        }
      };
      expect(await buttons(true)).toEqual({ Light: 'outline', Dark: 'outline', System: 'outline' });
      expect(await buttons(false)).toEqual({ Light: 'outline', Dark: 'default', System: 'outline' });
    });
  });

  describe.each(['org-dashboard-nextjs', START_BLUEPRINT])('%s sidebar', (blueprint) => {
    const roles: [string, string[]][] = [
      ['admin', ['Dashboard', 'Contacts', 'Administration']],
      ['manager', ['Dashboard', 'Contacts']],
      ['user', ['Dashboard', 'Contacts']],
    ];

    test.each(roles)('%s sees no group without a link', async (role, expectedTitles) => {
      const icons = { 'lucide-react': './icons.mjs' };
      const constants = join(stubs, `${blueprint}-constants.mjs`);
      await evaluateGeneratedModule(await read(blueprint, 'src/lib/constants.ts'), constants, icons, 'ts');
      const { SidebarLinks } = await load<{ SidebarLinks: Component }>(blueprint, 'src/components/navigation/sidebar-links.tsx', {
        '@/lib/constants': `./${blueprint}-constants.mjs`,
      });
      globals.__role = role;
      const tree = await render(SidebarLinks);
      const groups = elementsOf(tree).filter((element) => element.tag === 'section');
      for (const group of groups) {
        const links = elementsOf(group.children).filter((element) => element.tag === 'a');
        expect(links.length, `a group of ${blueprint} for ${role} has no link: ${textOf(group)}`).toBeGreaterThan(0);
      }
      const labels = elementsOf(tree)
        .filter((element) => element.tag === 'h3')
        .map(textOf);
      const linkTexts = elementsOf(tree)
        .filter((element) => element.tag === 'a')
        .map(textOf);
      expect(labels.includes('Administration')).toBe(expectedTitles.includes('Administration'));
      expect(linkTexts).toEqual(expect.arrayContaining(expectedTitles.filter((title) => title !== 'Administration')));
    });

    test('the permission hook exposes useCan, so a group is decided before it renders', async () => {
      const source = await read(blueprint, 'src/hooks/use-permission.ts');
      expect(source).toMatch(/export function useCan\(/);
    });
  });

  describe.each(SIGNED_OUT_GUARD_BLUEPRINTS)('%s guard redirect', (blueprint) => {
    const proxyFile = blueprint === 'cloudflare-fullstack-nextjs' ? 'src/middleware.ts' : 'src/proxy.ts';

    const forwardedHeaders = async (
      incoming: Record<string, string>,
      pathname: string,
      search: string,
    ): Promise<Headers> => {
      const proxy = await load<{ default: (request: unknown) => Promise<{ init: { request: { headers: Headers } } }> }>(
        blueprint,
        proxyFile,
        {},
        'ts',
      );
      const response = await proxy.default({ headers: new Headers(incoming), nextUrl: { pathname, search } });
      return response.init.request.headers;
    };

    const requestPathHeader = async (): Promise<string> => {
      const forwarded = await forwardedHeaders({}, '/probe', '');
      return must([...forwarded.keys()][0], 'the header the proxy adds');
    };

    const guardRedirect = async (headerName: string, value?: string): Promise<string> => {
      const { requireSession } = await load<{ requireSession: Component }>(blueprint, 'src/lib/auth/session.ts', {}, 'ts');
      globals.__session = null;
      globals.__requestHeaders = value === undefined ? {} : { [headerName]: value };
      try {
        await requireSession({});
      } catch (thrown) {
        return (thrown as { redirectTo: string }).redirectTo;
      }
      throw new Error('requireSession did not redirect');
    };

    test('the proxy hands the requested path and query to server components, whatever the client sent', async () => {
      const headerName = await requestPathHeader();
      const forwarded = await forwardedHeaders({ [headerName]: '/spoofed' }, '/admin/users/42', '?tab=roles');
      expect(forwarded.get(headerName)).toBe('/admin/users/42?tab=roles');
    });

    test('an anonymous visit redirects to the login with the requested path', async () => {
      const headerName = await requestPathHeader();
      const target = await guardRedirect(headerName, '/admin/users/42?tab=roles');
      const url = new URL(target, 'http://localhost');
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/admin/users/42?tab=roles');
    });

    test('the login form turns that parameter into the destination through safeRedirectPath', async () => {
      const { safeRedirectPath } = await load<{ safeRedirectPath: (value: string | null) => string }>(
        blueprint,
        'src/lib/safe-redirect.ts',
        {},
        'ts',
      );
      expect(safeRedirectPath('/admin/users/42?tab=roles')).toBe('/admin/users/42?tab=roles');
      expect(safeRedirectPath('https://evil.example/admin')).toBe('/');
    });

    test('without a forwarded path the redirect is the plain login', async () => {
      const headerName = await requestPathHeader();
      expect(await guardRedirect(headerName)).toBe('/login');
    });
  });

  describe('cloudflare-fullstack-nextjs auth pages', () => {
    const blueprint = 'cloudflare-fullstack-nextjs';
    const hrefsOf = (tree: RenderedChild[]): unknown[] =>
      elementsOf(tree)
        .filter((element) => element.tag === 'a')
        .map((element) => element.props.href);

    const formStubs = {
      '@repo/ui/lib/form': './form.mjs',
      sonner: './sonner.mjs',
      zod: './zod.mjs',
      '@/lib/safe-redirect': './safe-redirect.mjs',
    };

    beforeAll(async () => {
      await Bun.write(
        join(stubs, 'form.mjs'),
        `const field = new Proxy({}, { get: () => () => null });
export const useAppForm = () => new Proxy({ handleSubmit() {} }, {
  get: (target, key) => (key in target ? target[key] : ({ children, ...props }) => (typeof children[0] === 'function' ? children[0](field) : children[0] ?? null)),
});`,
      );
      await Bun.write(join(stubs, 'sonner.mjs'), 'export const toast = { error() {} };');
      const schema = 'const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });';
      await Bun.write(join(stubs, 'zod.mjs'), `${schema}\nexport const z = chain;`);
      await Bun.write(join(stubs, 'safe-redirect.mjs'), "export const safeRedirectPath = (value) => value ?? '/';");
    });

    test('the login page links to the signup page', async () => {
      const { LoginForm } = await load<{ LoginForm: Component }>(blueprint, 'src/app/(auth)/login/login-form.tsx', formStubs);
      expect(hrefsOf(await render(LoginForm))).toContain('/signup');
    });

    test('the signup page links back to the login page', async () => {
      const { SignupForm } = await load<{ SignupForm: Component }>(blueprint, 'src/app/(auth)/signup/signup-form.tsx', formStubs);
      expect(hrefsOf(await render(SignupForm))).toContain('/login');
    });
  });

  describe.each(NEXTJS_BLUEPRINTS)('%s page titles', (blueprint) => {
    const declaresTitle = (source: string): boolean =>
      /export const metadata\b/.test(source) || /export (async )?function generateMetadata\b/.test(source);

    // The root layout only holds the default title ("Home"), so a page has a title of its own when it, or a layout
    // between it and the root, declares one.
    test('every page that renders content has a title of its own', async () => {
      const root = join(webOf(blueprint), 'src/app');
      const pages = (await filesUnder(root)).filter((file) => file.endsWith('/page.tsx'));
      expect(pages.length).toBeGreaterThan(5);
      const untitled: string[] = [];
      for (const page of pages) {
        const source = await readTextFile(page);
        const redirectsOnly = /redirect\(/.test(source) && !/return\s*\(?\s*</.test(source);
        if (redirectsOnly || declaresTitle(source)) continue;
        const layouts = page
          .slice(root.length + 1)
          .split('/')
          .slice(0, -1)
          .map((_, index, directories) => join(root, ...directories.slice(0, index + 1), 'layout.tsx'));
        const titledByLayout = (
          await Promise.all(
            layouts.map(async (layout) => (await fileExists(layout)) && declaresTitle(await readTextFile(layout))),
          )
        ).some(Boolean);
        if (!titledByLayout) untitled.push(page.slice(root.length + 1));
      }
      expect(untitled).toEqual([]);
    });
  });

  describe.each(DETAIL_PAGE_BLUEPRINTS)('%s detail page titles', (blueprint) => {
    const pages: [string, string][] =
      blueprint === 'org-dashboard-nextjs'
        ? [
            ['src/app/(dashboard)/admin/users/[id]/page.tsx', 'user.getById'],
            ['src/app/(dashboard)/contacts/[id]/page.tsx', 'contact.getById'],
          ]
        : [['src/app/(dashboard)/admin/users/[id]/page.tsx', 'users.get']];

    test.each(pages)('%s titles a missing record as not found, not as the record', async (file, procedure) => {
      const { generateMetadata } = await load<{
        generateMetadata: (props: { params: Promise<{ id: string }> }) => Promise<{ title: string }>;
      }>(blueprint, file, SIBLING_COMPONENTS, 'tsx');
      const params = Promise.resolve({ id: 'k3x9z2q8' });
      globals.__records = { [procedure]: null };
      expect((await generateMetadata({ params })).title).toBe('Page not found');
      globals.__records = { [procedure]: { id: 'k3x9z2q8', name: 'Ada Lovelace' } };
      expect((await generateMetadata({ params })).title).not.toBe('Page not found');
    });
  });

  describe(`${START_BLUEPRINT} page titles`, () => {
    test('every route that renders a page sets a title of its own', async () => {
      const root = join(webOf(START_BLUEPRINT), 'src/routes');
      const routes = (await filesUnder(root)).filter((file) => file.endsWith('.tsx'));
      const untitled: string[] = [];
      for (const route of routes) {
        const source = await readTextFile(route);
        if (!/\bcomponent:/.test(source) || /component: \w*Layout\b/.test(source)) continue;
        if (!/pageTitle\('[^']+'/.test(source) && !/pageTitle\(\w/.test(source)) untitled.push(route.slice(root.length + 1));
      }
      expect(untitled).toEqual([]);
    });

    test('a user that does not exist is titled as a missing page', async () => {
      const { Route } = await load<{
        Route: { options: { head: (context: { loaderData?: unknown }) => { meta: { title: string }[] } } };
      }>(
        START_BLUEPRINT,
        'src/routes/_dashboard/admin/users/$id.tsx',
        { '@/lib/page-title': './page-title.mjs' },
        'tsx',
      );
      const titleOf = (loaderData?: unknown): string => Route.options.head({ loaderData }).meta[0]?.title ?? '';
      expect(titleOf(undefined)).toStartWith('Page not found');
      expect(titleOf({ found: true })).toStartWith('User');
    });
  });

  describe.each(BLUEPRINTS)('%s not found page', (blueprint) => {
    test('renders inside the dashboard, without a main of its own', async () => {
      const file =
        blueprint === START_BLUEPRINT
          ? 'src/components/dashboard-not-found.tsx'
          : 'src/app/(dashboard)/not-found.tsx';
      expect(await fileExists(join(webOf(blueprint), file)), file).toBe(true);
      const module = await load<{ default?: Component; DashboardNotFound?: Component }>(blueprint, file);
      const NotFound = must(module.default ?? module.DashboardNotFound, 'the not found component');
      const tree = await render(NotFound);
      const elements = elementsOf(tree);
      expect(elements.some((element) => element.tag === 'main')).toBe(false);
      expect(elements.some((element) => element.tag === 'h1')).toBe(true);
      expect(elements.some((element) => element.tag === 'a' && element.props.href === '/')).toBe(true);
    });
  });

  describe.each(BLUEPRINTS)('%s dashboard layout', (blueprint) => {
    // The shadcn SidebarInset is already the main landmark, and a not found page renders inside the layout.
    test('has one main landmark', async () => {
      const layout =
        blueprint === START_BLUEPRINT
          ? (await load<{ Route: { options: { component: Component } } }>(blueprint, 'src/routes/_dashboard.tsx')).Route
              .options.component
          : (await load<{ default: Component }>(blueprint, 'src/app/(dashboard)/layout.tsx')).default;
      const tree = await render(must(layout, 'the dashboard layout'), { children: 'Page body' });
      expect(elementsOf(tree).filter((element) => element.tag === 'main')).toHaveLength(1);
    });
  });

  // TanStack Router renders the notFoundComponent of the route that handles a not found in place of that route's own
  // component. The layout route would therefore lose the sidebar and header, so each route that can answer not found
  // handles it itself, below the layout.
  describe(`${START_BLUEPRINT} not found routes`, () => {
    test('every dashboard route that answers not found renders the dashboard not found page, the layout never does', async () => {
      const root = join(webOf(START_BLUEPRINT), 'src/routes');
      const routes = (await filesUnder(root)).filter((file) => file.endsWith('.tsx'));
      const answering: string[] = [];
      for (const route of routes) {
        const name = route.slice(root.length + 1);
        const source = await readTextFile(route);
        const answersNotFound = /\bnotFound\(\)|requirePermission\(/.test(source);
        if (name.startsWith('_dashboard/') && answersNotFound) {
          answering.push(name);
          expect(source, name).toContain('notFoundComponent: DashboardNotFound');
        }
      }
      expect(answering.length).toBeGreaterThan(3);
      expect(await readTextFile(join(root, '_dashboard.tsx'))).not.toContain('notFoundComponent');
    });
  });

  describe('the devtools trigger', () => {
    test('does not sit over the sidebar toggle', async () => {
      const startRoot = await read(START_BLUEPRINT, 'src/routes/__root.tsx');
      expect(startRoot).toContain('TanStackDevtools');
      expect(startRoot).not.toContain("position: 'top-left'");
      const nextDevtools = await read('org-dashboard-nextjs', 'src/components/devtools.tsx');
      expect(nextDevtools).toContain('TanStackDevtools');
      expect(nextDevtools).not.toContain("position: 'top-left'");
    });
  });
});
