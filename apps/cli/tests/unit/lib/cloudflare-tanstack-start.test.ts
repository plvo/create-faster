import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

const destinations = (ctx: TemplateContext) => getAllTemplatesForContext(ctx).map((t) => t.destination);

const singleCtx = (deployment?: 'cloudflare' | 'sst'): TemplateContext => ({
  projectName: 'site',
  repo: 'single',
  apps: [{ appName: 'site', stackName: 'tanstack-start', libraries: [] }],
  project: { deployment, tooling: [] },
  git: false,
});

describe('cloudflare deployment: tanstack-start package.json', () => {
  test('cloudflare declares a tanstack-start stack package.json', () => {
    expect(META.project.deployment.options.cloudflare?.stackPackageJson?.['tanstack-start']).toBeDefined();
  });

  test('drops nitro and the nitro start script, adds the cloudflare vite plugin and deploy scripts', () => {
    const ctx = singleCtx('cloudflare');
    const { content } = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(content.devDependencies?.nitro).toBeUndefined();
    expect(content.scripts?.start).toBeUndefined();
    expect(content.devDependencies?.['@cloudflare/vite-plugin']).toBeDefined();
    expect(content.devDependencies?.wrangler).toMatch(/^\^4/);
    expect(content.scripts?.deploy).toBe('vite build && wrangler deploy');
    expect(content.scripts?.preview).toStartWith('vite preview');
    expect(content.scripts?.['cf-typegen']).toBe('wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts');
  });

  test.each([undefined, 'sst'] as const)('keeps nitro and its start script when the deployment is %p', (deployment) => {
    const ctx = singleCtx(deployment);
    const { content } = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(content.devDependencies?.nitro).toBeDefined();
    expect(content.scripts?.start).toBe('node --env-file=.env.start .output/server/index.mjs');
    expect(content.devDependencies?.['@cloudflare/vite-plugin']).toBeUndefined();
  });
});

describe('cloudflare deployment: tanstack-start generated paths', () => {
  test('single repo emits wrangler.jsonc and no .env.start', () => {
    const dests = destinations(singleCtx('cloudflare'));
    expect(dests).toContain('wrangler.jsonc');
    expect(dests).not.toContain('.env.start');
  });

  test('evlog nitro.config.ts is not emitted: the app has no nitro dependency', () => {
    const ctx = singleCtx('cloudflare');
    ctx.apps[0]!.libraries = ['evlog'];
    expect(destinations(ctx)).not.toContain('nitro.config.ts');
  });

  test('without cloudflare the app keeps .env.start and gets no wrangler.jsonc', () => {
    const dests = destinations(singleCtx());
    expect(dests).toContain('.env.start');
    expect(dests).not.toContain('wrangler.jsonc');
  });

  test('turborepo scopes wrangler.jsonc to the tanstack-start app only', () => {
    const ctx: TemplateContext = {
      projectName: 'saas',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'tanstack-start', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { deployment: 'cloudflare', tooling: [] },
      git: false,
    };
    const dests = destinations(ctx);
    expect(dests).toContain('apps/web/wrangler.jsonc');
    expect(dests).toContain('apps/api/wrangler.jsonc');
    expect(dests).not.toContain('apps/web/.env.start');
  });

  test('D1 with drizzle emits the app-side server.ts only for the tanstack-start app', () => {
    const ctx: TemplateContext = {
      projectName: 'saas',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'tanstack-start', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { deployment: 'cloudflare', database: 'd1', orm: 'drizzle', tooling: [] },
      git: false,
    };
    const dests = destinations(ctx);
    expect(dests).toContain('apps/web/src/lib/server.ts');
    expect(dests).not.toContain('apps/api/src/lib/server.ts');
  });
});
