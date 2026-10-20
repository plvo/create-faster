import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { removeFrontmatter } from '@/lib/frontmatter';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';
import { evaluateNextConfig } from '../../integration/helpers';

beforeAll(() => {
  setupTemplateEngine();
});

function makeContext(tooling: string[]): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'single',
    apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: [] }],
    project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling },
    git: false,
  };
}

function renderHbs(relativePath: string, ctx: TemplateContext): string {
  const source = join(TEMPLATES_DIR, relativePath);
  const raw = readFileSync(source, 'utf-8');
  const content = removeFrontmatter(raw);
  const enriched = { ...ctx, ...ctx.apps[0] };
  return renderTemplate(content, enriched);
}

const NEXT_CONFIG_TEMPLATE = 'stack/nextjs/next.config.ts.hbs';

describe('next.config.ts.hbs: portless integration', () => {
  test('exposes NEXT_PUBLIC_APP_URL from PORTLESS_URL when portless selected', () => {
    const rendered = renderHbs(NEXT_CONFIG_TEMPLATE, makeContext(['portless']));
    expect(rendered).toContain('NEXT_PUBLIC_APP_URL: process.env.PORTLESS_URL ?? process.env.NEXT_PUBLIC_APP_URL');
  });

  test('omits the env block when portless is not selected', () => {
    const rendered = renderHbs(NEXT_CONFIG_TEMPLATE, makeContext([]));
    expect(rendered).not.toContain('PORTLESS_URL');
    expect(rendered).not.toContain('NEXT_PUBLIC_APP_URL');
  });
});

describe('next.config.ts.hbs: cloudflare integration', () => {
  function makeCloudflareContext(deployment?: string): TemplateContext {
    return {
      projectName: 'my-project',
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: [] }],
      project: { deployment, tooling: [] },
      git: false,
    };
  }

  test('includes initOpenNextCloudflareForDev import when deploying to cloudflare', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare'));
    expect(rendered).toContain('initOpenNextCloudflareForDev');
    expect(rendered).toContain('@opennextjs/cloudflare');
  });

  test('calls initOpenNextCloudflareForDev() at module level', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare'));
    expect(rendered).toContain('initOpenNextCloudflareForDev()');
  });

  test('initialises the OpenNext dev platform only under next dev, not during next build', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare'));
    expect(rendered).toMatch(/if \(process\.env\.NODE_ENV === 'development'\) \{\s+initOpenNextCloudflareForDev\(\);\s+\}/);
  });

  test('keeps the shared D1 persist path inside the development gate', () => {
    const ctx = makeCloudflareContext('cloudflare');
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', {
      ...ctx,
      project: { ...ctx.project, database: 'd1', orm: 'drizzle' },
    });
    expect(rendered).toMatch(
      /if \(process\.env\.NODE_ENV === 'development'\) \{\s+initOpenNextCloudflareForDev\(\{ persist: \{ path: '\.wrangler\/v3' \} \}\);\s+\}/,
    );
  });

  test('does NOT include cloudflare import when not deploying to cloudflare', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext());
    expect(rendered).not.toContain('initOpenNextCloudflareForDev');
    expect(rendered).not.toContain('@opennextjs/cloudflare');
  });

  describe('static export', () => {
    let directory: string;

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'next-config-unit-'));
    });

    afterAll(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    test('exports statically for the build and not under next dev, which would answer an unknown param with a 500', async () => {
      const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare-static'));
      expect((await evaluateNextConfig(rendered, directory, 'production')).output).toBe('export');
      expect((await evaluateNextConfig(rendered, directory, 'development')).output).toBeUndefined();
    });

    test('keeps unoptimized images in both modes', async () => {
      const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare-static'));
      for (const mode of ['production', 'development'] as const) {
        expect((await evaluateNextConfig(rendered, directory, mode)).images?.unoptimized).toBe(true);
      }
    });

    test('tells that next dev does not run the export', () => {
      const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare-static'));
      expect(rendered).toContain('`next build` is the check that the site still exports');
    });
  });

  test('does NOT pull in OpenNext when deploying to cloudflare-static', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare-static'));
    expect(rendered).not.toContain('initOpenNextCloudflareForDev');
    expect(rendered).not.toContain('@opennextjs/cloudflare');
  });

  test('does NOT emit static export config for the OpenNext cloudflare deployment', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare'));
    expect(rendered).not.toMatch(/output:/);
  });
});

describe('next.config.ts.hbs: posthog library', () => {
  function makePosthogContext(libraries: string[]): TemplateContext {
    return {
      projectName: 'my-project',
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries }],
      project: { tooling: [] },
      git: false,
    };
  }

  test('proxies /ingest to PostHog with static and array routes before the catch-all', () => {
    const rendered = renderHbs(NEXT_CONFIG_TEMPLATE, makePosthogContext(['posthog']));
    const staticRoute = rendered.indexOf("source: '/ingest/static/:path*'");
    const arrayRoute = rendered.indexOf("source: '/ingest/array/:path*'");
    const catchAllRoute = rendered.indexOf("source: '/ingest/:path*'");

    expect(staticRoute).toBeGreaterThan(-1);
    expect(arrayRoute).toBeGreaterThan(-1);
    expect(catchAllRoute).toBeGreaterThan(Math.max(staticRoute, arrayRoute));
    expect(rendered).toContain("destination: 'https://us-assets.i.posthog.com/static/:path*'");
    expect(rendered).toContain("destination: 'https://us-assets.i.posthog.com/array/:path*'");
    expect(rendered).toContain("destination: 'https://us.i.posthog.com/:path*'");
  });

  test('keeps trailing slashes so PostHog endpoints like /e/ are not redirected', () => {
    const rendered = renderHbs(NEXT_CONFIG_TEMPLATE, makePosthogContext(['posthog']));
    expect(rendered).toContain('skipTrailingSlashRedirect: true');
  });

  test('omits the PostHog proxy when the library is not selected', () => {
    const rendered = renderHbs(NEXT_CONFIG_TEMPLATE, makePosthogContext([]));
    expect(rendered).not.toContain('rewrites()');
    expect(rendered).not.toContain('posthog');
    expect(rendered).not.toContain('skipTrailingSlashRedirect');
  });
});

describe('proxy.ts.hbs: posthog library', () => {
  function makeProxyContext(libraries: string[]): TemplateContext {
    return {
      projectName: 'my-project',
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries }],
      project: { tooling: [] },
      git: false,
    };
  }

  test('excludes the /ingest proxy path from the matcher', () => {
    const rendered = renderHbs('stack/nextjs/src/proxy.ts.hbs', makeProxyContext(['posthog']));
    expect(rendered).toContain("'/((?!api|ingest|_next/static|");
  });

  test('keeps the default matcher without the library', () => {
    const rendered = renderHbs('stack/nextjs/src/proxy.ts.hbs', makeProxyContext([]));
    expect(rendered).toContain("'/((?!api|_next/static|");
    expect(rendered).not.toContain('ingest');
  });
});
