import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
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

    test('auth is a module singleton with the Start cookie plugin and no Next.js plugin', async () => {
      const auth = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
      expect(auth).toContain("import { tanstackStartCookies } from 'better-auth/tanstack-start'");
      expect(auth).toContain('plugins: [tanstackStartCookies()]');
      expect(auth).toContain('export const auth = betterAuth(');
      expect(auth).not.toContain('nextCookies');
      expect(auth).not.toContain('better-auth/next-js');
    });

    test('auth route handles every method through auth.handler', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/api/auth/$.ts'));
      expect(route).toContain("createFileRoute('/api/auth/$')");
      expect(route).toContain("import { auth } from '@/lib/auth/auth'");
      expect(route).toContain('GET: ({ request }) => auth.handler(request)');
      expect(route).toContain('POST: ({ request }) => auth.handler(request)');
    });

    test('auth client is generated', async () => {
      const client = await readTextFile(join(projectPath, 'src/lib/auth/auth-client.ts'));
      expect(client).toContain("from 'better-auth/react'");
    });

    test('session cache memoizes the promise per Request', async () => {
      const cache = await readTextFile(join(projectPath, 'src/lib/auth/session-cache.ts'));
      expect(cache).toContain('new WeakMap<Request, Promise<Session | null>>()');
      expect(cache).toContain("import type { auth } from './auth'");
    });

    test('getSession server function reads the session through the cache', async () => {
      const session = await readTextFile(join(projectPath, 'src/lib/auth/session.ts'));
      expect(session).toContain('createServerFn');
      expect(session).toContain("import { getRequest } from '@tanstack/react-start/server'");
      expect(session).toContain("import { auth } from '@/lib/auth/auth'");
      expect(session).toContain("import { getRequestSession } from '@/lib/auth/session-cache'");
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
      expect(agents).toContain('WeakMap<Request, Promise<Session | null>>');
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
      expect(server).toContain("import { createAuth } from '@/lib/auth/auth'");
      expect(server).toContain('export const db = createDb(env.DB)');
      expect(server).toContain('export const auth = createAuth(db)');
      expect(server).not.toContain('async');
    });

    test('auth.ts stays a shared createAuth(db) factory with the Start cookie plugin', async () => {
      const auth = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
      expect(auth).toContain('export function createAuth(db: Database)');
      expect(auth).toContain('plugins: [tanstackStartCookies()]');
      expect(auth).not.toContain('cloudflare:workers');
      expect(auth).not.toContain('export const auth');
    });

    test('route and getSession import the module-level auth from server.ts', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/api/auth/$.ts'));
      expect(route).toContain("import { auth } from '@/lib/server'");
      const session = await readTextFile(join(projectPath, 'src/lib/auth/session.ts'));
      expect(session).toContain("import { auth } from '@/lib/server'");
    });

    test('session cache types the session from the Auth factory type', async () => {
      const cache = await readTextFile(join(projectPath, 'src/lib/auth/session-cache.ts'));
      expect(cache).toContain("import type { Auth } from './auth'");
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

    test('shared auth package uses the Start cookie plugin only: the Next.js app has no better-auth', async () => {
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toContain('tanstackStartCookies()');
      expect(auth).not.toContain('nextCookies');
    });

    test('session cache lives in the auth package so a tRPC context can import it', async () => {
      const cache = await readTextFile(join(projectPath, 'packages/auth/src/session-cache.ts'));
      expect(cache).toContain('new WeakMap<Request, Promise<Session | null>>()');
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'packages/auth/package.json'));
      expect(pkg.exports?.['./session-cache']).toBe('./src/session-cache.ts');
    });

    test('the web app owns the route and the getSession server function', async () => {
      const route = await readTextFile(join(projectPath, 'apps/web/src/routes/api/auth/$.ts'));
      expect(route).toContain("import { auth } from '@repo/auth/auth'");
      const session = await readTextFile(join(projectPath, 'apps/web/src/lib/auth/session.ts'));
      expect(session).toContain("import { auth } from '@repo/auth/auth'");
      expect(session).toContain("import { getRequestSession } from '@repo/auth/session-cache'");
      expect(await fileExists(join(projectPath, 'apps/site/src/routes'))).toBe(false);
    });

    test('the Next.js app without better-auth gets no auth files', async () => {
      expect(await fileExists(join(projectPath, 'apps/site/src/app/api/auth'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/site/src/lib/auth'))).toBe(false);
    });

    test('the web app depends on the auth package, not on server-only', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'apps/web/package.json'));
      expect(pkg.dependencies).toHaveProperty('@repo/auth', '*');
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

    test('the web app server.ts composes db and auth from the shared factories', async () => {
      const server = await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'));
      expect(server).toContain("import { createDb } from '@repo/db'");
      expect(server).toContain("import { createAuth } from '@repo/auth/auth'");
      expect(server).toContain('export const auth = createAuth(db)');
    });

    test('the shared auth package never imports cloudflare:workers', async () => {
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toContain('export function createAuth(db: Database)');
      expect(auth).not.toContain('cloudflare:workers');
    });
  });

  describe('Next.js apps keep their own wiring', () => {
    test('a Next.js + better-auth project still uses nextCookies and has no Start files', async () => {
      const projectPath = await generate('next-auth', [
        '--app',
        'web:nextjs:better-auth',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
      ]);
      const auth = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
      expect(auth).toContain('nextCookies()');
      expect(auth).not.toContain('tanstackStartCookies');
      expect(await fileExists(join(projectPath, 'src/lib/auth/session-cache.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/auth/session.ts'))).toBe(false);
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
