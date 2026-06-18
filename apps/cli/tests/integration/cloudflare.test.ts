import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('Cloudflare deployment platform', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: Hono + cloudflare', () => {
    const projectName = 'test-cloudflare-hono';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'api:hono', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates wrangler.jsonc named after the project (Workers, not open-next)', async () => {
      expect(await fileExists(join(projectPath, 'wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(content).toContain(`"name": "${projectName}"`);
      expect(content).toContain('"main": "src/index.ts"');
      expect(content).toContain('"compatibility_date"');
      expect(content).toContain('"nodejs_compat"');
    });

    test('does not generate open-next.config.ts', async () => {
      expect(await fileExists(join(projectPath, 'open-next.config.ts'))).toBe(false);
    });

    test('package.json has wrangler scripts and devDependency, no opennext', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.scripts.deploy).toBe('wrangler deploy');
      expect(pkg.scripts.preview).toBe('wrangler dev');
      expect(pkg.scripts['cf-typegen']).toBe('wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts');
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
      expect(pkg.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
    });

    test('gitignore covers wrangler local files but not open-next', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.wrangler/');
      expect(content).toContain('cloudflare-env.d.ts');
      expect(content).not.toContain('.open-next/');
    });

    test('src/index.ts exports the app as default', async () => {
      const content = await readTextFile(join(projectPath, 'src/index.ts'));
      expect(content).toContain('export default app');
      expect(content).not.toContain('aws-lambda');
    });
  });

  describe('Single repo: Next.js + cloudflare', () => {
    const projectName = 'test-cloudflare-nextjs';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:nextjs`,
          '--deployment',
          'cloudflare',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates wrangler.jsonc with open-next main and assets binding', async () => {
      expect(await fileExists(join(projectPath, 'wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(content).toContain(`"name": "${projectName}"`);
      expect(content).toContain('"main": ".open-next/worker.js"');
      expect(content).toContain('"compatibility_date"');
      expect(content).toContain('"nodejs_compat"');
      expect(content).toContain('"ASSETS"');
      expect(content).toContain('.open-next/assets');
    });

    test('generates open-next.config.ts', async () => {
      expect(await fileExists(join(projectPath, 'open-next.config.ts'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'open-next.config.ts'));
      expect(content).toContain('defineCloudflareConfig');
      expect(content).toContain('@opennextjs/cloudflare');
    });

    test('next.config.ts includes initOpenNextCloudflareForDev', async () => {
      expect(await fileExists(join(projectPath, 'next.config.ts'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'next.config.ts'));
      expect(content).toContain('initOpenNextCloudflareForDev');
      expect(content).toContain('@opennextjs/cloudflare');
    });

    test('generates src/middleware.ts (Edge runtime) instead of proxy.ts, which OpenNext rejects', async () => {
      expect(await fileExists(join(projectPath, 'src/middleware.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/proxy.ts'))).toBe(false);
      const content = await readTextFile(join(projectPath, 'src/middleware.ts'));
      expect(content).toContain('export default async function middleware');
      expect(content).toContain('NextResponse.next()');
      expect(content).toContain('matcher');
    });

    test('package.json has opennext scripts and dependency', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.scripts['build:cf']).toContain('opennextjs-cloudflare');
      expect(pkg.scripts.preview).toContain('opennextjs-cloudflare');
      expect(pkg.scripts.deploy).toContain('opennextjs-cloudflare');
      expect(pkg.scripts['cf:typegen']).toBe('wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts');
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
      expect(pkg.dependencies['@opennextjs/cloudflare']).toBeDefined();
    });

    test('gitignore covers open-next and wrangler artifacts', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.open-next/');
      expect(content).toContain('.wrangler/');
      expect(content).toContain('.prod.env');
      expect(content).toContain('cloudflare-env.d.ts');
    });
  });

  describe('Turborepo: web (nextjs) + api (hono) with cloudflare', () => {
    const projectName = 'test-cloudflare-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'api:hono',
          '--deployment',
          'cloudflare',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('web app gets open-next wrangler.jsonc', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
      expect(content).toContain('"name": "web"');
      expect(content).toContain('"main": ".open-next/worker.js"');
    });

    test('web app has open-next.config.ts and opennext deps/scripts', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/open-next.config.ts'))).toBe(true);
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/web/package.json'));
      expect(pkg.scripts['build:cf']).toContain('opennextjs-cloudflare');
      expect(pkg.scripts.deploy).toContain('opennextjs-cloudflare');
      expect(pkg.dependencies['@opennextjs/cloudflare']).toBeDefined();
    });

    test('web app emits src/middleware.ts, not proxy.ts', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/middleware.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/proxy.ts'))).toBe(false);
      const content = await readTextFile(join(projectPath, 'apps/web/src/middleware.ts'));
      expect(content).toContain('export default async function middleware');
    });

    test('api app gets Workers wrangler.jsonc', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'apps/api/wrangler.jsonc'));
      expect(content).toContain('"name": "api"');
      expect(content).toContain('"main": "src/index.ts"');
    });

    test('api app has wrangler scripts, no opennext', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/api/package.json'));
      expect(pkg.scripts.deploy).toBe('wrangler deploy');
      expect(pkg.scripts.preview).toBe('wrangler dev');
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
      expect(pkg.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
    });

    test('api app does NOT get open-next.config.ts', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/open-next.config.ts'))).toBe(false);
    });

    test('root gitignore covers wrangler and open-next (a nextjs app uses cloudflare)', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.wrangler/');
      expect(content).toContain('cloudflare-env.d.ts');
      expect(content).toContain('.open-next/');
      expect(content).toContain('.prod.env');
    });
  });

  describe('Turborepo: hono-only with cloudflare omits open-next from gitignore', () => {
    const projectName = 'test-cloudflare-hono-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'api:hono',
          '--app',
          'worker:hono',
          '--deployment',
          'cloudflare',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('both hono apps get Workers wrangler.jsonc', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/wrangler.jsonc'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/worker/wrangler.jsonc'))).toBe(true);
    });

    test('root gitignore omits open-next artifacts when no nextjs app exists', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.wrangler/');
      expect(content).not.toContain('.open-next/');
      expect(content).not.toContain('.prod.env');
    });
  });

  describe('Next.js + cloudflare: middleware.ts preserves better-auth and evlog features', () => {
    const projectName = 'test-cloudflare-mw-features';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:nextjs:better-auth,evlog`,
          '--database',
          'sqlite',
          '--orm',
          'drizzle',
          '--deployment',
          'cloudflare',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('middleware.ts keeps better-auth session check and evlog wiring', async () => {
      expect(await fileExists(join(projectPath, 'src/middleware.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/proxy.ts'))).toBe(false);
      const content = await readTextFile(join(projectPath, 'src/middleware.ts'));
      expect(content).toContain('export default async function middleware');
      expect(content).toContain('auth.api.getSession');
      expect(content).toContain('evlogMiddleware');
      expect(content).toContain('MIDDLEWARE');
      expect(content).not.toContain('PROXY');
    });
  });

  describe('Regression: sst deployment still works', () => {
    const projectName = 'test-sst';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'api:hono', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates sst.config.ts and sst gitignore entry', async () => {
      expect(await fileExists(join(projectPath, 'sst.config.ts'))).toBe(true);
      const gitignore = await readTextFile(join(projectPath, '.gitignore'));
      expect(gitignore).toContain('.sst/');
    });

    test('does not generate cloudflare artifacts', async () => {
      expect(await fileExists(join(projectPath, 'wrangler.jsonc'))).toBe(false);
    });
  });
});
