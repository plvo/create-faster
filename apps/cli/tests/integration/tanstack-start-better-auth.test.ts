import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJson {
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

const COMMON_ARGS = ['--no-git', '--no-install', '--pm', 'bun'];

describe('TanStack Start + better-auth', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, ...COMMON_ARGS], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  describe('single repo on Nitro, sqlite + drizzle', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-auth', [
        '--app',
        'start-auth:tanstack-start:better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
    });

    test('the app instance is a module singleton built with the Start cookie plugin', async () => {
      const instance = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
      expect(instance).toContain("import { tanstackStartCookies } from 'better-auth/tanstack-start'");
      expect(instance).toContain("import { createAuth } from './create-auth'");
      expect(instance).toContain('export const auth = createAuth(tanstackStartCookies())');
      expect(instance).not.toContain('nextCookies');
    });

    test('the factory is framework-agnostic, appends the cookie plugin last and never refreshes without it', async () => {
      const factory = await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'));
      expect(factory).toContain('export function createAuth(cookiePlugin?: BetterAuthPlugin) {\n  return betterAuth({\n    baseURL: {');
      expect(factory).toContain('    plugins: [...(cookiePlugin ? [cookiePlugin] : [])],');
      expect(factory).toContain('      disableSessionRefresh: !cookiePlugin,');
      expect(factory).toContain('export type Auth = ReturnType<typeof createAuth>');
      expect(factory).not.toContain('better-auth/next-js');
      expect(factory).not.toContain('better-auth/tanstack-start');
    });

    test('auth route handles every method through auth.handler', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/api/auth/$.ts'));
      expect(route).toContain("createFileRoute('/api/auth/$')");
      expect(route).toContain("import { auth } from '@/lib/auth/auth'");
      expect(route).toContain('GET: ({ request }) => auth.handler(request)');
      expect(route).toContain('POST: ({ request }) => auth.handler(request)');
    });

    test('auth client infers from the exported Auth type', async () => {
      const client = await readTextFile(join(projectPath, 'src/lib/auth/auth-client.ts'));
      expect(client).toContain("from 'better-auth/react'");
      expect(client).toContain("import type { Auth } from './create-auth'");
      expect(client).toContain('inferAdditionalFields<Auth>()');
    });

    test('session cache memoizes the promise per Headers object, typed from Auth', async () => {
      const cache = await readTextFile(join(projectPath, 'src/lib/auth/session-cache.ts'));
      expect(cache).toContain('new WeakMap<Headers, Promise<Session | null>>()');
      expect(cache).toContain("import type { Auth } from './create-auth'");
      expect(cache).toContain("Auth['$Infer']['Session']");
      expect(cache).toContain(
        'export function getRequestSession(headers: Headers, load: () => Promise<Session | null>): Promise<Session | null> {',
      );
    });

    test('getSession server function reads the session through the cache', async () => {
      const session = await readTextFile(join(projectPath, 'src/lib/auth/session.ts'));
      expect(session).toContain('createServerFn');
      expect(session).toContain("import { getRequest } from '@tanstack/react-start/server'");
      expect(session).toContain("import { auth } from '@/lib/auth/auth'");
      expect(session).toContain("import { getRequestSession } from '@/lib/auth/session-cache'");
      expect(session).toContain('getRequestSession(request.headers,');
    });

    test('does not leak Next.js only files or dependencies', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.dependencies).toHaveProperty('better-auth');
      expect(pkg.dependencies).not.toHaveProperty('server-only');
      expect(pkg.dependencies).not.toHaveProperty('next');
      expect(await fileExists(join(projectPath, 'src/app'))).toBe(false);
    });

    test('agent docs explain the per-request session cache', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('getSession');
      expect(agents).toContain('WeakMap<Headers, Promise<Session | null>>');
    });

    test('agent docs tell to guard routes yourself, since no protected layout is generated', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('No protected layout is generated: guard routes yourself.');
    });
  });

  describe('single repo on Cloudflare, D1 + drizzle', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-auth-d1', [
        '--app',
        'start-auth-d1:tanstack-start:better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('server.ts builds db and auth once at module scope', async () => {
      const server = await readTextFile(join(projectPath, 'src/lib/server.ts'));
      expect(server).toContain("import { env } from 'cloudflare:workers'");
      expect(server).toContain("import { createAuth } from '@/lib/auth/create-auth'");
      expect(server).toContain("import { tanstackStartCookies } from 'better-auth/tanstack-start'");
      expect(server).toContain('export const db = createDb(env.DB)');
      expect(server).toContain('export const auth = createAuth(db, tanstackStartCookies())');
      expect(server).not.toContain('async');
    });

    test('the factory takes the db and the cookie plugin and never imports cloudflare:workers', async () => {
      const factory = await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'));
      expect(factory).toContain('export function createAuth(db: Database, cookiePlugin?: BetterAuthPlugin)');
      expect(factory).not.toContain('cloudflare:workers');
      expect(factory).not.toContain('Cookies()');
      expect(await fileExists(join(projectPath, 'src/lib/auth/auth.ts'))).toBe(false);
    });

    test('route and getSession import the module-level auth from server.ts', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/api/auth/$.ts'));
      expect(route).toContain("import { auth } from '@/lib/server'");
      const session = await readTextFile(join(projectPath, 'src/lib/auth/session.ts'));
      expect(session).toContain("import { auth } from '@/lib/server'");
    });

    test('session cache and client use the same exported Auth type', async () => {
      const cache = await readTextFile(join(projectPath, 'src/lib/auth/session-cache.ts'));
      expect(cache).toContain("import type { Auth } from './create-auth'");
      const client = await readTextFile(join(projectPath, 'src/lib/auth/auth-client.ts'));
      expect(client).toContain('inferAdditionalFields<Auth>()');
    });

    test('no Next.js per-request helpers are generated', async () => {
      const server = await readTextFile(join(projectPath, 'src/lib/server.ts'));
      expect(server).not.toContain('getAuth');
      expect(server).not.toContain('server-only');
      expect(await fileExists(join(projectPath, 'src/lib/env.ts'))).toBe(false);
    });
  });

  describe('turborepo, Start + Next.js + Hono, postgres + drizzle', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-auth-turbo', [
        '--app',
        'web:tanstack-start:better-auth',
        '--app',
        'site:nextjs',
        '--app',
        'api:hono',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
      ]);
    });

    test('shared auth package is a framework-agnostic factory that appends the app cookie plugin last', async () => {
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toContain("import { type BetterAuthPlugin, betterAuth } from 'better-auth'");
      expect(auth).toContain('export function createAuth(cookiePlugin?: BetterAuthPlugin)');
      expect(auth).toContain('export type Auth = ReturnType<typeof createAuth>');
      expect(auth).toContain('    plugins: [...(cookiePlugin ? [cookiePlugin] : [])],');
      expect(auth).not.toContain('Cookies()');
      expect(auth).not.toContain('better-auth/next-js');
      expect(auth).not.toContain('better-auth/tanstack-start');
      expect(auth).not.toContain('export const auth');
    });

    test('the web app builds its own auth instance with the Start cookie plugin', async () => {
      const instance = await readTextFile(join(projectPath, 'apps/web/src/lib/auth/auth.ts'));
      expect(instance).toContain("import { tanstackStartCookies } from 'better-auth/tanstack-start'");
      expect(instance).toContain("import { createAuth } from '@repo/auth/auth'");
      expect(instance).toContain('export const auth = createAuth(tanstackStartCookies())');
      expect(await fileExists(join(projectPath, 'packages/auth/src/route-nextjs.ts'))).toBe(false);
    });

    test('session cache lives in the auth package so a tRPC context can import it', async () => {
      const cache = await readTextFile(join(projectPath, 'packages/auth/src/session-cache.ts'));
      expect(cache).toContain('new WeakMap<Headers, Promise<Session | null>>()');
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'packages/auth/package.json'));
      expect(pkg.exports?.['./session-cache']).toBe('./src/session-cache.ts');
    });

    test('the web app owns the route and the getSession server function', async () => {
      const route = await readTextFile(join(projectPath, 'apps/web/src/routes/api/auth/$.ts'));
      expect(route).toContain("import { auth } from '@/lib/auth/auth'");
      const session = await readTextFile(join(projectPath, 'apps/web/src/lib/auth/session.ts'));
      expect(session).toContain("import { auth } from '@/lib/auth/auth'");
      expect(session).toContain("import { getRequestSession } from '@repo/auth/session-cache'");
      expect(await fileExists(join(projectPath, 'apps/site/src/routes'))).toBe(false);
    });

    test('the Next.js app without better-auth gets no auth files', async () => {
      expect(await fileExists(join(projectPath, 'apps/site/src/app/api/auth'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/site/src/lib/auth'))).toBe(false);
    });

    test('the web app depends on the auth package and on better-auth for its cookie plugin, not on server-only', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'apps/web/package.json'));
      expect(pkg.dependencies).toHaveProperty('@repo/auth', '*');
      expect(pkg.dependencies).toHaveProperty('better-auth');
      expect(pkg.dependencies).not.toHaveProperty('server-only');
    });
  });

  describe('turborepo on Cloudflare, D1 + drizzle', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-auth-turbo-d1', [
        '--app',
        'web:tanstack-start:better-auth',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('the web app server.ts composes db and auth, with its own cookie plugin, from the shared factories', async () => {
      const server = await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'));
      expect(server).toContain("import { createDb } from '@repo/db'");
      expect(server).toContain("import { createAuth } from '@repo/auth/auth'");
      expect(server).toContain("import { tanstackStartCookies } from 'better-auth/tanstack-start'");
      expect(server).toContain('export const auth = createAuth(db, tanstackStartCookies())');
      expect(await fileExists(join(projectPath, 'apps/web/src/lib/auth/auth.ts'))).toBe(false);
    });

    test('the shared auth package never imports cloudflare:workers', async () => {
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toContain('export function createAuth(db: Database, cookiePlugin?: BetterAuthPlugin)');
      expect(auth).not.toContain('cloudflare:workers');
      expect(auth).not.toContain('Cookies()');
    });
  });

  describe('turborepo with Next.js and Start apps that both use better-auth', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('mixed-auth', [
        '--app',
        'web:nextjs:better-auth,trpc',
        '--app',
        'admin:tanstack-start:better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
    });

    test('the shared package carries no framework cookie plugin', async () => {
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).not.toContain('better-auth/next-js');
      expect(auth).not.toContain('better-auth/tanstack-start');
      expect(auth).toContain('plugins: [...(cookiePlugin ? [cookiePlugin] : [])],');
    });

    test('each app builds its own instance with its own cookie plugin', async () => {
      const next = await readTextFile(join(projectPath, 'apps/web/src/lib/auth/auth.ts'));
      expect(next).toContain("import { nextCookies } from 'better-auth/next-js'");
      expect(next).toContain('export const auth = createAuth(nextCookies())');
      expect(next).not.toContain('tanstack');
      const start = await readTextFile(join(projectPath, 'apps/admin/src/lib/auth/auth.ts'));
      expect(start).toContain('export const auth = createAuth(tanstackStartCookies())');
      expect(start).not.toContain('next-js');
    });

    test('the Next.js route uses the app instance and the proxy none', async () => {
      const route = await readTextFile(join(projectPath, 'apps/web/src/app/api/auth/[...all]/route.ts'));
      expect(route).toContain("import { auth } from '@/lib/auth/auth'");
      expect(route).toContain('toNextJsHandler(auth.handler)');
      const proxy = await readTextFile(join(projectPath, 'apps/web/src/proxy.ts'));
      expect(proxy).not.toContain('@/lib/auth/auth');
    });

    test('the tRPC package reads sessions with a cookie-less instance', async () => {
      const readOnly = await readTextFile(join(projectPath, 'packages/api/src/auth.ts'));
      expect(readOnly).toContain("import { createAuth } from '@repo/auth/auth'");
      expect(readOnly).toContain('export const auth = createAuth()');
      const init = await readTextFile(join(projectPath, 'packages/api/src/trpc.ts'));
      expect(init).toContain("import { auth as sessionReader } from './auth'");
      expect(init).toContain('createTRPCContext(opts: { headers: Headers })');
    });

    test('the agent docs explain the per-app instance and the read-only tRPC instance', async () => {
      const agents = await readTextFile(join(projectPath, 'apps/web/AGENTS.md'));
      expect(agents).toContain('createAuth(cookiePlugin?)');
      expect(agents).toContain('`@repo/auth/auth` only exports the factory');
      expect(agents).toContain('that instance is `createAuth()` with no cookie plugin');
      expect(agents).toContain('would lose its `Set-Cookie` headers');
      expect(agents).toContain('tRPC reads do not extend the session');
    });
  });

  describe('turborepo with Next.js on Cloudflare D1', () => {
    test('getAuth builds the per-request instance with the Next.js cookie plugin', async () => {
      const projectPath = await generate('next-auth-d1-turbo', [
        '--app',
        'web:nextjs:better-auth',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      const server = await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'));
      expect(server).toContain("import { nextCookies } from 'better-auth/next-js'");
      expect(server).toContain('return createAuth(await getDb(), nextCookies())');
    });
  });

  describe('agent docs name what the generated code exports', () => {
    const INSTANCE_IN_AUTH_TS = '`src/lib/auth/auth.ts` exports this app\'s `auth`';
    const GET_AUTH_IN_SERVER_TS = '`getAuth()` in `src/lib/server.ts` builds this app\'s instance per request';
    const AUTH_IN_SERVER_TS = '`src/lib/server.ts` builds this app\'s `auth` once at module scope';
    const TRPC_READ_EXTENDS = 'a tRPC read extends the session';
    const TRPC_READ_DOES_NOT_EXTEND = 'tRPC reads do not extend the session';

    test('single repo Next.js + tRPC: instance in auth.ts, tRPC reads through it and extend the session', async () => {
      const projectPath = await generate('docs-next-single', [
        '--app',
        'docs-next-single:nextjs:better-auth,trpc',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain(INSTANCE_IN_AUTH_TS);
      expect(await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'))).toContain('export const auth = ');
      expect(agents).toContain(TRPC_READ_EXTENDS);
      expect(await readTextFile(join(projectPath, 'src/trpc/init.ts'))).toContain(
        "import { sessionReader } from './session-reader'",
      );
      expect(await readTextFile(join(projectPath, 'src/trpc/session-reader.ts'))).toContain(
        "export { auth as sessionReader } from '@/lib/auth/auth';",
      );
    });

    test('single repo Next.js on D1: getAuth in server.ts, tRPC reads do not extend the session', async () => {
      const projectPath = await generate('docs-next-d1', [
        '--app',
        'docs-next-d1:nextjs:better-auth,trpc',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain(GET_AUTH_IN_SERVER_TS);
      expect(await readTextFile(join(projectPath, 'src/lib/server.ts'))).toContain('export async function getAuth()');
      expect(agents).toContain(TRPC_READ_DOES_NOT_EXTEND);
      expect(await readTextFile(join(projectPath, 'src/trpc/init.ts'))).toContain('createAuth(opts.db)');
    });

    test('turborepo Next.js on D1: the app doc points at getAuth, which server.ts exports', async () => {
      const projectPath = await generate('docs-next-d1-turbo', [
        '--app',
        'web:nextjs:better-auth',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      const agents = await readTextFile(join(projectPath, 'apps/web/AGENTS.md'));
      expect(agents).toContain(GET_AUTH_IN_SERVER_TS);
      expect(agents).not.toContain('import `auth`');
      expect(await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'))).toContain('export async function getAuth()');
    });

    test('single repo Start on D1: the doc shows the call server.ts makes', async () => {
      const projectPath = await generate('docs-start-d1', [
        '--app',
        'docs-start-d1:tanstack-start:better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain(AUTH_IN_SERVER_TS);
      expect(agents).toContain('`createAuth(db, tanstackStartCookies())`');
      expect(await readTextFile(join(projectPath, 'src/lib/server.ts'))).toContain(
        'export const auth = createAuth(db, tanstackStartCookies())',
      );
    });

    test('multitenant-saas-nextjs: the blueprint doc states the cookie plugin its tRPC package binds', async () => {
      const projectPath = await generate('docs-multitenant', ['--blueprint', 'multitenant-saas-nextjs', '--linter', 'biome']);
      expect(await readTextFile(join(projectPath, 'packages/api/src/auth.ts'))).toContain('createAuth(nextCookies())');
      const agents = await readTextFile(join(projectPath, 'apps/web/AGENTS.md'));
      expect(agents).toContain('bind that framework\'s plugin in this file');
      const authDoc = await readTextFile(join(projectPath, 'docs/agents/auth-rbac.md'));
      expect(authDoc).toContain('`packages/api/src/auth.ts` builds the tRPC package\'s instance with `createAuth(nextCookies())`');
      expect(authDoc).not.toContain('exported as `auth`');
    });

    test('org-dashboard-nextjs: the blueprint doc names the factory the package exports', async () => {
      const projectPath = await generate('docs-org-dashboard', ['--blueprint', 'org-dashboard-nextjs', '--linter', 'biome']);
      const authDoc = await readTextFile(join(projectPath, 'docs/agents/auth.md'));
      expect(authDoc).toContain('exports the `createAuth(cookiePlugin?)` factory');
      expect(authDoc).not.toContain('exported as `auth`');
      expect(await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'))).toContain(
        'export function createAuth(cookiePlugin?: BetterAuthPlugin)',
      );
    });

    test('cloudflare-fullstack-nextjs: the blueprint doc shows the factory signature and the getAuth call', async () => {
      const projectPath = await generate('docs-cf-fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs', '--linter', 'biome']);
      const authDoc = await readTextFile(join(projectPath, 'docs/agents/auth-rbac.md'));
      expect(authDoc).toContain('exports `createAuth(db: Database, cookiePlugin?: BetterAuthPlugin)`');
      expect(authDoc).toContain('calls `createAuth(db, nextCookies())`');
      expect(await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'))).toContain(
        'export function createAuth(db: Database, cookiePlugin?: BetterAuthPlugin)',
      );
      expect(await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'))).toContain(
        'createAuth(await getDb(), nextCookies())',
      );
    });

    test('dapp-rainbowkit-nextjs: the blueprint doc names the file that registers siwe', async () => {
      const projectPath = await generate('docs-dapp', ['--blueprint', 'dapp-rainbowkit-nextjs', '--linter', 'biome']);
      const walletDoc = await readTextFile(join(projectPath, 'docs/agents/wallet-auth.md'));
      expect(walletDoc).toContain('The `siwe()` plugin is registered in `src/lib/auth/create-auth.ts`');
      expect(await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'))).toContain('siwe({');
    });
  });

  describe('Next.js apps keep their own wiring', () => {
    test('a Next.js + better-auth project builds its instance with nextCookies and has no Start files', async () => {
      const projectPath = await generate('next-auth', [
        '--app',
        'web:nextjs:better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
      const instance = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
      expect(instance).toContain('export const auth = createAuth(nextCookies())');
      expect(instance).not.toContain('tanstackStartCookies');
      expect(await fileExists(join(projectPath, 'src/lib/auth/session.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/routes'))).toBe(false);
    });
  });

  describe('session cache generation matches its export', () => {
    const combos = [
      { name: 'next-only', apps: ['web:nextjs:better-auth'], cache: false },
      { name: 'next-trpc', apps: ['web:nextjs:better-auth,trpc'], cache: false },
      { name: 'start', apps: ['web:tanstack-start:better-auth'], cache: true },
      { name: 'next-auth-start-plain', apps: ['web:nextjs:better-auth', 'admin:tanstack-start'], cache: true },
    ];

    test.each(combos)('$name: the file and the ./session-cache export agree', async ({ name, apps, cache }) => {
      const projectPath = await generate(`cache-${name}`, [
        ...apps.flatMap((app) => ['--app', app]),
        '--app',
        'api:hono',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'packages/auth/package.json'));
      const exported = pkg.exports?.['./session-cache'] === './src/session-cache.ts';
      const generated = await fileExists(join(projectPath, 'packages/auth/src/session-cache.ts'));
      expect(generated).toBe(cache);
      expect(exported).toBe(generated);
    });
  });

  describe('blueprints that override auth.ts', () => {
    const blueprintsWithAuth = Object.entries(META.blueprints).filter(([, blueprint]) =>
      blueprint.context.apps.some((app) => app.libraries.includes('better-auth')),
    );

    test.each(blueprintsWithAuth)('%s keeps the exported Auth type the session cache imports', async (name) => {
      const projectPath = await generate(`bp-${name}`, ['--blueprint', name, '--linter', 'biome']);
      const authPath = [
        join(projectPath, 'packages/auth/src/auth.ts'),
        join(projectPath, 'src/lib/auth/create-auth.ts'),
      ];
      const existing = await Promise.all(authPath.map(async (path) => ((await fileExists(path)) ? path : undefined)));
      const auth = await readTextFile(existing.find((path) => path !== undefined) as string);
      expect(auth).toMatch(/export type Auth = /);
    });
  });

  describe('blueprints keep the cookie plugin after their own plugins', () => {
    const blueprintsWithAuth = Object.entries(META.blueprints).filter(([, blueprint]) =>
      blueprint.context.apps.some((app) => app.libraries.includes('better-auth')),
    );
    const turborepoBlueprints = blueprintsWithAuth.filter(([, blueprint]) => blueprint.context.apps.length > 1);

    const COOKIE_PLUGIN_BY_STACK: Record<string, string> = {
      nextjs: 'nextCookies()',
      'tanstack-start': 'tanstackStartCookies()',
    };

    test.each(turborepoBlueprints)('%s package factory appends the app cookie plugin last', async (name, blueprint) => {
      const projectPath = await generate(`bp-factory-${name}`, ['--blueprint', name, '--linter', 'biome']);
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toMatch(/\.\.\.\(cookiePlugin \? \[cookiePlugin\] : \[\]\),\n\s*\],/);
      expect(auth).toContain('disableSessionRefresh: !cookiePlugin,');
      expect(auth).not.toMatch(/better-auth\/(next-js|tanstack-start)/);
      const instance = await readTextFile(join(projectPath, 'apps/web/src/lib/auth/auth.ts')).catch(() =>
        readTextFile(join(projectPath, 'apps/web/src/lib/server.ts')),
      );
      expect(instance).toContain(COOKIE_PLUGIN_BY_STACK[blueprint.context.apps[0]?.stackName ?? ''] as string);
    });

    test('dapp-rainbowkit-nextjs (single repo) appends the cookie plugin after siwe and builds its instance with nextCookies', async () => {
      const projectPath = await generate('bp-single-dapp-rainbowkit', ['--blueprint', 'dapp-rainbowkit-nextjs', '--linter', 'biome']);
      const factory = await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'));
      expect(factory).toMatch(/\}\),\n\s*\.\.\.\(cookiePlugin \? \[cookiePlugin\] : \[\]\),\n\s*\],/);
      expect(factory).toContain('disableSessionRefresh: !cookiePlugin,');
      const instance = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
      expect(instance).toContain('export const auth = createAuth(nextCookies())');
    });
  });

  describe('Hyperdrive stays blocked', () => {
    test('rejects better-auth + postgres + cloudflare on Start like on Next.js', async () => {
      const result = await runCli(
        [
          'start-auth-pg-cf',
          '--app',
          'web:tanstack-start:better-auth',
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
      expect(result.stderr).toContain('better-auth');
    });
  });
});
