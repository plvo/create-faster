import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('Generated favicon', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, args: string[]): Promise<string> {
    const result = await runCli([projectName, ...args, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  test('a single Next.js app ships an icon through the app directory convention', async () => {
    const projectPath = await generate('next-single', ['--app', 'next-single:nextjs']);
    const icon = await readTextFile(join(projectPath, 'src/app/icon.svg'));
    expect(icon).toStartWith('<svg');
    expect(icon).toMatch(/<title>[^<]+<\/title>/);
  });

  test('every Next.js app of a turborepo ships its own icon', async () => {
    const projectPath = await generate('next-mono', ['--app', 'web:nextjs', '--app', 'admin:nextjs']);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/icon.svg'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/admin/src/app/icon.svg'))).toBe(true);
  });

  test('a Next.js blueprint keeps the icon', async () => {
    const projectPath = await generate('bp-dapp', ['--blueprint', 'dapp-privy-nextjs']);
    expect(await fileExists(join(projectPath, 'src/app/icon.svg'))).toBe(true);
  });

  test('a TanStack Start app serves a public favicon linked from the root route head', async () => {
    const projectPath = await generate('start-single', ['--app', 'start-single:tanstack-start']);
    const favicon = await readTextFile(join(projectPath, 'public/favicon.svg'));
    expect(favicon).toStartWith('<svg');
    expect(favicon).toMatch(/<title>[^<]+<\/title>/);
    const rootRoute = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
    expect(rootRoute).toContain("rel: 'icon'");
    expect(rootRoute).toContain("href: '/favicon.svg'");
  });

  test('an Expo app points its web favicon at a shipped asset', async () => {
    const projectPath = await generate('expo-web', ['--app', 'expo-web:expo']);
    const config = await readTextFile(join(projectPath, 'app.config.ts'));
    expect(config).toMatch(/^\s+favicon: '\.\/assets\/favicon\.png',$/m);
    expect(await fileExists(join(projectPath, 'assets/favicon.png'))).toBe(true);
  });
});
