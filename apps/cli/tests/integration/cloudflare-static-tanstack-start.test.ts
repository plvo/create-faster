import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('TanStack Start + cloudflare-static', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('single repo, shadcn + evlog', () => {
    const projectName = 'start-static';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:tanstack-start:shadcn,evlog`,
          '--deployment',
          'cloudflare-static',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('vite config prerenders the linked pages with Start alone, no nitro nor cloudflare plugin', async () => {
      const config = await readTextFile(join(projectPath, 'vite.config.ts'));
      expect(config).toContain(
        'tanstackStart({ prerender: { enabled: true, crawlLinks: true, autoSubfolderIndex: false } })',
      );
      expect(config).not.toContain('nitro');
      expect(config).not.toContain('@cloudflare/vite-plugin');
    });

    test('wrangler.jsonc is assets-only and serves dist/client with a 404 page', async () => {
      const content = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(content).toContain(`"name": "${projectName}"`);
      expect(content).toContain('"directory": "dist/client"');
      expect(content).toContain('"not_found_handling": "404-page"');
      expect(content).not.toContain('"main"');
    });

    test('generates the /404 route and wires the same component as the root notFoundComponent', async () => {
      const route = await readTextFile(join(projectPath, 'src/routes/404.tsx'));
      expect(route).toContain("createFileRoute('/404')");
      expect(route).toContain("from '@/components/not-found'");
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).toContain("import { NotFound } from '@/components/not-found'");
      expect(root).toContain('notFoundComponent: NotFound');
      expect(await fileExists(join(projectPath, 'src/components/not-found.tsx'))).toBe(true);
    });

    test('omits the nitro and worker runtime files', async () => {
      expect(await fileExists(join(projectPath, '.env.start'))).toBe(false);
      expect(await fileExists(join(projectPath, 'nitro.config.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/server.ts'))).toBe(false);
    });

    test('package.json drops nitro and start, deploys through wrangler', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.devDependencies.nitro).toBeUndefined();
      expect(pkg.devDependencies['@cloudflare/vite-plugin']).toBeUndefined();
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
      expect(pkg.scripts.start).toBeUndefined();
      expect(pkg.scripts.deploy).toBe('vite build && wrangler deploy');
      expect(pkg.scripts.preview).toBe('wrangler dev');
    });
  });

  describe('turborepo: web (nextjs) + docs (tanstack-start)', () => {
    const projectName = 'start-static-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'docs:tanstack-start',
          '--deployment',
          'cloudflare-static',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('each app gets its own assets-only wrangler.jsonc with its own output directory', async () => {
      const web = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
      expect(web).toContain('"name": "web"');
      expect(web).toContain('"directory": "out"');
      const docs = await readTextFile(join(projectPath, 'apps/docs/wrangler.jsonc'));
      expect(docs).toContain('"name": "docs"');
      expect(docs).toContain('"directory": "dist/client"');
      expect(docs).not.toContain('"main"');
    });

    test('the start app is prerendered and the nextjs app keeps its static export', async () => {
      const docsConfig = await readTextFile(join(projectPath, 'apps/docs/vite.config.ts'));
      expect(docsConfig).toContain('prerender: { enabled: true');
      expect(docsConfig).toContain('port: 3001');
      const webConfig = await readTextFile(join(projectPath, 'apps/web/next.config.ts'));
      expect(webConfig).toContain("output: 'export'");
      expect(await fileExists(join(projectPath, 'apps/docs/src/routes/404.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/routes/404.tsx'))).toBe(false);
    });

    test('docs app scripts follow the static flow', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/docs/package.json'));
      expect(pkg.scripts.deploy).toBe('vite build && wrangler deploy');
      expect(pkg.scripts.start).toBeUndefined();
      expect(pkg.devDependencies.nitro).toBeUndefined();
    });
  });
});
