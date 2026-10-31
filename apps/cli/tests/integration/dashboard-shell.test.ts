import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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
  fileExists,
  filesUnder,
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
  'react.mjs': REACT_HOOKS_STUB,
  'ui.mjs': `import { createElement } from './react.mjs';
const host = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const Box = host('div');
export const Section = host('section');
export const Heading = host('h3');
export const List = host('ul');
export const Item = host('li');
export const Rule = () => createElement('hr', {});
export const Button = ({ asChild, children, ...props }) => (asChild ? children[0] : createElement('button', props, ...children));
// A Radix item given asChild hands its behaviour to its child, so the child becomes the menu item.
export const MenuItem = ({ asChild, children, ...props }) =>
  asChild
    ? { ...children[0], props: { role: 'menuitem', ...children[0].props, ...props } }
    : createElement('div', { role: 'menuitem', ...props }, ...children);
export const useSidebar = () => ({ isMobile: false });`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const ChevronsUpDown = icon('ChevronsUpDown');
export const LogOut = icon('LogOut');
export const Moon = icon('Moon');
export const Sun = icon('Sun');
export const Monitor = icon('Monitor');
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
export const ComputerIcon = 'ComputerIcon';
export const HugeiconsIcon = ({ icon: name }) => createElement('svg', { 'aria-hidden': 'true', 'data-icon': String(name) });`,
  'themes.mjs': `export const useTheme = () => ({
  theme: globalThis.__chosenTheme ?? globalThis.__theme,
  resolvedTheme: globalThis.__theme,
  setTheme: (value) => { (globalThis.__themeChanges ??= []).push(value); },
});`,
  'next-navigation.mjs': `export const useRouter = () => ({ push() {} });
export const usePathname = () => globalThis.__pathname ?? '/';
export const useSearchParams = () => new URLSearchParams(globalThis.__search ?? '');
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
// Only the pure check: a component that asks for a session hook of this module fails to import.
export const can = (role, permissions) => {
  const granted = DEFINITIONS[role] ?? {};
  return Object.entries(permissions).every(([resource, actions]) => actions.every((action) => granted[resource]?.includes(action)));
};`,
  'trpc-server.mjs': `export const getQueryClient = () => ({
  fetchQuery: async (options) => globalThis.__records?.[options.procedure],
  prefetchQuery: async () => {},
});
const procedures = (path) => new Proxy(function () {}, {
  get: (_, key) => (key === 'then' ? undefined : key === 'queryOptions' ? (input) => ({ procedure: path.join('.'), input }) : procedures([...path, key])),
});
export const trpc = procedures([]);
export const HydrateClient = ({ children }) => children[0];`,
  'session.mjs': `export const requireAdmin = async () => ({});
export const requirePermission = async () => ({});
export const requireSession = async () => ({ user: { role: 'admin' } });`,
  'leaf.mjs': `export const Skeleton = () => null;
export const QueryBoundary = ({ children }) => children[0];
export const UserDetail = () => null;
export const UserClient = () => null;
export const ContactDetail = () => null;
export const ContactClient = () => null;
export const DetailPending = () => null;
export const AppSidebar = () => null;
export const AppHeader = () => null;
export const CommandPaletteProvider = ({ children }) => children;
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
  '@/components/navigation/command-palette': './leaf.mjs',
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
  'dropdown-menu.mjs': `import { createElement } from './react.mjs';
import { Box, Rule, MenuItem } from './ui.mjs';
export const DropdownMenu = Box;
export const DropdownMenuTrigger = ({ asChild, children, ...props }) => (asChild ? children[0] : Box({ children, ...props }));
export const DropdownMenuContent = Box;
export const DropdownMenuGroup = Box;
export const DropdownMenuLabel = Box;
export const DropdownMenuSeparator = Rule;
export const DropdownMenuItem = MenuItem;
export const DropdownMenuRadioGroup = ({ children, value, onValueChange, ...props }) =>
  createElement('div', { role: 'group', ...props }, ...children.flat(Infinity).map((item) => ({
    ...item,
    props: { ...item.props, checked: item.props.value === value, onValueChange },
  })));
// Radix runs the item's own onSelect, then reports its value to the group whether or not the default was prevented.
export const DropdownMenuRadioItem = ({ children, onSelect, onValueChange, checked, ...props }) =>
  createElement('div', {
    role: 'menuitemradio',
    'aria-checked': checked,
    ...props,
    onSelect: (event) => { onSelect?.(event); onValueChange?.(props.value); },
  }, ...children);`,
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
  __chosenTheme?: string;
  __themeChanges?: string[];
  __search?: string;
  __pathname?: string;
  __requestHeaders?: Record<string, string>;
  __session?: unknown;
  __records?: Record<string, unknown>;
};

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

  const modulePath = (blueprint: string, file: string): string =>
    join(stubs, `${blueprint}-${file.replace(/\W/g, '_')}.mjs`);
  const relativeModule = (blueprint: string, file: string): string => `./${modulePath(blueprint, file).split('/').at(-1)}`;

  const load = async <T,>(
    blueprint: string,
    file: string,
    extra: Record<string, string> = {},
    loader: 'ts' | 'tsx' = 'tsx',
  ): Promise<T> => {
    const imports = { ...UI_IMPORTS, ...extra };
    return evaluateGeneratedModule<T>(await read(blueprint, file), modulePath(blueprint, file), imports, loader);
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
    const session = { user: { name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin', image: null } };
    let NavUser: Component;

    const items = (tree: RenderedChild[]): RenderedElement[] =>
      elementsOf(tree).filter((element) => element.props.role === 'menuitem');
    const itemNamed = (tree: RenderedChild[], name: string): RenderedElement | undefined =>
      items(tree).find((element) => textOf(element) === name);
    const select = (item: RenderedElement | undefined, what: string): FakeEvent => {
      const handler = item?.props.onSelect as ((event: FakeEvent) => void) | undefined;
      expect(handler, `${what} acts on select, the event of a Radix menu item`).toBeInstanceOf(Function);
      const event = fakeEvent();
      handler?.(event);
      return event;
    };
    const askConfirmation = async (): Promise<RenderedChild[]> => {
      react.resetState();
      const event = select(itemNamed(await render(NavUser, { session }), 'Logout'), 'Logout');
      expect(event.defaultPrevented, 'a Radix item closes the menu on select unless the handler prevents it').toBe(true);
      return render(NavUser, { session });
    };

    beforeAll(async () => {
      const hook = 'src/hooks/use-menu-confirmation.ts';
      await load(blueprint, hook, {}, 'ts');
      ({ NavUser } = await load<{ NavUser: Component }>(blueprint, 'src/components/navigation/nav-user.tsx', {
        '@/hooks/use-menu-confirmation': relativeModule(blueprint, hook),
      }));
    });

    test('selecting Logout keeps the menu open and shows the confirmation', async () => {
      react.resetState();
      expect(treeText(await render(NavUser, { session }))).not.toContain('Are you sure?');
      expect(treeText(await askConfirmation())).toContain('Are you sure?');
    });

    test('the confirmation is made of menu items, so the keyboard reaches it', async () => {
      const confirming = await askConfirmation();
      expect(items(confirming).map(textOf)).toEqual(expect.arrayContaining(['Logout', 'Cancel']));
      const confirm = must(itemNamed(confirming, 'Logout'), 'the confirm item');
      expect(confirm.props.variant).toBe('destructive');
      expect(confirm.props.size).toBe('sm');

      const cancel = select(itemNamed(confirming, 'Cancel'), 'Cancel');
      expect(cancel.defaultPrevented, 'cancelling keeps the menu open').toBe(true);
      const cancelled = await render(NavUser, { session });
      expect(treeText(cancelled)).not.toContain('Are you sure?');
      expect(itemNamed(cancelled, 'Logout')).toBeDefined();
    });

    test('Cancel takes the focus the removed Logout item leaves behind', async () => {
      const confirming = await askConfirmation();
      const cancel = must(itemNamed(confirming, 'Cancel'), 'the Cancel item');
      let focused = false;
      (cancel.props.ref as { current: unknown }).current = {
        focus: () => {
          focused = true;
        },
      };
      react.flushEffects();
      expect(focused).toBe(true);
    });

    test('Logout takes the focus back when Cancel removes the confirmation', async () => {
      const confirming = await askConfirmation();
      select(itemNamed(confirming, 'Cancel'), 'Cancel');
      const cancelled = await render(NavUser, { session });
      const logout = must(itemNamed(cancelled, 'Logout'), 'the Logout item');
      let focused = false;
      (logout.props.ref as { current: unknown }).current = {
        focus: () => {
          focused = true;
        },
      };
      react.flushEffects();
      expect(focused).toBe(true);
    });

    test('closing the menu forgets the confirmation', async () => {
      const menuOf = (tree: RenderedChild[]): RenderedElement =>
        must(
          elementsOf(tree).find((element) => typeof element.props.onOpenChange === 'function'),
          'the menu',
        );
      const confirming = await askConfirmation();
      const onOpenChange = menuOf(confirming).props.onOpenChange as (open: boolean) => void;
      onOpenChange(false);
      const closed = await render(NavUser, { session });
      expect(menuOf(closed).props.open).toBe(false);
      expect(treeText(closed)).not.toContain('Are you sure?');
    });

    describe('theme choices', () => {
      const THEMES = ['Light', 'Dark', 'System'];
      const radios = (tree: RenderedChild[]): RenderedElement[] =>
        elementsOf(tree).filter((element) => element.props.role === 'menuitemradio');
      const menu = async (chosen: string | undefined, resolved = 'dark'): Promise<RenderedChild[]> => {
        globals.__theme = resolved;
        globals.__chosenTheme = chosen;
        react.resetState();
        return render(NavUser, { session });
      };

      beforeEach(() => {
        globals.__themeChanges = [];
      });
      afterAll(() => {
        globals.__theme = undefined;
        globals.__chosenTheme = undefined;
        globals.__themeChanges = undefined;
      });

      test('Light, Dark and System are menu items of one radio group', async () => {
        const tree = await menu('light', 'light');
        expect(radios(tree).map(textOf)).toEqual(THEMES);
        const group = must(
          elementsOf(tree).find((element) => element.props.role === 'group'),
          'the theme group',
        );
        expect(radios(group.children)).toHaveLength(3);
        expect(group.props['aria-label'], 'the group is named, as the label beside it is not tied to it').toBe('Theme');
      });

      test.each(THEMES)('selecting %s applies it and keeps the menu open', async (name) => {
        const item = must(radios(await menu('light', 'light')).find((element) => textOf(element) === name), name);
        const event = select(item, name);
        expect(event.defaultPrevented, 'a Radix item closes the menu on select unless the handler prevents it').toBe(true);
        expect(globals.__themeChanges).toEqual([name.toLowerCase()]);
      });

      test('System is marked when it is the theme, not the theme it resolves to', async () => {
        const marked = async (chosen: string, resolved: string): Promise<string[]> =>
          radios(await menu(chosen, resolved))
            .filter((element) => element.props['aria-checked'] === true)
            .map(textOf);
        expect(await marked('system', 'dark')).toEqual(['System']);
        expect(await marked('system', 'light')).toEqual(['System']);
        expect(await marked('dark', 'dark')).toEqual(['Dark']);
        expect(await marked('light', 'dark')).toEqual(['Light']);
      });

      test('Profile still navigates and closes the menu', async () => {
        const profile = must(itemNamed(await menu('dark'), 'Profile'), 'the Profile item');
        expect(profile.tag).toBe('a');
        expect(profile.props.href).toBe('/profile/account');
        const event = fakeEvent();
        (profile.props.onSelect as ((event: FakeEvent) => void) | undefined)?.(event);
        expect(event.defaultPrevented, 'Profile keeps the default select, which closes the menu').toBe(false);
      });
    });
  });

  describe.each(BLUEPRINTS)('%s theme preference', (blueprint) => {
    const hook = 'src/hooks/use-mounted.ts';

    const rendered = async (serverRender: boolean): Promise<RenderedChild[]> => {
      await load(blueprint, hook, {}, 'ts');
      const { Preferences } = await load<{ Preferences: Component }>(blueprint, 'src/components/profile/preferences.tsx', {
        '@/hooks/use-mounted': relativeModule(blueprint, hook),
      });
      globals.__theme = 'dark';
      globals.__serverRender = serverRender;
      try {
        react.resetState();
        return await render(Preferences);
      } finally {
        globals.__serverRender = false;
      }
    };
    const buttonsOf = (tree: RenderedChild[]): Record<string, unknown[]> =>
      Object.fromEntries(
        elementsOf(tree)
          .filter((element) => element.tag === 'button')
          .map((element) => [textOf(element), [element.props.variant, element.props['aria-pressed']]]),
      );

    test('the server render marks no theme, so the client markup matches it', async () => {
      expect(buttonsOf(await rendered(true))).toEqual({
        Light: ['outline', false],
        Dark: ['outline', false],
        System: ['outline', false],
      });
      expect(buttonsOf(await rendered(false))).toEqual({
        Light: ['outline', false],
        Dark: ['default', true],
        System: ['outline', false],
      });
    });

    test('the theme buttons are a fieldset named by its legend', async () => {
      const tree = await rendered(false);
      const group = must(
        elementsOf(tree).find((element) => element.tag === 'fieldset'),
        'the theme fieldset',
      );
      const legend = elementsOf(group.children).find((element) => element.tag === 'legend');
      expect(legend && textOf(legend)).toBe('Theme');
      expect(elementsOf(group.children).filter((element) => element.tag === 'button')).toHaveLength(3);
    });
  });

  const SIDEBAR_BLUEPRINTS: [string, string][] = [
    ['org-dashboard-nextjs', 'Dashboard'],
    [START_BLUEPRINT, 'Dashboard'],
  ];
  describe.each(SIDEBAR_BLUEPRINTS)('%s sidebar', (blueprint, homeTitle) => {
    const roles: [string, boolean][] = [
      ['admin', true],
      ['manager', false],
      ['user', false],
    ];

    // The role comes from the layout as a prop, so a server render lists the same links as the browser does: the
    // permission module of this test has no session hook, and a component that asked for one would not import.
    test.each(roles)('%s sees no group without a link, on the server too', async (role, seesAdministration) => {
      await load(blueprint, 'src/lib/constants.ts', {}, 'ts');
      await load(blueprint, 'src/lib/allowed-routes.ts', { '@/lib/constants': relativeModule(blueprint, 'src/lib/constants.ts') }, 'ts');
      const { SidebarLinks } = await load<{ SidebarLinks: Component }>(blueprint, 'src/components/navigation/sidebar-links.tsx', {
        '@/lib/constants': relativeModule(blueprint, 'src/lib/constants.ts'),
        '@/lib/allowed-routes': relativeModule(blueprint, 'src/lib/allowed-routes.ts'),
      });
      globals.__serverRender = true;
      try {
        const tree = await render(SidebarLinks, { role });
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
        expect(labels.includes('Administration')).toBe(seesAdministration);
        expect(linkTexts).toContain(homeTitle);
      } finally {
        globals.__serverRender = false;
      }
    });

    test('the sidebar is handed the role of the session, and the permission module exports the check', async () => {
      const appSidebar = await read(blueprint, 'src/components/navigation/app-sidebar.tsx');
      expect(appSidebar).toContain('<SidebarLinks role={session.user.role} />');
      expect(await read(blueprint, 'src/hooks/use-permission.ts')).toMatch(/export function can\(/);
    });
  });

  describe.each(SIGNED_OUT_GUARD_BLUEPRINTS)('%s guard redirect', (blueprint) => {
    const proxyFile = blueprint === 'cloudflare-fullstack-nextjs' ? 'src/middleware.ts' : 'src/proxy.ts';
    let header: string;
    let imports: Record<string, string>;

    const forwardedHeaders = async (
      incoming: Record<string, string>,
      pathname: string,
      search: string,
    ): Promise<Headers> => {
      const proxy = await load<{ default: (request: unknown) => Promise<{ init: { request: { headers: Headers } } }> }>(
        blueprint,
        proxyFile,
        imports,
        'ts',
      );
      const response = await proxy.default({ headers: new Headers(incoming), nextUrl: { pathname, search } });
      return response.init.request.headers;
    };

    const guardRedirect = async (value?: string): Promise<string> => {
      const { requireSession } = await load<{ requireSession: Component }>(blueprint, 'src/lib/auth/session.ts', imports, 'ts');
      globals.__session = null;
      globals.__requestHeaders = value === undefined ? {} : { [header]: value };
      try {
        await requireSession({});
      } catch (thrown) {
        return (thrown as { redirectTo: string }).redirectTo;
      }
      throw new Error('requireSession did not redirect');
    };

    beforeAll(async () => {
      const module = await load<{ REQUEST_PATH_HEADER: string }>(blueprint, 'src/lib/auth/request-path.ts', {}, 'ts');
      header = module.REQUEST_PATH_HEADER;
      await load(blueprint, 'src/lib/safe-redirect.ts', {}, 'ts');
      imports = {
        '@/lib/auth/request-path': relativeModule(blueprint, 'src/lib/auth/request-path.ts'),
        '@/lib/safe-redirect': relativeModule(blueprint, 'src/lib/safe-redirect.ts'),
      };
    });

    test('the header name is exported once, and the proxy and the guard import it', async () => {
      expect(header).toBeTruthy();
      for (const file of [proxyFile, 'src/lib/auth/session.ts']) {
        const source = await read(blueprint, file);
        expect(source, file).toContain("from '@/lib/auth/request-path'");
        expect(source, file).not.toContain(header);
      }
    });

    test('the proxy hands the requested path and query to server components, whatever the client sent', async () => {
      const forwarded = await forwardedHeaders({ [header]: '/spoofed' }, '/admin/users/42', '?tab=roles');
      expect(forwarded.get(header)).toBe('/admin/users/42?tab=roles');
    });

    test('an anonymous visit redirects to the login with the requested path', async () => {
      const url = new URL(await guardRedirect('/admin/users/42?tab=roles'), 'http://localhost');
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe('/admin/users/42?tab=roles');
    });

    test('a header value that is not an internal path is dropped, as the proxy skips some paths', async () => {
      for (const hostile of ['//evil.example', 'https://evil.example/admin', '/\\evil.example']) {
        expect(await guardRedirect(hostile), hostile).toBe('/login');
      }
    });

    test('without a forwarded path the redirect is the plain login', async () => {
      expect(await guardRedirect()).toBe('/login');
    });
  });

  describe('cloudflare-fullstack-nextjs auth pages', () => {
    const blueprint = 'cloudflare-fullstack-nextjs';
    const hrefsOf = (tree: RenderedChild[]): unknown[] =>
      elementsOf(tree)
        .filter((element) => element.tag === 'a')
        .map((element) => element.props.href);
    const linkStyles = (tree: RenderedChild[]): string[] =>
      elementsOf(tree)
        .filter((element) => element.tag === 'a')
        .map((element) => String(element.props.className).replace(/\btext-sm\b|\btext-muted-foreground\b/g, '').trim());

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

    const renderForm = async (file: string, name: string, search = ''): Promise<RenderedChild[]> => {
      const module = await load<Record<string, Component>>(blueprint, file, formStubs);
      globals.__search = search;
      try {
        return await render(must(module[name], name));
      } finally {
        globals.__search = undefined;
      }
    };
    const LOGIN = 'src/app/(auth)/login/login-form.tsx';
    const SIGNUP = 'src/app/(auth)/signup/signup-form.tsx';
    const REQUESTED = 'redirectTo=%2Fadmin%2Fusers';

    test('the login page links to the signup page, and keeps the page the visitor asked for', async () => {
      expect(hrefsOf(await renderForm(LOGIN, 'LoginForm'))).toContain('/signup');
      expect(hrefsOf(await renderForm(LOGIN, 'LoginForm', REQUESTED))).toContain(`/signup?${REQUESTED}`);
    });

    test('the signup page links back to the login page, and keeps the page the visitor asked for', async () => {
      expect(hrefsOf(await renderForm(SIGNUP, 'SignupForm'))).toContain('/login');
      expect(hrefsOf(await renderForm(SIGNUP, 'SignupForm', REQUESTED))).toContain(`/login?${REQUESTED}`);
    });

    test('every link of the login form has the same style', async () => {
      expect(new Set(linkStyles(await renderForm(LOGIN, 'LoginForm'))).size).toBe(1);
    });
  });

  describe.each(NEXTJS_BLUEPRINTS)('%s catch-all page', (blueprint) => {
    test('a URL no page matches answers not found inside the dashboard group', async () => {
      const module = await load<{ default: Component; metadata: { title: string } }>(
        blueprint,
        'src/app/(dashboard)/[...slug]/page.tsx',
      );
      expect(module.metadata.title).toBe('Page not found');
      await expect(render(module.default)).rejects.toEqual({ kind: 'notFound' });
    });
  });

  describe.each(NEXTJS_BLUEPRINTS)('%s page titles', (blueprint) => {
    const declaresTitle = (source: string): boolean =>
      /export const metadata\b/.test(source) || /export (async )?function generateMetadata\b/.test(source);

    // The root layout holds the default title and the template that adds the project name. A title declared by a
    // layout between the root and a page replaces that template for every page below it, so each page declares its
    // own, which also keeps a 'use client' page apart from its server page.
    test('every page that renders content has a title of its own', async () => {
      const root = join(webOf(blueprint), 'src/app');
      const pages = (await filesUnder(root)).filter((file) => file.endsWith('/page.tsx'));
      expect(pages.length).toBeGreaterThan(5);
      const untitled: string[] = [];
      for (const page of pages) {
        const source = await readTextFile(page);
        const redirectsOnly = /redirect\(/.test(source) && !/return\s*\(?\s*</.test(source);
        if (!redirectsOnly && !declaresTitle(source)) untitled.push(page.slice(root.length + 1));
      }
      expect(untitled).toEqual([]);
    });

    test('no layout below the root declares a title, which would drop the title template of its pages', async () => {
      const root = join(webOf(blueprint), 'src/app');
      const layouts = (await filesUnder(root)).filter((file) => file.endsWith('/layout.tsx') && file !== join(root, 'layout.tsx'));
      for (const layout of layouts) expect(declaresTitle(await readTextFile(layout)), layout).toBe(false);
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

  // Top left holds the sidebar toggle, bottom left the avatar of the sidebar footer and bottom right the toasts, so
  // the devtools trigger takes the middle of the left edge (empty sidebar space) and the Next.js dev indicator the top right.
  describe('the devtools', () => {
    test('the trigger sits at the middle of the left edge', async () => {
      const files: [string, string][] = [
        [START_BLUEPRINT, 'src/routes/__root.tsx'],
        ['org-dashboard-nextjs', 'src/components/devtools.tsx'],
      ];
      for (const [blueprint, file] of files) {
        const source = await read(blueprint, file);
        expect(source, file).toContain('TanStackDevtools');
        expect(source, file).toContain("position: 'middle-left'");
      }
    });

    test('the Next.js dev indicator sits at the top right', async () => {
      expect(await read('org-dashboard-nextjs', 'next.config.ts')).toContain("devIndicators: { position: 'top-right' }");
    });
  });
});
