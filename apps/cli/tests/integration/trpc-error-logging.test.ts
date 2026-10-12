import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, expectOnErrorLogsInternals, readTextFile, runCli } from './helpers';

const COMMON_ARGS = ['--no-git', '--no-install', '--pm', 'bun'];

const LIBRARY_GENERATIONS = [
  { name: 'nextjs-single', args: ['--app', 'lib-next:nextjs:trpc'] },
  { name: 'nextjs-turborepo', args: ['--app', 'web:nextjs:trpc', '--app', 'api:hono'] },
  { name: 'tanstack-start-single', args: ['--app', 'lib-start:tanstack-start:trpc'] },
  { name: 'tanstack-start-turborepo', args: ['--app', 'web:tanstack-start:trpc', '--app', 'api:hono'] },
  { name: 'nextjs-evlog', args: ['--app', 'lib-next-evlog:nextjs:trpc,evlog'] },
  { name: 'tanstack-start-evlog', args: ['--app', 'lib-start-evlog:tanstack-start:trpc,evlog'] },
];

const BLUEPRINTS_WITH_TRPC = Object.entries(META.blueprints)
  .filter(([, blueprint]) => blueprint.context.apps.some((app) => app.libraries.includes('trpc')))
  .map(([name]) => name);

async function findTrpcHandlers(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const sources = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
  const matches = await Promise.all(
    sources.map(async (file) => ((await readTextFile(file)).includes('fetchRequestHandler(') ? file : null)),
  );
  return matches.filter((file): file is string => file !== null);
}

describe('tRPC handler error logging', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function expectEveryHandlerLogsInternals(name: string, args: string[]): Promise<void> {
    const result = await runCli([name, ...args, ...COMMON_ARGS], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const handlers = await findTrpcHandlers(join(tempDir, name));
    expect(handlers.length).toBeGreaterThan(0);
    for (const file of handlers) {
      expectOnErrorLogsInternals(await readTextFile(file));
    }
  }

  test('the blueprints that ship tRPC are found in META', () => {
    expect(BLUEPRINTS_WITH_TRPC).toContain('dapp-privy');
  });

  describe.each(LIBRARY_GENERATIONS)('library, $name', ({ name, args }) => {
    test('every generated handler logs unexpected errors in every environment', async () => {
      await expectEveryHandlerLogsInternals(`library-${name}`, args);
    });
  });

  describe.each(BLUEPRINTS_WITH_TRPC)('blueprint %s', (blueprint) => {
    test('every generated handler logs unexpected errors in every environment', async () => {
      await expectEveryHandlerLogsInternals(`blueprint-${blueprint}`, ['--blueprint', blueprint]);
    });
  });
});
