import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';
import { COMBINATIONS } from './workspace-combinations';

setIntegrationTimeout();

const ESLINT_LINTERS = ['eslint', 'eslint-prettier'];
const LINTABLE_SOURCES = '**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}';
const NOT_LINTED_DIRECTORIES = ['node_modules/**', 'dist/**', 'generated/**'];

interface Manifest {
  scripts?: Record<string, string>;
}

async function packagesWithSources(projectPath: string): Promise<string[]> {
  const packagesDir = join(projectPath, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const withSources: string[] = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const sources = await Array.fromAsync(new Glob(LINTABLE_SOURCES).scan({ cwd: join(packagesDir, entry.name) }));
    const linted = sources.filter(
      (source) => !NOT_LINTED_DIRECTORIES.some((directory) => new Glob(directory).match(source)),
    );
    if (linted.length > 0) withSources.push(entry.name);
  }

  return withSources;
}

describe.each(ESLINT_LINTERS.flatMap((linter) => COMBINATIONS.map((combination) => ({ linter, ...combination }))))(
  'eslint workspace packages: $linter, $name',
  ({ linter, args }) => {
    let tempDir: string;
    let projectPath: string;

    beforeAll(async () => {
      tempDir = await createTempDir();
      const result = await runCli(
        ['lint-scope', ...args, '--linter', linter, '--no-install', '--no-git', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      projectPath = join(tempDir, 'lint-scope');
    });

    afterAll(async () => {
      await cleanupTempDir(tempDir);
    });

    test('the root lint runs the lint script of the workspaces through turbo', async () => {
      const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
      expect(root.scripts?.lint).toBe('turbo lint');
    });

    test('a lint script passes a preset that exports its config as default', async () => {
      const packagesDir = join(projectPath, 'packages');
      const missingPreset: string[] = [];

      for (const name of await readdir(packagesDir)) {
        const manifest = await readJsonFile<Manifest>(join(packagesDir, name, 'package.json'));
        const preset = manifest.scripts?.lint?.match(/--config (\S+)/)?.[1];
        if (!preset) continue;
        const source = await readTextFile(join(packagesDir, name, preset)).catch(() => '');
        if (!/^export default /m.test(source)) missingPreset.push(`${name}: ${preset}`);
      }

      expect(missingPreset).toEqual([]);
    });

    test('every workspace package with sources has an eslint lint script', async () => {
      const outsideLintScope: string[] = [];

      for (const name of await packagesWithSources(projectPath)) {
        const manifest = await readJsonFile<Manifest>(join(projectPath, 'packages', name, 'package.json'));
        if (!manifest.scripts?.lint?.startsWith('eslint ')) outsideLintScope.push(name);
      }

      expect(outsideLintScope).toEqual([]);
    });
  },
);
