import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, REACT_ELEMENT_STUB, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const WEB = 'apps/web/src';
const NO_ACCESS = 'Your role has no access to contacts. Ask an administrator to grant it.';

interface Setup {
  blueprint: string;
  clientFile: string;
  stubbedModule: string;
}

const BLUEPRINTS: Setup[] = [
  { blueprint: 'org-dashboard-nextjs', clientFile: `${WEB}/app/(dashboard)/dashboard.client.tsx`, stubbedModule: './dashboard.client' },
  { blueprint: 'org-dashboard-tanstack-start', clientFile: `${WEB}/components/dashboard-client.tsx`, stubbedModule: '@/components/dashboard-client' },
];

interface Element {
  type: ((props: Record<string, unknown>) => unknown) | string;
  props: { children?: unknown };
}

const globals = globalThis as { __granted?: readonly string[]; __counts?: number };

const isElement = (node: unknown): node is Element => Boolean(node) && typeof node === 'object' && 'type' in (node as object);

// Renders the function components of a tree the way React does, so what a wrapper such as <Can> decides is in the result.
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!isElement(node)) return node;
  const { children, ...rest } = node.props;
  const list = Array.isArray(children) ? children : [];
  if (typeof node.type === 'function') return expand(node.type({ ...rest, children: list.length === 1 ? list[0] : list }));
  return { ...node, props: { ...node.props, children: expand(children) } };
}

const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isElement(node)) return textOf(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
};

describe.each(BLUEPRINTS)('$blueprint: the home page renders for every signed-in role', ({ blueprint, clientFile, stubbedModule }) => {
  const isStart = blueprint.endsWith('tanstack-start');
  let tempDir: string;
  let project: string;
  let renderHome: () => string;
  let homeSource: string;

  const rendered = (granted: readonly string[] | undefined): string => {
    globals.__granted = granted;
    globals.__counts = 0;
    return renderHome();
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, blueprint);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    const stubModules: Record<string, string> = {
      'react.mjs': REACT_ELEMENT_STUB,
      'react-query.mjs': `export const useQuery = () => ({ data: globalThis.__granted });
export const useSuspenseQuery = () => { globalThis.__counts += 1; return { data: 7 }; };`,
      'providers.mjs': `const options = { queryOptions: () => ({}) };
export const useTRPC = () => ({ permissions: { mine: options }, contact: { count: options } });`,
      'router.mjs': 'export const useRouteContext = ({ select }) => select({ permissions: globalThis.__granted });',
      'query-boundary.mjs': 'export const QueryBoundary = ({ children }) => children;',
    };
    for (const [file, source] of Object.entries(stubModules)) await Bun.write(join(stubs, file), source);

    const generated = async <T>(file: string, name: string, imports: Record<string, string>, loader: 'ts' | 'tsx' = 'ts'): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports, loader);

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
    const { DashboardClient } = await generated<{ DashboardClient: () => unknown }>(
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
    );
    renderHome = () => textOf(expand(DashboardClient()));
    homeSource = await readTextFile(join(project, isStart ? `${WEB}/routes/_dashboard/index.tsx` : `${WEB}/app/(dashboard)/page.tsx`));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('a role that reads contacts sees the count, read once', () => {
    const text = rendered(['contact.read']);
    expect(text).toContain('Dashboard');
    expect(text).toContain('Total Contacts');
    expect(text).toContain('7');
    expect(text).not.toContain(NO_ACCESS);
    expect(globals.__counts).toBe(1);
  });

  test('a role without contact.read sees the heading and that it has no access, and asks for no count', () => {
    for (const granted of [[], ['contact.create']]) {
      const text = rendered(granted);
      expect(text).toContain('Dashboard');
      expect(text).toContain(NO_ACCESS);
      expect(text).not.toContain('Total Contacts');
      expect(globals.__counts).toBe(0);
    }
  });

  test('while the list is unknown the heading shows and no sentence claims the role has no access', () => {
    const text = rendered(undefined);
    expect(text).toContain('Dashboard');
    expect(text).not.toContain(NO_ACCESS);
    expect(globals.__counts).toBe(0);
  });

  test('the page does not answer not found for a missing permission', () => {
    expect(homeSource).not.toContain('requirePermission');
    expect(homeSource).not.toContain('notFound');
    expect(homeSource).not.toContain('notFoundComponent');
  });

  test('the count is prefetched only for a role that may read contacts', async () => {
    const calls: string[] = [];
    const stubs = join(tempDir, 'stubs');
    const prefetched = () => calls.splice(0);
    const run = async (granted: readonly string[]): Promise<{ prefetched: string[]; rendered: boolean }> => {
      globals.__granted = granted;
      if (isStart) {
        const { Route } = await evaluateGeneratedModule<{
          Route: { loader?: (args: unknown) => unknown; beforeLoad?: unknown; component: unknown };
        }>(
          homeSource,
          join(stubs, 'home-route.mjs'),
          {
            react: './react.mjs',
            '@tanstack/react-router': './route-stub.mjs',
            '@/components/dashboard-client': './dashboard-client.mjs',
            '@/lib/auth/guards': './guards-stub.mjs',
            '@/lib/page-title': './page-title-stub.mjs',
          },
          'tsx',
        );
        expect(Route.beforeLoad).toBeUndefined();
        await Route.loader?.({
          context: {
            permissions: granted,
            queryClient: { prefetchQuery: (options: string) => calls.push(options) },
            trpc: { contact: { count: { queryOptions: () => 'contact.count' } } },
          },
        });
        return { prefetched: prefetched(), rendered: typeof Route.component === 'function' };
      }
      const page = await evaluateGeneratedModule<{ default: () => Promise<unknown> }>(
        homeSource,
        join(stubs, 'home-page.mjs'),
        {
          react: './react.mjs',
          '@/lib/auth/session': './session-stub.mjs',
          '@/trpc/server': './trpc-server-stub.mjs',
          [stubbedModule]: './dashboard-client.mjs',
        },
        'tsx',
      );
      const tree = await page.default();
      return { prefetched: prefetched(), rendered: Boolean(tree) };
    };

    await Bun.write(
      join(stubs, 'route-stub.mjs'),
      'export const createFileRoute = () => (options) => ({ ...options });',
    );
    await Bun.write(
      join(stubs, 'guards-stub.mjs'),
      'export const hasPermission = (permissions) => permissions.includes("contact.read");',
    );
    await Bun.write(join(stubs, 'page-title-stub.mjs'), 'export const pageTitle = (title) => title;');
    await Bun.write(
      join(stubs, 'session-stub.mjs'),
      `export const requireSession = async () => ({ user: { id: 'u1' } });
export const hasPermission = async () => globalThis.__granted.includes('contact.read');`,
    );
    await Bun.write(
      join(stubs, 'trpc-server-stub.mjs'),
      `export const trpc = { contact: { count: { queryOptions: () => 'contact.count' } } };
export const prefetch = (options) => { globalThis.__prefetched.push(options); };
export const HydrateClient = ({ children }) => children;`,
    );
    (globalThis as { __prefetched?: string[] }).__prefetched = calls;

    expect(await run(['contact.read'])).toEqual({ prefetched: ['contact.count'], rendered: true });
    expect(await run([])).toEqual({ prefetched: [], rendered: true });
    expect(await run(['contact.create'])).toEqual({ prefetched: [], rendered: true });
  });
});
