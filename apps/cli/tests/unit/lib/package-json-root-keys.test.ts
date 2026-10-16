import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { generateAppPackageJson, generateRootPackageJson, mergePackageJsonConfigs } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';
import type { MetaBlueprint, MetaLibrary, PackageJsonConfig } from '@/types/meta';

const STUB_LIBRARIES: Record<string, MetaLibrary> = {
  'stub-first': {
    label: 'first',
    support: { stacks: ['nextjs', 'hono'] },
    packageJson: {},
    rootPackageJson: { overrides: { shared: { first: '1.0.0' }, onlyFirst: { dep: '1.0.0' } } },
  },
  'stub-second': {
    label: 'second',
    support: { stacks: ['nextjs', 'hono'] },
    packageJson: {},
    rootPackageJson: { overrides: { shared: { second: '2.0.0' } } },
  },
  'stub-scripts': {
    label: 'scripts',
    support: { stacks: ['nextjs', 'hono'] },
    packageJson: {},
    installScripts: { fromInstallScripts: true },
    rootPackageJson: { allowScripts: { fromRootPackageJson: false } },
  },
  'stub-hono-only': {
    label: 'hono only',
    support: { stacks: ['hono'] },
    packageJson: {},
    rootPackageJson: { overrides: { honoOnly: { dep: '3.0.0' } } },
  },
};

const STUB_BLUEPRINT: MetaBlueprint = {
  label: 'stub',
  hint: 'stub',
  category: 'stub',
  context: { apps: [], project: {} },
  rootPackageJson: { overrides: { shared: { blueprint: '4.0.0' } } },
};

function turborepo(blueprint?: string): TemplateContext {
  return {
    projectName: 'test-project',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: ['stub-first', 'stub-hono-only'] },
      { appName: 'docs', stackName: 'nextjs', libraries: ['stub-second'] },
    ],
    project: { tooling: [] },
    blueprint,
    git: false,
  };
}

describe('library rootPackageJson', () => {
  beforeAll(() => {
    Object.assign(META.libraries, STUB_LIBRARIES);
    Object.assign(META.blueprints, { 'stub-blueprint': STUB_BLUEPRINT });
  });

  afterAll(() => {
    for (const name of Object.keys(STUB_LIBRARIES)) delete (META.libraries as Record<string, unknown>)[name];
    delete (META.blueprints as Record<string, unknown>)['stub-blueprint'];
  });

  test('turborepo: the root merges the keys of every library across apps, the apps carry none', () => {
    const ctx = turborepo();

    expect(generateRootPackageJson(ctx).content.overrides).toEqual({
      shared: { first: '1.0.0', second: '2.0.0' },
      onlyFirst: { dep: '1.0.0' },
    });
    for (const [index, app] of ctx.apps.entries()) {
      expect(generateAppPackageJson(app, ctx, index).content.overrides).toBeUndefined();
    }
  });

  test('turborepo: a blueprint rootPackageJson merges with the libraries instead of replacing them', () => {
    expect(generateRootPackageJson(turborepo('stub-blueprint')).content.overrides).toEqual({
      shared: { first: '1.0.0', second: '2.0.0', blueprint: '4.0.0' },
      onlyFirst: { dep: '1.0.0' },
    });
  });

  test('single repo: the app package.json is the root and carries the library keys', () => {
    const ctx: TemplateContext = {
      projectName: 'test-project',
      repo: 'single',
      apps: [{ appName: 'web', stackName: 'hono', libraries: ['stub-first', 'stub-hono-only'] }],
      project: { tooling: [] },
      git: false,
    };

    expect(generateAppPackageJson(ctx.apps[0]!, ctx, 0).content.overrides).toEqual({
      shared: { first: '1.0.0' },
      onlyFirst: { dep: '1.0.0' },
      honoOnly: { dep: '3.0.0' },
    });
  });

  test.each(['single', 'turborepo'] as const)('%s: the install-script policy merges with the library root keys', (repo) => {
    const ctx: TemplateContext = {
      projectName: 'test-project',
      repo,
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['stub-scripts'] }],
      project: { tooling: [] },
      pm: 'npm',
      git: false,
    };
    const root = repo === 'single' ? generateAppPackageJson(ctx.apps[0]!, ctx, 0) : generateRootPackageJson(ctx);

    expect(root.content.allowScripts).toEqual({ fromInstallScripts: true, fromRootPackageJson: false });
  });

  test('a library that does not support the stack of its app contributes nothing', () => {
    const ctx: TemplateContext = {
      ...turborepo(),
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['stub-hono-only'] }],
    };

    expect(generateRootPackageJson(ctx).content.overrides).toBeUndefined();
  });
});

describe('mergePackageJsonConfigs on keys other than dependencies', () => {
  test('merges nested objects and replaces arrays and scalars', () => {
    const result = mergePackageJsonConfigs<PackageJsonConfig>(
      { overrides: { a: { x: '1' } }, files: ['one'], private: false },
      { overrides: { a: { y: '2' }, b: { z: '3' } }, files: ['two'], private: true },
    );

    expect(result).toEqual({
      overrides: { a: { x: '1', y: '2' }, b: { z: '3' } },
      files: ['two'],
      private: true,
    });
  });
});
