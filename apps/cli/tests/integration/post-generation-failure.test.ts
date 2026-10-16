import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists } from './helpers';
import { createStubbedCli, type GenerateProject } from './stubbed-cli';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const NOISY_LINE_COUNT = 200;

describe('post-generation failures', () => {
  let tempDir: string;
  let stubbedGenerate: GenerateProject;

  beforeAll(async () => {
    tempDir = await createTempDir();
    ({ generate: stubbedGenerate } = await createStubbedCli(tempDir, {
      npm: `if [ "$1" = "--version" ]; then echo 10.0.0; exit 0; fi
i=1
while [ $i -le ${NOISY_LINE_COUNT} ]; do echo "npm http fetch line-$i" >&2; i=$((i+1)); done
echo "npm error 404 No match found for version 9.9.9 of transitive-dep" >&2
exit 1`,
      git: `echo "fatal: simulated git failure" >&2
exit 1`,
    }));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  function generate(name: string, args: string[]) {
    return stubbedGenerate(name, ['--app', `${name}:nextjs`, ...args]);
  }

  test('a failed install exits non-zero, keeps the files and tells how to retry', async () => {
    const { result, projectPath } = await generate('install-fails', ['--pm', 'npm', '--no-git']);

    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Project files were generated');
    expect(output).toContain('dependency install failed');
    expect(output).toContain('No match found for version 9.9.9 of transitive-dep');
    expect(output).toContain('cd install-fails && npm install');
    expect(output).not.toContain('created successfully');
    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
  });

  test('a failed install shows the tail of the output, not all of it', async () => {
    const { result } = await generate('install-tail', ['--pm', 'npm', '--no-git']);

    const output = result.stdout + result.stderr;
    expect(output).toContain(`line-${NOISY_LINE_COUNT}`);
    expect(output).not.toContain('line-1\n');
  });

  test('a failed git init only warns: the project is usable, the run succeeds', async () => {
    const { result, projectPath } = await generate('git-fails', ['--git', '--no-install']);

    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Failed to initialize git');
    expect(output).toContain('Project created successfully');
    expect(output).toContain('AGENTS.md');
    expect(output).not.toContain('Git, AGENTS.md');
    expect(output).not.toContain('git remote add origin');
    expect(output).toMatch(/# git init failed[^\n]*\n[\s│]+git init[\s│]+# Install dependencies:[\s│]+npm install/);
    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
  });

  test('--no-install skips the install and still succeeds', async () => {
    const { result } = await generate('no-install', ['--pm', 'npm', '--no-git', '--no-install']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('Project created successfully');
  });
});
