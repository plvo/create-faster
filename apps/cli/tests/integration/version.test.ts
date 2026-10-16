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
});
