import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createTRPCClient, TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';
import {
  REACT_HOOKS_STUB,
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
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-fullstack-nextjs';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

type Component = (props: Record<string, unknown>) => unknown;
type RecordSearchOptions = (trpc: unknown, text: string) => never;
type KeyHandler = (event: FakeKeyEvent) => void;

interface FakeKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

interface FakeTimer {
  callback: () => void;
  delay: number;
  cancelled: boolean;
}

// The browser the palette meets: a document that keeps the key listeners it is given, a navigator, and the timers the
// palette sets, kept so a test decides when the delay of the search has elapsed. `release` puts the real ones back.
function createFakeBrowser() {
  const document = { listeners: [] as KeyHandler[] };
  const timers: FakeTimer[] = [];
  const real = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  return {
    timers,
    open(userAgent: string): void {
      document.listeners = [];
      timers.length = 0;
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
          addEventListener: (_type: string, handler: KeyHandler) => document.listeners.push(handler),
          removeEventListener: (_type: string, handler: KeyHandler) => {
            document.listeners = document.listeners.filter((listener) => listener !== handler);
          },
        },
      });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
    },
    press(init: Partial<FakeKeyEvent>): FakeKeyEvent {
      const event: FakeKeyEvent = {
        key: 'k',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        defaultPrevented: false,
        preventDefault: () => {
          event.defaultPrevented = true;
        },
        ...init,
      };
      for (const listener of [...document.listeners]) listener(event);
      return event;
    },
    holdTimers(): void {
      globalThis.setTimeout = ((callback: () => void, delay: number) => {
        const timer = { callback, delay, cancelled: false };
        timers.push(timer);
        return timer;
      }) as never;
      globalThis.clearTimeout = ((timer: FakeTimer) => {
        timer.cancelled = true;
      }) as never;
    },
    elapse(): void {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback();
    },
    release(): void {
      globalThis.setTimeout = real.setTimeout;
      globalThis.clearTimeout = real.clearTimeout;
      if (real.document) Object.defineProperty(globalThis, 'document', real.document);
      else Reflect.deleteProperty(globalThis, 'document');
      if (real.navigator) Object.defineProperty(globalThis, 'navigator', real.navigator);
    },
  };
}

// Stand-ins for what the palette imports. Components render to `{ type, props }` objects (see `renderElementTree`).
const STUBS: Record<string, string> = {
  'react.mjs': `${REACT_HOOKS_STUB}
export const createContext = (initial) => {
  const context = { value: initial };
  context.Provider = ({ value, children }) => { context.value = value; return children; };
  return context;
};
export const useContext = (context) => context.value;`,
  'ui.mjs': `import { createElement } from './react.mjs';
export const host = (tag, extra = {}) => ({ children, ...props }) => createElement(tag, { ...extra, ...props }, ...children);`,
  'command.mjs': `import { createElement } from './react.mjs';
import { host } from './ui.mjs';
export const CommandDialog = ({ open, title, shouldFilter, children }) =>
  open ? createElement('div', { role: 'dialog', 'aria-label': title, 'data-should-filter': String(shouldFilter) }, ...children) : null;
export const CommandInput = ({ value, onValueChange, placeholder }) => createElement('input', { value, onValueChange, placeholder });
export const CommandList = host('div', { role: 'listbox' });
export const CommandGroup = ({ heading, children }) => createElement('div', { role: 'group', 'aria-label': heading }, ...children);
export const CommandItem = ({ value, onSelect, children }) =>
  createElement('div', { role: 'option', 'data-value': value, onSelect }, ...children);`,
  'search-query.mjs': '',
  'trpc-providers.mjs': `export const useTRPC = () => ({ search: { records: { queryOptions: (input, options) => ({ input, ...options }) } } });`,
  'sidebar.mjs': `import { createElement } from './react.mjs';
import { host } from './ui.mjs';
export const SidebarMenu = host('ul');
export const SidebarMenuItem = host('li');
export const SidebarMenuButton = host('button');
export const SidebarGroup = host('section');
export const SidebarGroupLabel = host('h3');
export const SidebarProvider = host('div');
export const SidebarInset = host('main');
export const Sidebar = host('aside');
export const SidebarHeader = host('header');
export const SidebarContent = host('div');
export const SidebarFooter = host('footer');
export const useSidebar = () => ({ isMobile: false, setOpenMobile: (open) => { globalThis.__mobileSidebarOpen = open; } });`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const FileText = icon('FileText');
export const ShieldCheck = icon('ShieldCheck');
export const Users = icon('Users');
export const Search = icon('Search');
export const LayoutDashboard = icon('LayoutDashboard');
export const SearchIcon = icon('SearchIcon');`,
  'next-navigation.mjs': `export const useRouter = () => ({ push: (url) => { (globalThis.__pushed ??= []).push(url); } });
export const usePathname = () => '/';`,
  'dialog.mjs': `import { host } from './ui.mjs';
export const Dialog = host('div');
export const DialogContent = host('section', { role: 'dialog' });
export const DialogHeader = host('header');
export const DialogTitle = host('h2');
export const DialogDescription = host('p');`,
  'cmdk.mjs': `import { host } from './ui.mjs';
export const Command = host('div', { 'data-cmdk': 'true' });`,
  'utils.mjs': `export const cn = (...names) => names.filter(Boolean).join(' ');`,
  'tanstack-router.mjs': `export const useRouter = () => ({ navigate: async ({ to }) => { (globalThis.__navigated ??= []).push(to); } });`,
  'session.mjs': `export const requireSession = async () => globalThis.__session;`,
  'leaf.mjs': `export const AppHeader = () => null;
export const NavUser = () => null;`,
  'next-link.mjs': `export default ({ href, children }) => ({ type: 'a', props: { href, children } });`,
  // The permission list of the caller, and the search of the palette, which is the query that carries an input.
  // \`useQueries\` is the permission check of an organization: one answer per query, from the "resource.action" list the
  // test grants, and none for a query that is not enabled or while the browser has no answer yet (the list is null).
  'react-query.mjs': `export const useQuery = (options) => {
  if (!options?.input) return { data: globalThis.__granted };
  (globalThis.__searches ??= []).push(options);
  const result = globalThis.__searchResult;
  return typeof result === 'function' ? result(options) : result;
};
export const useQueries = ({ queries }) => queries.map((query) => {
  if (query.enabled === false || globalThis.__organizationPermissions === null) return { data: undefined };
  const [resource, actions] = Object.entries(query.queryKey[1])[0];
  return { data: (globalThis.__organizationPermissions ?? []).includes(resource + '.' + actions[0]) };
});`,
  'providers.mjs': 'export const useTRPC = () => ({ permissions: { mine: { queryOptions: () => ({}) } } });',
  'trpc-server.mjs': `export const getQueryClient = () => ({ prefetchQuery: async () => {} });
export const HydrateClient = ({ children }) => children;
export const trpc = { permissions: { mine: { queryOptions: () => ({}) } } };`,
};

const IMPORTS: Record<string, string> = {
  react: './react.mjs',
  'lucide-react': './icons.mjs',
  'next/navigation': './next-navigation.mjs',
  'next/link': './next-link.mjs',
  '@repo/ui/components/ui/command': './command.mjs',
  '@repo/api/search-query': './search-query.mjs',
  '@tanstack/react-query': './react-query.mjs',
  '@/trpc/providers': './trpc-providers.mjs',
  '@repo/ui/components/ui/sidebar': './sidebar.mjs',
  '@/hooks/use-permission': './permission.mjs',
  '@/trpc/server': './trpc-server.mjs',
  cmdk: './cmdk.mjs',
  '@repo/ui/components/ui/dialog': './dialog.mjs',
  '@repo/ui/lib/utils': './utils.mjs',
  '@/hooks/use-mounted': './use-mounted.mjs',
  '@/lib/constants': './constants.mjs',
  '@/lib/allowed-routes': './allowed-routes.mjs',
};

const REAL = {
  zod: Bun.resolveSync('zod', import.meta.dir),
};

const must = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not there`);
  return value;
};

const globals = globalThis as {
  __serverRender?: boolean;
  __pushed?: string[];
  __navigated?: string[];
  __mobileSidebarOpen?: boolean;
  __session?: unknown;
  __granted?: string[];
  __searches?: unknown[];
  __searchResult?: unknown;
};

describe(`${BLUEPRINT} command palette`, () => {
  let tempDir: string;
  let projectPath: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let CommandPaletteProvider: Component;
  let CommandPaletteTrigger: Component;
  let recordSearchOptions: RecordSearchOptions;
  let DashboardLayout: Component;
  let StartProvider: Component;
  let StartTrigger: Component;

  const browser = createFakeBrowser();
  const { timers } = browser;

  const useBrowser = (userAgent: string) => {
    browser.open(userAgent);
    globals.__serverRender = false;
    globals.__pushed = [];
    globals.__searches = [];
    answer({ isPending: true });
    react.resetState();
  };

  const press = browser.press;

  // What the database grants each role: the blueprint reads the permission list of the caller, never the role name.
  const GRANTED: Record<string, string[]> = {
    admin: ['document.read', 'user.list', 'user.create'],
    user: ['document.read'],
    manager: ['document.read'],
  };

  const render = async (role: string): Promise<RenderedChild[]> => {
    globals.__granted = GRANTED[role] ?? [];
    react.beginRender();
    return renderElementTree({
      type: CommandPaletteProvider,
      props: { role, children: [{ type: CommandPaletteTrigger, props: { children: [] } }] },
    });
  };

  const renderLayout = async (role: string): Promise<RenderedChild[]> => {
    globals.__session = { user: { role } };
    globals.__granted = GRANTED[role] ?? [];
    react.beginRender();
    return renderElementTree({ type: DashboardLayout, props: { children: 'Page body' } });
  };

  const mount = async (role: string, userAgent: string): Promise<RenderedChild[]> => {
    useBrowser(userAgent);
    const tree = await render(role);
    react.flushEffects();
    return tree;
  };

  const dialogOf = (tree: RenderedChild[]): RenderedElement | undefined =>
    elementsOf(tree).find((element) => element.props.role === 'dialog');
  const pagesOf = (tree: RenderedChild[]): string[] =>
    elementsOf(tree)
      .filter((element) => element.props.role === 'option')
      .map((element) => String(element.props['data-value']));
  const triggerOf = (tree: RenderedChild[]): RenderedElement => {
    const trigger = elementsOf(tree).find((element) => element.tag === 'button');
    if (!trigger) throw new Error('the search trigger is not there');
    return trigger;
  };

  const hintOf = (trigger: RenderedElement): RenderedElement | undefined =>
    elementsOf([trigger]).find((element) => element.tag === 'kbd');
  // The element that hides the hint from assistive technology and from a phone: it wraps the kbd.
  const hintWrapperOf = (trigger: RenderedElement): RenderedElement | undefined =>
    elementsOf([trigger]).find((element) => element.children.some((inner) => typeof inner !== 'string' && inner.tag === 'kbd'));

  const realSetTimeout = globalThis.setTimeout;
  const { elapse } = browser;

  const inputOf = (tree: RenderedChild[]): RenderedElement => {
    const input = elementsOf(tree).find((element) => element.tag === 'input');
    if (!input) throw new Error('the search input is not there');
    return input;
  };

  // Types in the input of the open palette and renders again, as a user typing would.
  const typeInPalette = async (text: string, role = 'admin'): Promise<RenderedChild[]> => {
    (inputOf(await render(role)).props.onValueChange as (value: string) => void)(text);
    const tree = await render(role);
    react.flushEffects();
    return tree;
  };

  const settled = { isPending: false, isError: false, isFetching: false, data: [] };

  const answer = (result: Record<string, unknown>): void => {
    globals.__searchResult = { ...settled, ...result };
  };

  // The answer of the query layer per text searched, as the server answers each text on its own.
  const answerPer = (answers: Record<string, Record<string, unknown>>): void => {
    globals.__searchResult = (options: { input: { query: string } }) => ({
      ...settled,
      ...(answers[options.input.query] ?? { isPending: true }),
    });
  };

  const alertOf = (tree: RenderedChild[]): RenderedElement | undefined =>
    elementsOf(tree).find((element) => element.props.role === 'alert');
  // The text of the status region, which is always in the page so that a message put into it is announced.
  const messageOf = (tree: RenderedChild[]): string =>
    textOf(must(elementsOf(tree).find((element) => element.props.role === 'status'), 'the status region'));
  const lastSearch = (): { input: { query: string }; enabled: boolean; retry: boolean } =>
    must((globals.__searches ?? []).at(-1), 'a search') as never;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) if (source) await Bun.write(join(stubs, name), source);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;

    const load = async <T,>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(
        await readTextFile(join(projectPath, 'apps/web', file)),
        join(stubs, name),
        { ...IMPORTS, ...imports },
        'tsx',
      );
    await evaluateGeneratedModule(
      await readTextFile(join(projectPath, 'packages/api/src/search-query.ts')),
      join(stubs, 'search-query.mjs'),
      { zod: REAL.zod },
    );
    await load('src/hooks/use-mounted.ts', 'use-mounted.mjs');
    await load('src/hooks/use-permission.ts', 'permission.mjs', {
      '@tanstack/react-query': './react-query.mjs',
      '@/trpc/providers': './providers.mjs',
    });
    await load('src/lib/constants.ts', 'constants.mjs');
    await load('src/lib/allowed-routes.ts', 'allowed-routes.mjs');
    await load('src/components/navigation/sidebar-links.tsx', 'sidebar-links.mjs');
    ({ CommandPaletteProvider, CommandPaletteTrigger, recordSearchOptions } = await load<{
      CommandPaletteProvider: Component;
      CommandPaletteTrigger: Component;
      recordSearchOptions: RecordSearchOptions;
    }>('src/components/navigation/command-palette.tsx', 'command-palette.mjs'));

    const layoutImports = {
      '@/components/navigation/app-header': './leaf.mjs',
      '@/components/navigation/app-sidebar': './app-sidebar.mjs',
      '@/components/navigation/command-palette': './command-palette.mjs',
      '@/lib/auth/session': './session.mjs',
      './command-palette': './command-palette.mjs',
      './nav-user': './leaf.mjs',
      './sidebar-links': './sidebar-links.mjs',
    };
    await load('src/components/navigation/app-sidebar.tsx', 'app-sidebar.mjs', layoutImports);
    ({ default: DashboardLayout } = await load<{ default: Component }>('src/app/(dashboard)/layout.tsx', 'layout.mjs', layoutImports));

    setupTemplateEngine();
    const startContext: TemplateContext = {
      projectName: 'my-project',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'tanstack-start', libraries: [] }],
      project: { tooling: [] },
      git: false,
    };
    const startSource = renderTemplate('{{> navigation/command-palette}}', { ...startContext, ...startContext.apps[0] });
    const start = await evaluateGeneratedModule<{ CommandPaletteProvider: Component; CommandPaletteTrigger: Component }>(
      startSource,
      join(stubs, 'command-palette-start.mjs'),
      { ...IMPORTS, '@tanstack/react-router': './tanstack-router.mjs' },
      'tsx',
    );
    StartProvider = start.CommandPaletteProvider;
    StartTrigger = start.CommandPaletteTrigger;
  });

  afterAll(async () => {
    browser.release();
    await cleanupTempDir(tempDir);
  });

  describe('the shortcut', () => {
    test.each([
      ['macOS', MAC, { metaKey: true }, { ctrlKey: true }],
      ['Linux and Windows', LINUX, { ctrlKey: true }, { metaKey: true }],
    ])('on %s the platform key opens and closes the palette, the other one does nothing', async (_name, agent, platformKey, otherKey) => {
      let tree = await mount('admin', agent);
      expect(dialogOf(tree)).toBeUndefined();

      expect(press(otherKey).defaultPrevented).toBe(false);
      expect(dialogOf(await render('admin'))).toBeUndefined();

      expect(press(platformKey).defaultPrevented, 'the browser keeps its own use of the keys out of the way').toBe(true);
      tree = await render('admin');
      expect(dialogOf(tree)).toBeDefined();

      press(platformKey);
      expect(dialogOf(await render('admin'))).toBeUndefined();
    });

    test('a held key, another letter or an extra modifier leave the palette alone', async () => {
      await mount('admin', LINUX);
      press({ ctrlKey: true, repeat: true });
      press({ ctrlKey: true, key: 'j' });
      press({ ctrlKey: true, shiftKey: true });
      press({ ctrlKey: true, altKey: true });
      expect(dialogOf(await render('admin'))).toBeUndefined();
    });

    test('the capital letter, as with Caps Lock, opens it too', async () => {
      await mount('admin', LINUX);
      press({ ctrlKey: true, key: 'K' });
      expect(dialogOf(await render('admin'))).toBeDefined();
    });
  });

  describe('the trigger', () => {
    test('it shows the shortcut of the platform and announces it', async () => {
      const mac = triggerOf(await mount('admin', MAC));
      expect(hintOf(mac)?.children).toEqual(['⌘K']);
      expect(mac.props['aria-keyshortcuts']).toBe('Meta+K');
      expect(mac.props['aria-haspopup']).toBe('dialog');

      const linux = triggerOf(await mount('admin', LINUX));
      expect(hintOf(linux)?.children).toEqual(['Ctrl K']);
      expect(linux.props['aria-keyshortcuts']).toBe('Control+K');
    });

    test('the server markup carries no shortcut, so hydration finds nothing to disagree with', async () => {
      useBrowser(MAC);
      globals.__serverRender = true;
      const trigger = triggerOf(await render('admin'));
      expect(textOf(trigger)).toBe('Search');
      expect(hintOf(trigger)).toBeUndefined();
      expect(trigger.props['aria-keyshortcuts']).toBeUndefined();
      expect(trigger.props.tooltip).toBe('Search');
    });

    test('the tooltip of the collapsed sidebar names the shortcut of the platform once mounted', async () => {
      expect(triggerOf(await mount('admin', MAC)).props.tooltip).toBe('Search (⌘K)');
      expect(triggerOf(await mount('admin', LINUX)).props.tooltip).toBe('Search (Ctrl K)');
    });

    test('the hint is hidden below md, so a phone shows none, and with the sidebar collapsed', async () => {
      const classes = String(hintWrapperOf(triggerOf(await mount('admin', LINUX)))?.props.className).split(/\s+/);
      expect(classes).toContain('hidden');
      expect(classes).toContain('md:inline-block');
      expect(classes).toContain('group-data-[collapsible=icon]:hidden');
    });

    test('the hint is set in a step of the type scale', async () => {
      const classes = String(hintOf(triggerOf(await mount('admin', LINUX)))?.props.className).split(/\s+/);
      expect(classes).toContain('text-xs');
      expect(classes.some((name) => /^text-\[/.test(name))).toBe(false);
    });

    test('the key hint is hidden from screen readers, the button carries the announcement', async () => {
      const trigger = triggerOf(await mount('admin', MAC));
      expect(hintWrapperOf(trigger)?.props['aria-hidden']).toBe('true');
    });

    // Biome reads aria-hidden on a kbd as hidden from assistive technology on a focusable element
    // (lint/a11y/noAriaHiddenOnFocusable): the kbd stays the semantic element and the wrapper carries aria-hidden.
    test('aria-hidden sits on the element around the kbd, never on the kbd itself', async () => {
      const trigger = triggerOf(await mount('admin', MAC));
      expect(hintOf(trigger)?.props['aria-hidden']).toBeUndefined();
      expect(hintWrapperOf(trigger)?.tag).toBe('span');
    });

    test('clicking it opens the palette and closes the mobile sidebar it sits in', async () => {
      const trigger = triggerOf(await mount('admin', LINUX));
      globals.__mobileSidebarOpen = true;
      (trigger.props.onClick as () => void)();
      expect(globals.__mobileSidebarOpen).toBe(false);
      expect(dialogOf(await render('admin'))).toBeDefined();
    });

    test('the dialog is labelled', async () => {
      await mount('admin', LINUX);
      press({ ctrlKey: true });
      expect(dialogOf(await render('admin'))?.props['aria-label']).toBe('Search');
    });
  });

  describe('the pages', () => {
    const open = async (role: string): Promise<RenderedChild[]> => {
      await mount(role, LINUX);
      press({ ctrlKey: true });
      return render(role);
    };

    test('an administrator finds every page of the sidebar', async () => {
      expect(pagesOf(await open('admin'))).toEqual(['/', '/admin/users', '/admin/roles']);
    });

    test.each(['user', 'manager'])('a %s never sees a page they cannot access', async (role) => {
      expect(pagesOf(await open(role))).toEqual(['/']);
    });

    test('a role the application does not know finds no page and no group', async () => {
      const tree = await open('stranger');
      expect(pagesOf(tree)).toEqual([]);
      expect(elementsOf(tree).filter((element) => element.props.role === 'group')).toEqual([]);
    });

    test('a page is findable by part of its title, which is not in its address', async () => {
      await open('admin');
      await typeInPalette('docum');
      expect(pagesOf(await render('admin'))).toEqual(['/']);
    });

    test('a page is findable by its category, and a page that matches nothing is not listed', async () => {
      await open('admin');
      await typeInPalette('administ');
      expect(pagesOf(await render('admin'))).toEqual(['/admin/users', '/admin/roles']);
      await typeInPalette('zzz');
      expect(pagesOf(await render('admin'))).toEqual([]);
    });

    test('selecting a page closes the palette and goes to it', async () => {
      const tree = await open('admin');
      const roles = elementsOf(tree).find((element) => element.props['data-value'] === '/admin/roles');
      (roles?.props.onSelect as () => void)();
      expect(globals.__pushed).toEqual(['/admin/roles']);
      expect(dialogOf(await render('admin'))).toBeUndefined();
    });
  });

  describe('the records', () => {
    const GROUPS = [
      { type: 'documents', label: 'Documents', items: [{ id: 'd1', title: 'Quarterly report', subtitle: 'application/pdf', href: '/' }] },
      { type: 'users', label: 'Users', items: [{ id: 'u1', title: 'Ada Archer', subtitle: 'ada@example.com', href: '/admin/users/u1' }] },
    ];

    beforeAll(() => browser.holdTimers());

    afterAll(() => browser.release());

    const openPalette = async (role = 'admin'): Promise<void> => {
      await mount(role, LINUX);
      press({ ctrlKey: true });
    };

    // Types the text, lets the delay of the search elapse and renders again, as the browser would.
    const searchFor = async (text: string, role = 'admin'): Promise<RenderedChild[]> => {
      await typeInPalette(text, role);
      elapse();
      return render(role);
    };

    const groupsOf = (tree: RenderedChild[]): string[] =>
      elementsOf(tree)
        .filter((element) => element.props.role === 'group')
        .map((element) => String(element.props['aria-label']));

    test('the palette does not filter, the pages are matched by the palette and the records by the server', async () => {
      await openPalette();
      expect(dialogOf(await render('admin'))?.props['data-should-filter']).toBe('false');
    });

    test('nothing is searched while the box is empty or holds a single character', async () => {
      await openPalette();
      expect(messageOf(await render('admin'))).toBe('');

      await typeInPalette('a');
      elapse();
      const tree = await render('admin');
      expect(lastSearch().enabled).toBe(false);
      expect(messageOf(tree)).toContain('at least 2 characters');
    });

    test('the search starts at two characters, once the delay of the typing has elapsed', async () => {
      await openPalette();
      const typing = await typeInPalette('ad');
      expect(lastSearch().enabled, 'no request before the delay').toBe(false);
      expect(messageOf(typing)).toContain('Searching');
      expect(timers.length, 'the typing waits on a timer').toBeGreaterThan(0);
      expect(timers.every((timer) => timer.delay >= 150 && timer.delay <= 500)).toBe(true);

      elapse();
      await render('admin');
      expect(lastSearch()).toMatchObject({ input: { query: 'ad' }, enabled: true });
    });

    test('the text is trimmed, so a space around it neither counts nor asks twice', async () => {
      await openPalette();
      await searchFor('  ad ');
      expect(lastSearch()).toMatchObject({ input: { query: 'ad' }, enabled: true });
    });

    test('a failed search is not retried by the query, so the failure shows at once', async () => {
      await openPalette();
      await searchFor('ad');
      expect(lastSearch().retry).toBe(false);
    });

    test('a newer text supersedes the older one: the answer for "ad" is never shown for "ada"', async () => {
      await openPalette();
      answerPer({ ad: { data: [GROUPS[0]] }, ada: { data: [GROUPS[1]] } });
      await searchFor('ad');
      const first = await render('admin');
      expect(groupsOf(first)).toEqual(['Pages', 'Documents']);

      const typing = await typeInPalette('ada');
      expect(groupsOf(typing), 'the delay has not elapsed: the text has no answer yet').toEqual([]);
      expect(messageOf(typing)).toContain('Searching');

      elapse();
      const second = await render('admin');
      expect(lastSearch().input.query).toBe('ada');
      expect(groupsOf(second)).toEqual(['Users']);
    });

    test('while a search runs, it says so in the status region', async () => {
      await openPalette();
      answer({ isPending: true, isFetching: true });
      const tree = await searchFor('ad');
      expect(messageOf(tree)).toBe('Searching records...');
      expect(alertOf(tree)).toBeUndefined();
    });

    test('a search with no match says so, with the text, and is not the running state', async () => {
      await openPalette();
      answer({ data: [] });
      const tree = await searchFor('zzz');
      expect(messageOf(tree)).toBe('No records match "zzz".');
      expect(alertOf(tree)).toBeUndefined();
      expect(groupsOf(tree)).toEqual([]);
    });

    describe('a failed search', () => {
      const fail = async (refetch: () => void = () => {}): Promise<RenderedChild[]> => {
        await openPalette();
        answer({ isError: true, error: new Error('boom'), refetch });
        return searchFor('ad');
      };
      const retryOf = (tree: RenderedChild[]): RenderedElement =>
        must(elementsOf(tree).find((element) => element.props['data-value'] === 'records:retry'), 'the retry item');

      test('says so as an alert, apart from the status region', async () => {
        const tree = await fail();
        expect(textOf(must(alertOf(tree), 'an alert'))).toBe('The search failed.');
        expect(messageOf(tree)).toBe('');
      });

      test('offers the retry as an item of the list, so Enter selects it as it selects any item, and there is no button', async () => {
        const tree = await fail();
        expect(retryOf(tree).props.role).toBe('option');
        expect(elementsOf(must(dialogOf(tree), 'the dialog').children).filter((element) => element.tag === 'button')).toEqual([]);
      });

      test('selecting the retry asks again and neither closes the palette nor goes to a page', async () => {
        let retried = 0;
        const tree = await fail(() => {
          retried += 1;
        });
        (retryOf(tree).props.onSelect as () => void)();
        expect(retried).toBe(1);
        expect(globals.__pushed).toEqual([]);
        expect(dialogOf(await render('admin'))).toBeDefined();
      });

      test('a retry in flight shows the running state again, without the alert', async () => {
        await openPalette();
        answer({ isError: true, isFetching: true });
        const tree = await searchFor('ad');
        expect(messageOf(tree)).toBe('Searching records...');
        expect(alertOf(tree)).toBeUndefined();
      });
    });

    test('no message sits inside the listbox, which holds options and their groups only', async () => {
      await openPalette();
      for (const result of [{ isPending: true }, { data: [] }, { isError: true }]) {
        answer(result);
        const tree = await searchFor('ad');
        const listbox = must(elementsOf(tree).find((element) => element.props.role === 'listbox'), 'the listbox');
        const inside = elementsOf(listbox.children).map((element) => element.props.role);
        expect(inside.filter((role) => role === 'status' || role === 'alert')).toEqual([]);
        expect(elementsOf(listbox.children).filter((element) => element.tag === 'button')).toEqual([]);
      }
    });

    test('the three states are three different messages', async () => {
      await openPalette();
      const seen: string[] = [];
      for (const result of [{ isPending: true }, { data: [] }, { isError: true }]) {
        answer(result);
        const tree = await searchFor('ad');
        seen.push(alertOf(tree) ? textOf(must(alertOf(tree), 'an alert')) : messageOf(tree));
      }
      expect(new Set(seen).size).toBe(3);
    });

    test('the groups are the ones the server returned, in its order, under its labels', async () => {
      await openPalette();
      answer({ data: GROUPS });
      const tree = await searchFor('ad');
      expect(groupsOf(tree)).toEqual(['Pages', 'Documents', 'Users']);
      const items = elementsOf(tree).filter((element) => element.props.role === 'option');
      expect(items.map((item) => item.props['data-value'])).toEqual(['/admin/users', '/admin/roles', 'documents:d1', 'users:u1']);
      expect(textOf(must(items.at(-1), 'an item'))).toBe('Ada Archerada@example.com');
    });

    test('a type the palette has never heard of needs no change in it', async () => {
      await openPalette();
      answer({ data: [{ type: 'invoices', label: 'Invoices', items: [{ id: 'i1', title: 'INV-001', subtitle: 'Paid', href: '/invoices/i1' }] }] });
      const tree = await searchFor('inv');
      expect(groupsOf(tree)).toContain('Invoices');
      expect(elementsOf(tree).some((element) => element.props['data-value'] === 'invoices:i1')).toBe(true);
    });

    test('a group the server leaves out is not shown', async () => {
      await openPalette('user');
      answer({ data: [GROUPS[0]] });
      const tree = await searchFor('ad', 'user');
      expect(groupsOf(tree)).toEqual(['Documents']);
    });

    test('the records are not filtered by the pages: a record shows although its text is nowhere in a page title', async () => {
      await openPalette();
      answer({ data: GROUPS });
      const tree = await searchFor('archer');
      expect(pagesOf(tree)).toEqual(['documents:d1', 'users:u1']);
    });

    test('selecting a record closes the palette and goes to its page', async () => {
      await openPalette();
      answer({ data: GROUPS });
      const tree = await searchFor('ada');
      const user = must(elementsOf(tree).find((element) => element.props['data-value'] === 'users:u1'), 'the user');
      (user.props.onSelect as () => void)();
      expect(globals.__pushed).toEqual(['/admin/users/u1']);
      expect(dialogOf(await render('admin'))).toBeUndefined();
    });
  });

  // The request layer is the real one: a QueryClient, tRPC's options proxy and a link that records each request with
  // its abort signal. Only the network is a stand-in.
  describe('the requests', () => {
    interface Request {
      query: string;
      signal: AbortSignal | null | undefined;
    }

    const requests: Request[] = [];
    const link: TRPCLink<never> = () =>
      ({ op }) =>
        observable((observer) => {
          requests.push({ query: (op.input as { query: string }).query, signal: op.signal });
          const abort = () => observer.error(TRPCClientError.from(new Error('aborted')));
          op.signal?.addEventListener('abort', abort);
          return () => op.signal?.removeEventListener('abort', abort);
        });

    const watch = (queryClient: QueryClient, text: string) => {
      const trpc = createTRPCOptionsProxy({ client: createTRPCClient({ links: [link as never] }), queryClient });
      const options = (value: string) => recordSearchOptions(trpc, value) as never;
      const observer = new QueryObserver(queryClient, options(text));
      return { observer, options, stop: observer.subscribe(() => {}) };
    };
    const settle = () => new Promise((resolve) => realSetTimeout(resolve, 20));

    test('a request for an older text is aborted when a newer text replaces it', async () => {
      requests.length = 0;
      const { observer, options, stop } = watch(new QueryClient(), 'ad');
      await settle();
      expect(requests.map((request) => request.query)).toEqual(['ad']);

      observer.setOptions(options('ada'));
      await settle();
      expect(requests.map((request) => request.query)).toEqual(['ad', 'ada']);
      expect(requests[0]?.signal?.aborted, 'the request for "ad" is aborted').toBe(true);
      expect(requests[1]?.signal?.aborted, 'the request for "ada" runs on').toBe(false);
      stop();
    });

    test('closing the palette aborts the request still running', async () => {
      requests.length = 0;
      const { stop } = watch(new QueryClient(), 'ad');
      await settle();
      expect(requests[0]?.signal?.aborted).toBe(false);

      stop();
      await settle();
      expect(requests[0]?.signal?.aborted).toBe(true);
    });

    test('a text under the minimum sends no request', async () => {
      requests.length = 0;
      const { stop } = watch(new QueryClient(), 'a');
      await settle();
      expect(requests).toEqual([]);
      stop();
    });
  });

  describe('in the dashboard layout', () => {
    const openPages = async (role: string): Promise<string[]> => {
      useBrowser(LINUX);
      await renderLayout(role);
      react.flushEffects();
      press({ ctrlKey: true });
      return pagesOf(await renderLayout(role));
    };

    test.each([
      ['admin', ['/', '/admin/users', '/admin/roles']],
      ['user', ['/']],
    ])('the palette lists the pages of the role of the session: %s', async (role, pages) => {
      expect(await openPages(role)).toEqual(pages);
    });

    test('the search field sits in the sidebar header under the logo and opens the palette of the layout', async () => {
      useBrowser(LINUX);
      const tree = await renderLayout('admin');
      react.flushEffects();
      const header = must(elementsOf(tree).find((element) => element.tag === 'header'), 'the sidebar header');
      const inHeader = elementsOf(header.children);
      const logo = inHeader.findIndex((element) => element.tag === 'button' && textOf(element).includes(BLUEPRINT));
      const trigger = inHeader.findIndex((element) => element.tag === 'button' && element.props['aria-haspopup'] === 'dialog');
      expect(logo).toBeGreaterThanOrEqual(0);
      expect(trigger).toBeGreaterThan(logo);

      (inHeader[trigger]?.props.onClick as () => void)();
      expect(dialogOf(await renderLayout('admin'))).toBeDefined();
    });

    test('the search field is in the sidebar only, not in the page', async () => {
      useBrowser(LINUX);
      const tree = await renderLayout('admin');
      const main = must(elementsOf(tree).find((element) => element.tag === 'main'), 'the page');
      expect(elementsOf(main.children).filter((element) => element.props['aria-haspopup'] === 'dialog')).toEqual([]);
    });
  });

  describe('the TanStack Start variant', () => {
    test('selecting a page closes the palette and navigates with its router', async () => {
      useBrowser(LINUX);
      globals.__navigated = [];
      const renderStart = async (): Promise<RenderedChild[]> => {
        react.beginRender();
        return renderElementTree({
          type: StartProvider,
          props: { role: 'admin', children: [{ type: StartTrigger, props: { children: [] } }] },
        });
      };
      await renderStart();
      react.flushEffects();
      press({ ctrlKey: true });
      const roles = elementsOf(await renderStart()).find((element) => element.props['data-value'] === '/admin/roles');
      (roles?.props.onSelect as () => void)();
      expect(globals.__navigated).toEqual(['/admin/roles']);
      expect(globals.__pushed).toEqual([]);
      expect(dialogOf(await renderStart())).toBeUndefined();
    });
  });

  describe('the shared command component', () => {
    const loadCommandDialog = async (): Promise<Component> => {
      const source = await readTextFile(join(projectPath, 'packages/ui/src/components/ui/command.tsx'));
      const module = await evaluateGeneratedModule<{ CommandDialog: Component }>(
        source,
        join(tempDir, 'stubs', 'command-component.mjs'),
        IMPORTS,
        'tsx',
      );
      return module.CommandDialog;
    };
    const renderDialog = async (props: Record<string, unknown>): Promise<RenderedElement> => {
      const CommandDialog = await loadCommandDialog();
      const tree = await renderElementTree({ type: CommandDialog, props: { open: true, children: [], ...props } });
      return must(
        elementsOf(tree).find((element) => element.props.role === 'dialog'),
        'the dialog content',
      );
    };

    test('the ui package declares cmdk and ships the component that imports it', async () => {
      const manifest = JSON.parse(await readTextFile(join(projectPath, 'packages/ui/package.json')));
      expect(manifest.dependencies).toHaveProperty('cmdk');
      const source = await readTextFile(join(projectPath, 'packages/ui/src/components/ui/command.tsx'));
      expect(source).toMatch(/from ['"]cmdk['"]/);
      expect(source).toContain('export {');
    });

    test('the dialog is named and described from inside its content, and cmdk carries the same name', async () => {
      const content = await renderDialog({ title: 'Search', description: 'Search for a page to open.' });
      const inside = elementsOf(content.children);
      expect(inside.find((element) => element.tag === 'h2')?.children).toEqual(['Search']);
      expect(inside.find((element) => element.tag === 'p')?.children).toEqual(['Search for a page to open.']);
      expect(inside.find((element) => element.props['data-cmdk'])?.props.label).toBe('Search');
    });

    test('without a title the dialog still has one', async () => {
      const content = await renderDialog({});
      const inside = elementsOf(content.children);
      expect(inside.find((element) => element.tag === 'h2')?.children).toEqual(['Command Palette']);
      expect(inside.find((element) => element.props['data-cmdk'])?.props.label).toBe('Command Palette');
    });
  });
});

const ORG_DASHBOARDS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start'];

// What the org dashboards add to the stand-ins above: the role check is the generated access control, and the router of
// TanStack Start is a route that carries its component and its context.
const ORG_STUBS: Record<string, string> = {
  'auth-client.mjs': `import { roles } from './permissions.mjs';
export const authClient = {
  admin: { checkRolePermission: ({ role, permissions }) => roles[role]?.authorize(permissions).success ?? false },
  useSession: () => ({ data: globalThis.__orgSession }),
};`,
  'tanstack-router-org.mjs': `export const useRouter = () => ({ navigate: async ({ to }) => { (globalThis.__navigated ??= []).push(to); } });
export const useRouteContext = ({ select }) => select(globalThis.__routeContext);
export const Outlet = () => globalThis.__outlet;
export const createFileRoute = () => (options) => ({
  ...options,
  useRouteContext: () => globalThis.__routeContext,
});`,
  'org-leaf.mjs': `export const AppHeader = () => null;
export const NavUser = () => null;
export const SidebarLinks = () => null;`,
  'guards.mjs': 'export const requireSession = async () => globalThis.__session;',
};

const ORG_IMPORTS: Record<string, string> = {
  '@repo/auth/auth-client': './auth-client.mjs',
  '@repo/auth/permissions': './permissions.mjs',
  '@/lib/auth/permission': './auth-permission.mjs',
  '@/lib/auth/guards': './guards.mjs',
  '@/components/navigation/app-header': './org-leaf.mjs',
  './nav-user': './org-leaf.mjs',
  './sidebar-links': './org-leaf.mjs',
};

// The org dashboards carry no permission list of their own: a page is listed when the role of the session may open it.
const ORG_PAGES: Record<string, string[]> = {
  admin: ['/', '/contacts', '/admin/users', '/admin/roles'],
  user: ['/', '/contacts'],
  manager: ['/', '/contacts'],
  stranger: ['/'],
};

const orgGlobals = globalThis as { __routeContext?: unknown; __outlet?: unknown };

describe.each(ORG_DASHBOARDS)('%s command palette', (blueprint) => {
  const isStart = blueprint === 'org-dashboard-tanstack-start';
  let tempDir: string;
  let projectPath: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let Layout: Component;

  const browser = createFakeBrowser();

  const useBrowser = () => {
    browser.open(LINUX);
    globals.__serverRender = false;
    globals.__pushed = [];
    globals.__navigated = [];
    globals.__searches = [];
    globals.__searchResult = { isPending: true, isError: false, isFetching: false, data: [] };
    react.resetState();
  };

  const pressShortcut = () => browser.press({ ctrlKey: true });

  const renderLayout = async (role: string): Promise<RenderedChild[]> => {
    globals.__session = { user: { role } };
    orgGlobals.__routeContext = { session: { user: { role } } };
    orgGlobals.__outlet = 'Page body';
    react.beginRender();
    return renderElementTree({ type: Layout, props: { children: 'Page body' } });
  };

  const openPalette = async (role: string): Promise<RenderedChild[]> => {
    useBrowser();
    await renderLayout(role);
    react.flushEffects();
    pressShortcut();
    return renderLayout(role);
  };

  const dialogOf = (tree: RenderedChild[]) => elementsOf(tree).find((element) => element.props.role === 'dialog');
  const optionsOf = (tree: RenderedChild[]): string[] =>
    elementsOf(tree)
      .filter((element) => element.props.role === 'option')
      .map((element) => String(element.props['data-value']));
  const groupsOf = (tree: RenderedChild[]): string[] =>
    elementsOf(tree)
      .filter((element) => element.props.role === 'group')
      .map((element) => String(element.props['aria-label']));

  // Types the text in the box, lets the delay elapse and renders the answer the server gives for it.
  const search = async (role: string, text: string, data: unknown[]): Promise<RenderedChild[]> => {
    const tree = await openPalette(role);
    const input = must(elementsOf(tree).find((element) => element.tag === 'input'), 'the search input');
    (input.props.onValueChange as (value: string) => void)(text);
    await renderLayout(role);
    react.flushEffects();
    browser.elapse();
    globals.__searchResult = { isPending: false, isError: false, isFetching: false, data };
    return renderLayout(role);
  };

  const GROUPS = [
    { type: 'contacts', label: 'Contacts', items: [{ id: 'c1', title: 'Grace Hopper', subtitle: 'grace@navy.example', href: '/contacts/c1' }] },
    { type: 'users', label: 'Users', items: [{ id: 'u1', title: 'Ada Admin', subtitle: 'ada@example.com', href: '/admin/users/u1' }] },
  ];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, blueprint);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    const icons = `${STUBS['icons.mjs']}\nexport const Shield = icon('Shield');`;
    for (const [name, source] of Object.entries({ ...STUBS, ...ORG_STUBS, 'icons.mjs': icons })) {
      if (source) await Bun.write(join(stubs, name), source);
    }
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;

    const imports = {
      ...IMPORTS,
      ...ORG_IMPORTS,
      '@tanstack/react-router': './tanstack-router-org.mjs',
      '@/lib/auth/session': './session.mjs',
      '@/components/navigation/command-palette': './command-palette.mjs',
      './command-palette': './command-palette.mjs',
      '@/components/navigation/app-sidebar': './app-sidebar.mjs',
    };
    const load = async <T,>(file: string, name: string): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(projectPath, 'apps/web', file)), join(stubs, name), imports, 'tsx');

    await evaluateGeneratedModule(
      await readTextFile(join(projectPath, 'packages/api/src/search-query.ts')),
      join(stubs, 'search-query.mjs'),
      { zod: REAL.zod },
    );
    await evaluateGeneratedModule(
      await readTextFile(join(projectPath, 'packages/auth/src/permissions.ts')),
      join(stubs, 'permissions.mjs'),
      {
        'better-auth/plugins/access': Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
        'better-auth/plugins/admin/access': Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
      },
    );
    await load('src/hooks/use-mounted.ts', 'use-mounted.mjs');
    if (isStart) await load('src/lib/auth/permission.ts', 'auth-permission.mjs');
    await load('src/hooks/use-permission.ts', 'permission.mjs');
    await load('src/lib/constants.ts', 'constants.mjs');
    await load('src/lib/allowed-routes.ts', 'allowed-routes.mjs');
    await load('src/components/navigation/command-palette.tsx', 'command-palette.mjs');
    await load('src/components/navigation/app-sidebar.tsx', 'app-sidebar.mjs');

    if (isStart) {
      Layout = (await load<{ Route: { component: Component } }>('src/routes/_dashboard.tsx', 'layout.mjs')).Route.component;
    } else {
      Layout = (await load<{ default: Component }>('src/app/(dashboard)/layout.tsx', 'layout.mjs')).default;
    }

    browser.holdTimers();
  });

  afterAll(async () => {
    browser.release();
    await cleanupTempDir(tempDir);
  });

  test('Ctrl+K in the dashboard layout opens a labelled palette that does not filter', async () => {
    useBrowser();
    const closed = await renderLayout('admin');
    react.flushEffects();
    expect(dialogOf(closed)).toBeUndefined();
    pressShortcut();
    const open = dialogOf(await renderLayout('admin'));
    expect(open?.props['aria-label']).toBe('Search');
    expect(open?.props['data-should-filter']).toBe('false');
  });

  test.each(Object.entries(ORG_PAGES))('the palette lists the pages a %s may open, as the sidebar does', async (role, pages) => {
    expect(optionsOf(await openPalette(role))).toEqual(pages);
  });

  test('the search field sits in the sidebar header under the logo and opens the palette of the layout', async () => {
    useBrowser();
    const tree = await renderLayout('admin');
    react.flushEffects();
    const header = must(elementsOf(tree).find((element) => element.tag === 'header'), 'the sidebar header');
    const inHeader = elementsOf(header.children);
    const logo = inHeader.findIndex((element) => element.tag === 'button' && textOf(element).includes(blueprint));
    const trigger = inHeader.findIndex((element) => element.tag === 'button' && element.props['aria-haspopup'] === 'dialog');
    expect(logo).toBeGreaterThanOrEqual(0);
    expect(trigger).toBeGreaterThan(logo);

    (inHeader[trigger]?.props.onClick as () => void)();
    expect(dialogOf(await renderLayout('admin'))).toBeDefined();
  });

  test('the palette asks the server for records of the text, from two characters', async () => {
    await search('admin', 'gr', []);
    const asked = must(globals.__searches?.at(-1), 'a search') as { input: { query: string }; enabled: boolean; retry: boolean };
    expect(asked).toMatchObject({ input: { query: 'gr' }, enabled: true, retry: false });
  });

  test('the groups the server returns are shown under its labels, a contact and a user among them', async () => {
    const tree = await search('admin', 'gr', GROUPS);
    expect(groupsOf(tree), 'no page title holds the text').toEqual(['Contacts', 'Users']);
    expect(optionsOf(tree)).toEqual(['contacts:c1', 'users:u1']);
    const contact = must(elementsOf(tree).find((element) => element.props['data-value'] === 'contacts:c1'), 'the contact');
    expect(textOf(contact)).toBe('Grace Hoppergrace@navy.example');
  });

  test.each([
    ['a contact', 'contacts:c1', '/contacts/c1'],
    ['a user', 'users:u1', '/admin/users/u1'],
  ])('selecting %s closes the palette and goes to its page with the router of the stack', async (_kind, value, path) => {
    const tree = await search('admin', 'gr', GROUPS);
    const record = must(elementsOf(tree).find((element) => element.props['data-value'] === value), 'the record');
    (record.props.onSelect as () => void)();
    expect(isStart ? globals.__navigated : globals.__pushed).toEqual([path]);
    expect(isStart ? globals.__pushed : globals.__navigated).toEqual([]);
    expect(dialogOf(await renderLayout('admin'))).toBeUndefined();
  });

  describe('the packages', () => {
    test('the ui package declares cmdk and ships the command component that imports it and the dialog under it', async () => {
      const manifest = JSON.parse(await readTextFile(join(projectPath, 'packages/ui/package.json')));
      expect(manifest.dependencies).toHaveProperty('cmdk');
      expect(await readTextFile(join(projectPath, 'packages/ui/src/components/ui/command.tsx'))).toMatch(/from ['"]cmdk['"]/);
      expect(await readTextFile(join(projectPath, 'packages/ui/src/components/ui/dialog.tsx'))).toContain('export {');
    });

    test('the api package exports the module the palette imports', async () => {
      const manifest = JSON.parse(await readTextFile(join(projectPath, 'packages/api/package.json')));
      expect(manifest.exports).toHaveProperty(['./search-query']);
    });
  });
});

const MULTITENANT = 'multitenant-saas-nextjs';

// What the multitenant blueprint adds to the stand-ins above: Hugeicons objects instead of lucide components, and the
// parts of the sidebar and the header the layout composes around the palette.
const HUGEICONS = [
  'DashboardSquare01Icon',
  'FolderLibraryIcon',
  'Settings02Icon',
  'UserGroupIcon',
  'UserIcon',
  'Search01Icon',
];

const MULTITENANT_STUBS: Record<string, string> = {
  'auth-client.mjs': 'export const authClient = {};',
  'hugeicons-react.mjs': `import { createElement } from './react.mjs';
export const HugeiconsIcon = ({ icon }) => createElement('svg', { 'aria-hidden': 'true', 'data-icon': icon.name });`,
  'hugeicons.mjs': HUGEICONS.map((name) => `export const ${name} = { name: '${name}' };`).join('\n'),
  'organization-leaf.mjs': `import { createElement } from './react.mjs';
export const OrgSwitcher = () => createElement('div', { 'data-part': 'org-switcher' });
export const NavUser = () => null;
export const AppHeader = () => null;`,
};

const MULTITENANT_IMPORTS: Record<string, string> = {
  ...IMPORTS,
  '@repo/auth/auth-client': './auth-client.mjs',
  '@hugeicons/react': './hugeicons-react.mjs',
  '@hugeicons/core-free-icons': './hugeicons.mjs',
  '@/lib/auth/session': './session.mjs',
  '@/components/navigation/command-palette': './command-palette.mjs',
  './command-palette': './command-palette.mjs',
  '@/components/navigation/app-sidebar': './app-sidebar.mjs',
  '@/components/navigation/app-header': './organization-leaf.mjs',
  './org-switcher': './organization-leaf.mjs',
  './nav-user': './organization-leaf.mjs',
  './sidebar-links': './sidebar-links.mjs',
};

// The pages of the sidebar and what each needs: the organization decides, in the browser, not the role of the user.
const ALL_PERMISSIONS = ['project.read', 'organization.update', 'member.update', 'ac.read'];
const MULTITENANT_PAGES: [string, string[], string[]][] = [
  ['no permission', [], ['/']],
  ['only project.read', ['project.read'], ['/', '/projects']],
  ['only member.update', ['member.update'], ['/', '/settings/members']],
  ['every permission', ALL_PERMISSIONS, ['/', '/projects', '/settings/general', '/settings/members', '/settings/roles']],
];

describe(`${MULTITENANT} command palette`, () => {
  let tempDir: string;
  let projectPath: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let Layout: Component;

  const browser = createFakeBrowser();
  const permissions = globalThis as { __organizationPermissions?: string[] | null };

  const useBrowser = () => {
    browser.open(LINUX);
    globals.__serverRender = false;
    globals.__pushed = [];
    globals.__searches = [];
    globals.__searchResult = { isPending: true, isError: false, isFetching: false, data: [] };
    react.resetState();
  };

  const renderLayout = async (): Promise<RenderedChild[]> => {
    globals.__session = { user: { id: 'u1' }, session: { activeOrganizationId: 'org-1' } };
    react.beginRender();
    return renderElementTree({ type: Layout, props: { children: 'Page body' } });
  };

  const openPalette = async (granted: string[] | null): Promise<RenderedChild[]> => {
    permissions.__organizationPermissions = granted;
    useBrowser();
    await renderLayout();
    react.flushEffects();
    browser.press({ ctrlKey: true });
    return renderLayout();
  };

  const optionsOf = (tree: RenderedChild[]): string[] =>
    elementsOf(tree)
      .filter((element) => element.props.role === 'option')
      .map((element) => String(element.props['data-value']));
  const sidebarLinksOf = (tree: RenderedChild[]): string[] =>
    elementsOf(tree)
      .filter((element) => element.tag === 'a')
      .map((element) => String(element.props.href));
  const dialogOf = (tree: RenderedChild[]) => elementsOf(tree).find((element) => element.props.role === 'dialog');
  const iconsOf = (element: RenderedElement): string[] =>
    elementsOf([element])
      .filter((inner) => inner.tag === 'svg')
      .map((inner) => String(inner.props['data-icon']));

  // Types the text in the box, lets the delay elapse and renders the answer the server gives for it.
  const search = async (text: string, data: unknown[]): Promise<RenderedChild[]> => {
    const tree = await openPalette(ALL_PERMISSIONS);
    const input = must(elementsOf(tree).find((element) => element.tag === 'input'), 'the search input');
    (input.props.onValueChange as (value: string) => void)(text);
    await renderLayout();
    react.flushEffects();
    browser.elapse();
    globals.__searchResult = { isPending: false, isError: false, isFetching: false, data };
    return renderLayout();
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([MULTITENANT, '--blueprint', MULTITENANT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, MULTITENANT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries({ ...STUBS, ...MULTITENANT_STUBS })) {
      if (source) await Bun.write(join(stubs, name), source);
    }
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;

    const load = async <T,>(file: string, name: string): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(projectPath, 'apps/web', file)), join(stubs, name), MULTITENANT_IMPORTS, 'tsx');

    await evaluateGeneratedModule(
      await readTextFile(join(projectPath, 'packages/api/src/search-query.ts')),
      join(stubs, 'search-query.mjs'),
      { zod: REAL.zod },
    );
    await load('src/hooks/use-mounted.ts', 'use-mounted.mjs');
    await load('src/hooks/use-permission.ts', 'permission.mjs');
    await load('src/lib/constants.ts', 'constants.mjs');
    await load('src/lib/allowed-routes.ts', 'allowed-routes.mjs');
    await load('src/components/navigation/command-palette.tsx', 'command-palette.mjs');
    await load('src/components/navigation/sidebar-links.tsx', 'sidebar-links.mjs');
    await load('src/components/navigation/app-sidebar.tsx', 'app-sidebar.mjs');
    Layout = (await load<{ default: Component }>('src/app/(dashboard)/layout.tsx', 'layout.mjs')).default;

    browser.holdTimers();
  });

  afterAll(async () => {
    browser.release();
    await cleanupTempDir(tempDir);
  });

  test('Ctrl+K in the dashboard layout opens a labelled palette that does not filter', async () => {
    useBrowser();
    const closed = await renderLayout();
    react.flushEffects();
    expect(dialogOf(closed)).toBeUndefined();
    browser.press({ ctrlKey: true });
    const open = dialogOf(await renderLayout());
    expect(open?.props['aria-label']).toBe('Search');
    expect(open?.props['data-should-filter']).toBe('false');
  });

  test('the search field sits in the sidebar header under the organization switcher and opens the palette of the layout', async () => {
    permissions.__organizationPermissions = [];
    useBrowser();
    const tree = await renderLayout();
    react.flushEffects();
    const header = must(elementsOf(tree).find((element) => element.tag === 'header'), 'the sidebar header');
    const inHeader = elementsOf(header.children);
    const switcher = inHeader.findIndex((element) => element.props['data-part'] === 'org-switcher');
    const trigger = inHeader.findIndex((element) => element.tag === 'button' && element.props['aria-haspopup'] === 'dialog');
    expect(switcher).toBeGreaterThanOrEqual(0);
    expect(trigger).toBeGreaterThan(switcher);

    (inHeader[trigger]?.props.onClick as () => void)();
    expect(dialogOf(await renderLayout())).toBeDefined();
  });

  test.each(MULTITENANT_PAGES)('with %s the palette lists the pages the sidebar shows, and no other', async (_name, granted, pages) => {
    const tree = await openPalette(granted);
    expect(sidebarLinksOf(tree)).toEqual(pages);
    expect(optionsOf(tree)).toEqual(pages);
  });

  test('until the browser has the permissions, only the page that needs none is listed, in the sidebar and in the palette', async () => {
    const tree = await openPalette(null);
    expect(sidebarLinksOf(tree)).toEqual(['/']);
    expect(optionsOf(tree)).toEqual(['/']);
  });

  test('a page a permission refuses is in neither the sidebar nor the palette, and one it grants is in both', async () => {
    const before = await openPalette(['project.read']);
    expect(optionsOf(before)).toContain('/projects');
    const after = await openPalette([]);
    expect(optionsOf(after)).not.toContain('/projects');
    expect(sidebarLinksOf(after)).not.toContain('/projects');
  });

  test('the icons are Hugeicons: the search field, and the page of each result', async () => {
    const tree = await openPalette(ALL_PERMISSIONS);
    const trigger = must(elementsOf(tree).find((element) => element.props['aria-haspopup'] === 'dialog' && element.tag === 'button'), 'the trigger');
    expect(iconsOf(trigger)).toEqual(['Search01Icon']);
    const projects = must(elementsOf(tree).find((element) => element.props['data-value'] === '/projects'), 'the page');
    expect(iconsOf(projects)).toEqual(['FolderLibraryIcon']);
    expect(elementsOf(tree).filter((element) => element.tag === 'svg' && !String(element.props['data-icon']).endsWith('Icon'))).toEqual([]);
  });

  describe('the records', () => {
    const GROUPS = [
      { type: 'projects', label: 'Projects', items: [{ id: 'p1', title: 'Orchid rollout', subtitle: 'Spring launch', href: '/projects/p1' }] },
      { type: 'members', label: 'Members', items: [{ id: 'm1', title: 'Cleo Cole', subtitle: 'cleo@example.com', href: '/settings/members' }] },
    ];

    test('the groups the server returns are shown under its labels, after the pages that match', async () => {
      const tree = await search('pro', GROUPS);
      const groups = elementsOf(tree)
        .filter((element) => element.props.role === 'group')
        .map((element) => String(element.props['aria-label']));
      expect(groups).toEqual(['Pages', 'Projects', 'Members']);
      const member = must(elementsOf(tree).find((element) => element.props['data-value'] === 'members:m1'), 'the member');
      expect(textOf(member)).toBe('Cleo Colecleo@example.com');
    });

    test.each([
      ['a project', 'projects:p1', '/projects/p1'],
      ['a member, who has no page of their own', 'members:m1', '/settings/members'],
    ])('selecting %s closes the palette and goes to its page', async (_kind, value, path) => {
      const tree = await search('or', GROUPS);
      const record = must(elementsOf(tree).find((element) => element.props['data-value'] === value), 'the record');
      (record.props.onSelect as () => void)();
      expect(globals.__pushed).toEqual([path]);
      expect(dialogOf(await renderLayout())).toBeUndefined();
    });

    test('the palette asks the server for records of the text, from two characters', async () => {
      await search('or', []);
      const asked = must(globals.__searches?.at(-1), 'a search') as { input: { query: string }; enabled: boolean; retry: boolean };
      expect(asked).toMatchObject({ input: { query: 'or' }, enabled: true, retry: false });
    });
  });

  describe('the packages', () => {
    test('the ui package declares cmdk and ships the command component that imports it and the shared dialog under it', async () => {
      const manifest = JSON.parse(await readTextFile(join(projectPath, 'packages/ui/package.json')));
      expect(manifest.dependencies).toHaveProperty('cmdk');
      expect(await readTextFile(join(projectPath, 'packages/ui/src/components/ui/command.tsx'))).toMatch(/from ['"]cmdk['"]/);
      expect(await readTextFile(join(projectPath, 'packages/ui/src/components/ui/dialog.tsx'))).toContain('showCloseButton');
    });

    test('the api package exports the module the palette imports', async () => {
      const manifest = JSON.parse(await readTextFile(join(projectPath, 'packages/api/package.json')));
      expect(manifest.exports).toHaveProperty(['./search-query']);
    });

    test('the search procedure is registered on the router', async () => {
      const root = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
      expect(root).toContain('search: searchRouter');
    });
  });
});
