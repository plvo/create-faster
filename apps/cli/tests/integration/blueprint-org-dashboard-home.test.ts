import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cleanupTempDir,
  createTempDir,
  evaluateGeneratedModule,
  REACT_HOOKS_STUB,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const WEB = 'apps/web/src';
const NO_ACCESS = 'Your role has no access to contacts. Ask an administrator to grant it.';

interface Setup {
  blueprint: string;
  clientFile: string;
  homeFile: string;
  layoutFile: string;
  guardFile: string;
}

const BLUEPRINTS: Setup[] = [
  {
    blueprint: 'org-dashboard-nextjs',
    clientFile: `${WEB}/app/(dashboard)/dashboard.client.tsx`,
    homeFile: `${WEB}/app/(dashboard)/page.tsx`,
    layoutFile: `${WEB}/app/(dashboard)/layout.tsx`,
    guardFile: `${WEB}/lib/auth/session.ts`,
  },
  {
    blueprint: 'org-dashboard-tanstack-start',
    clientFile: `${WEB}/components/dashboard-client.tsx`,
    homeFile: `${WEB}/routes/_dashboard/index.tsx`,
    layoutFile: `${WEB}/routes/_dashboard.tsx`,
    guardFile: `${WEB}/lib/auth/guards.ts`,
  },
];

interface Globals {
  __granted?: readonly string[];
  __counts?: number;
  __events?: string[];
  __session?: { user: { id: string; role: string } };
}

interface Guards {
  hasPermission: (...args: unknown[]) => unknown;
  requirePermission: (...args: unknown[]) => unknown;
}

const globals = globalThis as Globals;

const SESSION = { user: { id: 'u1', role: 'user' } };

// The stand-ins of what the generated files import from packages and from the framework.
const STUB_MODULES: Record<string, string> = {
  'react.mjs': REACT_HOOKS_STUB,
  'react-query.mjs': `export const useQuery = () => ({ data: globalThis.__granted });
export const useSuspenseQuery = () => { globalThis.__counts += 1; return { data: 7 }; };`,
  'providers.mjs': `const options = { queryOptions: () => ({}) };
export const useTRPC = () => ({ permissions: { mine: options }, contact: { count: options } });`,
  'router.mjs': `export const useRouteContext = ({ select }) => select({ permissions: globalThis.__granted });
export const createFileRoute = () => (options) => ({ ...options });
export const notFound = () => ({ kind: 'notFound' });
export const redirect = (target) => ({ kind: 'redirect', ...target });
export const Outlet = () => null;`,
  'next-headers.mjs': 'export const headers = async () => new Headers();',
  'next-navigation.mjs': `export const notFound = () => { throw { kind: 'notFound' }; };
export const redirect = (to) => { throw { kind: 'redirect', to }; };`,
  'auth-instance.mjs': 'export const auth = { api: { getSession: async () => globalThis.__session } };',
  'request-path.mjs': "export const REQUEST_PATH_HEADER = 'x-request-path';",
  'safe-redirect.mjs': 'export const safeRedirectPath = (value) => value ?? "/";',
  'session-stub.mjs': 'export const getSession = async () => globalThis.__session;',
  'trpc-server.mjs': `export const trpc = {
  contact: { count: { queryOptions: () => 'contact.count' } },
  permissions: { mine: { queryOptions: () => ({ queryKey: ['permissions', 'mine'] }) } },
};
export const prefetch = (options) => { globalThis.__events.push('prefetch ' + options); };
export const getQueryClient = () => ({
  ensureQueryData: async () => globalThis.__granted,
  prefetchQuery: async (options) => { globalThis.__events.push('prefetch ' + options.queryKey.join('.')); },
});
export const HydrateClient = ({ children }) => { globalThis.__events.push('hydrate'); return children; };`,
  'page-title.mjs': 'export const pageTitle = (title) => title;',
  'query-boundary.mjs': 'export const QueryBoundary = ({ children }) => children;',
  'layout-parts.mjs': `const part = ({ children }) => children;
export const SidebarProvider = part;
export const SidebarInset = part;
export const CommandPaletteProvider = part;
export const AppSidebar = () => null;
export const AppHeader = () => null;`,
};

describe.each(BLUEPRINTS)('$blueprint: the home page renders for every signed-in role', ({ blueprint, clientFile, homeFile, layoutFile, guardFile }) => {
  const isStart = blueprint.endsWith('tanstack-start');
  let tempDir: string;
  let project: string;
  let stubs: string;
  let DashboardClient: () => unknown;
  let guards: Guards;

  const generated = async <T>(file: string, name: string, imports: Record<string, string>, loader: 'ts' | 'tsx' = 'ts'): Promise<T> =>
    evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports, loader);

  const reset = (granted: readonly string[] | undefined): void => {
    globals.__granted = granted;
    globals.__counts = 0;
    globals.__events = [];
    globals.__session = SESSION;
  };

  const rendered = async (granted: readonly string[] | undefined): Promise<string> => {
    reset(granted);
    return (await renderElementTree(DashboardClient())).map(textOf).join(' ');
  };

  const thrownBy = async (run: () => unknown): Promise<unknown> => {
    try {
      await run();
      return undefined;
    } catch (error) {
      return error;
    }
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, blueprint);
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUB_MODULES)) await Bun.write(join(stubs, file), source);

    await generated('packages/auth/src/permissions.ts', 'permissions.mjs', {
      'better-auth/plugins/access': Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
      'better-auth/plugins/admin/access': Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
    });
    await generated(`${WEB}/hooks/use-permission.ts`, 'use-permission.mjs', {
      '@tanstack/react-query': './react-query.mjs',
      '@tanstack/react-router': './router.mjs',
      '@/trpc/providers': './providers.mjs',
      '@repo/auth/permissions': './permissions.mjs',
    });
    const shared = { react: './react.mjs', '@/hooks/use-permission': './use-permission.mjs' };
    await generated(`${WEB}/components/can.tsx`, 'can.mjs', shared, 'tsx');
    ({ DashboardClient } = await generated<{ DashboardClient: () => unknown }>(
      clientFile,
      'dashboard-client.mjs',
      {
        ...shared,
        '@tanstack/react-query': './react-query.mjs',
        '@/trpc/providers': './providers.mjs',
        '@/components/can': './can.mjs',
        '@/components/query-boundary': './query-boundary.mjs',
      },
      'tsx',
    ));
    guards = await generated<Guards>(
      guardFile,
      'guards.mjs',
      isStart
        ? { '@tanstack/react-router': './router.mjs', '@repo/auth/permissions': './permissions.mjs', '@/lib/auth/session': './session-stub.mjs' }
        : {
            react: './react.mjs',
            'next/headers': './next-headers.mjs',
            'next/navigation': './next-navigation.mjs',
            '@repo/auth/permissions': './permissions.mjs',
            '@/lib/auth/auth': './auth-instance.mjs',
            '@/lib/auth/request-path': './request-path.mjs',
            '@/lib/safe-redirect': './safe-redirect.mjs',
            '@/trpc/server': './trpc-server.mjs',
          },
    );
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('a role that reads contacts sees the count, read once', async () => {
    const text = await rendered(['contact.read']);
    expect(text).toContain('Dashboard');
    expect(text).toContain('Total Contacts');
    expect(text).toContain('7');
    expect(text).not.toContain(NO_ACCESS);
    expect(globals.__counts).toBe(1);
  });

  test('a role without contact.read sees the heading and that it has no access, and asks for no count', async () => {
    for (const granted of [[], ['contact.create']]) {
      const text = await rendered(granted);
      expect(text).toContain('Dashboard');
      expect(text).toContain(NO_ACCESS);
      expect(text).not.toContain('Total Contacts');
      expect(globals.__counts).toBe(0);
    }
  });

  test('while the list is unknown the heading shows and neither the count nor a no-access sentence does', async () => {
    const text = await rendered(undefined);
    expect(text).toContain('Dashboard');
    expect(text).not.toContain(NO_ACCESS);
    expect(text).not.toContain('Total Contacts');
    expect(globals.__counts).toBe(0);
  });

  test('the dashboard layout hands the permission list of the caller to the first render', async () => {
    reset(['contact.read']);
    const layoutImports = {
      react: './react.mjs',
      '@tanstack/react-router': './router.mjs',
      '@repo/ui/components/ui/sidebar': './layout-parts.mjs',
      '@/components/navigation/app-sidebar': './layout-parts.mjs',
      '@/components/navigation/app-header': './layout-parts.mjs',
      '@/components/navigation/command-palette': './layout-parts.mjs',
      '@/lib/auth/session': './guards-stub.mjs',
      '@/lib/auth/guards': './guards-stub.mjs',
      '@/lib/auth/permissions': './permissions-stub.mjs',
      '@/trpc/server': './trpc-server.mjs',
    };
    await Bun.write(join(stubs, 'guards-stub.mjs'), 'export const requireSession = async () => globalThis.__session;');
    await Bun.write(join(stubs, 'permissions-stub.mjs'), 'export const getPermissions = async () => globalThis.__granted;');

    if (isStart) {
      const { Route } = await generated<{ Route: { beforeLoad: (args: unknown) => Promise<unknown> } }>(layoutFile, 'layout.mjs', layoutImports, 'tsx');
      expect(await Route.beforeLoad({ location: { href: '/' } })).toEqual({ session: SESSION, permissions: ['contact.read'] });
      return;
    }
    const { default: Layout } = await generated<{ default: (props: { children: string }) => Promise<unknown> }>(layoutFile, 'layout.mjs', layoutImports, 'tsx');
    await renderElementTree(await Layout({ children: 'page' }));
    expect(globals.__events).toEqual(['prefetch permissions.mine', 'hydrate']);
  });

  test('the page does not answer not found for a missing permission', async () => {
    const source = await readTextFile(join(project, homeFile));
    expect(source).not.toContain('requirePermission');
    expect(source).not.toContain('notFound');
    expect(source).not.toContain('notFoundComponent');
  });

  test('hasPermission answers from the permission list of the request', async () => {
    reset(['contact.read']);
    expect(await guards.hasPermission(...(isStart ? [['contact.read'], { contact: ['read'] }] : ['contact', 'read']))).toBe(true);
    for (const granted of [[], ['contact.create'], ['user.list']]) {
      reset(granted);
      expect(await guards.hasPermission(...(isStart ? [granted, { contact: ['read'] }] : ['contact', 'read']))).toBe(false);
    }
  });

  test('requirePermission answers not found without the permission and passes with it', async () => {
    const call = (granted: readonly string[]) =>
      isStart ? guards.requirePermission(granted, { contact: ['read'] }) : guards.requirePermission('contact', 'read');

    reset([]);
    expect(await thrownBy(() => call([]))).toEqual({ kind: 'notFound' });
    reset(['contact.create']);
    expect(await thrownBy(() => call(['contact.create']))).toEqual({ kind: 'notFound' });
    reset(['contact.read']);
    expect(await thrownBy(() => call(['contact.read']))).toBeUndefined();
    if (!isStart) expect(await call(['contact.read'])).toEqual(SESSION);
  });

  test('the count is prefetched only for a role that may read contacts', async () => {
    const imports: Record<string, string> = isStart
      ? {
          react: './react.mjs',
          '@tanstack/react-router': './router.mjs',
          '@/components/dashboard-client': './dashboard-client.mjs',
          '@/lib/auth/guards': './guards.mjs',
          '@/lib/page-title': './page-title.mjs',
        }
      : {
          react: './react.mjs',
          '@/lib/auth/session': './guards.mjs',
          '@/trpc/server': './trpc-server.mjs',
          './dashboard.client': './dashboard-client.mjs',
        };
    const home = await generated<{ default?: () => Promise<unknown>; Route?: { loader: (args: unknown) => unknown; beforeLoad?: unknown } }>(
      homeFile,
      'home.mjs',
      imports,
      'tsx',
    );

    const prefetchedFor = async (granted: readonly string[]): Promise<string[]> => {
      reset(granted);
      if (isStart) {
        expect(home.Route?.beforeLoad).toBeUndefined();
        await home.Route?.loader({
          context: {
            permissions: granted,
            queryClient: { prefetchQuery: (options: string) => globals.__events?.push(`prefetch ${options}`) },
            trpc: { contact: { count: { queryOptions: () => 'contact.count' } } },
          },
        });
      } else {
        await renderElementTree(await home.default?.());
      }
      return (globals.__events ?? []).filter((event) => event.startsWith('prefetch'));
    };

    expect(await prefetchedFor(['contact.read'])).toEqual(['prefetch contact.count']);
    expect(await prefetchedFor([])).toEqual([]);
    expect(await prefetchedFor(['contact.create'])).toEqual([]);
  });
});
