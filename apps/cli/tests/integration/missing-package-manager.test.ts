import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('package manager missing from PATH', () => {
  let tempDir: string;
  let emptyBinDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    emptyBinDir = join(tempDir, 'empty-bin');
    await mkdir(emptyBinDir);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generateWithoutPackageManagers(args: string[]) {
    const workDir = join(tempDir, 'work');
    await mkdir(workDir, { recursive: true });
    const result = await runCli(args, workDir, { PATH: emptyBinDir });
    return { result, written: await readdir(workDir) };
  }

  test('fails before writing anything and explains how to fix a missing --pm', async () => {
    const { result, written } = await generateWithoutPackageManagers([
      'missing-pm',
      '--app',
      'missing-pm:nextjs',
      '--no-git',
      '--no-install',
      '--pm',
      'pnpm',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Package manager 'pnpm' is not installed");
    expect(result.stderr).toContain('Install pnpm');
    expect(result.stderr).toContain('--pm');
    expect(result.stderr).not.toContain('Command failed');
    expect(written).toEqual([]);
  });

  test('explains the implicit npm requirement of a turborepo without --pm', async () => {
    const { result, written } = await generateWithoutPackageManagers([
      'missing-npm',
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--no-git',
      '--no-install',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Package manager 'npm' is not installed");
    expect(written).toEqual([]);
  });
});
