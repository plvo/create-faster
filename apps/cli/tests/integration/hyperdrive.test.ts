import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('Postgres/MySQL on Cloudflare via Hyperdrive', () => {
  test('accepts postgres + cloudflare without a singleton-db consumer', async () => {
    const tempDir = await createTempDir();
    const r = await runCli(
      ['cf-pg', '--app', 'web:nextjs', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(r.exitCode).toBe(0);
    await cleanupTempDir(tempDir);
  });

  test('rejects better-auth + postgres + cloudflare (per-request binding, see #153)', async () => {
    const tempDir = await createTempDir();
    const r = await runCli(
      ['ba-pg-cf', '--app', 'web:nextjs:better-auth', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('better-auth');
    await cleanupTempDir(tempDir);
  });

  test('rejects trpc + mysql + cloudflare', async () => {
    const tempDir = await createTempDir();
    const r = await runCli(
      ['trpc-my-cf', '--app', 'web:nextjs:trpc', '--database', 'mysql', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('trpc');
    await cleanupTempDir(tempDir);
  });

  test('still accepts better-auth + postgres without cloudflare (singleton db works)', async () => {
    const tempDir = await createTempDir();
    const r = await runCli(
      ['ba-pg', '--app', 'web:nextjs:better-auth', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(r.exitCode).toBe(0);
    await cleanupTempDir(tempDir);
  });
});

describe('Single repo: Next.js + cloudflare + postgres', () => {
  const projectName = 'hd-pg-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'web:nextjs', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db index exports a per-request createDb over Hyperdrive, not a DATABASE_URL singleton', async () => {
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain("from 'drizzle-orm/node-postgres'");
    expect(index).toContain('export function createDb(hyperdrive: Hyperdrive)');
    expect(index).toContain('new Pool(');
    expect(index).toContain('maxUses: 1');
    expect(index).toContain('hyperdrive.connectionString');
    expect(index).toContain('export type Database');
    expect(index).not.toContain('export const db');
    expect(index).not.toContain('DATABASE_URL');
  });

  test('getEnv seam types the HYPERDRIVE binding', async () => {
    const env = await readTextFile(join(projectPath, 'src/lib/env.ts'));
    expect(env).toContain("from '@opennextjs/cloudflare'");
    expect(env).toContain('export async function getEnv()');
    expect(env).toContain('HYPERDRIVE: Hyperdrive');
    expect(env).toContain('env.HYPERDRIVE');
  });

  test('wrangler.jsonc declares the Hyperdrive binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"hyperdrive"');
    expect(wrangler).toContain('"binding": "HYPERDRIVE"');
    expect(wrangler).toContain('localConnectionString');
  });

  test('installs pg-cloudflare so the build resolves the cloudflare:sockets transport', async () => {
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies['pg-cloudflare']).toBeDefined();
  });

  test('build:cf generates worker types first so the HYPERDRIVE binding typechecks', async () => {
    const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.scripts['build:cf']).toContain('wrangler types');
    expect(pkg.scripts['build:cf']).toContain('opennextjs-cloudflare');
  });

  test('migrations stay node/DATABASE_URL based (drizzle.config unchanged)', async () => {
    const config = await readTextFile(join(projectPath, 'drizzle.config.ts'));
    expect(config).toContain("dialect: 'postgresql'");
    expect(config).toContain('DATABASE_URL');
  });

  test('seed.ts connects directly via DATABASE_URL (no missing db singleton)', async () => {
    const seed = await readTextFile(join(projectPath, 'scripts/seed.ts'));
    expect(seed).toContain("from 'drizzle-orm/node-postgres'");
    expect(seed).toContain('process.env.DATABASE_URL');
    expect(seed).not.toContain('import { db,');
    expect(seed).not.toContain('import { db }');
  });
});

describe('Single repo: Next.js + cloudflare + mysql', () => {
  const projectName = 'hd-my-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'web:nextjs', '--database', 'mysql', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db index uses mysql2 createConnection with disableEval over Hyperdrive', async () => {
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain("from 'drizzle-orm/mysql2'");
    expect(index).toContain('createConnection');
    expect(index).toContain('disableEval: true');
    expect(index).toContain('hyperdrive.host');
    expect(index).toContain('export type Database');
    expect(index).not.toContain('export const db');
  });

  test('wrangler.jsonc declares the Hyperdrive binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"hyperdrive"');
    expect(wrangler).toContain('"binding": "HYPERDRIVE"');
  });
});

describe('Turborepo: Next.js + cloudflare + postgres', () => {
  const projectName = 'hd-pg-turbo';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'web:nextjs', '--app', 'api:hono', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db package exports the per-request createDb factory', async () => {
    const index = await readTextFile(join(projectPath, 'packages/db/src/index.ts'));
    expect(index).toContain('export function createDb(hyperdrive: Hyperdrive)');
    expect(index).toContain('export type Database');
    expect(index).not.toContain('export const db');
  });

  test('db package installs pg-cloudflare', async () => {
    const pkg = await readJsonFile<{ dependencies?: Record<string, string> }>(join(projectPath, 'packages/db/package.json'));
    expect(pkg.dependencies?.['pg-cloudflare']).toBeDefined();
  });

  test('web app wrangler.jsonc declares the Hyperdrive binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    expect(wrangler).toContain('"binding": "HYPERDRIVE"');
  });
});

describe('Non-binding postgres (off Cloudflare) stays a singleton', () => {
  const projectName = 'pg-vanilla';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'web:nextjs', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('keeps the lazy DATABASE_URL singleton, no Hyperdrive', async () => {
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain('export const db');
    expect(index).toContain('process.env.DATABASE_URL');
    expect(index).not.toContain('Hyperdrive');
    expect(index).not.toContain('getCloudflareContext');
  });

  test('does not install pg-cloudflare or emit a HYPERDRIVE binding', async () => {
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies['pg-cloudflare']).toBeUndefined();
    expect(await fileExists(join(projectPath, 'wrangler.jsonc'))).toBe(false);
  });
});
