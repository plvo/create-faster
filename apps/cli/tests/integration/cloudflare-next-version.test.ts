import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface PackageJsonShape {
  dependencies: Record<string, string>;
}

const BASE_NEXT_RANGE = '^16.3.0';
const CLOUDFLARE_NEXT_RANGE = '~16.3.8';

describe('Next.js version per deployment', () => {
  let tempDir: string;

  async function nextRangeOf(packageJsonDir: string): Promise<string | undefined> {
    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, packageJsonDir, 'package.json'));
    return pkg.dependencies.next;
  }

  async function generate(name: string, args: string[]): Promise<void> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
  }

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo on cloudflare uses the OpenNext compatible range', async () => {
    await generate('single-cf', ['--app', 'single-cf:nextjs', '--deployment', 'cloudflare']);

    expect(await nextRangeOf('single-cf')).toBe(CLOUDFLARE_NEXT_RANGE);
  });

  test('turborepo on cloudflare pins each Next.js app only', async () => {
    await generate('mono-cf', [
      '--app',
      'web:nextjs',
      '--app',
      'docs:nextjs',
      '--app',
      'site:tanstack-start',
      '--deployment',
      'cloudflare',
    ]);

    expect(await nextRangeOf('mono-cf/apps/web')).toBe(CLOUDFLARE_NEXT_RANGE);
    expect(await nextRangeOf('mono-cf/apps/docs')).toBe(CLOUDFLARE_NEXT_RANGE);
    expect(await nextRangeOf('mono-cf/apps/site')).toBeUndefined();
  });

  test('cloudflare-fullstack blueprint uses the OpenNext compatible range', async () => {
    await generate('fullstack', ['--blueprint', 'cloudflare-fullstack']);

    expect(await nextRangeOf('fullstack/apps/web')).toBe(CLOUDFLARE_NEXT_RANGE);
  });

  test.each([
    ['no-deployment', []],
    ['sst', ['--deployment', 'sst']],
    ['cloudflare-static', ['--deployment', 'cloudflare-static']],
  ])('single repo with %s keeps the stack range', async (label, deploymentArgs) => {
    const name = `single-${label}`;
    await generate(name, ['--app', `${name}:nextjs`, ...deploymentArgs]);

    expect(await nextRangeOf(name)).toBe(BASE_NEXT_RANGE);
  });
});
