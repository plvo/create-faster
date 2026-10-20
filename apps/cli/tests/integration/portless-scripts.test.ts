import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface PackageJson {
  scripts: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(projectName: string, args: string[]): Promise<string> {
  const result = await runCli(
    [projectName, ...args, '--tooling', 'portless', '--no-git', '--no-install', '--pm', 'bun'],
    tempDir,
  );
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, projectName);
}

// portless single-quotes every argument it runs, so a leading `VAR=value` would be run as a command name.
interface PortlessScripts {
  stack: string;
  dev?: string;
  /** The `dev` of a single repo, when it differs from the one of a turborepo app. */
  singleDev?: string;
  start?: string;
}

const PORTLESS_SCRIPTS: PortlessScripts[] = [
  {
    stack: 'nextjs',
    dev: 'portless run next dev',
    start: 'portless run next start',
  },
  {
    stack: 'hono',
    dev: 'portless run bun run --hot src/index.ts',
    start: 'NODE_ENV=production portless run bun run src/index.ts',
  },
  {
    stack: 'node',
    dev: 'portless run bun run --hot src/index.ts',
    start: 'NODE_ENV=production portless run bun run src/index.ts',
  },
  {
    stack: 'tanstack-start',
    dev: 'portless run vite dev',
    start: 'portless run node --env-file-if-exists=.env --env-file=.env.start .output/server/index.mjs',
  },
  {
    stack: 'expo',
    dev: undefined,
    singleDev: 'portless run expo start',
    start: undefined,
  },
];

describe('portless scripts', () => {
  test.each(PORTLESS_SCRIPTS)(
    'single repo, $stack: wraps dev and start:portless',
    async ({ stack, dev, singleDev = dev, start }) => {
      const projectDir = await generate(`portless-single-${stack}`, ['--app', `app:${stack}`]);
      const pkg = await readJsonFile<PackageJson>(join(projectDir, 'package.json'));
      expect(pkg.scripts.dev).toBe(singleDev as string);
      expect(pkg.scripts['start:portless']).toBe(start);
    },
  );

  test.each(PORTLESS_SCRIPTS)('turborepo, $stack: wraps dev and start:portless', async ({ stack, dev, start }) => {
    const projectDir = await generate(`portless-mono-${stack}`, ['--app', 'web:nextjs', '--app', `app:${stack}`]);
    const pkg = await readJsonFile<PackageJson>(join(projectDir, 'apps', 'app', 'package.json'));
    expect(pkg.scripts.dev).toBe(dev as string);
    expect(pkg.scripts['start:portless']).toBe(start);
  });

  test('start keeps its env assignment so the unwrapped script still runs production mode', async () => {
    const projectDir = await generate('portless-start-untouched', ['--app', 'api:hono']);
    const pkg = await readJsonFile<PackageJson>(join(projectDir, 'package.json'));
    expect(pkg.scripts.start).toBe('NODE_ENV=production bun run src/index.ts');
  });
});
