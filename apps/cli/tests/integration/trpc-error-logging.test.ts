import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, expectOnErrorLogsInternals, expectOnErrorSkipsFrameworkErrors, readTextFile, runCli } from './helpers';

const COMMON_ARGS = ['--no-git', '--no-install', '--pm', 'bun'];

const LIBRARY_GENERATIONS = [
  { name: 'nextjs-single', args: ['--app', 'lib-next:nextjs:trpc'] },
  { name: 'nextjs-turborepo', args: ['--app', 'web:nextjs:trpc', '--app', 'api:hono'] },
  { name: 'nextjs-query-single', args: ['--app', 'lib-next-query:nextjs:trpc,tanstack-query'] },
  { name: 'nextjs-query-turborepo', args: ['--app', 'web:nextjs:trpc,tanstack-query', '--app', 'api:hono'] },
  { name: 'tanstack-start-single', args: ['--app', 'lib-start:tanstack-start:trpc'] },
  { name: 'tanstack-start-turborepo', args: ['--app', 'web:tanstack-start:trpc', '--app', 'api:hono'] },
  { name: 'nextjs-evlog', args: ['--app', 'lib-next-evlog:nextjs:trpc,evlog'] },
  { name: 'tanstack-start-evlog', args: ['--app', 'lib-start-evlog:tanstack-start:trpc,evlog'] },
];

const BLUEPRINTS_WITH_TRPC = Object.entries(META.blueprints)
  .filter(([, blueprint]) => blueprint.context.apps.some((app) => app.libraries.includes('trpc')))
  .map(([name]) => name);

const SERVER_CALL_SITES = ['router: appRouter', 'appRouter.createCaller('];

async function findTrpcServerCallSites(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const sources = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
  const matches = await Promise.all(
    sources.map(async (file) => {
      const source = await readTextFile(file);
      return SERVER_CALL_SITES.some((callSite) => source.includes(callSite)) ? file : null;
    }),
  );
  return matches.filter((file): file is string => file !== null);
}

describe('tRPC server error logging', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function expectEveryServerCallSiteLogsInternals(name: string, args: string[]): Promise<string[]> {
    const result = await runCli([name, ...args, ...COMMON_ARGS], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const callSites = await findTrpcServerCallSites(join(tempDir, name));
    expect(callSites.length).toBeGreaterThan(0);
    const nextServerCallSites: string[] = [];
    for (const file of callSites) {
      const source = await readTextFile(file);
      expectOnErrorLogsInternals(source);
      if (file.endsWith('trpc/server.tsx')) {
        expectOnErrorSkipsFrameworkErrors(source);
        nextServerCallSites.push(file);
      }
    }
    return nextServerCallSites;
  }

  test('the blueprints that ship tRPC are found in META', () => {
    expect(BLUEPRINTS_WITH_TRPC).toContain('dapp-privy');
  });

  describe.each(LIBRARY_GENERATIONS)('library, $name', ({ name, args }) => {
    test('every generated server call site logs unexpected errors in every environment', async () => {
      const nextServerCallSites = await expectEveryServerCallSiteLogsInternals(`library-${name}`, args);
      expect(nextServerCallSites).toHaveLength(name.startsWith('nextjs') ? 1 : 0);
    });
  });

  describe.each(BLUEPRINTS_WITH_TRPC)('blueprint %s', (blueprint) => {
    test('every generated server call site logs unexpected errors in every environment', async () => {
      await expectEveryServerCallSiteLogsInternals(`blueprint-${blueprint}`, ['--blueprint', blueprint]);
    });
  });
});
