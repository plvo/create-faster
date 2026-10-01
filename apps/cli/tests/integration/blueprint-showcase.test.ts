import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

describe('Blueprint generation - showcase', () => {
  const projectName = 'showcase';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli([projectName, '--blueprint', 'showcase', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('composes PostHog as a library instead of blueprint extras', () => {
    const bp = META.blueprints.showcase;
    expect(bp?.context.apps[0]?.libraries).toContain('posthog');
    expect(bp?.packageJson?.dependencies).not.toHaveProperty('posthog-js');
    expect(bp?.envs?.some((env) => env.value.includes('POSTHOG'))).toBe(false);
  });

  test('next.config comes from the Next.js stack with the PostHog proxy', async () => {
    const config = await readTextFile(join(projectPath, 'next.config.ts'));
    expect(config).toContain("source: '/ingest/static/:path*'");
    expect(config).toContain("source: '/ingest/array/:path*'");
    expect(config).toContain("source: '/ingest/:path*'");
    expect(config).toContain('skipTrailingSlashRedirect: true');
  });

  test('PostHog neither captures nor persists until consent is granted', async () => {
    const content = await readTextFile(join(projectPath, 'src/instrumentation-client.ts'));
    expect(content).toContain("api_host: '/ingest'");
    expect(content).toContain('opt_out_capturing_by_default: true');
    expect(content).toContain('opt_out_persistence_by_default: true');
  });

  test('consent UI uses the c15t v2 components and provider callbacks', async () => {
    const providers = await readTextFile(join(projectPath, 'src/components/app-providers.tsx'));
    expect(providers).toContain("from '@c15t/nextjs'");
    expect(providers).toContain('<ConsentBanner />');
    expect(providers).toContain('<ConsentDialog />');
    expect(providers).toContain('onConsentSet');
    expect(providers).not.toContain('@c15t/nextjs/client');
    expect(providers).not.toContain('ClientSideOptionsProvider');
    expect(providers).not.toContain('CookieBanner');
  });

  test('layout loads the c15t stylesheet after the global styles', async () => {
    const layout = await readTextFile(join(projectPath, 'src/app/layout.tsx'));
    const globals = layout.indexOf("import '@/styles/globals.css'");
    const c15t = layout.indexOf("import '@c15t/nextjs/styles.css'");
    expect(globals).toBeGreaterThan(-1);
    expect(c15t).toBeGreaterThan(globals);
  });

  test('package.json has c15t v2 and posthog-js from the library', async () => {
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies['@c15t/nextjs']).toMatch(/^\^2\./);
    expect(pkg.dependencies['posthog-js']).toMatch(/^\^1\.435/);
  });

  test('.env.example has the PostHog token and the site URL', async () => {
    const env = await readTextFile(join(projectPath, '.env.example'));
    expect(env).toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=');
    expect(env).toContain('NEXT_PUBLIC_SITE_URL=');
    expect(env).not.toContain('NEXT_PUBLIC_POSTHOG_KEY');
  });

  test('agent docs describe the token env var', async () => {
    const doc = await readTextFile(join(projectPath, 'docs/agents/analytics-consent.md'));
    expect(doc).toContain('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN');
    expect(doc).toContain('opt_out_capturing_by_default');
    expect(doc).not.toContain('NEXT_PUBLIC_POSTHOG_KEY');
  });
});
