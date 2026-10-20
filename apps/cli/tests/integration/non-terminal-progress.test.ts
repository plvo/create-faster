import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, filesUnder, runCli } from './helpers';
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
    expect(result.stdout).toContain('Generating files...');
    expect(result.stdout).toMatch(/Generated \d+ files successfully!/);
    expect(result.stdout).toContain('Initializing git repository...');
    expect(result.stdout).toContain('Git repository initialized successfully!');
    expect(result.stdout).not.toContain(ESCAPE);
    expect(result.stdout).not.toMatch(/[◒◐◓◑]/);
  });

  const filesWritten = async (projectPath: string) =>
    (await filesUnder(projectPath)).filter((file) => !/\/(\.git|node_modules)\//.test(file)).length;

  test('prints the number of files written, agent context included', async () => {
    const result = await runCli(['counted', '--app', 'web:nextjs', '--no-git', '--no-install'], tempDir);

    expect(result.stdout).toContain('Generating files...');
    expect(result.stdout).toContain(`Generated ${await filesWritten(join(tempDir, 'counted'))} files successfully!`);
  });

  test('prints the number of files written without the agent context', async () => {
    const result = await runCli(
      ['counted-bare', '--app', 'web:nextjs', '--no-git', '--no-install', '--no-agent-context'],
      tempDir,
    );

    expect(result.stdout).toContain(`Generated ${await filesWritten(join(tempDir, 'counted-bare'))} files successfully!`);
  });
});
