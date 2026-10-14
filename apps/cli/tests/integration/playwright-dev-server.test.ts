import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('Playwright dev server command', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const generate = async (name: string, pm: string, appArgs: string[]): Promise<string> => {
    const result = await runCli([name, ...appArgs, '--no-git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  };

  const expectDevServerRunWith = (config: string, pm: string): void => {
    expect(config).toContain(`command: '${pm} run dev'`);
    if (pm !== 'bun') expect(config).not.toContain('bun run');
  };

  for (const pm of ['bun', 'npm', 'pnpm']) {
    test(`single repo: the web server starts with ${pm}`, async () => {
      const projectPath = await generate(`pw-single-${pm}`, pm, ['--app', 'web:nextjs:playwright']);
      expectDevServerRunWith(await readTextFile(join(projectPath, 'playwright.config.ts')), pm);
    });

    test(`turborepo: every app config starts its web server with ${pm}`, async () => {
      const projectPath = await generate(`pw-mono-${pm}`, pm, [
        '--app',
        'web:nextjs:playwright',
        '--app',
        'docs:tanstack-start:playwright',
      ]);
      for (const app of ['web', 'docs']) {
        expectDevServerRunWith(await readTextFile(join(projectPath, 'apps', app, 'playwright.config.ts')), pm);
      }
    });
  }
});
