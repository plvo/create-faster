import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, fileExists, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_DB = 120_000;

// Reads the seeded database from a Node process using the generated project's own
// @libsql/client install. This proves the libsql driver loads and queries on Node
// (not just Bun) and that it opens the same file written by db:push / db:seed.
async function countRowsViaNode(projectDir: string, dbPath: string, table: string): Promise<number> {
  const script = [
    `const { createClient } = require('@libsql/client');`,
    `const client = createClient({ url: 'file:' + ${JSON.stringify(dbPath)} });`,
    `client.execute('SELECT count(*) AS count FROM ${table}')`,
    `  .then((rs) => { process.stdout.write(String(rs.rows[0].count)); client.close(); })`,
    `  .catch((err) => { console.error(err); process.exit(1); });`,
  ].join('\n');

  const result = await runCommand(['node', '-e', script], projectDir);
  expect(result.exitCode, `node libsql read failed: ${result.stderr}`).toBe(0);
  return Number(result.stdout.trim());
}

describe('nextjs-drizzle-sqlite', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'nextjs-drizzle-sqlite',
        '--app',
        'nextjs-drizzle-sqlite:nextjs',
        '--database',
        'sqlite',
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

    projectDir = join(tempDir, 'nextjs-drizzle-sqlite');
    installResult = await runCommand(['bun', 'install'], projectDir);
    await copyFile(join(projectDir, '.env.example'), join(projectDir, '.env'));
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'db:push creates the local database file via the Node drizzle-kit CLI',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:push', '--force'], projectDir);
      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(projectDir, 'db.sqlite'))).toBe(true);
    },
    TIMEOUT_DB,
  );

  test(
    'db:seed populates the database and a Node process reads it back',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:seed'], projectDir);
      expect(result.exitCode).toBe(0);

      const dbPath = join(projectDir, 'db.sqlite');
      expect(await countRowsViaNode(projectDir, dbPath, 'users')).toBe(2);
      expect(await countRowsViaNode(projectDir, dbPath, 'posts')).toBe(3);
    },
    TIMEOUT_DB,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );
});

describe('turbo-drizzle-sqlite', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'turbo-drizzle-sqlite',
        '--app',
        'web:nextjs',
        '--app',
        'api:hono',
        '--database',
        'sqlite',
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

    projectDir = join(tempDir, 'turbo-drizzle-sqlite');
    installResult = await runCommand(['bun', 'install'], projectDir);
    await copyFile(join(projectDir, 'packages/db/.env.example'), join(projectDir, 'packages/db/.env'));
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'db:push creates the database file in packages/db',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:push', '--force'], join(projectDir, 'packages/db'));
      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(projectDir, 'packages/db/db.sqlite'))).toBe(true);
    },
    TIMEOUT_DB,
  );

  test(
    'db:seed from the root seeds the same database file, readable from Node',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:seed'], projectDir);
      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectDir, 'db.sqlite'))).toBe(false);

      const dbPath = join(projectDir, 'packages/db/db.sqlite');
      const dbPkg = join(projectDir, 'packages/db');
      expect(await countRowsViaNode(dbPkg, dbPath, 'users')).toBe(2);
      expect(await countRowsViaNode(dbPkg, dbPath, 'posts')).toBe(3);
    },
    TIMEOUT_DB,
  );

  test(
    'type-checks packages/db',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, 'packages/db'));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'type-checks apps/web',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, 'apps/web'));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );
});
