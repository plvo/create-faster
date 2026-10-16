import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

describe('sqlite on a deployment without a local filesystem', () => {
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe.each([
    ['cloudflare', 'tanstack-start', 'web:tanstack-start'],
    ['cloudflare', 'nextjs', 'web:nextjs'],
    ['cloudflare', 'hono', 'web:hono'],
    ['cloudflare', 'tanstack-start with better-auth and trpc', 'web:tanstack-start:better-auth,trpc'],
    ['sst', 'nextjs', 'web:nextjs'],
    ['sst', 'hono', 'web:hono'],
    ['terraform-aws', 'nextjs', 'web:nextjs'],
    ['terraform-aws', 'hono', 'web:hono'],
  ])('%s with %s', (deployment, _label, app) => {
    test(`rejects --database sqlite --deployment ${deployment}`, async () => {
      const result = await runCli(
        ['no-fs-sqlite', '--app', app, '--database', 'sqlite', '--orm', 'drizzle', '--deployment', deployment, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("'sqlite'");
      expect(result.stderr).toContain(`'${deployment}'`);
      expect(result.stderr).toContain('local filesystem');
    });
  });

  test('accepts sqlite without a deployment', async () => {
    const result = await runCli(
      ['no-deploy-sqlite', '--app', 'web:nextjs', '--database', 'sqlite', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
});
