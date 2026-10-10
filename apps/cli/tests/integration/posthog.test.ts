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

  describe('Single repo: TanStack Start + posthog', () => {
    const projectName = 'test-posthog-start';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:tanstack-start:posthog`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('does not generate the Next.js instrumentation file', async () => {
      expect(await fileExists(join(projectPath, 'src/instrumentation-client.ts'))).toBe(false);
    });

    test('generates the provider with the first-party /ingest host and the VITE_ token', async () => {
      const content = await readTextFile(join(projectPath, 'src/components/analytics-provider.tsx'));
      expect(content).toContain("import { PostHogProvider } from '@posthog/react'");
      expect(content).toContain('import.meta.env.VITE_POSTHOG_PROJECT_TOKEN');
      expect(content).toContain("api_host: '/ingest'");
      expect(content).toContain("ui_host: 'https://us.posthog.com'");
      expect(content).toContain("defaults: '2026-05-30'");
      expect(content).toContain('capture_exceptions: true');
    });

    test('renders the provider in the root route', async () => {
      const content = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(content).toContain("import { AnalyticsProvider } from '../components/analytics-provider'");
      expect(content).toContain('<AnalyticsProvider>');
      expect(content).toContain('</AnalyticsProvider>');
    });

    test('generates the splat /ingest proxy route with the verified proxy rules', async () => {
      const content = await readTextFile(join(projectPath, 'src/routes/ingest/$.ts'));
      expect(content).toContain("createFileRoute('/ingest/$')");
      expect(content).toContain('ANY:');
      expect(content).toContain("'us.i.posthog.com'");
      expect(content).toContain("'us-assets.i.posthog.com'");
      expect(content).toContain("path.startsWith('/static/')");
      expect(content).toContain("path.startsWith('/array/')");
      for (const header of ['cookie', 'authorization', 'accept-encoding']) {
        expect(content).toContain(`headers.delete('${header}')`);
      }
      for (const header of ['content-encoding', 'content-length']) {
        expect(content).toContain(`responseHeaders.delete('${header}')`);
      }
      expect(content).toContain("request.headers.get('cf-connecting-ip') ?? getRequestIP({ xForwardedFor: true })");
      expect(content).toContain('await request.arrayBuffer()');
      expect(content).toContain("redirect: 'manual'");
      expect(content).not.toContain('caches.default');
    });

    test('adds posthog-js and @posthog/react as runtime dependencies', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['posthog-js']).toBeDefined();
      expect(pkg.dependencies['@posthog/react']).toBeDefined();
    });

    test('.env.example declares the VITE_ token only', async () => {
      const content = await readTextFile(join(projectPath, '.env.example'));
      expect(content).toContain('VITE_POSTHOG_PROJECT_TOKEN=');
      expect(content).not.toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN');
    });
  });

  describe('Single repo: TanStack Start + posthog + next-themes on Cloudflare', () => {
    const projectName = 'test-posthog-start-cf';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:tanstack-start:posthog,next-themes`,
          '--deployment',
          'cloudflare',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates the same proxy route under Cloudflare', async () => {
      expect(await fileExists(join(projectPath, 'src/routes/ingest/$.ts'))).toBe(true);
    });

    test('nests the analytics provider inside the theme provider', async () => {
      const content = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      const theme = content.indexOf('<ThemeProvider');
      const analytics = content.indexOf('<AnalyticsProvider>');
      const children = content.indexOf('{children}');
      const analyticsClose = content.indexOf('</AnalyticsProvider>');
      const themeClose = content.indexOf('</ThemeProvider>');
      expect(theme).toBeLessThan(analytics);
      expect(analytics).toBeLessThan(children);
      expect(children).toBeLessThan(analyticsClose);
      expect(analyticsClose).toBeLessThan(themeClose);
    });
  });

  describe('Single repo: TanStack Start without posthog', () => {
    const projectName = 'test-no-posthog-start';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:tanstack-start`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('has no PostHog files nor provider', async () => {
      expect(await fileExists(join(projectPath, 'src/routes/ingest/$.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/components/analytics-provider.tsx'))).toBe(false);
      const content = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(content).not.toContain('Analytics');
    });
  });

  describe('Turborepo: web (nextjs + posthog) + dash (tanstack-start + posthog)', () => {
    const projectName = 'test-posthog-mixed';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:posthog',
          '--app',
          'dash:tanstack-start:posthog',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('scopes each stack files to its own app', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/instrumentation-client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/routes/ingest/$.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/dash/src/instrumentation-client.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/dash/src/routes/ingest/$.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/dash/src/components/analytics-provider.tsx'))).toBe(true);
    });

    test('emits each app the token name of its stack', async () => {
      const web = await readTextFile(join(projectPath, 'apps/web/.env.example'));
      const dash = await readTextFile(join(projectPath, 'apps/dash/.env.example'));
      expect(web).toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=');
      expect(web).not.toContain('VITE_POSTHOG_PROJECT_TOKEN');
      expect(dash).toContain('VITE_POSTHOG_PROJECT_TOKEN=');
      expect(dash).not.toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN');
    });

    test('adds @posthog/react to the Start app only', async () => {
      const web = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/web/package.json'));
      const dash = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps/dash/package.json'));
      expect(web.dependencies['posthog-js']).toBeDefined();
      expect(web.dependencies['@posthog/react']).toBeUndefined();
      expect(dash.dependencies['posthog-js']).toBeDefined();
      expect(dash.dependencies['@posthog/react']).toBeDefined();
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
