import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface GeneratedApp {
  layout: string;
  devtools: string | null;
  manifest: Manifest;
}

describe('Next.js + tanstack-devtools', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, modules: string): Promise<GeneratedApp> {
    const app = modules ? `${projectName}:nextjs:${modules}` : `${projectName}:nextjs`;
    const result = await runCli([projectName, '--app', app, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    const projectPath = join(tempDir, projectName);
    const devtoolsPath = join(projectPath, 'src/components/devtools.tsx');
    return {
      layout: await readTextFile(join(projectPath, 'src/app/layout.tsx')),
      devtools: (await fileExists(devtoolsPath)) ? await readTextFile(devtoolsPath) : null,
      manifest: await readJsonFile<Manifest>(join(projectPath, 'package.json')),
    };
  }

  describe('with tanstack-devtools only', () => {
    let app: GeneratedApp;

    beforeAll(async () => {
      app = await generate('next-devtools-only', 'tanstack-devtools');
    });

    test('mounts the shell without the query panel, which needs a QueryClient', () => {
      expect(app.devtools).toContain('<TanStackDevtools');
      expect(app.devtools).not.toContain('ReactQueryDevtoolsPanel');
      expect(app.devtools).not.toContain('formDevtoolsPlugin');
    });

    test('does not add the query or form devtools packages', () => {
      expect(app.manifest.devDependencies).toHaveProperty('@tanstack/react-devtools');
      expect(app.manifest.devDependencies).not.toHaveProperty('@tanstack/react-query-devtools');
      expect(app.manifest.devDependencies).not.toHaveProperty('@tanstack/react-form-devtools');
    });

    test('does not import the devtools in the layout, so a production build never bundles them', () => {
      expect(app.layout).not.toContain('@tanstack/react-devtools');
      expect(app.layout).toContain("process.env.NODE_ENV === 'development'");
      expect(app.layout).toContain("await import('@/components/devtools')");
      expect(app.layout).toContain('<Devtools />');
    });

    test('does not connect to a server event bus that Next.js does not run', () => {
      expect(app.devtools).not.toContain('connectToServerBus');
    });
  });

  describe('with tanstack-query', () => {
    let app: GeneratedApp;

    beforeAll(async () => {
      app = await generate('next-devtools-query', 'tanstack-query,tanstack-devtools');
    });

    test('adds the query panel and its package', () => {
      expect(app.devtools).toContain("import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'");
      expect(app.devtools).toContain("{ name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> }");
      expect(app.manifest.devDependencies).toHaveProperty('@tanstack/react-query-devtools');
      expect(app.devtools).not.toContain('formDevtoolsPlugin');
    });

    test('renders the shell inside AppProviders so the panel finds the QueryClient', () => {
      const open = app.layout.indexOf('<AppProviders>');
      const devtools = app.layout.indexOf('<Devtools />');
      const close = app.layout.indexOf('</AppProviders>');
      expect(open).toBeLessThan(devtools);
      expect(devtools).toBeLessThan(close);
    });
  });

  describe('with tanstack-query and tanstack-form', () => {
    let app: GeneratedApp;

    beforeAll(async () => {
      app = await generate('next-devtools-all', 'tanstack-query,tanstack-form,tanstack-devtools');
    });

    test('adds the query and form panels', () => {
      expect(app.devtools).toContain("import { formDevtoolsPlugin } from '@tanstack/react-form-devtools'");
      expect(app.devtools).toContain('formDevtoolsPlugin()');
      expect(app.devtools).toContain('ReactQueryDevtoolsPanel');
    });

    test('declares every devtools package as a dev dependency', () => {
      expect(app.manifest.devDependencies).toMatchObject({
        '@tanstack/react-devtools': expect.any(String),
        '@tanstack/react-query-devtools': expect.any(String),
        '@tanstack/react-form-devtools': expect.any(String),
      });
      expect(app.manifest.dependencies).not.toHaveProperty('@tanstack/react-devtools');
    });
  });

  describe('with tanstack-form but no tanstack-query', () => {
    test('adds the form panel alone', async () => {
      const app = await generate('next-devtools-form', 'tanstack-form,tanstack-devtools');
      expect(app.devtools).toContain('formDevtoolsPlugin()');
      expect(app.devtools).not.toContain('ReactQueryDevtoolsPanel');
      expect(app.manifest.devDependencies).toHaveProperty('@tanstack/react-form-devtools');
      expect(app.manifest.devDependencies).not.toHaveProperty('@tanstack/react-query-devtools');
    });
  });

  describe('without tanstack-devtools', () => {
    test('generates no devtools component and no devtools packages', async () => {
      const app = await generate('next-no-devtools', 'tanstack-query,tanstack-form');
      expect(app.devtools).toBeNull();
      expect(app.layout).not.toContain('Devtools');
      expect(app.manifest.devDependencies ?? {}).not.toHaveProperty('@tanstack/react-query-devtools');
      expect(app.manifest.devDependencies ?? {}).not.toHaveProperty('@tanstack/react-form-devtools');
    });
  });

  describe('in the org-dashboard-nextjs blueprint', () => {
    test('loads the devtools through the shared component instead of importing them in the layout', async () => {
      const result = await runCli(
        ['next-devtools-blueprint', '--blueprint', 'org-dashboard-nextjs', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      const appPath = join(tempDir, 'next-devtools-blueprint', 'apps/web');
      const layout = await readTextFile(join(appPath, 'src/app/layout.tsx'));
      const devtools = await readTextFile(join(appPath, 'src/components/devtools.tsx'));
      expect(layout).not.toContain('@tanstack/react-devtools');
      expect(layout).toContain("await import('@/components/devtools')");
      expect(devtools).toContain('ReactQueryDevtoolsPanel');
      expect(devtools).toContain('formDevtoolsPlugin()');
    });
  });
});
