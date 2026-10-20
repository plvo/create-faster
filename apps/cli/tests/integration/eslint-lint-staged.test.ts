import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Glob } from 'bun';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';
import { COMBINATIONS } from './workspace-combinations';

setIntegrationTimeout();

const ESLINT_LINTERS = ['eslint', 'eslint-prettier'];
const ESLINT_CONFIGS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((extension) => `eslint.config.${extension}`);
const LINT_STAGED_CONFIG_FILES = [
  '.lintstagedrc',
  ...['json', 'yaml', 'yml', 'mjs', 'mts', 'js', 'ts', 'cjs', 'cts'].map((extension) => `.lintstagedrc.${extension}`),
  ...['mjs', 'mts', 'js', 'ts', 'cjs', 'cts'].map((extension) => `lint-staged.config.${extension}`),
];

type LintStagedConfig = Record<string, string[]>;

interface Manifest {
  scripts?: Record<string, string>;
  'lint-staged'?: LintStagedConfig;
}

async function hasLintStagedConfig(projectPath: string, dir: string): Promise<boolean> {
  const manifest = await readJsonFile<Manifest>(join(projectPath, dir, 'package.json')).catch(() => undefined);
  if (manifest?.['lint-staged']) return true;
  for (const name of LINT_STAGED_CONFIG_FILES) if (await fileExists(join(projectPath, dir, name))) return true;
  return false;
}

/** The directory of the `lint-staged` config used for a staged file: the closest one, in a package.json or a file. */
async function lintStagedDirOf(projectPath: string, stagedFile: string): Promise<string | undefined> {
  for (let dir = dirname(stagedFile); ; dir = dirname(dir)) {
    if (await hasLintStagedConfig(projectPath, dir)) return dir;
    if (dir === '.') return undefined;
  }
}

/** Whether ESLint, started in `dir`, finds a config there or in a parent directory (its lookup from the cwd). */
async function eslintConfigFoundFrom(projectPath: string, dir: string): Promise<boolean> {
  for (let current = dir; ; current = dirname(current)) {
    for (const name of ESLINT_CONFIGS) if (await fileExists(join(projectPath, current, name))) return true;
    if (current === '.') return false;
  }
}

async function workspaceDirs(projectPath: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const group of ['apps', 'packages']) {
    const entries = await readdir(join(projectPath, group), { withFileTypes: true });
    dirs.push(...entries.filter((entry) => entry.isDirectory()).map((entry) => `${group}/${entry.name}`));
  }
  return dirs;
}

describe.each(ESLINT_LINTERS.flatMap((linter) => COMBINATIONS.map((combination) => ({ linter, ...combination }))))(
  'eslint lint-staged in a turborepo: $linter, $name',
  ({ linter, args }) => {
    let tempDir: string;
    let projectPath: string;

    beforeAll(async () => {
      tempDir = await createTempDir();
      const result = await runCli(
        ['staged', ...args, '--linter', linter, '--tooling', 'husky', '--git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      projectPath = join(tempDir, 'staged');
    });

    afterAll(async () => {
      await cleanupTempDir(tempDir);
    });

    test('a staged source of a workspace that lints itself runs eslint where its config is found', async () => {
      const unresolved: string[] = [];

      for (const workspace of await workspaceDirs(projectPath)) {
        const manifest = await readJsonFile<Manifest>(join(projectPath, workspace, 'package.json'));
        if (!manifest.scripts?.lint?.startsWith('eslint ')) continue;

        const stagedFile = `${workspace}/src/staged.ts`;
        const configDir = await lintStagedDirOf(projectPath, stagedFile);
        const config = configDir
          ? (await readJsonFile<Manifest>(join(projectPath, configDir, 'package.json')))['lint-staged']
          : undefined;
        const commands = Object.entries(config ?? {}).find(([pattern]) => new Glob(pattern).match('staged.ts'))?.[1];

        if (!configDir || !commands?.includes('eslint --fix') || !(await eslintConfigFoundFrom(projectPath, configDir)))
          unresolved.push(workspace);
      }

      expect(unresolved).toEqual([]);
    });

    test('lint-staged finds several configs, so it runs the tasks in the directory of each', async () => {
      const dirs = ['.', ...(await workspaceDirs(projectPath))];
      const withConfig = (await Promise.all(dirs.map((dir) => hasLintStagedConfig(projectPath, dir)))).filter(Boolean);

      expect(withConfig.length).toBeGreaterThanOrEqual(2);
    });

    test('the root config does not run eslint', async () => {
      const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
      const rootCommands = Object.values(root['lint-staged'] ?? {}).flat();

      expect(rootCommands.filter((command) => command.startsWith('eslint'))).toEqual([]);
    });

    test('a workspace formats with prettier after eslint only under eslint-prettier', async () => {
      const expected = linter === 'eslint-prettier' ? ['eslint --fix', 'prettier --write'] : ['eslint --fix'];

      for (const app of await readdir(join(projectPath, 'apps'))) {
        const manifest = await readJsonFile<Manifest>(join(projectPath, 'apps', app, 'package.json'));
        expect(Object.values(manifest['lint-staged'] ?? {}).flat()).toEqual(expected);
      }
    });
  },
);

const TURBOREPO_ARGS = [
  '--app',
  'web:nextjs:shadcn',
  '--app',
  'worker:node',
  '--database',
  'sqlite',
  '--orm',
  'drizzle',
];

const ROOT_COMMANDS: Record<string, string[]> = {
  biome: ['biome check --write --unsafe --no-errors-on-unmatched'],
  oxc: ['oxlint --fix --no-error-on-unmatched-pattern', 'oxfmt --no-error-on-unmatched-pattern'],
  prettier: ['prettier --write'],
};

describe.each(Object.entries(ROOT_COMMANDS))('lint-staged of a turborepo with %s', (linter, rootCommands) => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['staged', ...TURBOREPO_ARGS, '--linter', linter, '--tooling', 'husky', '--git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'staged');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the root config runs the commands of the linter', async () => {
    const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));

    expect(Object.values(root['lint-staged'] ?? {}).flat()).toEqual(rootCommands);
  });

  test('nothing is put in the workspaces', async () => {
    for (const workspace of await workspaceDirs(projectPath)) {
      const manifest = await readJsonFile<Manifest>(join(projectPath, workspace, 'package.json'));
      expect(manifest['lint-staged']).toBeUndefined();
    }
  });
});

describe('eslint in a turborepo without husky', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['staged', ...TURBOREPO_ARGS, '--linter', 'eslint', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'staged');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('no workspace has a lint-staged config', async () => {
    for (const workspace of await workspaceDirs(projectPath)) {
      const manifest = await readJsonFile<Manifest>(join(projectPath, workspace, 'package.json'));
      expect(manifest['lint-staged']).toBeUndefined();
    }
  });
});

describe('eslint in a single repo with husky', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [
        'staged',
        '--app',
        'web:nextjs',
        '--linter',
        'eslint-prettier',
        '--tooling',
        'husky',
        '--git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'staged');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the root config runs eslint then prettier, where the ESLint config is', async () => {
    const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));

    expect(Object.values(root['lint-staged'] ?? {}).flat()).toEqual(['eslint --fix', 'prettier --write']);
    expect(await fileExists(join(projectPath, 'eslint.config.mjs'))).toBe(true);
  });
});
