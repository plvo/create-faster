import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';

describe('cloudflare deployment option', () => {
  test('cloudflare is a deployment platform option', () => {
    expect(META.project.deployment.options.cloudflare).toBeDefined();
  });

  test('cloudflare has stack-specific package.json for hono and nextjs', () => {
    const cloudflare = META.project.deployment.options.cloudflare;
    expect(cloudflare?.stackPackageJson?.hono).toBeDefined();
    expect(cloudflare?.stackPackageJson?.nextjs).toBeDefined();
  });

  test('cloudflare is not root-scoped (generates per app)', () => {
    const cloudflare = META.project.deployment.options.cloudflare;
    expect(cloudflare?.mono).toBeUndefined();
  });
});

describe('deployment cloudflare: nextjs app package.json (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'my-site',
    repo: 'single',
    apps: [{ appName: 'my-site', stackName: 'nextjs', libraries: [] }],
    project: { deployment: 'cloudflare', tooling: [] },
    git: false,
  };

  test('includes @opennextjs/cloudflare as a dependency', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeDefined();
  });

  test('includes wrangler as a devDependency', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
  });

  test('has build:cf script using opennextjs-cloudflare', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.['build:cf']).toContain('opennextjs-cloudflare');
  });

  test('has preview script using opennextjs-cloudflare', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.preview).toContain('opennextjs-cloudflare');
  });

  test('has deploy script using opennextjs-cloudflare', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.deploy).toContain('opennextjs-cloudflare');
  });

  test('has cf:typegen script', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.['cf:typegen']).toBe(
      'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts',
    );
  });

  test('does NOT have hono-style deploy script (wrangler deploy)', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.deploy).not.toBe('wrangler deploy');
  });
});

describe('deployment cloudflare: turborepo per-app resolution', () => {
  const ctx: TemplateContext = {
    projectName: 'my-saas',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { deployment: 'cloudflare', tooling: [] },
    git: false,
  };

  test('nextjs app gets opennext deps and scripts', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeDefined();
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
    expect(result.content.scripts?.['build:cf']).toContain('opennextjs-cloudflare');
    expect(result.content.scripts?.deploy).toContain('opennextjs-cloudflare');
  });

  test('hono app gets wrangler Workers scripts, not opennext', () => {
    const result = generateAppPackageJson(ctx.apps[1]!, ctx, 1);
    expect(result.content.scripts?.deploy).toBe('wrangler deploy');
    expect(result.content.scripts?.preview).toBe('wrangler dev');
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
  });
});

describe('deployment cloudflare: hono app package.json (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'my-api',
    repo: 'single',
    apps: [{ appName: 'my-api', stackName: 'hono', libraries: [] }],
    project: { deployment: 'cloudflare', tooling: [] },
    git: false,
  };

  test('deploy script is wrangler deploy', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.deploy).toBe('wrangler deploy');
  });

  test('preview script is wrangler dev', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.preview).toBe('wrangler dev');
  });

  test('cf-typegen script present', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.['cf-typegen']).toBe(
      'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts',
    );
  });

  test('wrangler devDependency present', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
  });

  test('does NOT have @opennextjs/cloudflare dependency', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
  });

  test('does NOT have build:cf script', () => {
    const result = generateAppPackageJson(ctx.apps[0]!, ctx, 0);
    expect(result.content.scripts?.['build:cf']).toBeUndefined();
  });
});
