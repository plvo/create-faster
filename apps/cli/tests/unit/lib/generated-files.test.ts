import { describe, expect, test } from 'bun:test';
import { collectGeneratedFiles } from '@/lib/generated-files';
import type { AppContext, TemplateContext } from '@/types/ctx';

const context = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  projectName: 'proj',
  repo: 'single',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
  project: { tooling: [] },
  git: false,
  pm: 'bun',
  ...overrides,
});

const startApp: AppContext = { appName: 'web', stackName: 'tanstack-start', libraries: [] };
const drizzle = { database: 'sqlite', orm: 'drizzle', tooling: [] };

describe('collectGeneratedFiles', () => {
  test('is empty for a project with no choice that declares a generated file', () => {
    expect(collectGeneratedFiles(context(), 'biome')).toEqual([]);
  });

  test('gives each tool the form it reads for the route tree of a TanStack Start app', () => {
    const ctx = context({ apps: [startApp] });

    expect(collectGeneratedFiles(ctx, 'biome')).toEqual(['**/routeTree.gen.ts']);
    expect(collectGeneratedFiles(ctx, 'oxfmt')).toEqual(['**/routeTree.gen.ts']);
    expect(collectGeneratedFiles(ctx, 'prettier')).toEqual(['routeTree.gen.ts']);
  });

  test('leaves the route tree out of the tools that already ignore it by themselves', () => {
    const ctx = context({ apps: [startApp] });

    expect(collectGeneratedFiles(ctx, 'eslint')).toEqual([]);
    expect(collectGeneratedFiles(ctx, 'oxlint')).toEqual([]);
  });

  test('gives each tool the form it reads for the migrations of Drizzle', () => {
    const ctx = context({ project: drizzle });

    expect(collectGeneratedFiles(ctx, 'biome')).toEqual(['**/drizzle/**/*']);
    expect(collectGeneratedFiles(ctx, 'oxfmt')).toEqual(['**/drizzle/**']);
    expect(collectGeneratedFiles(ctx, 'prettier')).toEqual(['drizzle/']);
    expect(collectGeneratedFiles(ctx, 'eslint')).toEqual([]);
    expect(collectGeneratedFiles(ctx, 'oxlint')).toEqual([]);
  });

  test('lists the files of the project addons, the libraries, the stacks and the blueprint, each once, in that order', () => {
    const ctx = context({ apps: [startApp, { ...startApp, appName: 'admin' }], project: drizzle });

    expect(collectGeneratedFiles(ctx, 'biome')).toEqual(['**/drizzle/**/*', '**/routeTree.gen.ts']);
  });

  test('gives every tool the glob of a blueprint', () => {
    const ctx = context({ blueprint: 'cloudflare-payload-nextjs' });
    const expected = ['**/src/payload-types.ts', '**/importMap.js', '**/src/migrations/*'];

    for (const tool of ['biome', 'eslint', 'oxfmt', 'oxlint', 'prettier'] as const) {
      expect(collectGeneratedFiles(ctx, tool), tool).toEqual(expected);
    }
  });
});
