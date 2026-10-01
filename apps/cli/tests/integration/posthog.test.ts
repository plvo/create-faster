import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('PostHog Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: Next.js + posthog', () => {
    const projectName = 'test-posthog-nextjs';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:posthog`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('initializes PostHog client-side through the first-party /ingest proxy', async () => {
      const content = await readTextFile(join(projectPath, 'src/instrumentation-client.ts'));
      expect(content).toContain("import posthog from 'posthog-js'");
      expect(content).toContain('process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN');
      expect(content).toContain("api_host: '/ingest'");
      expect(content).toContain("ui_host: 'https://us.posthog.com'");
      expect(content).toContain("defaults: '2026-05-30'");
      expect(content).not.toContain('opt_out_capturing_by_default');
    });

    test('next.config.ts proxies /ingest to PostHog', async () => {
      const content = await readTextFile(join(projectPath, 'next.config.ts'));
      expect(content).toContain("source: '/ingest/:path*'");
      expect(content).toContain('skipTrailingSlashRedirect: true');
    });

    test('proxy.ts matcher skips the /ingest path', async () => {
      const content = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(content).toContain('ingest');
    });

    test('package.json has posthog-js as a runtime dependency', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['posthog-js']).toMatch(/^\^1\.435/);
      expect(pkg.devDependencies?.['posthog-js']).toBeUndefined();
    });

    test('.env.example declares the PostHog project token', async () => {
      const content = await readTextFile(join(projectPath, '.env.example'));
      expect(content).toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=');
    });
  });

  describe('Single repo: Next.js without posthog', () => {
    const projectName = 'test-no-posthog';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli([projectName, '--app', `${projectName}:nextjs`, '--no-git', '--no-install'], tempDir);
      expect(result.exitCode).toBe(0);
    });

    test('does not generate instrumentation-client.ts', async () => {
      expect(await fileExists(join(projectPath, 'src/instrumentation-client.ts'))).toBe(false);
    });

    test('next.config.ts has no PostHog proxy', async () => {
      const content = await readTextFile(join(projectPath, 'next.config.ts'));
      expect(content).not.toContain('posthog');
    });
  });

  describe('Turborepo: web (nextjs + posthog) + api (hono)', () => {
    const projectName = 'test-posthog-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'web:nextjs:posthog', '--app', 'api:hono', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('scopes the PostHog files to the web app', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/instrumentation-client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/api/src/instrumentation-client.ts'))).toBe(false);
      const config = await readTextFile(join(projectPath, 'apps/web/next.config.ts'));
      expect(config).toContain("source: '/ingest/:path*'");
    });

    test('adds posthog-js and the token env only to the web app', async () => {
      const webPkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/web/package.json'));
      const apiPkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/api/package.json'));
      expect(webPkg.dependencies['posthog-js']).toBeDefined();
      expect(apiPkg.dependencies?.['posthog-js']).toBeUndefined();
      const env = await readTextFile(join(projectPath, 'apps/web/.env.example'));
      expect(env).toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=');
    });
  });

  test('cloudflare-static rejects posthog (the /ingest proxy needs a server runtime)', async () => {
    const result = await runCli(
      [
        'test-cf-static-posthog',
        '--app',
        'web:nextjs:posthog',
        '--deployment',
        'cloudflare-static',
        '--no-git',
        '--no-install',
      ],
      tempDir,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('posthog');
  });
});
