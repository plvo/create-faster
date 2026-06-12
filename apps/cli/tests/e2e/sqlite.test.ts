import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, fileExists, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_DB = 120_000;

function countRows(dbPath: string, table: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
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
    'db:push creates the local database file',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:push', '--force'], projectDir);
      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(projectDir, 'db.sqlite'))).toBe(true);
    },
    TIMEOUT_DB,
  );

  test(
    'db:seed populates the database',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:seed'], projectDir);
      expect(result.exitCode).toBe(0);

      const dbPath = join(projectDir, 'db.sqlite');
      expect(countRows(dbPath, 'users')).toBe(2);
      expect(countRows(dbPath, 'posts')).toBe(3);
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
    'db:seed from the root seeds the same database file',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:seed'], projectDir);
      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectDir, 'db.sqlite'))).toBe(false);

      const dbPath = join(projectDir, 'packages/db/db.sqlite');
      expect(countRows(dbPath, 'users')).toBe(2);
      expect(countRows(dbPath, 'posts')).toBe(3);
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
