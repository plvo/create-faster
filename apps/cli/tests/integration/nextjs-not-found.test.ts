import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('Next.js not-found page', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('sets its own title instead of inheriting the home page default', async () => {
    const result = await runCli(['nf', '--app', 'nf:nextjs', '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    const notFound = await readTextFile(join(tempDir, 'nf/src/app/not-found.tsx'));
    expect(notFound).toContain('export const metadata');
    expect(notFound).toContain("title: 'Page not found'");
  });
});
