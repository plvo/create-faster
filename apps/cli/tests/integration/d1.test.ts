import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('D1 database option', () => {
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('rejects --database d1 without a cloudflare deployment', async () => {
    const result = await runCli(
      ['no-cf', '--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("database 'd1'");
    expect(result.stderr).toContain('deployment: cloudflare');
  });

  test('rejects --database d1 with a non-cloudflare deployment', async () => {
    const result = await runCli(
      ['sst-d1', '--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('deployment: cloudflare');
  });

  test('accepts --database d1 with --deployment cloudflare', async () => {
    const result = await runCli(
      ['cf-d1', '--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const env = await readTextFile(join(tempDir, 'cf-d1', '.env.example'));
    expect(env).not.toContain('DATABASE_URL');
  });
});

describe('Single repo: Next.js + cloudflare + d1', () => {
  const projectName = 'd1-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db index exports a createDb factory, not a DATABASE_URL singleton', async () => {
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain("from 'drizzle-orm/d1'");
    expect(index).toContain('export function createDb(d1: D1Database)');
    expect(index).toContain('export type Database');
    expect(index).not.toContain('DATABASE_URL');
    expect(index).not.toContain('libsql');
  });

  test('drizzle.config uses sqlite dialect with a d1-http prod branch', async () => {
    const config = await readTextFile(join(projectPath, 'drizzle.config.ts'));
    expect(config).toContain("dialect: 'sqlite'");
    expect(config).toContain("driver: 'd1-http'");
    expect(config).toContain('CLOUDFLARE_D1_DATABASE_ID');
    expect(config).not.toContain('postgresql');
    expect(config).not.toContain('DATABASE_URL');
  });

  test('schema still uses the sqlite dialect', async () => {
    const schema = await readTextFile(join(projectPath, 'src/lib/db/schema.ts'));
    expect(schema).toContain('sqliteTable');
    expect(schema).not.toContain('pgTable');
    expect(schema).not.toContain('mysqlTable');
  });

  test('generates a composable getEnv seam typing the DB binding', async () => {
    const env = await readTextFile(join(projectPath, 'src/lib/env.ts'));
    expect(env).toContain("from '@opennextjs/cloudflare'");
    expect(env).toContain('export async function getEnv()');
    expect(env).toContain('DB: D1Database');
    expect(env).toContain('env.DB');
  });

  test('wrangler.jsonc declares the D1 binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"migrations_dir": "drizzle"');
  });

  test('exposes the d1 migration workflow scripts', async () => {
    const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.scripts['db:migrate:local']).toContain('wrangler d1 migrations apply');
    expect(pkg.scripts['db:migrate:local']).toContain('--local');
    expect(pkg.scripts['db:migrate:remote']).toContain('--remote');
    expect(pkg.scripts['local-setup']).toBeDefined();
  });

  test('db:migrate is the wrangler local apply (not the unusable drizzle-kit migrate)', async () => {
    const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.scripts['db:migrate']).toContain('wrangler d1 migrations apply');
    expect(pkg.scripts['db:migrate']).not.toContain('drizzle-kit');
  });

  test('installs a sqlite client so drizzle-kit studio can read the local D1 file', async () => {
    const pkg = await readJsonFile<{ devDependencies: Record<string, string>; scripts: Record<string, string> }>(
      join(projectPath, 'package.json'),
    );
    expect(pkg.devDependencies['@libsql/client']).toBeDefined();
    expect(pkg.scripts['db:studio']).toContain('drizzle-kit studio');
  });

  test('seed.ts uses bun:sqlite + drizzle-orm/bun-sqlite instead of missing db singleton', async () => {
    const seed = await readTextFile(join(projectPath, 'scripts/seed.ts'));
    expect(seed).toContain("from 'bun:sqlite'");
    expect(seed).toContain("from 'drizzle-orm/bun-sqlite'");
    expect(seed).toContain('getLocalD1DB');
    expect(seed).not.toContain("import { db,");
    expect(seed).not.toContain("import { db }");
  });
});

describe('Single repo: Hono + cloudflare + d1', () => {
  const projectName = 'd1-hono-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('wrangler.jsonc declares the D1 binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"migrations_dir": "drizzle"');
  });
});

describe('Turborepo: Next.js + Hono + cloudflare + d1', () => {
  const projectName = 'd1-turbo';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'web:nextjs', '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db package index exports createDb factory', async () => {
    const index = await readTextFile(join(projectPath, 'packages/db/src/index.ts'));
    expect(index).toContain('export function createDb(d1: D1Database)');
    expect(index).toContain('export type Database');
    expect(index).not.toContain('DATABASE_URL');
  });

  test('web app wrangler.jsonc declares the D1 binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"migrations_dir": "drizzle"');
  });

  test('api app wrangler.jsonc declares the D1 binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/api/wrangler.jsonc'));
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"migrations_dir": "drizzle"');
  });

  test('drizzle.config in db package uses d1-http driver', async () => {
    const config = await readTextFile(join(projectPath, 'packages/db/drizzle.config.ts'));
    expect(config).toContain("dialect: 'sqlite'");
    expect(config).toContain("driver: 'd1-http'");
  });
});

describe('Single repo: cloudflare + postgres (no d1 bindings)', () => {
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('does not emit env.ts for cloudflare + postgres (no bindings/secrets)', async () => {
    const r = await runCli(
      ['cf-pg', '--app', 'web:nextjs', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(r.exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'cf-pg', 'src/lib/env.ts'))).toBe(false);
  });
});
