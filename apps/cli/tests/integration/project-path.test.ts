import './timeout';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const FLAGS = ['--yes', '--no-install', '--no-git'];

describe('project name given as a path', () => {
  let tempDir: string;
  let workDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    workDir = join(tempDir, 'work');
    await mkdir(workDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  async function expectProjectNamedMyApp(projectDir: string, stdout: string, argument: string) {
    const pkg = await readJsonFile<{ name: string }>(join(projectDir, 'package.json'));
    expect(pkg.name).toBe('my-app');
    expect(await readTextFile(join(projectDir, 'README.md'))).toContain('# my-app');
    expect(stdout).toContain(`cd ${argument}`);
    expect(stdout).toContain(`create-faster ${argument} --app my-app:nextjs`);
  }

  test('a relative path outside the working directory writes there and names the project after its last segment', async () => {
    const result = await runCli(['../out/my-app', '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(0);
    await expectProjectNamedMyApp(join(tempDir, 'out', 'my-app'), result.stdout, '../out/my-app');
    expect(await fileExists(join(workDir, 'out'))).toBe(false);
  });

  test('a nested relative path writes there and names the project after its last segment', async () => {
    const result = await runCli(['./apps/my-app', '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(0);
    await expectProjectNamedMyApp(join(workDir, 'apps', 'my-app'), result.stdout, './apps/my-app');
  });

  test('an absolute path writes there and names the project after its last segment', async () => {
    const target = join(tempDir, 'abs', 'my-app');
    const result = await runCli([target, '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(0);
    await expectProjectNamedMyApp(target, result.stdout, target);
  });

  test('the project name reaches the database name and the compose file', async () => {
    const result = await runCli(
      ['../out/my-app', '--app', 'my-app:nextjs', '--database', 'postgres', '--orm', 'drizzle', ...FLAGS],
      workDir,
    );

    expect(result.exitCode).toBe(0);
    const compose = await readTextFile(join(tempDir, 'out', 'my-app', 'docker-compose.yml'));
    expect(compose).toContain('postgres-my-app');
    expect(compose).not.toContain('out/my-app');
  });

  test('an existing target directory is refused', async () => {
    await mkdir(join(tempDir, 'out', 'my-app'), { recursive: true });
    const result = await runCli(['../out/my-app', '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('already exists');
  });

  test('a last segment that is not a valid package name is refused before anything is written', async () => {
    const result = await runCli(['../out/My App', '--app', 'web:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('Project name');
    expect(await fileExists(join(tempDir, 'out'))).toBe(false);
  });
});
