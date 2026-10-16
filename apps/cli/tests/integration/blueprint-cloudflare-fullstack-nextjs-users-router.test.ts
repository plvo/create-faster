import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-fullstack-nextjs';

type Procedure = (args: { ctx: { db: unknown }; input: { id: string } }) => Promise<unknown>;

// Stand-ins for what the generated router imports. A procedure builder returns the handler it is given, so the
// router's `get` is the function the generated file wrote; the database answers with the rows a test sets.
const STUBS: Record<string, string> = {
  'db.mjs': `export const desc = (column) => column;
export const eq = (column, value) => [column, value];
export const userTable = new Proxy({}, { get: (_, column) => String(column) });`,
  'zod.mjs': 'export const z = new Proxy(() => {}, { get: () => z, apply: () => z });',
  'trpc.mjs': 'export const router = (procedures) => procedures;',
  'rbac.mjs': `const procedure = { input: () => procedure, query: (handler) => handler, mutation: (handler) => handler };
export const adminProcedure = procedure;`,
  'auth.mjs': 'export const createAuth = () => ({});',
};

const IMPORTS: Record<string, string> = {
  '@repo/db': './db.mjs',
  '@repo/auth/auth': './auth.mjs',
  zod: './zod.mjs',
  '../trpc': './trpc.mjs',
  '../middleware/rbac': './rbac.mjs',
};

describe(`${BLUEPRINT} users router`, () => {
  let tempDir: string;
  let get: Procedure;

  const databaseWith = (rows: unknown[]) => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  });

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);
    const source = await readTextFile(join(tempDir, BLUEPRINT, 'packages/api/src/router/users.ts'));
    const { usersRouter } = await evaluateGeneratedModule<{ usersRouter: { get: Procedure } }>(
      source,
      join(stubs, 'generated-users.mjs'),
      IMPORTS,
    );
    get = usersRouter.get;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  // The user page turns null into a 404 before anything is hydrated. A thrown error would be logged by the
  // server link in development and rejected in the browser.
  test('get answers null for an id that matches no user, without throwing', async () => {
    expect(await get({ ctx: { db: databaseWith([]) }, input: { id: 'nobody' } })).toBeNull();
  });

  test('get answers the user it finds', async () => {
    const user = { id: 'u1', name: 'Ada' };
    expect(await get({ ctx: { db: databaseWith([user]) }, input: { id: 'u1' } })).toBe(user);
  });
});
