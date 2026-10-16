import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  readJsonFile,
  readTextFile,
  runCli,
  runCliOnTerminal,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const FLAGS = ['--yes', '--no-install', '--no-git'];
const NAME_PROMPT = 'Name of your project?';
const CLEAR_FIELD = '\x7f'.repeat(40);
const typeProjectDir = (prompt: string, dir: string) => ({ prompt, keys: `${CLEAR_FIELD}${dir}\r` });

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

  test('a directory with a space is quoted in the next step and the recreate command', async () => {
    const result = await runCli(['../my dir/my-app', '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'my dir', 'my-app', 'package.json'))).toBe(true);
    expect(result.stdout).toContain("cd '../my dir/my-app'");
    expect(result.stdout).toContain("create-faster '../my dir/my-app' --app my-app:nextjs");
  });

  test('a directory with a shell metacharacter is quoted, never left to the shell', async () => {
    const result = await runCli(['../a$(id)/my-app', '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("cd '../a$(id)/my-app'");
    expect(result.stdout).toContain("create-faster '../a$(id)/my-app' --app my-app:nextjs");
  });

  test('a directory starting with a dash is read as a directory after --, and printed with ./', async () => {
    const result = await runCli(['--app', 'my-app:nextjs', ...FLAGS, '--', '-x/my-app'], workDir);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(workDir, '-x', 'my-app', 'package.json'))).toBe(true);
    expect(result.stdout).toContain('cd ./-x/my-app');
    expect(result.stdout).toContain('create-faster ./-x/my-app --app my-app:nextjs');
  });

  test('a turborepo takes its root package name from the last segment', async () => {
    const result = await runCli(
      ['../out/my-app', '--app', 'web:nextjs', '--app', 'api:hono', ...FLAGS],
      workDir,
    );

    expect(result.exitCode).toBe(0);
    const root = await readJsonFile<{ name: string }>(join(tempDir, 'out', 'my-app', 'package.json'));
    expect(root.name).toBe('my-app');
    expect(await fileExists(join(tempDir, 'out', 'my-app', 'apps', 'web', 'package.json'))).toBe(true);
  });

  test('a blueprint takes its project name from the last segment of a path', async () => {
    const result = await runCli(['../out/my-site', '--blueprint', 'showcase-nextjs', '--no-install', '--no-git'], workDir);

    expect(result.exitCode).toBe(0);
    const pkg = await readJsonFile<{ name: string }>(join(tempDir, 'out', 'my-site', 'package.json'));
    expect(pkg.name).toBe('my-site');
    expect(result.stdout).toContain('create-faster ../out/my-site --blueprint showcase-nextjs');
  });

  test('an existing absolute directory is refused and left untouched', async () => {
    const target = join(tempDir, 'taken', 'my-app');
    await mkdir(target, { recursive: true });
    const result = await runCli([target, '--app', 'my-app:nextjs', ...FLAGS], workDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('already exists');
    expect(await readdir(target)).toEqual([]);
  });

  test('git init runs in the target directory', async () => {
    const result = await runCli(['../out/my-app', '--app', 'my-app:nextjs', '--git', '--no-install'], workDir);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'out', 'my-app', '.git'))).toBe(true);
    expect(await fileExists(join(workDir, '.git'))).toBe(false);
  });

  describe('typed in the name prompt', () => {
    const promptFlags = ['--app', 'new-app:nextjs', '--yes', '--no-git', '--no-install'];

    test('a path is accepted and names the project after its last segment', async () => {
      const { exitCode, output } = await runCliOnTerminal(promptFlags, workDir, [
        typeProjectDir(NAME_PROMPT, '  ../out/prompted  '),
      ]);

      expect(exitCode).toBe(0);
      const pkg = await readJsonFile<{ name: string }>(join(tempDir, 'out', 'prompted', 'package.json'));
      expect(pkg.name).toBe('prompted');
      expect(output).toContain('create-faster ../out/prompted --app new-app:nextjs');
    }, 90_000);

    test('an invalid last segment is refused and asked again', async () => {
      const { exitCode } = await runCliOnTerminal(promptFlags, workDir, [
        typeProjectDir(NAME_PROMPT, '../out/My App'),
        typeProjectDir('must start with a lowercase letter', '../out/valid-app'),
      ]);

      expect(exitCode).toBe(0);
      expect(await fileExists(join(tempDir, 'out', 'valid-app', 'package.json'))).toBe(true);
      expect(await readdir(join(tempDir, 'out'))).toEqual(['valid-app']);
    }, 90_000);

    test('an existing directory given as a path is refused and asked again', async () => {
      await mkdir(join(tempDir, 'out', 'taken'), { recursive: true });
      const { exitCode } = await runCliOnTerminal(promptFlags, workDir, [
        typeProjectDir(NAME_PROMPT, '../out/taken'),
        typeProjectDir('already exists', '../out/fresh'),
      ]);

      expect(exitCode).toBe(0);
      expect(await readdir(join(tempDir, 'out', 'taken'))).toEqual([]);
      expect(await fileExists(join(tempDir, 'out', 'fresh', 'package.json'))).toBe(true);
    }, 90_000);
  });
});
