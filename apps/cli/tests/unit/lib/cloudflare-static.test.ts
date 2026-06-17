import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import {
  isCategoryValueAllowedByLibraries,
  isRequirementMet,
  isServerRuntimeSatisfied,
} from '@/lib/addon-utils';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

const destinations = (ctx: TemplateContext) => getAllTemplatesForContext(ctx).map((t) => t.destination);

const visibleDeploymentOptions = (ctx: Partial<TemplateContext>): string[] =>
  Object.entries(META.project.deployment.options)
    .filter(([, addon]) => isRequirementMet(addon.require, ctx as TemplateContext))
    .filter(([name]) => isCategoryValueAllowedByLibraries('deployment', name, ctx))
    .filter(([, addon]) => isServerRuntimeSatisfied(addon, ctx))
    .map(([name]) => name);

describe('cloudflare-static deployment option', () => {
  test('cloudflare-static is a deployment platform option', () => {
    expect(META.project.deployment.options['cloudflare-static']).toBeDefined();
  });

  test('cloudflare-static defines only a nextjs stack package.json', () => {
    const option = META.project.deployment.options['cloudflare-static'];
    expect(option?.stackPackageJson?.nextjs).toBeDefined();
    expect(option?.stackPackageJson?.hono).toBeUndefined();
  });

  test('cloudflare-static is not root-scoped (generates per app)', () => {
    const option = META.project.deployment.options['cloudflare-static'];
    expect(option?.mono).toBeUndefined();
  });
});

describe('interactive deployment prompt visibility', () => {
  test('shows cloudflare-static when a nextjs app exists with no server-dependent library', () => {
    const ctx = { apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }] } as Partial<TemplateContext>;
    expect(visibleDeploymentOptions(ctx)).toContain('cloudflare-static');
  });

  test('hides cloudflare-static when no nextjs app exists', () => {
    const ctx = { apps: [{ appName: 'api', stackName: 'hono', libraries: [] }] } as Partial<TemplateContext>;
    expect(visibleDeploymentOptions(ctx)).not.toContain('cloudflare-static');
  });

  test('hides cloudflare-static when a nextjs app uses a server-dependent library', () => {
    const ctxBetterAuth = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
    } as Partial<TemplateContext>;
    const ctxTrpc = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['trpc'] }],
    } as Partial<TemplateContext>;
    expect(visibleDeploymentOptions(ctxBetterAuth)).not.toContain('cloudflare-static');
    expect(visibleDeploymentOptions(ctxTrpc)).not.toContain('cloudflare-static');
  });

  test('keeps the server-runtime cloudflare option visible regardless of libraries', () => {
    const ctx = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
    } as Partial<TemplateContext>;
    expect(visibleDeploymentOptions(ctx)).toContain('cloudflare');
  });
});

describe('deployment cloudflare-static: nextjs app package.json (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'my-site',
    repo: 'single',
    apps: [{ appName: 'my-site', stackName: 'nextjs', libraries: [] }],
    project: { deployment: 'cloudflare-static', tooling: [] },
    git: false,
  };

  test('includes wrangler as a devDependency', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
  });

  test('deploy script builds then deploys with wrangler', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.deploy).toBe('next build && wrangler deploy');
  });

  test('preview script uses wrangler dev', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.preview).toBe('wrangler dev');
  });

  test('does NOT include @opennextjs/cloudflare dependency', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
  });

  test('does NOT include build:cf script', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.['build:cf']).toBeUndefined();
  });
});

describe('deployment cloudflare-static: template resolution', () => {
  test('nextjs static export omits the proxy.ts request interceptor (single repo)', () => {
    const ctx: TemplateContext = {
      projectName: 'site',
      repo: 'single',
      apps: [{ appName: 'site', stackName: 'nextjs', libraries: [] }],
      project: { deployment: 'cloudflare-static', tooling: [] },
      git: false,
    };
    const dests = destinations(ctx);
    expect(dests).not.toContain('src/proxy.ts');
    expect(dests).not.toContain('src/middleware.ts');
  });

  test('nextjs static export omits proxy.ts per app (turborepo)', () => {
    const ctx: TemplateContext = {
      projectName: 'saas',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { deployment: 'cloudflare-static', tooling: [] },
      git: false,
    };
    const dests = destinations(ctx);
    expect(dests).not.toContain('apps/web/src/proxy.ts');
    expect(dests).not.toContain('apps/web/src/middleware.ts');
  });
});
