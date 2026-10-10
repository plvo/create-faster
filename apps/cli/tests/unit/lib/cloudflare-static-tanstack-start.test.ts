import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { getCategoryOptionUnavailability } from '@/lib/addon-utils';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

const destinations = (ctx: TemplateContext) => getAllTemplatesForContext(ctx).map((t) => t.destination);

const singleCtx = (libraries: string[] = []): TemplateContext => ({
  projectName: 'site',
  repo: 'single',
  apps: [{ appName: 'site', stackName: 'tanstack-start', libraries }],
  project: { deployment: 'cloudflare-static', tooling: [] },
  git: false,
});

const isDeploymentOptionVisible = (ctx: Partial<TemplateContext>): boolean =>
  getCategoryOptionUnavailability(
    'deployment',
    'cloudflare-static',
    META.project.deployment.options['cloudflare-static'],
    ctx,
  ) === undefined;

describe('cloudflare-static deployment: tanstack-start package.json', () => {
  test('declares a tanstack-start stack package.json', () => {
    expect(META.project.deployment.options['cloudflare-static']?.stackPackageJson?.['tanstack-start']).toBeDefined();
  });

  test('drops nitro and the nitro start script, adds wrangler deploy scripts and no Cloudflare vite plugin', () => {
    const ctx = singleCtx();
    const { content } = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(content.devDependencies?.nitro).toBeUndefined();
    expect(content.scripts?.start).toBeUndefined();
    expect(content.devDependencies?.['@cloudflare/vite-plugin']).toBeUndefined();
    expect(content.devDependencies?.wrangler).toMatch(/^\^4/);
    expect(content.scripts?.deploy).toBe('vite build && wrangler deploy');
    expect(content.scripts?.preview).toBe('wrangler dev');
    expect(content.scripts?.['cf-typegen']).toBe('wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts');
  });
});

describe('cloudflare-static deployment: tanstack-start generated paths', () => {
  test('single repo emits the assets-only wrangler.jsonc and the 404 page, no nitro or runtime files', () => {
    const dests = destinations(singleCtx(['evlog']));
    expect(dests).toContain('wrangler.jsonc');
    expect(dests).toContain('src/routes/404.tsx');
    expect(dests).not.toContain('.env.start');
    expect(dests).not.toContain('nitro.config.ts');
    expect(dests).not.toContain('src/lib/server.ts');
  });

  test('turborepo scopes the static files to each tanstack-start app and leaves the nextjs app alone', () => {
    const ctx: TemplateContext = {
      projectName: 'saas',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'docs', stackName: 'tanstack-start', libraries: ['evlog'] },
      ],
      project: { deployment: 'cloudflare-static', tooling: [] },
      git: false,
    };
    const dests = destinations(ctx);
    expect(dests).toContain('apps/web/wrangler.jsonc');
    expect(dests).toContain('apps/docs/wrangler.jsonc');
    expect(dests).toContain('apps/docs/src/routes/404.tsx');
    expect(dests).not.toContain('apps/web/src/routes/404.tsx');
    expect(dests).not.toContain('apps/docs/.env.start');
    expect(dests).not.toContain('apps/docs/nitro.config.ts');
  });

  test.each([undefined, 'cloudflare', 'sst', 'cloudflare-static'] as const)(
    'emits the not-found component the root route imports when the deployment is %p',
    (deployment) => {
      const ctx = { ...singleCtx(), project: { deployment, tooling: [] } };
      expect(destinations(ctx)).toContain('src/components/not-found.tsx');
    },
  );

  test('other deployments never emit the 404 page route', () => {
    const ctx = { ...singleCtx(), project: { deployment: 'cloudflare' as const, tooling: [] } };
    expect(destinations(ctx)).not.toContain('src/routes/404.tsx');
  });
});

describe('cloudflare-static deployment: availability with tanstack-start', () => {
  test('is available to a tanstack-start app', () => {
    expect(isDeploymentOptionVisible(singleCtx(['shadcn', 'evlog']))).toBe(true);
  });

  test('stays unavailable without a nextjs or tanstack-start app', () => {
    const ctx = { apps: [{ appName: 'api', stackName: 'hono', libraries: [] }] } as Partial<TemplateContext>;
    expect(isDeploymentOptionVisible(ctx)).toBe(false);
  });

  test.each(['better-auth', 'trpc', 'posthog'])('is unavailable when a tanstack-start app uses %s', (library) => {
    expect(isDeploymentOptionVisible(singleCtx([library]))).toBe(false);
  });
});
