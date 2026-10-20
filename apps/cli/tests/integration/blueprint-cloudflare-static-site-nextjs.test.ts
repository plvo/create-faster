import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, evaluateNextConfig, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('Blueprint generation - cloudflare-static-site-nextjs', () => {
  const projectName = 'static-site';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli([projectName, '--blueprint', 'cloudflare-static-site-nextjs', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('next.config emits a static export with unoptimized images', async () => {
    const config = await evaluateNextConfig(await readTextFile(join(projectPath, 'next.config.ts')), tempDir, 'production');
    expect(config.output).toBe('export');
    expect(config.images?.unoptimized).toBe(true);
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

  test('the first deploy learns the production URL, then builds and deploys with it', async () => {
    const notes = await readTextFile(join(projectPath, 'docs/agents/cloudflare-deploy.md'));
    const productionUrl = `https://${projectName}.<subdomain>.workers.dev`;
    let from = 0;
    for (const marker of [
      '### Production URL',
      'npx wrangler whoami',
      'WRANGLER_HIDE_BANNER=true npx wrangler auth token',
      'https://api.cloudflare.com/client/v4/accounts/<account id>/workers/subdomain',
      productionUrl,
      'export NEXT_PUBLIC_APP_URL=<the URL>',
      'npm run deploy',
    ]) {
      const at = notes.indexOf(marker, from);
      expect(at, `"${marker}" after offset ${from}`).toBeGreaterThanOrEqual(0);
      from = at + marker.length;
    }
    expect(notes).toContain('sitemap');
    expect(notes).toContain('canonical');
  });

  test('every note that names the static export says that next build is its check', async () => {
    for (const file of ['AGENTS.md', 'README.md', 'docs/agents/cloudflare-deploy.md']) {
      expect(await readTextFile(join(projectPath, file)), file).toContain(
        '`next build` is the check that the site still exports',
      );
    }
  });

  test('the README points to the deploy notes for the production URL', async () => {
    const readme = await readTextFile(join(projectPath, 'README.md'));
    expect(readme).toContain('Give the build your production URL');
    expect(readme).toContain('docs/agents/cloudflare-deploy.md');
  });

  test('recreate command shows the blueprint flag', async () => {
    const result = await runCli(
      ['static-site-cmd', '--blueprint', 'cloudflare-static-site-nextjs', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint cloudflare-static-site-nextjs');
  });
});
