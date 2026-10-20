import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectProductionSteps } from '@/lib/production-steps';
import type { TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/stack-name';

function singleRepo(stackName: StackName, deployment?: string): TemplateContext {
  return {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'demo', stackName, libraries: [] }],
    project: { deployment, tooling: [] },
    git: false,
    pm: 'npm',
  };
}

function turborepo(stacks: StackName[], deployment?: string): TemplateContext {
  return {
    ...singleRepo('nextjs', deployment),
    repo: 'turborepo',
    apps: stacks.map((stackName, index) => ({ appName: ['web', 'docs', 'api'][index] as string, stackName, libraries: [] })),
  };
}

function commands(ctx: TemplateContext): string[] {
  return collectProductionSteps(ctx).map(({ command }) => command);
}

describe('collectProductionSteps', () => {
  test('a Hono app has no build script, so it only starts', () => {
    expect(commands(singleRepo('hono'))).toEqual(['npm run start']);
  });

  test('a Next.js app builds, then starts', () => {
    expect(commands(singleRepo('nextjs'))).toEqual(['npm run build', 'npm run start']);
  });

  test('a Next.js app on Cloudflare lists the Worker build, the preview and the deploy, and has no start', () => {
    expect(commands(singleRepo('nextjs', 'cloudflare'))).toEqual([
      'npm run build',
      'npm run build:cf',
      'npm run preview',
      'npm run deploy',
    ]);
  });

  test('a static Next.js app on Cloudflare previews and deploys', () => {
    expect(commands(singleRepo('nextjs', 'cloudflare-static'))).toEqual([
      'npm run build',
      'npm run preview',
      'npm run deploy',
    ]);
  });

  test('the commands follow the package manager', () => {
    expect(commands({ ...singleRepo('nextjs'), pm: 'bun' })).toEqual(['bun run build', 'bun run start']);
  });

  test('an Expo app starts its dev server, which its description says', () => {
    expect(collectProductionSteps(singleRepo('expo'))).toEqual([
      { description: 'Start the Expo dev server', command: 'npm run start' },
    ]);
  });

  test('a turborepo root runs its build and start in the apps that define them, which the description says', () => {
    expect(collectProductionSteps(turborepo(['nextjs', 'hono']))).toEqual([
      { description: 'Build every app that has a `build` script for production', command: 'npm run build' },
      { description: 'Start every app that has a `start` script', command: 'npm run start' },
    ]);
  });

  test('a turborepo runs the scripts only its apps define app by app, from a subshell that leaves the shell at the root', () => {
    expect(collectProductionSteps(turborepo(['nextjs', 'nextjs'], 'cloudflare')).slice(1)).toEqual([
      { description: 'Build the Worker bundle (web)', command: '(cd apps/web && npm run build:cf)' },
      { description: 'Preview the production build locally (web)', command: '(cd apps/web && npm run preview)' },
      { description: 'Deploy to Cloudflare Workers (web)', command: '(cd apps/web && npm run deploy)' },
      { description: 'Build the Worker bundle (docs)', command: '(cd apps/docs && npm run build:cf)' },
      { description: 'Preview the production build locally (docs)', command: '(cd apps/docs && npm run preview)' },
      { description: 'Deploy to Cloudflare Workers (docs)', command: '(cd apps/docs && npm run deploy)' },
    ]);
  });

  test('each app of a mixed Cloudflare turborepo keeps its own order: the Worker build before its preview and deploy', () => {
    const steps = commands(turborepo(['tanstack-start', 'nextjs', 'hono'], 'cloudflare'));
    const positionOf = (appName: string, script: string) => steps.indexOf(`(cd apps/${appName} && npm run ${script})`);

    expect(positionOf('docs', 'build:cf')).toBeGreaterThan(-1);
    for (const script of ['preview', 'deploy']) {
      expect(positionOf('docs', script)).toBeGreaterThan(positionOf('docs', 'build:cf'));
      expect(positionOf('web', script)).toBeGreaterThan(-1);
      expect(positionOf('api', script)).toBeGreaterThan(-1);
    }
  });

  test('a turborepo names only the apps that define the script', () => {
    const steps = commands(turborepo(['nextjs', 'hono'], 'cloudflare'));

    expect(steps).toContain('(cd apps/web && npm run build:cf)');
    expect(steps).not.toContain('(cd apps/api && npm run build:cf)');
  });

  test('prints the scripts a stack declares in META and no other', () => {
    const stack = META.stacks.nextjs;
    const declared = stack.productionScripts;
    Object.assign(stack, { productionScripts: [{ script: 'analyze', description: 'Analyze the bundle' }] });
    try {
      expect(collectProductionSteps(singleRepo('nextjs'))).toEqual([
        { description: 'Analyze the bundle', command: 'npm run analyze' },
      ]);
    } finally {
      Object.assign(stack, { productionScripts: declared });
    }
  });
});
