import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('TanStack Start gitignore', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generateGitignore(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return readTextFile(join(tempDir, name, '.gitignore'));
  }

  test('single repo ignores the router temp directory and the Nitro output', async () => {
    const gitignore = await generateGitignore('start-single', ['--app', 'start-single:tanstack-start']);
    expect(gitignore).toContain('.tanstack/');
    expect(gitignore).toContain('.output/');
  });

  test('turborepo with a Start app ignores the router temp directory at every depth', async () => {
    const gitignore = await generateGitignore('start-turbo', ['--app', 'web:tanstack-start', '--app', 'api:hono']);
    expect(gitignore).toContain('.tanstack/');
    expect(gitignore).not.toMatch(/^\/\.tanstack/m);
  });

  test('cloudflare deployment keeps the wrangler state ignored next to the router temp directory', async () => {
    const gitignore = await generateGitignore('start-cf', [
      '--app',
      'start-cf:tanstack-start',
      '--deployment',
      'cloudflare',
    ]);
    expect(gitignore).toContain('.tanstack/');
    expect(gitignore).toContain('.wrangler/');
  });

  test('projects without a Start app do not carry its directories', async () => {
    const gitignore = await generateGitignore('next-only', ['--app', 'next-only:nextjs']);
    expect(gitignore).not.toContain('.tanstack/');
  });
});
