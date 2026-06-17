import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

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
  });

  test('schema still uses the sqlite dialect', async () => {
    const schema = await readTextFile(join(projectPath, 'src/lib/db/schema.ts'));
    expect(schema).toContain('sqliteTable');
  });
});
