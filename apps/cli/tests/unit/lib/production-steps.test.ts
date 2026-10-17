import { describe, expect, test } from 'bun:test';
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

  test('every step carries a description', () => {
    for (const { description } of collectProductionSteps(singleRepo('nextjs', 'cloudflare'))) {
      expect(description).not.toBe('');
    }
  });

  test('the commands follow the package manager', () => {
    expect(commands({ ...singleRepo('nextjs'), pm: 'bun' })).toEqual(['bun run build', 'bun run start']);
  });

  test('a turborepo runs the scripts only its apps define from the app directory', () => {
    const turborepo: TemplateContext = {
      ...singleRepo('nextjs', 'cloudflare'),
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'docs', stackName: 'nextjs', libraries: [] },
      ],
    };

    expect(commands(turborepo)).toEqual([
      'npm run build',
      'cd apps/<app> && npm run build:cf',
      'cd apps/<app> && npm run preview',
      'cd apps/<app> && npm run deploy',
    ]);
  });

  test('a turborepo prints a script the root forwards to the apps as a root command', () => {
    const turborepo: TemplateContext = {
      ...singleRepo('nextjs'),
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
    };

    expect(commands(turborepo)).toEqual(['npm run build', 'npm run start']);
  });

  test('an Expo app has no build script and starts its dev server', () => {
    expect(commands(singleRepo('expo'))).toEqual(['npm run start']);
  });
});
