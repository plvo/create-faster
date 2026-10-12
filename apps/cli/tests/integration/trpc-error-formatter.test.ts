import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, expectFormatterHidesInternals, readTextFile, runCli } from './helpers';

const COMMON_ARGS = ['--no-git', '--no-install', '--pm', 'bun'];

const LIBRARY_GENERATIONS = [
  { name: 'single', args: ['--app', 'lib-single:nextjs:trpc'] },
  { name: 'turborepo', args: ['--app', 'web:nextjs:trpc', '--app', 'api:hono'] },
];

const BLUEPRINTS_WITH_TRPC = Object.entries(META.blueprints)
  .filter(([, blueprint]) => blueprint.context.apps.some((app) => app.libraries.includes('trpc')))
  .map(([name]) => name);

async function findTrpcInitFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const sources = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
  const matches = await Promise.all(sources.map(async (file) => ((await readTextFile(file)).includes('initTRPC') ? file : null)));
  return matches.filter((file): file is string => file !== null);
}

describe('tRPC error formatter', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function expectEveryInitMasksInternals(name: string, args: string[]): Promise<void> {
    const result = await runCli([name, ...args, ...COMMON_ARGS], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const initFiles = await findTrpcInitFiles(join(tempDir, name));
    expect(initFiles.length).toBeGreaterThan(0);
    for (const file of initFiles) {
      expectFormatterHidesInternals(await readTextFile(file));
    }
  }

  test('the blueprints that ship tRPC are found in META', () => {
    expect(BLUEPRINTS_WITH_TRPC).toContain('dapp-privy');
  });

  describe.each(LIBRARY_GENERATIONS)('library, $name', ({ name, args }) => {
    test('every generated init masks internal errors outside development', async () => {
      await expectEveryInitMasksInternals(`library-${name}`, args);
    });
  });

  describe.each(BLUEPRINTS_WITH_TRPC)('blueprint %s', (blueprint) => {
    test('every generated init masks internal errors outside development', async () => {
      await expectEveryInitMasksInternals(`blueprint-${blueprint}`, ['--blueprint', blueprint]);
    });
  });
});
