import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('Single repo: Next.js + cloudflare + d1 + better-auth', () => {
  const projectName = 'd1-auth-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:nextjs:better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('auth.ts exposes a createAuth(db) factory, not a module singleton', async () => {
    const auth = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
    expect(auth).toContain('export function createAuth(db: Database)');
    expect(auth).toContain('export type Auth = ReturnType<typeof createAuth>');
    expect(auth).not.toContain('export const auth');
  });

  test('auth.ts drizzle adapter uses the sqlite provider for d1', async () => {
    const auth = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
    expect(auth).toContain("provider: 'sqlite'");
  });

  test('server.ts composes the per-request db and auth from the binding', async () => {
    const server = await readTextFile(join(projectPath, 'src/lib/server.ts'));
    expect(server).toContain("import { getEnv } from '@/lib/env'");
    expect(server).toContain('export async function getDb()');
    expect(server).toContain('createDb((await getEnv()).DB)');
    expect(server).toContain('export async function getAuth()');
    expect(server).toContain('createAuth(await getDb())');
  });

  test('auth route handler resolves auth per-request via getAuth()', async () => {
    const route = await readTextFile(join(projectPath, 'src/app/api/auth/[...all]/route.ts'));
    expect(route).toContain("import { getAuth } from '@/lib/server'");
    expect(route).toContain('await getAuth()');
    expect(route).not.toContain("import { auth }");
  });

  test('middleware resolves auth per-request via getAuth()', async () => {
    const mw = await readTextFile(join(projectPath, 'src/middleware.ts'));
    expect(mw).toContain("import { getAuth } from '@/lib/server'");
    expect(mw).toContain('const auth = await getAuth()');
    expect(mw).not.toContain("import { auth }");
  });

  test('auth-client infers fields from the Auth type, not the singleton', async () => {
    const client = await readTextFile(join(projectPath, 'src/lib/auth/auth-client.ts'));
    expect(client).toContain("import type { Auth } from './auth'");
    expect(client).toContain('inferAdditionalFields<Auth>()');
    expect(client).not.toContain('typeof auth');
  });
});

describe('Single repo: Next.js + cloudflare + d1 + trpc + better-auth', () => {
  const projectName = 'd1-trpc-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:nextjs:trpc,tanstack-query,better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('trpc context takes a per-request db and builds auth from it', async () => {
    const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
    expect(init).toContain('createTRPCContext(opts: { headers: Headers; db: Database }');
    expect(init).toContain('createAuth(opts.db)');
    expect(init).toContain('protectedProcedure');
    expect(init).not.toContain("import { auth }");
    expect(init).not.toContain("import { db }");
  });

  test('trpc server.tsx supplies the per-request db via getDb()', async () => {
    const server = await readTextFile(join(projectPath, 'src/trpc/server.tsx'));
    expect(server).toContain("import { getDb } from '@/lib/server'");
    expect(server).toContain('db: await getDb()');
  });

  test('trpc route handler supplies the per-request db via getDb()', async () => {
    const route = await readTextFile(join(projectPath, 'src/app/api/trpc/[trpc]/route.ts'));
    expect(route).toContain("import { getDb } from '@/lib/server'");
    expect(route).toContain('db: await getDb()');
  });
});

describe('Turborepo: Next.js + Hono + cloudflare + d1 + trpc + better-auth', () => {
  const projectName = 'd1-turbo-consumers';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:nextjs:trpc,tanstack-query,better-auth',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('auth package exposes the createAuth factory', async () => {
    const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(auth).toContain('export function createAuth(db: Database)');
    expect(auth).not.toContain('export const auth');
  });

  test('the singleton route-nextjs re-export is not generated for d1', async () => {
    expect(await fileExists(join(projectPath, 'packages/auth/src/route-nextjs.ts'))).toBe(false);
  });

  test('api package context takes a per-request db and builds auth from it', async () => {
    const trpc = await readTextFile(join(projectPath, 'packages/api/src/trpc.ts'));
    expect(trpc).toContain('createTRPCContext(opts: { headers: Headers; db: Database }');
    expect(trpc).toContain('createAuth(opts.db)');
    expect(trpc).not.toContain("import { db }");
  });

  test('web app composes the per-request seam in server.ts', async () => {
    const server = await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'));
    expect(server).toContain("from '@repo/db'");
    expect(server).toContain("from '@repo/auth/auth'");
    expect(server).toContain('createDb((await getEnv()).DB)');
    expect(server).toContain('createAuth(await getDb())');
  });

  test('web app callers supply the per-request db', async () => {
    const serverTsx = await readTextFile(join(projectPath, 'apps/web/src/trpc/server.tsx'));
    expect(serverTsx).toContain("import { getDb } from '@/lib/server'");
    expect(serverTsx).toContain('db: await getDb()');
    const route = await readTextFile(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'));
    expect(route).toContain('db: await getDb()');
    const authRoute = await readTextFile(join(projectPath, 'apps/web/src/app/api/auth/[...all]/route.ts'));
    expect(authRoute).toContain('await getAuth()');
  });
});

describe('Non-d1 databases keep the singleton wiring (regression guard)', () => {
  const projectName = 'pg-auth-trpc';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:nextjs:trpc,tanstack-query,better-auth',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('auth.ts keeps the module singleton', async () => {
    const auth = await readTextFile(join(projectPath, 'src/lib/auth/auth.ts'));
    expect(auth).toContain('export const auth = betterAuth({');
    expect(auth).toContain("import { db,");
    expect(auth).not.toContain('createAuth');
  });

  test('trpc init.ts imports the singletons, no per-request db param', async () => {
    const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
    expect(init).toContain("import { auth }");
    expect(init).toContain("import { db }");
    expect(init).not.toContain('createAuth');
    expect(init).not.toContain('db: Database');
  });

  test('no per-request server.ts accessor is generated', async () => {
    expect(await fileExists(join(projectPath, 'src/lib/server.ts'))).toBe(false);
  });

  test('auth route handler keeps toNextJsHandler', async () => {
    const route = await readTextFile(join(projectPath, 'src/app/api/auth/[...all]/route.ts'));
    expect(route).toContain('toNextJsHandler(auth.handler)');
    expect(route).not.toContain('getAuth');
  });
});
