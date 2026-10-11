import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJson {
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

const COMMON_ARGS = ['--no-git', '--no-install', '--pm', 'bun'];
const SESSION_READ_THROUGH_CACHE =
  'const session = await getRequestSession(opts.headers, () => auth.api.getSession({ headers: opts.headers }));';

describe('TanStack Start + tRPC', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, ...COMMON_ARGS], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return join(tempDir, name);
  }

  describe('single repo on Nitro, tRPC alone', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-trpc', ['--app', 'start-trpc:tanstack-start:trpc']);
    });

    test('generates the shared router and context, and no Next.js file', async () => {
      expect(await fileExists(join(projectPath, 'src/trpc/init.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/routers/_app.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/routers/hello.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/server.tsx'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/app'))).toBe(false);
    });

    test('does not generate the TanStack Query files', async () => {
      expect(await fileExists(join(projectPath, 'src/trpc/query-client.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/trpc/providers.tsx'))).toBe(false);
    });

    test('the context takes the request headers explicitly, without next/headers', async () => {
      const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
      expect(init).toContain('export async function createTRPCContext(opts: { headers: Headers }) {');
      expect(init).not.toContain('next/headers');
      expect(init).toContain('transformer: superjson');
    });

    test('the API route serves GET and POST through fetchRequestHandler with the request headers', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/api/trpc/$.ts'));
      expect(route).toContain("createFileRoute('/api/trpc/$')");
      expect(route).toContain("import { fetchRequestHandler } from '@trpc/server/adapters/fetch'");
      expect(route).toContain("endpoint: '/api/trpc'");
      expect(route).toContain('createContext: () => createTRPCContext({ headers: request.headers })');
      expect(route).toContain('GET: handler');
      expect(route).toContain('POST: handler');
    });

    test('the client is isomorphic: localLink with a memoized context promise on the server, httpBatchLink in the browser', async () => {
      const client = await readTextFile(join(projectPath, 'src/trpc/client.ts'));
      expect(client).toContain('export const makeTRPCClient = createIsomorphicFn()');
      expect(client).toContain('unstable_localLink({');
      expect(client).toContain('transformer: superjson');
      expect(client).toContain(
        'createContext: () => (context ??= createTRPCContext({ headers: getRequest().headers })),',
      );
      expect(client).toContain("httpBatchLink({ url: '/api/trpc', transformer: superjson })");
      expect(client).toContain("from '@/trpc/routers/_app'");
    });

    test('getRouter puts a per-request client in the router context', async () => {
      const router = await readTextFile(join(projectPath, 'src/router.tsx'));
      expect(router).toContain("import { makeTRPCClient } from '@/trpc/client'");
      expect(router).toContain('context: { trpc: makeTRPCClient() },');
      expect(router).not.toContain('setupRouterSsrQueryIntegration');
    });

    test('the root route types the router context with the vanilla client', async () => {
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).toContain("import type { TRPCClient } from '@trpc/client'");
      expect(root).toContain('trpc: TRPCClient<AppRouter>');
      expect(root).toContain('createRootRouteWithContext<RouterContext>()({');
    });

    test('package.json has the tRPC dependencies and no Next.js only ones', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.dependencies).toHaveProperty('@trpc/client');
      expect(pkg.dependencies).toHaveProperty('@trpc/server');
      expect(pkg.dependencies).toHaveProperty('superjson');
      expect(pkg.dependencies).toHaveProperty('zod');
      expect(pkg.dependencies).not.toHaveProperty('server-only');
      expect(pkg.dependencies).not.toHaveProperty('@tanstack/react-router-ssr-query');
    });
  });

  describe('single repo on Nitro, tRPC + TanStack Query + better-auth, sqlite', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-trpc-query-auth', [
        '--app',
        'start-trpc-query-auth:tanstack-start:trpc,tanstack-query,better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
    });

    test('reuses the superjson query client that dehydrates pending queries', async () => {
      const queryClient = await readTextFile(join(projectPath, 'src/trpc/query-client.ts'));
      expect(queryClient).toContain('export function makeQueryClient()');
      expect(queryClient).toContain("defaultShouldDehydrateQuery(query) || query.state.status === 'pending'");
      expect(queryClient).toContain('serializeData: superjson.serialize');
      expect(queryClient).toContain('deserializeData: superjson.deserialize');
    });

    test('providers export the tRPC React context hooks', async () => {
      const providers = await readTextFile(join(projectPath, 'src/trpc/providers.tsx'));
      expect(providers).toContain(
        'export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();',
      );
      expect(providers).not.toContain("'use client'");
      expect(providers).not.toContain('get-app-url');
    });

    test('getRouter builds the query client, the client and the options proxy per request', async () => {
      const router = await readTextFile(join(projectPath, 'src/router.tsx'));
      expect(router).toContain('const queryClient = makeQueryClient()');
      expect(router).toContain('const trpcClient = makeTRPCClient()');
      expect(router).toContain('const trpc = createTRPCOptionsProxy({ client: trpcClient, queryClient })');
      expect(router).toContain('context: { queryClient, trpc },');
      expect(router).toContain('<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>');
      expect(router).toContain('setupRouterSsrQueryIntegration({ router, queryClient })');
    });

    test('the root route types the router context with the query client and the options proxy', async () => {
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).toContain('queryClient: QueryClient');
      expect(root).toContain('trpc: TRPCOptionsProxy<AppRouter>');
      expect(root).toContain('createRootRouteWithContext<RouterContext>()({');
    });

    test('the context reads the session through the per-request cache shared with getSession', async () => {
      const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
      expect(init).toContain("import { auth } from './auth'");
      expect(init).toContain("import { getRequestSession } from '@/lib/auth/session-cache'");
      expect(init).toContain(SESSION_READ_THROUGH_CACHE);
      expect(init).toContain('protectedProcedure');
      expect(await fileExists(join(projectPath, 'src/lib/auth/session-cache.ts'))).toBe(true);
    });

    test('the context reads sessions through a cookie-less instance that never refreshes them', async () => {
      const instance = await readTextFile(join(projectPath, 'src/trpc/auth.ts'));
      expect(instance).toContain("import { createAuth } from '@/lib/auth/create-auth'");
      expect(instance).toContain('export const auth = createAuth();');
    });

    test('package.json adds the router SSR query integration and no server-only', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.dependencies).toHaveProperty('@tanstack/react-router-ssr-query');
      expect(pkg.dependencies).toHaveProperty('@trpc/tanstack-react-query');
      expect(pkg.dependencies).toHaveProperty('@tanstack/react-query');
      expect(pkg.dependencies).not.toHaveProperty('server-only');
    });

    test('agent docs teach the streamed prefetch and the shared session cache', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('void context.queryClient.prefetchQuery(context.trpc.hello.greet.queryOptions(');
      expect(agents).toContain('useSuspenseQuery');
      expect(agents).toContain('getRequestSession');
    });
  });

  describe('single repo on Cloudflare, D1 + better-auth + TanStack Query', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-trpc-d1', [
        '--app',
        'start-trpc-d1:tanstack-start:trpc,tanstack-query,better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('the context builds a cookie-less auth per request and reads the session through the cache', async () => {
      const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
      expect(init).toContain('createTRPCContext(opts: { headers: Headers; db: Database })');
      expect(init).toContain('const auth = createAuth(opts.db);');
      expect(init).toContain(SESSION_READ_THROUGH_CACHE);
    });

    test('the route and the server client pass the module-level db', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/api/trpc/$.ts'));
      expect(route).toContain("import { db } from '@/lib/server'");
      expect(route).toContain('createTRPCContext({ headers: request.headers, db })');
      const client = await readTextFile(join(projectPath, 'src/trpc/client.ts'));
      expect(client).toContain("import { db } from '@/lib/server'");
      expect(client).toContain('createTRPCContext({ headers: getRequest().headers, db })');
    });

    test('server.ts keeps the module-level db and auth', async () => {
      const server = await readTextFile(join(projectPath, 'src/lib/server.ts'));
      expect(server).toContain('export const db = createDb(env.DB)');
      expect(server).toContain('export const auth = createAuth(db, tanstackStartCookies())');
      expect(await fileExists(join(projectPath, 'src/trpc/auth.ts'))).toBe(false);
    });
  });

  describe('turborepo, Next.js and Start apps sharing the tRPC package, sqlite + better-auth', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('mixed-trpc', [
        '--app',
        'web:nextjs:trpc,tanstack-query,better-auth',
        '--app',
        'admin:tanstack-start:trpc,tanstack-query,better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
    });

    test('the shared context reads the session through the cache exported by the auth package', async () => {
      const init = await readTextFile(join(projectPath, 'packages/api/src/trpc.ts'));
      expect(init).toContain("import { auth } from './auth'");
      expect(init).toContain("import { getRequestSession } from '@repo/auth/session-cache'");
      expect(init).toContain(SESSION_READ_THROUGH_CACHE);
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'packages/auth/package.json'));
      expect(pkg.exports?.['./session-cache']).toBe('./src/session-cache.ts');
    });

    test('the Start app gets its route, client and providers from @repo/api', async () => {
      const route = await readTextFile(join(projectPath, 'apps/admin/src/routes/api/trpc/$.ts'));
      expect(route).toContain("import { appRouter, createTRPCContext } from '@repo/api'");
      const client = await readTextFile(join(projectPath, 'apps/admin/src/trpc/client.ts'));
      expect(client).toContain("from '@repo/api'");
      const providers = await readTextFile(join(projectPath, 'apps/admin/src/trpc/providers.tsx'));
      expect(providers).toContain("import type { AppRouter } from '@repo/api'");
      expect(await fileExists(join(projectPath, 'apps/admin/src/trpc/server.tsx'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/src/app'))).toBe(false);
    });

    test('the Next.js app keeps its own route, server helpers and React provider', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'))).toBe(true);
      const server = await readTextFile(join(projectPath, 'apps/web/src/trpc/server.tsx'));
      expect(server).toContain("import 'server-only';");
      const providers = await readTextFile(join(projectPath, 'apps/web/src/trpc/providers.tsx'));
      expect(providers).toContain('TRPCReactProvider');
      expect(await fileExists(join(projectPath, 'apps/web/src/routes'))).toBe(false);
    });

    test('server-only is a dependency of the Next.js app only', async () => {
      const web = await readJsonFile<PackageJson>(join(projectPath, 'apps/web/package.json'));
      expect(web.dependencies).toHaveProperty('server-only');
      const admin = await readJsonFile<PackageJson>(join(projectPath, 'apps/admin/package.json'));
      expect(admin.dependencies).not.toHaveProperty('server-only');
      expect(admin.dependencies).toHaveProperty('@repo/api', '*');
      expect(admin.dependencies).toHaveProperty('@tanstack/react-router-ssr-query');
    });
  });

  describe('turborepo on Cloudflare, Start + Hono, D1 + better-auth', () => {
    test('the Start route passes the app db to the shared context', async () => {
      const projectPath = await generate('start-trpc-turbo-d1', [
        '--app',
        'web:tanstack-start:trpc,better-auth',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      const route = await readTextFile(join(projectPath, 'apps/web/src/routes/api/trpc/$.ts'));
      expect(route).toContain("import { db } from '@/lib/server'");
      expect(route).toContain('createTRPCContext({ headers: request.headers, db })');
      const init = await readTextFile(join(projectPath, 'packages/api/src/trpc.ts'));
      expect(init).toContain("import { getRequestSession } from '@repo/auth/session-cache'");
      expect(init).not.toContain('cloudflare:workers');
    });
  });

  describe('Hyperdrive stays blocked', () => {
    test('rejects tRPC + postgres + cloudflare on Start like on Next.js', async () => {
      const result = await runCli(
        [
          'start-trpc-pg-cf',
          '--app',
          'web:tanstack-start:trpc',
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--deployment',
          'cloudflare',
          ...COMMON_ARGS,
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('trpc');
    });
  });
});

describe('Next.js + tRPC aligns on the explicit context signature', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo: init.ts takes the headers, server.tsx and the route pass them', async () => {
    const result = await runCli(
      [
        'next-trpc-auth',
        '--app',
        'next-trpc-auth:nextjs:trpc,tanstack-query,better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
        ...COMMON_ARGS,
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const projectPath = join(tempDir, 'next-trpc-auth');

    const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
    expect(init).toContain('export async function createTRPCContext(opts: { headers: Headers }) {');
    expect(init).toContain('const session = await auth.api.getSession({ headers: opts.headers });');
    expect(init).not.toContain('next/headers');
    expect(init).not.toContain('getRequestSession');

    const server = await readTextFile(join(projectPath, 'src/trpc/server.tsx'));
    expect(server).toContain('const getTRPCContext = cache(async () => createTRPCContext({ headers: await headers() }));');

    const route = await readTextFile(join(projectPath, 'src/app/api/trpc/[trpc]/route.ts'));
    expect(route).toContain('createContext: ({ req }) => createTRPCContext({ headers: req.headers }),');
    expect(init).toContain("import { auth } from '@/lib/auth/auth'");
    expect(await fileExists(join(projectPath, 'src/trpc/auth.ts'))).toBe(false);
    expect(await fileExists(join(projectPath, 'src/lib/auth/session-cache.ts'))).toBe(false);
  });

  test('single repo without better-auth: the context still takes the headers', async () => {
    const result = await runCli(['next-trpc', '--app', 'next-trpc:nextjs:trpc', ...COMMON_ARGS], tempDir);
    expect(result.exitCode).toBe(0);
    const projectPath = join(tempDir, 'next-trpc');

    const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
    expect(init).toContain('export async function createTRPCContext(opts: { headers: Headers }) {');
    const route = await readTextFile(join(projectPath, 'src/app/api/trpc/[trpc]/route.ts'));
    expect(route).toContain('createContext: ({ req }) => createTRPCContext({ headers: req.headers }),');
  });
});
