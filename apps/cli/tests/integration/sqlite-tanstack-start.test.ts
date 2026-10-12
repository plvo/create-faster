import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SQLITE_CLIENT = '@libsql/client';

describe('SQLite with TanStack Start on Nitro', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo: the app depends on the sqlite client directly so Nitro can trace its native binding', async () => {
    const result = await runCli(
      ['start-sqlite', '--app', 'start-sqlite:tanstack-start', '--database', 'sqlite', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite/package.json'));
    expect(pkg.dependencies?.[SQLITE_CLIENT]).toBeDefined();
  });

  test('turborepo: only the TanStack Start app depends on the sqlite client, at the same version as the db package', async () => {
    const result = await runCli(
      ['start-sqlite-turbo', '--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'sqlite', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const web = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-turbo/apps/web/package.json'));
    const api = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-turbo/apps/api/package.json'));
    const db = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-turbo/packages/db/package.json'));
    expect(web.dependencies?.[SQLITE_CLIENT]).toBeDefined();
    expect(web.dependencies?.[SQLITE_CLIENT]).toBe(db.dependencies?.[SQLITE_CLIENT]);
    expect(api.dependencies?.[SQLITE_CLIENT]).toBeUndefined();
  });

  test('a TanStack Start app without sqlite does not get the sqlite client', async () => {
    const result = await runCli(
      ['start-pg', '--app', 'start-pg:tanstack-start', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-pg/package.json'));
    expect(pkg.dependencies?.[SQLITE_CLIENT]).toBeUndefined();
  });

  test('turborepo on Cloudflare static (no Nitro): the TanStack Start app does not get the sqlite client', async () => {
    const result = await runCli(
      ['start-sqlite-cf', '--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'sqlite', '--orm', 'drizzle', '--deployment', 'cloudflare-static', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const web = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-cf/apps/web/package.json'));
    expect(web.dependencies?.[SQLITE_CLIENT]).toBeUndefined();
  });
});
