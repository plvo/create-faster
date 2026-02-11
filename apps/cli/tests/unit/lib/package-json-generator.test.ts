// ABOUTME: Tests for programmatic package.json generation
// ABOUTME: Tests merge logic with libraries and project addons

import { describe, expect, test } from 'bun:test';
import { generateAllPackageJsons, generateAppPackageJson, mergePackageJsonConfigs } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';

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

describe('internal @repo/* dependencies (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: ['shadcn', 'better-auth'] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { database: 'postgres', orm: 'drizzle', tooling: ['biome'] },
    git: true,
  };

  function findByPath(results: ReturnType<typeof generateAllPackageJsons>, path: string) {
    return results.find((r) => r.path === path);
  }

  test('all packages have @repo/config as devDependency', () => {
    const results = generateAllPackageJsons(ctx);

    const ui = findByPath(results, 'packages/ui/package.json');
    const db = findByPath(results, 'packages/db/package.json');
    const auth = findByPath(results, 'packages/auth/package.json');

    expect(ui?.content.devDependencies?.['@repo/config']).toBe('*');
    expect(db?.content.devDependencies?.['@repo/config']).toBe('*');
    expect(auth?.content.devDependencies?.['@repo/config']).toBe('*');
  });

  test('all apps have @repo/config as devDependency', () => {
    const results = generateAllPackageJsons(ctx);

    const web = findByPath(results, 'apps/web/package.json');
    const api = findByPath(results, 'apps/api/package.json');

    expect(web?.content.devDependencies?.['@repo/config']).toBe('*');
    expect(api?.content.devDependencies?.['@repo/config']).toBe('*');
  });

  test('root package.json does NOT have @repo/config', () => {
    const results = generateAllPackageJsons(ctx);
    const root = findByPath(results, 'package.json');

    expect(root?.content.devDependencies?.['@repo/config']).toBeUndefined();
    expect(root?.content.dependencies?.['@repo/config']).toBeUndefined();
  });

  test('@repo/auth has @repo/db when ORM selected', () => {
    const results = generateAllPackageJsons(ctx);
    const auth = findByPath(results, 'packages/auth/package.json');

    expect(auth?.content.dependencies?.['@repo/db']).toBe('*');
  });

  test('@repo/auth does NOT have @repo/db when no ORM selected', () => {
    const ctxNoOrm: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
      project: { tooling: [] },
      git: true,
    };

    const results = generateAllPackageJsons(ctxNoOrm);
    const auth = findByPath(results, 'packages/auth/package.json');

    expect(auth?.content.dependencies?.['@repo/db']).toBeUndefined();
  });

  test('single repo has no @repo/* dependencies', () => {
    const singleCtx: TemplateContext = {
      projectName: 'test-single',
      repo: 'single',
      apps: [{ appName: 'test-single', stackName: 'nextjs', libraries: ['shadcn'] }],
      project: { database: 'postgres', orm: 'drizzle', tooling: ['biome'] },
      git: true,
    };

    const results = generateAllPackageJsons(singleCtx);
    const pkg = results[0];
    const allDeps = { ...pkg.content.dependencies, ...pkg.content.devDependencies };
    const repoRefs = Object.keys(allDeps).filter((k) => k.startsWith('@repo/'));

    expect(repoRefs).toEqual([]);
  });
});

describe('appPackageJson for pkg-scoped libraries', () => {
  function findByPath(results: ReturnType<typeof generateAllPackageJsons>, path: string) {
    return results.find((r) => r.path === path);
  }

  test('turborepo: app gets @repo/api + appPackageJson deps', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['trpc', 'tanstack-query'] }],
      project: { tooling: [] },
      git: true,
    };

    const results = generateAllPackageJsons(ctx);
    const app = findByPath(results, 'apps/web/package.json');

    expect(app?.content.dependencies?.['@repo/api']).toBe('*');
    expect(app?.content.dependencies?.['@trpc/client']).toBeDefined();
    expect(app?.content.dependencies?.['@trpc/tanstack-react-query']).toBeDefined();
    expect(app?.content.dependencies?.['server-only']).toBeDefined();
    // Server-side deps should NOT be in the app
    expect(app?.content.dependencies?.['@trpc/server']).toBeUndefined();
    expect(app?.content.dependencies?.zod).toBeUndefined();
  });

  test('turborepo: packages/api gets server-side deps', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['trpc', 'tanstack-query'] }],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: true,
    };

    const results = generateAllPackageJsons(ctx);
    const api = findByPath(results, 'packages/api/package.json');

    expect(api).toBeDefined();
    expect(api?.content.dependencies?.['@trpc/server']).toBeDefined();
    expect(api?.content.dependencies?.superjson).toBeDefined();
    expect(api?.content.dependencies?.zod).toBeDefined();
    expect(api?.content.dependencies?.['@repo/db']).toBe('*');
  });

  test('single repo: merges both packageJson and appPackageJson into app', () => {
    const ctx: TemplateContext = {
      projectName: 'test-single',
      repo: 'single',
      apps: [{ appName: 'test-single', stackName: 'nextjs', libraries: ['trpc', 'tanstack-query'] }],
      project: { tooling: [] },
      git: true,
    };

    const results = generateAllPackageJsons(ctx);
    const pkg = results[0];

    // Both server and client deps merged flat
    expect(pkg.content.dependencies?.['@trpc/server']).toBeDefined();
    expect(pkg.content.dependencies?.['@trpc/client']).toBeDefined();
    expect(pkg.content.dependencies?.superjson).toBeDefined();
    expect(pkg.content.dependencies?.zod).toBeDefined();
    // No @repo/* refs
    const allDeps = { ...pkg.content.dependencies, ...pkg.content.devDependencies };
    const repoRefs = Object.keys(allDeps).filter((k) => k.startsWith('@repo/'));
    expect(repoRefs).toEqual([]);
  });
});
