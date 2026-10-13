import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { stripVTControlCharacters } from 'node:util';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

const INVALID_DATABASE_ARGS = ['x', '--app', 'x:nextjs', '--database', 'nope', '--no-git', '--no-install'];
const COLOR_ESCAPE = '\u001b[';

describe('CLI output seen by the tests', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each([
    ['FORCE_COLOR', { FORCE_COLOR: '1' }],
    ['CI', { CI: 'true' }],
    ['both', { FORCE_COLOR: '1', CI: 'true' }],
  ])('is plain text when the parent environment asks for colors (%s)', async (_label, parentEnv) => {
    Object.assign(process.env, parentEnv);

    const result = await runCli(INVALID_DATABASE_ARGS, tempDir);

    expect(result.stderr).toContain("Invalid database 'nope'");
    expect(result.stdout + result.stderr).not.toContain(COLOR_ESCAPE);
  });

  test('still renders colors when a run opts back in', async () => {
    const result = await runCli(INVALID_DATABASE_ARGS, tempDir, { NO_COLOR: '', FORCE_COLOR: '1' });

    expect(result.stderr).toContain(COLOR_ESCAPE);
    expect(stripVTControlCharacters(result.stderr)).toContain("Invalid database 'nope'");
  });
});
