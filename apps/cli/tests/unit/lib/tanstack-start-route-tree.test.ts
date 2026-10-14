import { describe, expect, test } from 'bun:test';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import type { StackName } from '@/types/stack-name';
import type { TemplateContext } from '@/types/ctx';

const TYPEGEN = 'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts';
const ROUTE_TREE = 'tsr generate';

const ctxFor = (
  stackName: StackName,
  deployment?: 'cloudflare' | 'cloudflare-static' | 'sst',
  repo: 'single' | 'turborepo' = 'single',
): TemplateContext => ({
  projectName: 'site',
  repo,
  apps: [{ appName: 'site', stackName, libraries: [] }],
  project: { deployment, tooling: [] },
  git: false,
});

const appPackageJson = (ctx: TemplateContext) => generateAppPackageJson(ctx.apps[0]!, ctx, 0).content;

describe('TanStack Start route tree on install', () => {
  test.each([undefined, 'sst', 'cloudflare-static'] as const)(
    'single repo, deployment %p: install generates the route tree with the router CLI',
    (deployment) => {
      const pkg = appPackageJson(ctxFor('tanstack-start', deployment));
      expect(pkg.scripts?.postinstall).toBe(ROUTE_TREE);
      expect(pkg.dependencies?.['@tanstack/router-cli']).toBeDefined();
      expect(pkg.devDependencies?.['@tanstack/router-cli']).toBeUndefined();
    },
  );

  test('turborepo app: install generates the route tree', () => {
    const pkg = appPackageJson(ctxFor('tanstack-start', undefined, 'turborepo'));
    expect(pkg.scripts?.postinstall).toBe(ROUTE_TREE);
  });

  test('on cloudflare one postinstall generates the binding types and the route tree', () => {
    const pkg = appPackageJson(ctxFor('tanstack-start', 'cloudflare'));
    expect(pkg.scripts?.postinstall).toBe(`${TYPEGEN} && ${ROUTE_TREE}`);
    expect(pkg.scripts?.['cf-typegen']).toBe(TYPEGEN);
  });

  test.each(['nextjs', 'hono', 'node'] as const)('%s has no route tree to generate', (stackName) => {
    const pkg = appPackageJson(ctxFor(stackName));
    expect(pkg.scripts?.postinstall).toBeUndefined();
    expect(pkg.dependencies?.['@tanstack/router-cli']).toBeUndefined();
    expect(pkg.devDependencies?.['@tanstack/router-cli']).toBeUndefined();
  });
});
