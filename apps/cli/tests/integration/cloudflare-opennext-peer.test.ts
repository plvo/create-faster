import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const BASE_NEXT_RANGE = '^16.3.0';

// `next` peer range of @opennextjs/cloudflare@1.20.12, the first release that serves Next.js 16.4
// (opennextjs/opennextjs-cloudflare#1355). npm refuses to install a project whose `next` can resolve outside it.
const OPENNEXT_NEXT_PEER = '>=15.5.28 <16 || >=16.4.1';
const OPENNEXT_WRANGLER_PEER = '^4.148.0';
const OPENNEXT_FIRST_NEXT_16_4_VERSION = '1.20.12';

function lowestVersionOf(range: string): string {
  const version = range.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`No version in range ${range}`);
  return version;
}

describe('Next.js and OpenNext pair on cloudflare', () => {
  let tempDir: string;

  async function dependenciesOf(packageJsonDir: string): Promise<Record<string, string>> {
    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, packageJsonDir, 'package.json'));
    return pkg.dependencies ?? {};
  }

  async function wranglerRangeOf(packageJsonDir: string): Promise<string | undefined> {
    const pkg = await readJsonFile<PackageJsonShape>(join(tempDir, packageJsonDir, 'package.json'));
    return pkg.devDependencies?.wrangler;
  }

  async function expectWranglerInsidePeer(packageJsonDir: string): Promise<void> {
    const range = await wranglerRangeOf(packageJsonDir);
    expect(range).toBeDefined();
    expect(Bun.semver.satisfies(lowestVersionOf(range!), OPENNEXT_WRANGLER_PEER)).toBe(true);
  }

  async function generate(name: string, args: string[]): Promise<void> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
  }

  function expectServesNextJs16_4(opennextRange: string | undefined): void {
    expect(opennextRange).toBeDefined();
    expect(Bun.semver.order(lowestVersionOf(opennextRange!), OPENNEXT_FIRST_NEXT_16_4_VERSION)).toBeGreaterThanOrEqual(0);
  }

  function expectCompatiblePair(dependencies: Record<string, string>): void {
    expect(dependencies.next).toBeDefined();
    expect(Bun.semver.satisfies(lowestVersionOf(dependencies.next!), OPENNEXT_NEXT_PEER)).toBe(true);
    expectServesNextJs16_4(dependencies['@opennextjs/cloudflare']);
  }

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo on cloudflare declares a next range inside the OpenNext peer range', async () => {
    await generate('single-cf', ['--app', 'single-cf:nextjs', '--deployment', 'cloudflare']);

    expectCompatiblePair(await dependenciesOf('single-cf'));
    await expectWranglerInsidePeer('single-cf');
  });

  test('turborepo on cloudflare pairs each Next.js app and leaves the others alone', async () => {
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

    expectCompatiblePair(await dependenciesOf('mono-cf/apps/web'));
    await expectWranglerInsidePeer('mono-cf/apps/web');
    expectCompatiblePair(await dependenciesOf('mono-cf/apps/docs'));
    expect((await dependenciesOf('mono-cf/apps/site')).next).toBeUndefined();
  });

  test('cloudflare-fullstack-nextjs pairs the web app and every OpenNext range of the project', async () => {
    await generate('fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs']);

    expectCompatiblePair(await dependenciesOf('fullstack/apps/web'));
    expectServesNextJs16_4((await dependenciesOf('fullstack/packages/api'))['@opennextjs/cloudflare']);
    await expectWranglerInsidePeer('fullstack/apps/web');
  });

  test.each([
    ['no-deployment', []],
    ['sst', ['--deployment', 'sst']],
    ['cloudflare-static', ['--deployment', 'cloudflare-static']],
  ])('single repo with %s keeps the stack range', async (label, deploymentArgs) => {
    const name = `single-${label}`;
    await generate(name, ['--app', `${name}:nextjs`, ...deploymentArgs]);

    expect((await dependenciesOf(name)).next).toBe(BASE_NEXT_RANGE);
  });
});
