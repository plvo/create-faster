import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('Cloudflare Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Deploy library exclusion', () => {
    test('aws-lambda and cloudflare on the same app are rejected', async () => {
      const result = await runCli(
        ['test-conflict', '--app', 'api:hono:aws-lambda,cloudflare', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Deploy libraries are mutually exclusive');
      expect(result.stderr).toContain('aws-lambda');
      expect(result.stderr).toContain('cloudflare');
    });

    test('aws-lambda and cloudflare on different apps are accepted', async () => {
      const result = await runCli(
        [
          'test-split-deploy',
          '--app',
          'api:hono:cloudflare',
          '--app',
          'lambda:hono:aws-lambda',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Single repo: Hono + cloudflare', () => {
    const projectName = 'test-cloudflare-hono';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'api:hono:cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates wrangler.jsonc named after the project', async () => {
      expect(await fileExists(join(projectPath, 'wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(content).toContain(`"name": "${projectName}"`);
      expect(content).toContain('"main": "src/index.ts"');
      expect(content).toContain('"compatibility_date"');
      expect(content).toContain('"nodejs_compat"');
    });

    test('package.json has wrangler scripts and devDependency', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.scripts.deploy).toBe('wrangler deploy');
      expect(pkg.scripts.preview).toBe('wrangler dev');
      expect(pkg.scripts['cf-typegen']).toBe('wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts');
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
    });

    test('generates .dev.vars.example', async () => {
      expect(await fileExists(join(projectPath, '.dev.vars.example'))).toBe(true);
      const content = await readTextFile(join(projectPath, '.dev.vars.example'));
      expect(content).toContain('.dev.vars');
    });

    test('gitignore covers wrangler local files', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.dev.vars');
      expect(content).toContain('.wrangler/');
      expect(content).toContain('cloudflare-env.d.ts');
    });

    test('src/index.ts exports the app as default', async () => {
      const content = await readTextFile(join(projectPath, 'src/index.ts'));
      expect(content).toContain('export default app');
      expect(content).not.toContain('aws-lambda');
    });
  });

  describe('Turborepo: Hono + cloudflare', () => {
    const projectName = 'test-cloudflare-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'api:hono:cloudflare', '--app', 'web:nextjs', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates wrangler.jsonc under apps/api named after the app', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/wrangler.jsonc'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'apps/api/wrangler.jsonc'));
      expect(content).toContain('"name": "api"');
    });

    test('app package.json has wrangler scripts and devDependency', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/api/package.json'));
      expect(pkg.scripts.deploy).toBe('wrangler deploy');
      expect(pkg.scripts.preview).toBe('wrangler dev');
      expect(pkg.devDependencies.wrangler).toMatch(/^\^4/);
    });

    test('generates .dev.vars.example under apps/api only', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/.dev.vars.example'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/.dev.vars.example'))).toBe(false);
      expect(await fileExists(join(projectPath, '.dev.vars.example'))).toBe(false);
    });

    test('other apps do not get wrangler config', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/wrangler.jsonc'))).toBe(false);
    });

    test('root gitignore covers wrangler local files', async () => {
      const content = await readTextFile(join(projectPath, '.gitignore'));
      expect(content).toContain('.dev.vars');
      expect(content).toContain('.wrangler/');
      expect(content).toContain('cloudflare-env.d.ts');
    });
  });
});
