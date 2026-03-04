import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type CliResult, cleanupTempDir, createTempDir, runCli } from './helpers';

describe('Blueprint CLI flag', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('invalid blueprint name produces an error', async () => {
    const result = await runCli(['test-bp', '--blueprint', 'nonexistent', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid blueprint');
  });
});
