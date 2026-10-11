import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const NATIVE_SQLITE_BINDING = 'libsql';

describe('SQLite with TanStack Start on Nitro', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo: the app depends on the native sqlite binding directly so Nitro can trace it', async () => {
    const result = await runCli(
      ['start-sqlite', '--app', 'start-sqlite:tanstack-start', '--database', 'sqlite', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite/package.json'));
    expect(pkg.dependencies?.[NATIVE_SQLITE_BINDING]).toBeDefined();
  });

  test('turborepo: only the TanStack Start app depends on the native sqlite binding', async () => {
    const result = await runCli(
      ['start-sqlite-turbo', '--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'sqlite', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const web = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-turbo/apps/web/package.json'));
    const api = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-turbo/apps/api/package.json'));
    expect(web.dependencies?.[NATIVE_SQLITE_BINDING]).toBeDefined();
    expect(api.dependencies?.[NATIVE_SQLITE_BINDING]).toBeUndefined();
  });

  test('a TanStack Start app without sqlite does not get the native binding', async () => {
    const result = await runCli(
      ['start-pg', '--app', 'start-pg:tanstack-start', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-pg/package.json'));
    expect(pkg.dependencies?.[NATIVE_SQLITE_BINDING]).toBeUndefined();
  });

  test('a TanStack Start app on Cloudflare (no Nitro) does not get the native binding', async () => {
    const result = await runCli(
      ['start-sqlite-cf', '--app', 'start-sqlite-cf:tanstack-start', '--database', 'sqlite', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, 'start-sqlite-cf/package.json'));
    expect(pkg.dependencies?.[NATIVE_SQLITE_BINDING]).toBeUndefined();
  });
});
