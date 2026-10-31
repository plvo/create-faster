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
export const CommandItem = ({ value, onSelect, children }) => createElement('div', { role: 'option', 'data-value': value, onSelect }, ...children);`,
  'sidebar.mjs': `import { createElement } from './react.mjs';
import { host } from './ui.mjs';
export const SidebarMenu = host('ul');
export const SidebarMenuItem = host('li');
export const SidebarMenuButton = host('button');
export const SidebarGroup = host('section');
export const SidebarGroupLabel = host('h3');
export const useSidebar = () => ({ isMobile: false, setOpenMobile: (open) => { globalThis.__mobileSidebarOpen = open; } });`,
  'icons.mjs': `import { createElement } from './react.mjs';
const icon = (name) => () => createElement('svg', { 'aria-hidden': 'true', 'data-icon': name });
export const FileText = icon('FileText');
export const ShieldCheck = icon('ShieldCheck');
export const Users = icon('Users');
export const Search = icon('Search');`,
  'next-navigation.mjs': `export const useRouter = () => ({ push: (url) => { (globalThis.__pushed ??= []).push(url); } });
export const usePathname = () => '/';`,
  'next-link.mjs': `export default ({ href, children }) => ({ type: 'a', props: { href, children } });`,
  'permission.mjs': `const GRANTS = {
  admin: { user: ['list', 'create'] },
  user: {},
  manager: {},
};
export const can = (role, permissions) => {
  const granted = GRANTS[role];
  if (!granted) return false;
  return Object.entries(permissions).every(([resource, actions]) => actions.every((action) => granted[resource]?.includes(action)));
};`,
};

const IMPORTS: Record<string, string> = {
  react: './react.mjs',
  'lucide-react': './icons.mjs',
  'next/navigation': './next-navigation.mjs',
  'next/link': './next-link.mjs',
  '@repo/ui/components/ui/command': './command.mjs',
  '@repo/ui/components/ui/sidebar': './sidebar.mjs',
  '@/hooks/use-permission': './permission.mjs',
};

const globals = globalThis as {
  __serverRender?: boolean;
  __pushed?: string[];
  __mobileSidebarOpen?: boolean;
};

describe(`${BLUEPRINT} command palette`, () => {
  let tempDir: string;
  let projectPath: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let CommandPaletteProvider: Component;
  let CommandPaletteTrigger: Component;
  let allowedRoutes: (role: string | null | undefined) => { url: string }[];

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

  const render = async (role: string): Promise<RenderedChild[]> => {
    react.beginRender();
    return renderElementTree({
      type: CommandPaletteProvider,
      props: { role, children: [{ type: CommandPaletteTrigger, props: { children: [] } }] },
    });
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
    await load('src/lib/constants.ts', 'constants.mjs');
    ({ allowedRoutes } = await load<{ allowedRoutes: typeof allowedRoutes }>('src/components/navigation/sidebar-links.tsx', 'sidebar-links.mjs', {
      '@/lib/constants': './constants.mjs',
    }));
    ({ CommandPaletteProvider, CommandPaletteTrigger } = await load<{
      CommandPaletteProvider: Component;
      CommandPaletteTrigger: Component;
    }>(
      'src/components/navigation/command-palette.tsx',
      'command-palette.mjs',
      { '@/components/navigation/sidebar-links': './sidebar-links.mjs' },
    ));
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
      const pages = pagesOf(await open('admin'));
      expect(pages).toEqual(allowedRoutes('admin').map((route) => route.url));
      expect(pages).toEqual(expect.arrayContaining(['/', '/admin/users', '/admin/roles']));
    });

    test.each(['user', 'manager'])('a %s never sees a page they cannot access', async (role) => {
      const pages = pagesOf(await open(role));
      expect(pages).toEqual(allowedRoutes(role).map((route) => route.url));
      expect(pages).toEqual(['/']);
    });

    test('a role the application does not know finds no page and no group', async () => {
      const tree = await open('stranger');
      expect(pagesOf(tree)).toEqual([]);
      expect(elementsOf(tree).filter((element) => element.props.role === 'group')).toEqual([]);
    });

    test('selecting a page closes the palette and goes to it', async () => {
      const tree = await open('admin');
      const roles = elementsOf(tree).find((element) => element.props['data-value'] === '/admin/roles');
      (roles?.props.onSelect as () => void)();
      expect(globals.__pushed).toEqual(['/admin/roles']);
      expect(dialogOf(await render('admin'))).toBeUndefined();
    });
  });

  describe('the shared command component', () => {
    test('the ui package declares cmdk and ships the component that imports it', async () => {
      const manifest = JSON.parse(await readTextFile(join(projectPath, 'packages/ui/package.json')));
      expect(manifest.dependencies).toHaveProperty('cmdk');
      const source = await readTextFile(join(projectPath, 'packages/ui/src/components/ui/command.tsx'));
      expect(source).toMatch(/from ['"]cmdk['"]/);
      expect(source).toContain('export {');
    });
  });
});
