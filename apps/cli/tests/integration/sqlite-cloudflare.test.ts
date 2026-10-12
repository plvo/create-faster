import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

describe('sqlite on the cloudflare deployment', () => {
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe.each([
    ['tanstack-start', 'web:tanstack-start'],
    ['nextjs', 'web:nextjs'],
    ['hono', 'web:hono'],
    ['tanstack-start with better-auth and trpc', 'web:tanstack-start:better-auth,trpc'],
  ])('%s', (_label, app) => {
    test('rejects --database sqlite --deployment cloudflare', async () => {
      const result = await runCli(
        ['cf-sqlite', '--app', app, '--database', 'sqlite', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'sqlite'");
      expect(result.stderr).toContain("'cloudflare'");
      expect(result.stderr).toContain('local filesystem');
    });
  });

  test('accepts sqlite on a deployment that has a filesystem', async () => {
    const result = await runCli(
      ['sst-sqlite', '--app', 'web:nextjs', '--database', 'sqlite', '--orm', 'drizzle', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
});
