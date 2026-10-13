import { describe, expect, test } from 'bun:test';
import { generateAppPackageJson, generateRootPackageJson } from '@/lib/package-json-generator';
import type { StackName } from '@/types/stack-name';
import type { TemplateContext } from '@/types/ctx';

const TYPEGEN = 'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts';
const STACKS: StackName[] = ['nextjs', 'tanstack-start', 'hono'];

const singleCtx = (stackName: StackName, deployment?: 'cloudflare' | 'sst'): TemplateContext => ({
  projectName: 'site',
  repo: 'single',
  apps: [{ appName: 'site', stackName, libraries: [] }],
  project: { deployment, tooling: [] },
  git: false,
});

describe('cloudflare binding types', () => {
  test.each(STACKS)('%s: one cf-typegen script, run after every install', (stackName) => {
    const ctx = singleCtx(stackName, 'cloudflare');
    const { scripts } = generateAppPackageJson(ctx.apps[0]!, ctx, 0).content;
    expect(scripts?.['cf-typegen']).toBe(TYPEGEN);
    expect(scripts?.postinstall).toBe(TYPEGEN);
    expect(scripts?.['cf:typegen']).toBeUndefined();
  });

  test('nextjs: build:cf regenerates the types before the OpenNext build', () => {
    const ctx = singleCtx('nextjs', 'cloudflare');
    const { scripts } = generateAppPackageJson(ctx.apps[0]!, ctx, 0).content;
    expect(scripts?.['build:cf']).toBe(`${TYPEGEN} && opennextjs-cloudflare build`);
  });

  test('turborepo: the root runs cf-typegen in every app', () => {
    const ctx: TemplateContext = {
      projectName: 'mono',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { deployment: 'cloudflare', tooling: [] },
      git: false,
    };
    expect(generateRootPackageJson(ctx).content.scripts?.['cf-typegen']).toBe('turbo cf-typegen');
  });

  test.each(['sst', undefined] as const)('no typegen script and no postinstall with deployment %p', (deployment) => {
    const ctx = singleCtx('hono', deployment);
    const { scripts } = generateAppPackageJson(ctx.apps[0]!, ctx, 0).content;
    expect(scripts?.['cf-typegen']).toBeUndefined();
    expect(scripts?.postinstall).toBeUndefined();
  });
});
