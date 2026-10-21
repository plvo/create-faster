import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  printedScriptsMissingFrom,
  readJsonFile,
  readTextFile,
  runCli,
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
const MONO_APPS = ['--app', 'web:nextjs', '--app', 'api:hono', '--app', 'worker:node'];
const DATABASE = ['--database', 'sqlite', '--orm', 'drizzle'];
const COMMON = ['--tooling', 'husky', '--git', '--no-install', '--pm', 'npm'];

let dir: string;
const summaries = new Map<string, string>();

const projectPath = (name: string) => join(dir, name);
const singleName = (linter: Linter) => `single-${linter}`;
const monoName = (linter: Linter) => `mono-${linter}`;

beforeAll(async () => {
  dir = await createTempDir();
  for (const linter of LINTERS) {
    const projects: [string, string[]][] = [
      [singleName(linter), ['--app', 'web:nextjs']],
      [monoName(linter), [...MONO_APPS, ...DATABASE]],
    ];
    for (const [name, apps] of projects) {
      const result = await runCli([name, ...apps, '--linter', linter, ...COMMON], dir);
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

describe.each(LINTERS)('the AGENTS.md of a project linted with %s', (linter) => {
  test.each([singleName(linter), monoName(linter)])('%s has a section per linter, with commands that exist', async (name) => {
    const agents = await readTextFile(join(projectPath(name), 'AGENTS.md'));

    for (const heading of HEADINGS[linter]) {
      expect(agents).toContain(`\n## ${heading}\n\n`);
    }
    expect(await printedScriptsMissingFrom(projectPath(name), agents)).toEqual([]);
  });
});

describe('the ESLint section of a turborepo', () => {
  test.each(['eslint', 'eslint-prettier'] as const)(
    'with %s, every workspace has its own configuration and lint script, and the root has none',
    async (linter) => {
      const project = projectPath(monoName(linter));
      const agents = await readTextFile(join(project, 'AGENTS.md'));

      expect(agents).toContain('ESLint is configured per workspace.');
      expect(agents).toContain('The root has no ESLint configuration');
      expect(await readJsonFile<{ scripts: Record<string, string> }>(join(project, 'package.json'))).toMatchObject({
        scripts: { lint: 'turbo lint' },
      });
      expect((await readdir(project)).filter((file) => file.startsWith('eslint.config'))).toEqual([]);

      const linted = await workspacesWithESLintConfig(project);
      expect(linted).toEqual([
        'apps/api',
        'apps/web',
        'apps/worker',
        'packages/db',
        'packages/eslint-config',
      ]);
      for (const workspace of linted) {
        const manifest = await readJsonFile<{ scripts: Record<string, string> }>(join(project, workspace, 'package.json'));
        expect(manifest.scripts.lint, workspace).toBe('eslint .');
      }
    },
  );

  test.each(['biome', 'oxc', 'prettier'] as const)('with %s, the configuration is one file at the root', async (linter) => {
    const agents = await readTextFile(join(projectPath(monoName(linter)), 'AGENTS.md'));

    expect(agents).not.toContain('ESLint is configured per workspace');
  });

  test('a single repo has one configuration at the root', async () => {
    const project = projectPath(singleName('eslint'));
    const agents = await readTextFile(join(project, 'AGENTS.md'));

    expect(agents).toContain('`eslint.config.mjs` at the root is the flat configuration of the app');
    expect(await fileExists(join(project, 'eslint.config.mjs'))).toBe(true);
  });
});

describe('the Husky section', () => {
  test.each(LINTERS)('with %s, it names the hooks that exist', async (linter) => {
    const project = projectPath(monoName(linter));
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    const manifest = await readJsonFile<{ scripts: Record<string, string> }>(join(project, 'package.json'));

    expect(agents).toContain('\n## Husky\n\n');
    for (const hook of ['pre-commit', 'commit-msg']) {
      expect(agents).toContain(`.husky/${hook}`);
      expect(await fileExists(join(project, '.husky', hook))).toBe(true);
    }
    expect(manifest.scripts.prepare).toBe('husky');
    expect((await readTextFile(join(project, '.husky', 'pre-commit'))).trim()).toBe('lint-staged');
  });

  test.each(LINTERS)('with %s in a single repo, the tasks it lists are the lint-staged tasks of package.json', async (linter) => {
    const project = projectPath(singleName(linter));
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    const manifest = await readJsonFile<{ 'lint-staged': Record<string, string[]> }>(join(project, 'package.json'));
    const sentence = agents.match(/to the staged files: (.+)\. A task that fails/)?.[1] ?? '';
    const documented = [...sentence.matchAll(/`([^`]+)`/g)].map(([, command]) => command as string);
    const configured = Object.values(manifest['lint-staged']).flat();

    expect(documented.length).toBeGreaterThan(0);
    expect(documented.map((command) => configured.find((task) => task.startsWith(command)))).not.toContain(undefined);
    expect(configured.length).toBeGreaterThanOrEqual(documented.length);
  });

  test.each(['eslint', 'eslint-prettier'] as const)(
    'with %s in a turborepo, every workspace that lints carries its own lint-staged key and the section says so',
    async (linter) => {
      const project = projectPath(monoName(linter));
      const agents = await readTextFile(join(project, 'AGENTS.md'));

      expect(agents).toContain('each app and each package with a `lint` script carries its own `lint-staged` key');
      for (const workspace of await workspacesWithESLintConfig(project)) {
        const manifest = await readJsonFile<{ 'lint-staged'?: Record<string, string[]> }>(
          join(project, workspace, 'package.json'),
        );
        expect(Object.values(manifest['lint-staged'] ?? {}).flat(), workspace).toContain('eslint --fix');
      }
    },
  );

  test.each(['biome', 'oxc', 'prettier'] as const)('with %s in a turborepo, it does not claim per-workspace tasks', async (linter) => {
    const agents = await readTextFile(join(projectPath(monoName(linter)), 'AGENTS.md'));

    expect(agents).not.toContain('carries its own `lint-staged` key');
  });
});

describe('the commit-msg hook', () => {
  const COMMIT_MESSAGE = /git commit -m "([^"]+)"/;

  async function verdict(project: string, message: string): Promise<{ output: string; exitCode: number }> {
    const messageFile = join(project, 'COMMIT_EDITMSG.test');
    await writeFile(messageFile, `${message}\n`);
    const result = await $`sh ${join(project, '.husky', 'commit-msg')} ${messageFile}`.quiet().nothrow();
    return { output: result.stdout.toString(), exitCode: result.exitCode };
  }

  const isValid = (output: string) => output.includes('Commit message is valid!');
  const isInvalid = (output: string) => output.includes('Invalid commit message format');

  test('accepts the first commit message the summary suggests', async () => {
    const suggested = summaries.get(monoName('biome'))?.match(COMMIT_MESSAGE)?.[1];

    expect(suggested).toBeDefined();
    const { output, exitCode } = await verdict(projectPath(monoName('biome')), suggested as string);
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
    const { output, exitCode } = await verdict(projectPath(singleName('biome')), message);

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
    const { output, exitCode } = await verdict(projectPath(singleName('biome')), message);

    expect(isInvalid(output)).toBe(true);
    expect(isValid(output)).toBe(false);
    expect(output).toContain('Allowed types:');
    expect(exitCode).toBe(0);
  });
});
