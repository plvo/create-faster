import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { $ } from 'bun';
import { cleanupTempDir, createTempDir, fileExists, runCli } from './helpers';

// Stand-ins for the package manager and for husky: `install` runs the `prepare` script of the
// generated package.json, and `husky` sets `core.hooksPath` only inside a repository, as husky 9 does.
const STUB_NPM = `#!/bin/sh
case "$1" in
  --version) echo 10.0.0 ;;
  install) mkdir -p node_modules; sh -c "$(node -p "require('./package.json').scripts.prepare ?? 'true'")" ;;
  run) ;;
esac
`;
const STUB_HUSKY = `#!/bin/sh
git rev-parse --git-dir > /dev/null 2>&1 || { echo ".git can't be found"; exit 0; }
git config core.hooksPath .husky/_
`;

describe('git hooks installed by a prepare script', () => {
  let tempDir: string;
  let stubBinDir: string;
  let env: Record<string, string>;

  beforeAll(async () => {
    tempDir = await createTempDir();
    stubBinDir = join(tempDir, 'stub-bin');
    await mkdir(stubBinDir);
    await writeFile(join(stubBinDir, 'npm'), STUB_NPM, { mode: 0o755 });
    await writeFile(join(stubBinDir, 'husky'), STUB_HUSKY, { mode: 0o755 });
    env = { PATH: `${stubBinDir}${delimiter}${process.env.PATH}` };
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]) {
    const workDir = join(tempDir, name);
    await mkdir(workDir);
    const result = await runCli(
      [name, '--app', `${name}:hono`, '--linter', 'biome', '--tooling', 'husky', '--pm', 'npm', ...args],
      workDir,
      env,
    );
    return { result, projectPath: join(workDir, name), output: result.stdout + result.stderr };
  }

  async function hooksPath(projectPath: string): Promise<string> {
    return (await $`git config core.hooksPath`.cwd(projectPath).nothrow().quiet().text()).trim();
  }

  test('are active right after a generation with an install', async () => {
    const { result, projectPath } = await generate('installed', ['--git']);

    expect(result.exitCode).toBe(0);
    expect(await hooksPath(projectPath)).toBe('.husky/_');
  });

  test('with --no-install, the repository exists and the first install activates them', async () => {
    const { result, projectPath, output } = await generate('not-installed', ['--git', '--no-install']);

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
