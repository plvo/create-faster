import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

describe('--version', () => {
  let dir: string;
  let version: string;

  beforeAll(async () => {
    dir = await createTempDir();
    ({ version } = await readJsonFile<{ version: string }>(join(import.meta.dir, '../../package.json')));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test.each(['--version', '-V'])('%s prints the package version only and writes nothing', async (flag) => {
    const result = await runCli([flag], dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.stderr).toBe('');
    expect(await readdir(dir)).toEqual([]);
  });

  test.each([
    ['an invalid app', ['--app', 'x:bogus', '--version']],
    ['an invalid app after the flag', ['--version', '--app', 'x:bogus']],
    ['--help', ['--help', '--version']],
    ['--help after the flag', ['--version', '--help']],
    ['a project name', ['demo', '--version']],
    ['a project name and apps', ['demo', '--app', 'demo:nextjs', '--yes', '--version']],
  ])('--version with %s prints the version only and writes nothing', async (_title, args) => {
    const result = await runCli(args, dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.stderr).toBe('');
    expect(await readdir(dir)).toEqual([]);
  });
});
