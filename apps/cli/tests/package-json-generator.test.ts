// ABOUTME: Unit tests for programmatic package.json generation
// ABOUTME: Tests merge logic, workspace references, and port resolution

import { describe, expect, test } from 'bun:test';
import {
  generateAllPackageJsons,
  generateAppPackageJson,
  generatePackagePackageJson,
  generateRootPackageJson,
  mergePackageJsonConfigs,
} from '../src/lib/package-json-generator';
import type { TemplateContext } from '../src/types/ctx';

describe('mergePackageJsonConfigs', () => {
  test('merges dependencies', () => {
    const result = mergePackageJsonConfigs({ dependencies: { a: '1.0.0' } }, { dependencies: { b: '2.0.0' } });
    expect(result.dependencies).toEqual({ a: '1.0.0', b: '2.0.0' });
  });

  test('later config overrides earlier', () => {
    const result = mergePackageJsonConfigs({ dependencies: { a: '1.0.0' } }, { dependencies: { a: '2.0.0' } });
    expect(result.dependencies?.a).toBe('2.0.0');
  });

  test('merges devDependencies and scripts', () => {
    const result = mergePackageJsonConfigs(
      { devDependencies: { a: '1' }, scripts: { dev: 'dev1' } },
      { devDependencies: { b: '2' }, scripts: { build: 'build1' } },
    );
    expect(result.devDependencies).toEqual({ a: '1', b: '2' });
    expect(result.scripts).toEqual({ dev: 'dev1', build: 'build1' });
  });
});

describe('generateAppPackageJson (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-project',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', modules: ['shadcn'] },
      { appName: 'api', stackName: 'hono', modules: [] },
    ],
    orm: 'drizzle',
    database: 'postgres',
    git: false,
  };

  test('generates correct name and path', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.path).toBe('apps/web/package.json');
    expect(result.content.name).toBe('web');
  });

  test('includes stack dependencies', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.next).toBeDefined();
    expect(result.content.dependencies?.react).toBeDefined();
  });

  test('references workspace packages for modules with asPackage', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@repo/ui']).toBe('*');
    expect(result.content.dependencies?.['radix-ui']).toBeUndefined();
  });

  test('references @repo/db when orm is set', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@repo/db']).toBe('*');
  });

  test('resolves port placeholder in scripts', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.dev).toContain('--port 3000');

    const result2 = generateAppPackageJson(ctx.apps[1], ctx, 1);
    expect(result2.content.scripts?.dev).not.toContain('{{port}}');
  });

  test('second app gets port 3001', () => {
    const result = generateAppPackageJson(ctx.apps[1], ctx, 1);
    expect(result.content.name).toBe('api');
  });
});

describe('generateAppPackageJson (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-single',
    repo: 'single',
    apps: [{ appName: 'web', stackName: 'nextjs', modules: ['shadcn'] }],
    orm: 'drizzle',
    database: 'postgres',
    extras: ['biome'],
    git: false,
  };

  test('generates at root with project name', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.path).toBe('package.json');
    expect(result.content.name).toBe('test-single');
  });

  test('includes module dependencies directly (no workspace)', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['radix-ui']).toBeDefined();
    expect(result.content.dependencies?.['@repo/ui']).toBeUndefined();
  });

  test('includes orm dependencies directly', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['drizzle-orm']).toBeDefined();
    expect(result.content.devDependencies?.['drizzle-kit']).toBeDefined();
    expect(result.content.scripts?.['db:generate']).toBeDefined();
  });

  test('includes database driver', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.pg).toBeDefined();
  });

  test('includes extras', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.['@biomejs/biome']).toBeDefined();
    expect(result.content.scripts?.format).toBeDefined();
  });

  test('does not include port in scripts (single app)', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.dev).not.toContain('--port');
  });
});

describe('generatePackagePackageJson', () => {
  test('generates ui package with correct exports', () => {
    const result = generatePackagePackageJson('ui', {
      dependencies: { 'radix-ui': '^1.0.0' },
      exports: { './': './src/components/' },
    });

    expect(result.path).toBe('packages/ui/package.json');
    expect(result.content.name).toBe('@repo/ui');
    expect(result.content.exports).toEqual({ './': './src/components/' });
    expect(result.content.dependencies?.['radix-ui']).toBe('^1.0.0');
  });

  test('generates db package with scripts', () => {
    const result = generatePackagePackageJson('db', {
      dependencies: { 'drizzle-orm': '^0.38.0' },
      scripts: { 'db:generate': 'drizzle-kit generate' },
      exports: { '.': './src/index.ts' },
    });

    expect(result.content.name).toBe('@repo/db');
    expect(result.content.scripts?.['db:generate']).toBeDefined();
  });
});

describe('generateRootPackageJson (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'my-monorepo',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', modules: [] },
      { appName: 'api', stackName: 'hono', modules: [] },
    ],
    extras: ['biome'],
    git: false,
  };

  test('generates root package.json with project name', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.path).toBe('package.json');
    expect(result.content.name).toBe('my-monorepo');
  });

  test('includes workspaces', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.workspaces).toContain('apps/*');
    expect(result.content.workspaces).toContain('packages/*');
  });

  test('includes turborepo scripts', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.scripts?.dev).toContain('turbo');
    expect(result.content.scripts?.build).toContain('turbo');
  });

  test('includes extras devDependencies', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies?.['@biomejs/biome']).toBeDefined();
  });
});

describe('generateAllPackageJsons', () => {
  test('generates all required package.jsons for turborepo', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', modules: ['shadcn'] },
        { appName: 'api', stackName: 'hono', modules: [] },
      ],
      orm: 'drizzle',
      database: 'postgres',
      git: false,
    };

    const results = generateAllPackageJsons(ctx);
    const paths = results.map((r) => r.path);

    expect(paths).toContain('package.json');
    expect(paths).toContain('apps/web/package.json');
    expect(paths).toContain('apps/api/package.json');
    expect(paths).toContain('packages/ui/package.json');
    expect(paths).toContain('packages/db/package.json');
  });

  test('generates single package.json for single repo', () => {
    const ctx: TemplateContext = {
      projectName: 'test-single',
      repo: 'single',
      apps: [{ appName: 'web', stackName: 'nextjs', modules: [] }],
      git: false,
    };

    const results = generateAllPackageJsons(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('package.json');
  });
});
