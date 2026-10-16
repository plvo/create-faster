import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('Generated .gitignore', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generateGitignoreLines(name: string, args: string[]): Promise<string[]> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return (await readTextFile(join(tempDir, name, '.gitignore'))).split('\n');
  }

  const repos = [
    { repo: 'single', apps: (libraries: string) => ['--app', `web:nextjs${libraries}`] },
    { repo: 'turbo', apps: (libraries: string) => ['--app', `web:nextjs${libraries}`, '--app', 'api:hono'] },
  ];

  for (const { repo, apps } of repos) {
    test(`${repo} repo ignores TypeScript build info and Playwright output`, async () => {
      const lines = await generateGitignoreLines(`with-playwright-${repo}`, apps(':playwright'));
      expect(lines).toContain('*.tsbuildinfo');
      expect(lines).toContain('test-results/');
      expect(lines).toContain('playwright-report/');
    });

    test(`${repo} repo without Playwright does not ignore its output`, async () => {
      const lines = await generateGitignoreLines(`without-playwright-${repo}`, apps(''));
      expect(lines).not.toContain('test-results/');
      expect(lines).not.toContain('playwright-report/');
    });

    test(`${repo} repo does not ignore a path no tool writes`, async () => {
      const lines = await generateGitignoreLines(`no-stray-${repo}`, apps(''));
      expect(lines).not.toContain('create-faster');
    });
  }
});
