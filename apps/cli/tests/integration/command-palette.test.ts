import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
export const CommandDialog = ({ open, title, children }) =>
  open ? createElement('div', { role: 'dialog', 'aria-label': title }, ...children) : null;
export const CommandInput = () => createElement('input', {});
export const CommandList = host('div', { role: 'listbox' });
export const CommandEmpty = host('p');
export const CommandGroup = ({ heading, children }) => createElement('div', { role: 'group', 'aria-label': heading }, ...children);
export const CommandItem = ({ value, keywords, onSelect, children }) =>
  createElement('div', { role: 'option', 'data-value': value, 'data-keywords': (keywords ?? []).join(' '), onSelect }, ...children);`,
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
  'react-query.mjs': 'export const useQuery = () => ({ data: globalThis.__granted });',
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
};

describe(`${BLUEPRINT} command palette`, () => {
  let tempDir: string;
  let projectPath: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let CommandPaletteProvider: Component;
  let CommandPaletteTrigger: Component;
  let DashboardLayout: Component;
  let StartProvider: Component;
  let StartTrigger: Component;

  const fakeDocument = { listeners: [] as KeyHandler[] };
  const realDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const useBrowser = (userAgent: string) => {
    fakeDocument.listeners = [];
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        addEventListener: (_type: string, handler: KeyHandler) => fakeDocument.listeners.push(handler),
        removeEventListener: (_type: string, handler: KeyHandler) => {
          fakeDocument.listeners = fakeDocument.listeners.filter((listener) => listener !== handler);
        },
      },
    });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
    globals.__serverRender = false;
    globals.__pushed = [];
    react.resetState();
  };

  const press = (init: Partial<FakeKeyEvent>): FakeKeyEvent => {
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
    for (const listener of [...fakeDocument.listeners]) listener(event);
    return event;
  };

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

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;

    const load = async <T,>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(
        await readTextFile(join(projectPath, 'apps/web', file)),
        join(stubs, name),
        { ...IMPORTS, ...imports },
        'tsx',
      );
    await load('src/hooks/use-mounted.ts', 'use-mounted.mjs');
    await load('src/hooks/use-permission.ts', 'permission.mjs', {
      '@tanstack/react-query': './react-query.mjs',
      '@/trpc/providers': './providers.mjs',
    });
    await load('src/lib/constants.ts', 'constants.mjs');
    await load('src/lib/allowed-routes.ts', 'allowed-routes.mjs');
    await load('src/components/navigation/sidebar-links.tsx', 'sidebar-links.mjs');
    ({ CommandPaletteProvider, CommandPaletteTrigger } = await load<{
      CommandPaletteProvider: Component;
      CommandPaletteTrigger: Component;
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
    if (realDocument) Object.defineProperty(globalThis, 'document', realDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
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
      const classes = String(hintOf(triggerOf(await mount('admin', LINUX)))?.props.className).split(/\s+/);
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
      expect(hintOf(triggerOf(await mount('admin', MAC)))?.props['aria-hidden']).toBe('true');
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

    test('a page is findable by its title, which is not in its address', async () => {
      const documents = elementsOf(await open('admin')).find((element) => element.props['data-value'] === '/');
      const searchable = `${documents?.props['data-value']} ${documents?.props['data-keywords']}`.toLowerCase();
      expect(searchable).toContain('documents');
    });

    test('selecting a page closes the palette and goes to it', async () => {
      const tree = await open('admin');
      const roles = elementsOf(tree).find((element) => element.props['data-value'] === '/admin/roles');
      (roles?.props.onSelect as () => void)();
      expect(globals.__pushed).toEqual(['/admin/roles']);
      expect(dialogOf(await render('admin'))).toBeUndefined();
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
