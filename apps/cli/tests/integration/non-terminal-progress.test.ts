import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const ESCAPE = '\u001b';

describe('progress of a run whose stdout is not a terminal', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('prints each step as a plain line, with no spinner frame or cursor code', async () => {
    const result = await runCli(['plain', '--app', 'web:nextjs', '--git', '--no-install'], tempDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Generating \d+ files\.\.\./);
    expect(result.stdout).toMatch(/Generated \d+ files successfully!/);
    expect(result.stdout).toContain('Initializing git repository...');
    expect(result.stdout).toContain('Git repository initialized successfully!');
    expect(result.stdout).not.toContain(ESCAPE);
    expect(result.stdout).not.toMatch(/[◒◐◓◑]/);
  });
});
