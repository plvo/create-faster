import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SPACE } from '../pseudo-terminal';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  printedScriptsMissingFrom,
  readJsonFile,
  readTextFile,
  runCli,
  runCliOnTerminal,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const HEADINGS = {
  biome: ['Biome'],
  oxc: ['Oxlint + Oxfmt'],
  prettier: ['Prettier'],
  eslint: ['ESLint'],
  'eslint-prettier': ['ESLint', 'Prettier'],
} as const;

type Linter = keyof typeof HEADINGS;

const LINTERS = Object.keys(HEADINGS) as Linter[];
const ESLINT_LINTERS: Linter[] = ['eslint', 'eslint-prettier'];
const PRETTIER_LINTERS: Linter[] = ['prettier', 'eslint-prettier'];
const DATABASE = ['--database', 'sqlite', '--orm', 'drizzle'];
const COMMON = ['--tooling', 'husky', '--git', '--no-install', '--pm', 'npm'];

const SHAPES = {
  single: ['--app', 'web:nextjs'],
  mono: ['--app', 'web:nextjs', '--app', 'api:hono', '--app', 'worker:node', ...DATABASE],
  start: ['--app', 'web:tanstack-start:shadcn', '--app', 'api:hono', ...DATABASE],
} as const;

type Shape = keyof typeof SHAPES;

let dir: string;
const summaries = new Map<string, string>();

const projectPath = (name: string) => join(dir, name);
const nameOf = (shape: Shape, linter: Linter) => `${shape}-${linter}`;

beforeAll(async () => {
  dir = await createTempDir();
  for (const linter of LINTERS) {
    for (const shape of Object.keys(SHAPES) as Shape[]) {
      const name = nameOf(shape, linter);
      const result = await runCli([name, ...SHAPES[shape], '--linter', linter, ...COMMON], dir);
      expect(result.exitCode, `${name}: ${result.stderr}`).toBe(0);
      summaries.set(name, result.stdout);
    }
  }
});

afterAll(async () => {
  await cleanupTempDir(dir);
});

async function workspaces(project: string): Promise<string[]> {
  const directories: string[] = [];
  for (const group of ['apps', 'packages']) {
    const root = join(project, group);
    if (!(await fileExists(root))) continue;
    directories.push(...(await readdir(root)).map((name) => `${group}/${name}`));
  }
  return directories.sort();
}

async function workspacesWithESLintConfig(project: string): Promise<string[]> {
  const configured: string[] = [];
  for (const workspace of await workspaces(project)) {
    if (await fileExists(join(project, workspace, 'eslint.config.mjs'))) configured.push(workspace);
  }
  return configured;
}

interface Manifest {
  scripts: Record<string, string>;
  'lint-staged'?: Record<string, string[]>;
}

const manifestOf = (project: string, workspace = '.') => readJsonFile<Manifest>(join(project, workspace, 'package.json'));
const agentsOf = (name: string) => readTextFile(join(projectPath(name), 'AGENTS.md'));

describe.each(LINTERS)('the AGENTS.md of a project linted with %s', (linter) => {
  test.each(Object.keys(SHAPES) as Shape[])('%s has a section per linter, with commands that exist', async (shape) => {
    const name = nameOf(shape, linter);
    const agents = await agentsOf(name);

    for (const heading of HEADINGS[linter]) {
      expect(agents).toContain(`\n## ${heading}\n\n`);
    }
    expect(await printedScriptsMissingFrom(projectPath(name), agents)).toEqual([]);
  });
});

describe('the ESLint section', () => {
  test.each(ESLINT_LINTERS)(
    'with %s in a turborepo, every workspace that holds code has its own configuration and lint script, and the root has none',
    async (linter) => {
      const project = projectPath(nameOf('mono', linter));
      const agents = await agentsOf(nameOf('mono', linter));

      expect(agents).toContain('ESLint is configured per workspace.');
      expect(agents).toContain('The root has no ESLint configuration');
      expect((await manifestOf(project)).scripts.lint).toBe('turbo lint');
      expect((await readdir(project)).filter((file) => file.startsWith('eslint.config'))).toEqual([]);

      const linted = await workspacesWithESLintConfig(project);
      expect(linted).toEqual(['apps/api', 'apps/web', 'apps/worker', 'packages/db', 'packages/eslint-config']);
      for (const workspace of linted) {
        expect((await manifestOf(project, workspace)).scripts.lint, workspace).toBe('eslint .');
      }
    },
  );

  test('a single repo has one configuration at the root', async () => {
    const project = projectPath(nameOf('single', 'eslint'));

    expect(await agentsOf(nameOf('single', 'eslint'))).toContain(
      '`eslint.config.mjs` at the root is the flat configuration of the app',
    );
    expect(await fileExists(join(project, 'eslint.config.mjs'))).toBe(true);
    expect((await manifestOf(project)).scripts.lint).toBe('eslint .');
  });

  test.each(['biome', 'oxc', 'prettier'] as const)('with %s, there is no ESLint section', async (linter) => {
    expect(await agentsOf(nameOf('mono', linter))).not.toContain('ESLint is configured per workspace');
  });

  test('with eslint-prettier, the Prettier config is in the ESLint configuration', async () => {
    expect(await readTextFile(join(projectPath(nameOf('single', 'eslint-prettier')), 'eslint.config.mjs'))).toContain(
      'eslint-config-prettier',
    );
    expect(
      await readTextFile(join(projectPath(nameOf('mono', 'eslint-prettier')), 'packages/eslint-config/base.js')),
    ).toContain('eslint-config-prettier');
  });
});

describe('the Prettier section', () => {
  describe.each(PRETTIER_LINTERS)('with %s', (linter) => {
    test.each(Object.keys(SHAPES) as Shape[])('%s: the style and the ignored files are the generated ones', async (shape) => {
      const name = nameOf(shape, linter);
      const project = projectPath(name);
      const agents = await agentsOf(name);
      const rc = JSON.parse(await readTextFile(join(project, '.prettierrc')));
      const ignored = (await readTextFile(join(project, '.prettierignore'))).split('\n');

      expect(rc).toMatchObject({ semi: true, singleQuote: true, trailingComma: 'all', printWidth: 100 });
      expect(agents).toContain('(semicolons, single quotes, trailing commas, 100 columns)');
      expect(rc.plugins).toContain('prettier-plugin-tailwindcss');
      expect(rc.tailwindFunctions).toEqual(['clsx', 'cn']);

      expect(ignored.includes('routeTree.gen.ts')).toBe(shape === 'start');
      expect(agents.includes('- the generated route tree\n')).toBe(shape === 'start');
      expect(ignored.includes('drizzle/')).toBe(shape !== 'single');
      expect(agents.includes('- the Drizzle migrations\n')).toBe(shape !== 'single');
      expect(ignored).toContain('pnpm-lock.yaml');

      const { scripts } = await manifestOf(project);
      expect(scripts.format).toBe('prettier --write .');
      expect(scripts['format:check']).toBe('prettier --check .');
    });
  });

  test('the sentence about ESLint is only in the section of eslint-prettier', async () => {
    expect(await agentsOf(nameOf('mono', 'eslint-prettier'))).toContain(
      'with `eslint-config-prettier` turning off the ESLint rules that conflict with the formatter',
    );
    expect(await agentsOf(nameOf('mono', 'prettier'))).not.toContain('eslint-config-prettier');
  });
});

describe('the Biome section', () => {
  test.each(Object.keys(SHAPES) as Shape[])('%s: the style, the ignored files and the scripts are the generated ones', async (shape) => {
    const name = nameOf(shape, 'biome');
    const project = projectPath(name);
    const agents = await agentsOf(name);
    const config = JSON.parse(await readTextFile(join(project, 'biome.json')));
    const { scripts } = await manifestOf(project);

    expect(agents).toContain('single quotes, semicolons, two-space indent and 120 columns');
    expect(config.javascript.formatter).toMatchObject({ quoteStyle: 'single', semicolons: 'always' });
    expect(config.formatter).toMatchObject({ indentStyle: 'space', indentWidth: 2, lineWidth: 120 });
    expect(config.vcs.useIgnoreFile).toBe(true);
    expect(config.assist.actions.source.organizeImports).toBe('on');
    expect(config.root).toBe(true);

    expect(scripts.lint).toBe('biome lint');
    expect(scripts.format).toBe('biome format --write .');
    expect(scripts.check).toBe('biome check --fix .');
    expect(agents).toContain('`npm run format` formats but leaves the import order alone, which `check` enforces');
  });
});

describe('the Oxlint + Oxfmt section', () => {
  test.each(Object.keys(SHAPES) as Shape[])('%s: the configuration files and the scripts are the generated ones', async (shape) => {
    const name = nameOf(shape, 'oxc');
    const project = projectPath(name);
    const agents = await agentsOf(name);
    const oxfmt = await readTextFile(join(project, 'oxfmt.config.mts'));
    const oxlint = await readTextFile(join(project, 'oxlint.config.mts'));
    const { scripts } = await manifestOf(project);

    expect(agents).toContain('(single quotes, 120 columns)');
    expect(oxfmt).toContain('singleQuote: true');
    expect(oxfmt).toContain('printWidth: 120');
    expect(oxfmt).toContain('sortImports');
    expect(oxfmt.includes('sortTailwindcss')).toBe(shape === 'start');
    expect(agents.includes('and the Tailwind classes')).toBe(shape === 'start');
    expect(oxfmt).toContain("'pnpm-lock.yaml'");
    expect(oxlint).toContain("'**/generated/**'");

    expect(scripts).toMatchObject({ lint: 'oxlint', format: 'oxfmt', check: 'oxlint --fix && oxfmt' });
  });

  test('a turborepo has an override for the apps that use React or a test library only', async () => {
    const oxlint = await readTextFile(join(projectPath(nameOf('mono', 'oxc')), 'oxlint.config.mts'));
    const agents = await agentsOf(nameOf('mono', 'oxc'));

    expect(oxlint).toContain("files: ['apps/web/**']");
    expect(oxlint).not.toContain('apps/api');
    expect(oxlint).not.toContain('apps/worker');
    expect(agents).toContain('an override per app that uses React or a test library (`apps/<app>/**`)');
    expect(await readTextFile(join(projectPath(nameOf('single', 'oxc')), 'oxlint.config.mts'))).toContain("files: ['**']");
  });
});

describe('the Husky section', () => {
  test.each(LINTERS)('with %s, it names the hooks that exist and the prepare script', async (linter) => {
    const name = nameOf('mono', linter);
    const project = projectPath(name);
    const agents = await agentsOf(name);

    expect(agents).toContain('\n## Husky\n\n');
    expect(agents).toContain('The `prepare` script runs `husky` on install, which points `core.hooksPath` at `.husky/_`');
    expect((await manifestOf(project)).scripts.prepare).toBe('husky');
    for (const hook of ['pre-commit', 'commit-msg']) {
      expect(agents).toContain(`.husky/${hook}`);
      expect(await fileExists(join(project, '.husky', hook))).toBe(true);
    }
    expect((await readTextFile(join(project, '.husky', 'pre-commit'))).trim()).toBe('lint-staged');
  });

  describe.each(Object.keys(SHAPES) as Shape[])('%s', (shape) => {
    test.each(LINTERS.filter((linter) => shape === 'single' || !ESLINT_LINTERS.includes(linter)))(
      'with %s, the tasks are the lint-staged key of the root package.json',
      async (linter) => {
        const name = nameOf(shape, linter);
        const agents = await agentsOf(name);
        const rootTasks = Object.values((await manifestOf(projectPath(name)))['lint-staged'] ?? {}).flat();

        expect(agents).toContain('with the tasks of the `lint-staged` key of the root `package.json`');
        expect(agents).not.toContain('each app and each package that lints itself');
        expect(rootTasks.length).toBeGreaterThan(0);
      },
    );
  });

  test.each(ESLINT_LINTERS)(
    'with %s in a turborepo, the tasks are the lint-staged key of each workspace that lints itself',
    async (linter) => {
      for (const shape of ['mono', 'start'] as const) {
        const name = nameOf(shape, linter);
        const project = projectPath(name);
        const agents = await agentsOf(name);
        const rootKey = (await manifestOf(project))['lint-staged'];

        expect(agents).toContain('the tasks are the `lint-staged` key of each app and each package that lints itself');
        expect(agents).not.toContain('with the tasks of the `lint-staged` key of the root');
        expect(agents.includes('key of the root `package.json` covers the files outside the workspaces')).toBe(
          linter === 'eslint-prettier',
        );
        expect(rootKey !== undefined).toBe(linter === 'eslint-prettier');

        const linted = await workspacesWithESLintConfig(project);
        expect(linted.length).toBeGreaterThan(0);
        for (const workspace of linted) {
          const tasks = Object.values((await manifestOf(project, workspace))['lint-staged'] ?? {}).flat();
          expect(tasks, workspace).toContain('eslint --fix');
        }
      }
    },
  );
});

describe('the commit-msg hook', () => {
  const COMMIT_MESSAGE = /git commit -m "([^"]+)"/;
  const TYPES = /^types='([^']+)'$/m;

  async function verdict(message: string): Promise<{ output: string; exitCode: number }> {
    const project = projectPath(nameOf('single', 'biome'));
    const messageFile = join(project, 'COMMIT_EDITMSG.test');
    await writeFile(messageFile, `${message}\n`);
    const result = await $`sh ${join(project, '.husky', 'commit-msg')} ${messageFile}`.quiet().nothrow();
    return { output: result.stdout.toString(), exitCode: result.exitCode };
  }

  const isValid = (output: string) => output.includes('Commit message is valid!');
  const isInvalid = (output: string) => output.includes('Invalid commit message format');

  test('accepts the first commit message the summary suggests', async () => {
    const suggested = summaries.get(nameOf('mono', 'biome'))?.match(COMMIT_MESSAGE)?.[1];

    expect(suggested).toBeDefined();
    const { output, exitCode } = await verdict(suggested as string);
    expect(isValid(output)).toBe(true);
    expect(isInvalid(output)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test.each([
    'feat: add login',
    'fix(auth): refuse an expired token',
    'refactor(api)!: rename the session route',
    'feat(auth): add email login\n\nA body line.',
  ])('prints only the valid verdict for %p', async (message) => {
    const { output, exitCode } = await verdict(message);

    expect(isValid(output)).toBe(true);
    expect(isInvalid(output)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test.each([
    'Initial commit',
    'feature: add login',
    'feat add login',
    'feat(): add login',
    'feat:add login',
    '\nfeat: a subject on the second line',
    'Add a thing\n\nfix: only the body starts with a type',
  ])('prints only the warning for %p and does not block the commit', async (message) => {
    const { output, exitCode } = await verdict(message);

    expect(isInvalid(output)).toBe(true);
    expect(isValid(output)).toBe(false);
    expect(output).toContain('Allowed types:');
    expect(exitCode).toBe(0);
  });

  test('the hook, its warning and the Husky section list the same types', async () => {
    const hook = await readTextFile(join(projectPath(nameOf('single', 'biome')), '.husky', 'commit-msg'));
    const types = hook.match(TYPES)?.[1] as string;
    const { output } = await verdict('Initial commit');

    expect(types.split('|').length).toBeGreaterThan(5);
    expect(output.split('Allowed types:\n')[1]?.trimEnd().split('\n')).toEqual(types.split('|').map((type) => `  • ${type}`));
    expect(await agentsOf(nameOf('single', 'biome'))).toContain(`a type that matches \`${types}\``);
    for (const type of types.split('|')) {
      expect((await verdict(`${type}: a subject`)).output).toContain('Commit message is valid!');
    }
  });
});

describe('husky chosen in the prompt without a git repository', () => {
  test('the skipped tooling names git alone, and no hook is generated', async () => {
    const tempDir = await createTempDir();
    try {
      const { exitCode, output } = await runCliOnTerminal(
        ['asked', '--app', 'asked:nextjs', '--database', 'none', '--deployment', 'none', '--linter', 'biome', '--no-git', '--no-install'],
        tempDir,
        [{ prompt: 'extras', keys: `${SPACE}\r` }],
      );

      expect(exitCode).toBe(0);
      expect(output).toContain('husky requires git. Skipping.');
      expect(output).not.toContain('a linter');
      expect(await fileExists(join(tempDir, 'asked', '.husky'))).toBe(false);
    } finally {
      await cleanupTempDir(tempDir);
    }
  }, 90_000);
});
