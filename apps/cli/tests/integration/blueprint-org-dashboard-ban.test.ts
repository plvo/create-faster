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

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start'];
const HOOK_PATH = 'apps/web/src/hooks/use-menu-confirmation.ts';
const ACTIONS_PATH = 'apps/web/src/components/admin/user-actions.tsx';

type Component = (props: Record<string, unknown>) => unknown;

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

// Stand-ins for the packages the generated component imports. Components render to `{ type, props }` objects (see
// `renderElementTree`); hooks keep their state in slots that survive a re-render, and effects wait for `flushEffects`.
const STUBS: Record<string, string> = {
  'react.mjs': REACT_HOOKS_STUB,
  'query.mjs': 'export const useQueryClient = () => ({ invalidateQueries() {} });',
  'sonner.mjs': 'export const toast = { success() {}, error() {} };',
  'icons.mjs': `import { createElement } from './react.mjs';
export const MoreHorizontal = () => createElement('svg', { 'aria-hidden': 'true' });`,
  'button.mjs': `import { createElement } from './react.mjs';
export const Button = ({ children, ...props }) => createElement('button', props, ...children);`,
  'dropdown-menu.mjs': `import { createElement } from './react.mjs';
const host = (tag) => ({ children, ...props }) => createElement(tag, props, ...children);
export const DropdownMenu = host('div');
export const DropdownMenuTrigger = ({ children }) => children[0];
export const DropdownMenuContent = host('div');
export const DropdownMenuSeparator = () => createElement('hr', {});
export const DropdownMenuItem = ({ children, ...props }) => createElement('div', { role: 'menuitem', ...props }, ...children);`,
  'trpc.mjs': `const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
export const useTRPC = () => chain;`,
  'auth-client.mjs': `const record = (name) => async (args) => { globalThis.__adminCalls.push({ name, args }); return {}; };
export const authClient = {
  useSession: () => ({ data: { user: { id: 'signed-in-admin' } } }),
  admin: { banUser: record('banUser'), unbanUser: record('unbanUser'), setRole: record('setRole') },
};`,
};

const IMPORTS: Record<string, string> = {
  react: './react.mjs',
  '@tanstack/react-query': './query.mjs',
  sonner: './sonner.mjs',
  'lucide-react': './icons.mjs',
  '@repo/ui/components/ui/button': './button.mjs',
  '@repo/ui/components/ui/dropdown-menu': './dropdown-menu.mjs',
  '@/trpc/providers': './trpc.mjs',
  '@repo/auth/auth-client': './auth-client.mjs',
  '@/hooks/use-menu-confirmation': './use-menu-confirmation.mjs',
};

const globals = globalThis as { __adminCalls?: { name: string; args: unknown }[] };

const items = (tree: RenderedChild[]): RenderedElement[] =>
  elementsOf(tree).filter((element) => element.props.role === 'menuitem');
const itemNamed = (tree: RenderedChild[], name: string): RenderedElement | undefined =>
  items(tree).find((element) => textOf(element) === name);
const menuOf = (tree: RenderedChild[]): RenderedElement => {
  const menu = elementsOf(tree).find((element) => typeof element.props.onOpenChange === 'function');
  if (!menu) throw new Error('the menu is not rendered');
  return menu;
};
const select = (item: RenderedElement | undefined, what: string): FakeEvent => {
  const handler = item?.props.onSelect as ((event: FakeEvent) => void) | undefined;
  expect(handler, `${what} acts on select, the event of a Radix menu item`).toBeInstanceOf(Function);
  const event = fakeEvent();
  handler?.(event);
  return event;
};

describe.each(BLUEPRINTS)('%s ban action', (blueprint) => {
  let tempDir: string;
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let UserActions: Component;

  const render = async (user: Record<string, unknown>): Promise<RenderedChild[]> => {
    react.beginRender();
    return renderElementTree({ type: UserActions, props: { user } });
  };
  const activeUser = { id: 'user-1', name: 'Grace Hopper', role: 'user', banned: false };
  const bannedUser = { ...activeUser, banned: true };
  const freshMenu = async (user: Record<string, unknown> = activeUser): Promise<RenderedChild[]> => {
    react.resetState();
    globals.__adminCalls = [];
    return render(user);
  };
  const askConfirmation = async (): Promise<RenderedChild[]> => {
    const tree = await freshMenu();
    const event = select(itemNamed(tree, 'Ban User'), 'Ban User');
    expect(event.defaultPrevented, 'a Radix item closes the menu on select unless the handler prevents it').toBe(true);
    return render(activeUser);
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;
    await evaluateGeneratedModule(
      await readTextFile(join(tempDir, blueprint, HOOK_PATH)),
      join(stubs, 'use-menu-confirmation.mjs'),
      { react: './react.mjs' },
    );
    ({ UserActions } = await evaluateGeneratedModule<{ UserActions: Component }>(
      await readTextFile(join(tempDir, blueprint, ACTIONS_PATH)),
      join(stubs, 'user-actions.mjs'),
      IMPORTS,
      'tsx',
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('selecting Ban User asks first and bans nobody', async () => {
    const asking = await askConfirmation();
    expect(globals.__adminCalls).toEqual([]);
    expect(itemNamed(asking, 'Ban User')).toBeUndefined();
    expect(items(asking).map(textOf)).toEqual(expect.arrayContaining(['Confirm ban', 'Cancel']));
  });

  test('Confirm ban bans the user', async () => {
    const asking = await askConfirmation();
    select(itemNamed(asking, 'Confirm ban'), 'Confirm ban');
    expect(globals.__adminCalls).toEqual([
      { name: 'banUser', args: { userId: 'user-1', banReason: 'Banned by admin' } },
    ]);
  });

  test('Cancel keeps the menu open, bans nobody and brings Ban User back', async () => {
    const asking = await askConfirmation();
    const cancel = select(itemNamed(asking, 'Cancel'), 'Cancel');
    expect(cancel.defaultPrevented, 'cancelling keeps the menu open').toBe(true);
    const cancelled = await render(activeUser);
    expect(globals.__adminCalls).toEqual([]);
    expect(itemNamed(cancelled, 'Ban User')).toBeDefined();
    expect(itemNamed(cancelled, 'Confirm ban')).toBeUndefined();
  });

  test('closing the menu forgets the confirmation', async () => {
    const asking = await askConfirmation();
    (menuOf(asking).props.onOpenChange as (open: boolean) => void)(false);
    const closed = await render(activeUser);
    expect(menuOf(closed).props.open).toBe(false);
    expect(itemNamed(closed, 'Ban User')).toBeDefined();
    expect(itemNamed(closed, 'Confirm ban')).toBeUndefined();
  });

  test('Cancel takes the focus the removed Ban User item leaves behind', async () => {
    const asking = await askConfirmation();
    const cancel = itemNamed(asking, 'Cancel');
    let focused = false;
    (cancel?.props.ref as { current: unknown }).current = {
      focus: () => {
        focused = true;
      },
    };
    react.flushEffects();
    expect(focused).toBe(true);
  });

  test('Ban User takes the focus back when Cancel removes the confirmation', async () => {
    const asking = await askConfirmation();
    select(itemNamed(asking, 'Cancel'), 'Cancel');
    const cancelled = await render(activeUser);
    let focused = false;
    (itemNamed(cancelled, 'Ban User')?.props.ref as { current: unknown }).current = {
      focus: () => {
        focused = true;
      },
    };
    react.flushEffects();
    expect(focused).toBe(true);
  });

  test('unbanning restores access and acts at once', async () => {
    const tree = await freshMenu(bannedUser);
    const unban = itemNamed(tree, 'Unban User');
    expect(itemNamed(tree, 'Ban User')).toBeUndefined();
    (unban?.props.onClick as () => void)();
    expect(globals.__adminCalls).toEqual([{ name: 'unbanUser', args: { userId: 'user-1' } }]);
  });
});
