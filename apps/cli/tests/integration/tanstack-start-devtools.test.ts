import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('TanStack Start + tanstack-devtools', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, modules: string): Promise<string> {
    const app = modules ? `${projectName}:tanstack-start:${modules}` : `${projectName}:tanstack-start`;
    const result = await runCli([projectName, '--app', app, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  describe('with tanstack-query and tanstack-form', () => {
    let rootRoute: string;
    let viteConfig: string;
    let manifest: Manifest;

    beforeAll(async () => {
      const projectPath = await generate('start-devtools-all', 'tanstack-query,tanstack-form,tanstack-devtools');
      rootRoute = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      viteConfig = await readTextFile(join(projectPath, 'vite.config.ts'));
      manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    });

    test('mounts the devtools shell with the router, query and form panels', () => {
      expect(rootRoute).toContain("import { TanStackDevtools } from '@tanstack/react-devtools'");
      expect(rootRoute).toContain("import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'");
      expect(rootRoute).toContain("import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'");
      expect(rootRoute).toContain("import { formDevtoolsPlugin } from '@tanstack/react-form-devtools'");
      expect(rootRoute).toContain('<TanStackDevtools');
      expect(rootRoute).toContain("{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }");
      expect(rootRoute).toContain("{ name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> }");
      expect(rootRoute).toContain('formDevtoolsPlugin()');
    });

    test('replaces the standalone router devtools so the router panel is not rendered twice', () => {
      expect(rootRoute).not.toContain('<TanStackRouterDevtools ');
      expect(rootRoute).not.toMatch(/import \{ TanStackRouterDevtools \}/);
    });

    test('renders the shell after the page content and before the scripts', () => {
      const children = rootRoute.indexOf('{children}');
      const devtools = rootRoute.indexOf('<TanStackDevtools');
      const scripts = rootRoute.indexOf('<Scripts />');
      expect(children).toBeLessThan(devtools);
      expect(devtools).toBeLessThan(scripts);
    });

    test('registers the devtools vite plugin first so production builds drop the devtools', () => {
      expect(viteConfig).toContain("import { devtools } from '@tanstack/devtools-vite'");
      expect(viteConfig).toMatch(/plugins: \[\n\s+devtools\(\),\n\s+tailwindcss\(\),/);
    });

    test('declares every devtools package as a dev dependency', () => {
      expect(manifest.devDependencies).toMatchObject({
        '@tanstack/react-devtools': expect.any(String),
        '@tanstack/devtools-vite': expect.any(String),
        '@tanstack/react-router-devtools': expect.any(String),
        '@tanstack/react-query-devtools': expect.any(String),
        '@tanstack/react-form-devtools': expect.any(String),
      });
      expect(manifest.dependencies).not.toHaveProperty('@tanstack/react-devtools');
    });
  });

  describe('with tanstack-devtools only', () => {
    let rootRoute: string;
    let manifest: Manifest;

    beforeAll(async () => {
      const projectPath = await generate('start-devtools-only', 'tanstack-devtools');
      rootRoute = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    });

    test('mounts the shell with the router panel alone', () => {
      expect(rootRoute).toContain("{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }");
      expect(rootRoute).not.toContain('ReactQueryDevtoolsPanel');
      expect(rootRoute).not.toContain('formDevtoolsPlugin');
    });

    test('does not add the form devtools package', () => {
      expect(manifest.devDependencies).not.toHaveProperty('@tanstack/react-form-devtools');
    });
  });

  describe('without tanstack-devtools', () => {
    let rootRoute: string;
    let viteConfig: string;
    let manifest: Manifest;

    beforeAll(async () => {
      const projectPath = await generate('start-no-devtools', 'tanstack-query,tanstack-form');
      rootRoute = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      viteConfig = await readTextFile(join(projectPath, 'vite.config.ts'));
      manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    });

    test('keeps the standalone router devtools', () => {
      expect(rootRoute).toContain("import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'");
      expect(rootRoute).toContain('<TanStackRouterDevtools position="bottom-right" />');
      expect(rootRoute).not.toContain('<TanStackDevtools');
    });

    test('does not touch the vite config or the unified devtools packages', () => {
      expect(viteConfig).not.toContain('devtools');
      expect(manifest.devDependencies).not.toHaveProperty('@tanstack/react-devtools');
      expect(manifest.devDependencies).not.toHaveProperty('@tanstack/devtools-vite');
      expect(manifest.devDependencies).not.toHaveProperty('@tanstack/react-form-devtools');
    });
  });
});
