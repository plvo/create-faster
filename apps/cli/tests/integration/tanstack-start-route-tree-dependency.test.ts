import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('TanStack Start route tree on a production install', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the router CLI run by postinstall is a dependency, so an install without dev dependencies finds it', async () => {
    const result = await runCli(
      ['site', '--app', 'site:tanstack-start', '--no-git', '--no-install', '--pm', 'npm'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, 'site', 'package.json'));
    expect(pkg.scripts.postinstall).toStartWith('tsr generate');
    expect(pkg.dependencies?.['@tanstack/router-cli']).toBeDefined();
    expect(pkg.devDependencies?.['@tanstack/router-cli']).toBeUndefined();
  });
});
