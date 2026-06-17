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
