import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { $ } from 'bun';
import { cleanupTempDir, createTempDir, fileExists } from './helpers';
import { createStubbedCli, type GenerateProject } from './stubbed-cli';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('git hooks installed by a prepare script', () => {
  let tempDir: string;
  let env: Record<string, string>;
  let stubbedGenerate: GenerateProject;

  beforeAll(async () => {
    tempDir = await createTempDir();
    // `install` runs the `prepare` script of the generated package.json, and `husky` sets
    // `core.hooksPath` only when the working directory holds a `.git`, as husky 9 does.
    ({ env, generate: stubbedGenerate } = await createStubbedCli(tempDir, {
      npm: `case "$1" in
  --version) echo 10.0.0 ;;
  install) mkdir -p node_modules; sh -c "$(node -p "require('./package.json').scripts.prepare ?? 'true'")" ;;
  run) ;;
esac`,
      husky: `[ -e .git ] || { echo ".git can't be found"; exit 0; }
git config core.hooksPath .husky/_`,
    }));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  function generate(name: string, apps: string[], args: string[]) {
    return stubbedGenerate(name, [
      ...apps.flatMap((app) => ['--app', `${app}:hono`]),
      '--linter',
      'biome',
      '--tooling',
      'husky',
      '--pm',
      'npm',
      ...args,
    ]);
  }

  async function hooksPath(projectPath: string): Promise<string> {
    return (await $`git config core.hooksPath`.cwd(projectPath).nothrow().quiet().text()).trim();
  }

  test('are active right after a generation with an install', async () => {
    const { result, projectPath } = await generate('installed', ['web'], ['--git']);

    expect(result.exitCode).toBe(0);
    expect(await hooksPath(projectPath)).toBe('.husky/_');
  });

  test('are active in a turborepo, where husky sits in the root package.json', async () => {
    const { result, projectPath } = await generate('monorepo', ['web', 'api'], ['--git']);

    expect(result.exitCode).toBe(0);
    expect(await hooksPath(projectPath)).toBe('.husky/_');
  });

  test('with --no-install, the repository exists and the first install activates them', async () => {
    const { result, projectPath, output } = await generate('not-installed', ['web'], ['--git', '--no-install']);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(projectPath, '.git'))).toBe(true);
    expect(await hooksPath(projectPath)).toBe('');
    expect(output).toMatch(/# Install dependencies:[\s│]+npm install/);

    await $`npm install`
      .cwd(projectPath)
      .env({ ...process.env, ...env })
      .quiet();

    expect(await hooksPath(projectPath)).toBe('.husky/_');
  });
});
