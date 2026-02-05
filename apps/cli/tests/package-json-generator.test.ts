// ABOUTME: Tests for programmatic package.json generation
// ABOUTME: Tests merge logic with libraries and project addons

import { describe, expect, test } from 'bun:test';
import {
  generateAllPackageJsons,
  generateAppPackageJson,
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
});

describe('generateAppPackageJson (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-project',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    git: true,
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

  test('references workspace packages for libraries with package destination', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@repo/ui']).toBe('*');
    expect(result.content.dependencies?.['radix-ui']).toBeUndefined();
  });

  test('references @repo/db when orm is selected', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@repo/db']).toBe('*');
  });

  test('resolves port placeholder in scripts', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.dev).toContain('--port 3000');
  });
});

describe('generateAppPackageJson (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-single',
    repo: 'single',
    apps: [{ appName: 'test-single', stackName: 'nextjs', libraries: ['shadcn'] }],
    project: { database: 'postgres', orm: 'drizzle', tooling: ['biome'] },
    git: true,
  };

  test('generates at root with project name', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.path).toBe('package.json');
    expect(result.content.name).toBe('test-single');
  });

  test('includes library dependencies directly (no workspace)', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['radix-ui']).toBeDefined();
    expect(result.content.dependencies?.['@repo/ui']).toBeUndefined();
  });

  test('includes orm and database dependencies directly', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['drizzle-orm']).toBeDefined();
    expect(result.content.dependencies?.pg).toBeDefined();
    expect(result.content.scripts?.['db:generate']).toBeDefined();
  });

  test('includes tooling extras', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.['@biomejs/biome']).toBeDefined();
    expect(result.content.scripts?.format).toBeDefined();
  });
});

describe('generateAllPackageJsons', () => {
  test('generates all package.jsons for turborepo', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: true,
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
      apps: [{ appName: 'test-single', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: true,
    };

    const results = generateAllPackageJsons(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('package.json');
  });
});
