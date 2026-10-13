import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

describe('Next.js package versions', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the bundle analyzer is on the same range as next, as it is versioned with Next.js', async () => {
    const result = await runCli(['versions', '--app', 'web:nextjs', '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    const pkg = await readJsonFile<{
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    }>(join(tempDir, 'versions', 'package.json'));

    expect(pkg.devDependencies['@next/bundle-analyzer']).toBe(pkg.dependencies.next);
  });
});
