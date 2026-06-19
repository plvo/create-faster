import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('Cloudflare static deployment platform', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: Next.js + cloudflare-static', () => {
    const projectName = 'test-cf-static';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:nextjs:shadcn,mdx`,
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

    test('generates an assets-only wrangler.jsonc (out dir, no main, no Pages output)', async () => {
      expect(await fileExists(join(projectPath, 'wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(content).toContain(`"name": "${projectName}"`);
      expect(content).toContain('"compatibility_date"');
      expect(content).toContain('"directory": "out"');
      expect(content).toContain('"not_found_handling": "404-page"');
      expect(content).not.toContain('"main"');
      expect(content).not.toContain('pages_build_output_dir');
    });

    test('does not generate open-next.config.ts', async () => {
      expect(await fileExists(join(projectPath, 'open-next.config.ts'))).toBe(false);
    });

    test('next.config.ts has static export and unoptimized images', async () => {
      const content = await readTextFile(join(projectPath, 'next.config.ts'));
      expect(content).toContain("output: 'export'");
      expect(content).toContain('unoptimized: true');
      expect(content).not.toContain('initOpenNextCloudflareForDev');
    });

    test('omits the proxy.ts/middleware.ts interceptor (unsupported by static export)', async () => {
      expect(await fileExists(join(projectPath, 'src/proxy.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/middleware.ts'))).toBe(false);
    });

    test('package.json has static deploy script and wrangler, no opennext', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.scripts.deploy).toBe('next build && wrangler deploy');
      expect(pkg.scripts.preview).toBe('wrangler dev');
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
      expect(pkg.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
      expect(pkg.scripts['build:cf']).toBeUndefined();
    });

    test('gitignore covers wrangler artifacts but not open-next', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.wrangler/');
      expect(content).toContain('cloudflare-env.d.ts');
      expect(content).not.toContain('.open-next/');
    });
  });

  describe('Turborepo: web (nextjs) + cloudflare-static', () => {
    const projectName = 'test-cf-static-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'docs:nextjs',
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

    test('web app gets an assets-only wrangler.jsonc', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
      expect(content).toContain('"name": "web"');
      expect(content).toContain('"directory": "out"');
      expect(content).not.toContain('"main"');
    });

    test('web app next.config.ts uses static export', async () => {
      const content = await readTextFile(join(projectPath, 'apps/web/next.config.ts'));
      expect(content).toContain("output: 'export'");
    });

    test('web app omits proxy.ts', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/proxy.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/web/src/middleware.ts'))).toBe(false);
    });
  });

  describe('cloudflare-static rejects projects with no nextjs app', () => {
    test('hono-only project is rejected with a clear message', async () => {
      const result = await runCli(
        ['test-cf-static-no-next', '--app', 'api:hono', '--deployment', 'cloudflare-static', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('cloudflare-static');
      expect(result.stderr.toLowerCase()).toContain('next');
    });
  });

  describe('cloudflare-static rejects server-dependent libraries', () => {
    test('better-auth on a nextjs app is rejected', async () => {
      const result = await runCli(
        [
          'test-cf-static-ba',
          '--app',
          'web:nextjs:better-auth',
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--deployment',
          'cloudflare-static',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('better-auth');
    });

    test('trpc on a nextjs app is rejected', async () => {
      const result = await runCli(
        [
          'test-cf-static-trpc',
          '--app',
          'web:nextjs:trpc',
          '--deployment',
          'cloudflare-static',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('trpc');
    });
  });
});
