import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface RouteTreeConfig {
  routeTreeFileFooter: string[];
}

describe('TanStack Start route tree, first run', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  async function footerOf(appDir: string): Promise<string> {
    const config = await readJsonFile<RouteTreeConfig>(join(appDir, 'tsr.config.json'));
    expect(config.routeTreeFileFooter).toHaveLength(1);
    return config.routeTreeFileFooter[0] as string;
  }

  test('without a start file the footer registers the router with createStart', async () => {
    const root = await generate('plain', ['--app', 'site:tanstack-start']);

    const footer = await footerOf(root);
    expect(footer).toContain("import type { getRouter } from './router.tsx'");
    expect(footer).toContain("import type { createStart } from '@tanstack/react-start'");
    expect(footer).toContain('router: Awaited<ReturnType<typeof getRouter>>');
    expect(footer).not.toContain('startInstance');
    expect(await fileExists(join(root, 'src/start.ts'))).toBe(false);
  });

  test('with a start file the footer registers its config', async () => {
    const root = await generate('logged', ['--app', 'site:tanstack-start:evlog']);

    const footer = await footerOf(root);
    expect(footer).toContain("import type { startInstance } from './start.ts'");
    expect(footer).toContain('config: Awaited<ReturnType<typeof startInstance.getOptions>>');
    expect(footer).not.toContain('createStart');
    expect(await fileExists(join(root, 'src/start.ts'))).toBe(true);
  });

  test('cloudflare-static generates no start file, so the footer does not import it', async () => {
    const root = await generate('static', ['--app', 'site:tanstack-start:evlog', '--deployment', 'cloudflare-static']);

    expect(await fileExists(join(root, 'src/start.ts'))).toBe(false);
    expect(await footerOf(root)).not.toContain('startInstance');
  });

  test('turborepo: only the TanStack Start app gets the router config and the README says the file is generated', async () => {
    const root = await generate('mono', ['--app', 'web:nextjs', '--app', 'docs:tanstack-start']);

    expect(await fileExists(join(root, 'apps/docs/tsr.config.json'))).toBe(true);
    expect(await fileExists(join(root, 'apps/web/tsr.config.json'))).toBe(false);
    const readme = await readTextFile(join(root, 'README.md'));
    expect(readme).toContain('routeTree.gen.ts');
    expect(readme.indexOf('routeTree.gen.ts')).toBeGreaterThan(readme.indexOf('bun install'));
  });

  test('a project without TanStack Start mentions no route tree', async () => {
    const root = await generate('next', ['--app', 'site:nextjs']);

    expect(await fileExists(join(root, 'tsr.config.json'))).toBe(false);
    expect(await readTextFile(join(root, 'README.md'))).not.toContain('routeTree');
  });
});
