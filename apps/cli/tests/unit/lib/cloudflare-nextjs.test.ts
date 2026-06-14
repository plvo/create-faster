import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';

describe('cloudflare library supports nextjs stack', () => {
  test('cloudflare support.stacks includes nextjs', () => {
    const cloudflare = META.libraries.cloudflare;
    const stacks = cloudflare.support?.stacks;
    expect(Array.isArray(stacks) && stacks.includes('nextjs')).toBe(true);
  });

  test('cloudflare support.stacks still includes hono', () => {
    const cloudflare = META.libraries.cloudflare;
    const stacks = cloudflare.support?.stacks;
    expect(Array.isArray(stacks) && stacks.includes('hono')).toBe(true);
  });
});

describe('stackPackageJson: nextjs + cloudflare package.json', () => {
  const ctx: TemplateContext = {
    projectName: 'my-site',
    repo: 'single',
    apps: [{ appName: 'my-site', stackName: 'nextjs', libraries: ['cloudflare'] }],
    project: { tooling: [] },
    git: false,
  };

  test('includes @opennextjs/cloudflare as a dependency', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeDefined();
  });

  test('includes wrangler as a devDependency', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
  });

  test('has build:cf script', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.['build:cf']).toContain('opennextjs-cloudflare');
  });

  test('has preview script using opennextjs-cloudflare', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.preview).toContain('opennextjs-cloudflare');
  });

  test('has deploy script using opennextjs-cloudflare', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.deploy).toContain('opennextjs-cloudflare');
  });

  test('has cf:typegen script', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.['cf:typegen']).toBe(
      'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts',
    );
  });

  test('does NOT have hono-style deploy script (wrangler deploy)', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.deploy).not.toBe('wrangler deploy');
  });
});

describe('stackPackageJson regression: hono + cloudflare package.json unchanged', () => {
  const ctx: TemplateContext = {
    projectName: 'my-api',
    repo: 'single',
    apps: [{ appName: 'my-api', stackName: 'hono', libraries: ['cloudflare'] }],
    project: { tooling: [] },
    git: false,
  };

  test('deploy script is wrangler deploy', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.deploy).toBe('wrangler deploy');
  });

  test('preview script is wrangler dev', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.preview).toBe('wrangler dev');
  });

  test('cf-typegen script present', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.['cf-typegen']).toBe(
      'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts',
    );
  });

  test('wrangler devDependency present', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.wrangler).toMatch(/^\^4/);
  });

  test('does NOT have @opennextjs/cloudflare dependency', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@opennextjs/cloudflare']).toBeUndefined();
  });

  test('does NOT have build:cf script', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.['build:cf']).toBeUndefined();
  });
});
