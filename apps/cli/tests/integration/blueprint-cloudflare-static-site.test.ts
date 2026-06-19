import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('Blueprint generation - cloudflare-static-site', () => {
  const projectName = 'static-site';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli([projectName, '--blueprint', 'cloudflare-static-site', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('next.config emits a static export with unoptimized images', async () => {
    const config = await readTextFile(join(projectPath, 'next.config.ts'));
    expect(config).toContain("output: 'export'");
    expect(config).toContain('unoptimized: true');
  });

  test('wrangler.jsonc serves the static export from out/ as Workers assets', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"assets"');
    expect(wrangler).toContain('"directory": "out"');
    expect(wrangler).toContain('"not_found_handling": "404-page"');
  });

  test('deploy script builds then deploys via wrangler', async () => {
    const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.scripts.deploy).toContain('next build');
    expect(pkg.scripts.deploy).toContain('wrangler deploy');
  });

  test('ships the MDX blog with a statically pre-rendered [slug] route', async () => {
    expect(await fileExists(join(projectPath, 'src/app/blog/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'src/lib/blog.ts'))).toBe(true);
    const slugPage = await readTextFile(join(projectPath, 'src/app/blog/[slug]/page.tsx'));
    expect(slugPage).toContain('generateStaticParams');
  });

  test('ships seeded blog content', async () => {
    const files = [
      'contents/blog/getting-started-with-pigeon-logistics.mdx',
      'contents/blog/why-carrier-pigeons-beat-email.mdx',
    ];
    for (const f of files) {
      expect(await fileExists(join(projectPath, f))).toBe(true);
    }
  });

  test('ships SEO metadata routes forced static for the export', async () => {
    const sitemap = await readTextFile(join(projectPath, 'src/app/sitemap.ts'));
    const robots = await readTextFile(join(projectPath, 'src/app/robots.ts'));
    expect(sitemap).toContain("export const dynamic = 'force-static'");
    expect(robots).toContain("export const dynamic = 'force-static'");
  });

  test('carries no server-dependent analytics stack (posthog / c15t)', async () => {
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies['posthog-js']).toBeUndefined();
    expect(pkg.dependencies['@c15t/nextjs']).toBeUndefined();

    expect(await fileExists(join(projectPath, 'src/instrumentation-client.ts'))).toBe(false);

    const providers = await readTextFile(join(projectPath, 'src/components/app-providers.tsx'));
    expect(providers).not.toContain('posthog');
    expect(providers).not.toContain('c15t');

    const layout = await readTextFile(join(projectPath, 'src/app/layout.tsx'));
    expect(layout).not.toContain('posthog');
    expect(layout).not.toContain('c15t');
  });

  test('generates no IaC directory', async () => {
    expect(await fileExists(join(projectPath, 'infra'))).toBe(false);
    expect(await fileExists(join(projectPath, 'sst.config.ts'))).toBe(false);
    expect(await fileExists(join(projectPath, 'main.tf'))).toBe(false);
  });

  test('ships a cloudflare deploy note in docs/agents', async () => {
    expect(await fileExists(join(projectPath, 'docs/agents/cloudflare-deploy.md'))).toBe(true);
    expect(await fileExists(join(projectPath, 'docs/agents/analytics-consent.md'))).toBe(false);
  });

  test('recreate command shows the blueprint flag', async () => {
    const result = await runCli(
      ['static-site-cmd', '--blueprint', 'cloudflare-static-site', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint cloudflare-static-site');
  });
});
