import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';
import { COMBINATIONS } from './workspace-combinations';

setIntegrationTimeout();

const ESLINT_LINTERS = ['eslint', 'eslint-prettier'];
const LINTABLE_SOURCES = '**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}';
const NOT_LINTED_SOURCES = ['node_modules/**', 'dist/**', 'generated/**', 'eslint.config.mjs'];

interface Manifest {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function packagesWithSources(projectPath: string): Promise<string[]> {
  const packagesDir = join(projectPath, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const withSources: string[] = [];

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const sources = await Array.fromAsync(new Glob(LINTABLE_SOURCES).scan({ cwd: join(packagesDir, entry.name) }));
    const linted = sources.filter(
      (source) => !NOT_LINTED_SOURCES.some((glob) => new Glob(glob).match(source)),
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

    test('a package that lints itself has an eslint config and the eslint dependency', async () => {
      const packagesDir = join(projectPath, 'packages');
      const incomplete: string[] = [];

      for (const name of await readdir(packagesDir)) {
        const manifest = await readJsonFile<Manifest>(join(packagesDir, name, 'package.json'));
        if (!manifest.scripts?.lint?.startsWith('eslint ')) continue;
        const hasConfig = await fileExists(join(packagesDir, name, 'eslint.config.mjs'));
        if (!hasConfig || !manifest.devDependencies?.eslint) incomplete.push(name);
      }

      expect(incomplete).toEqual([]);
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

const PACKAGE_SOURCE = 'packages/api/src/index.ts';

function matchesAny(patterns: string[], file: string): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(file));
}

async function excludedPatterns(linter: string, projectPath: string): Promise<string[]> {
  if (linter === 'biome') {
    const { files } = JSON.parse(await readTextFile(join(projectPath, 'biome.json')));
    return (files.includes as string[]).filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  }
  const config = await readTextFile(join(projectPath, 'oxlint.config.mts'));
  const list = /ignorePatterns: \[(.*)\]/.exec(config)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

describe.each(['biome', 'oxc'])('root %s config covers the workspace packages', (linter) => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(COMBINATIONS)('$name', async ({ args }) => {
    const result = await runCli(
      ['lint-root', ...args, '--linter', linter, '--no-install', '--no-git', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const projectPath = join(tempDir, 'lint-root');

    expect(matchesAny(await excludedPatterns(linter, projectPath), PACKAGE_SOURCE)).toBe(false);
    await cleanupTempDir(projectPath);
  });
});
