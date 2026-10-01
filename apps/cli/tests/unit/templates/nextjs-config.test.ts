import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { removeFrontmatter } from '@/lib/frontmatter';
import { renderTemplate, registerHandlebarsHelpers } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  registerHandlebarsHelpers();
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

  test('does NOT include cloudflare import when not deploying to cloudflare', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext());
    expect(rendered).not.toContain('initOpenNextCloudflareForDev');
    expect(rendered).not.toContain('@opennextjs/cloudflare');
  });

  test('emits static export config when deploying to cloudflare-static', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare-static'));
    expect(rendered).toContain("output: 'export'");
    expect(rendered).toContain('unoptimized: true');
  });

  test('does NOT pull in OpenNext when deploying to cloudflare-static', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare-static'));
    expect(rendered).not.toContain('initOpenNextCloudflareForDev');
    expect(rendered).not.toContain('@opennextjs/cloudflare');
  });

  test('does NOT emit static export config for the OpenNext cloudflare deployment', () => {
    const rendered = renderHbs('stack/nextjs/next.config.ts.hbs', makeCloudflareContext('cloudflare'));
    expect(rendered).not.toContain("output: 'export'");
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
