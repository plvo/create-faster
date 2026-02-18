import { describe, expect, test } from 'bun:test';
import {
  generateAllPackageJsons,
  generateAppPackageJson,
  generateRootPackageJson,
  getPackageManager,
  mergePackageJsonConfigs,
} from '@/lib/package-json-generator';
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
    project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
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

  test('includes linter dependencies', () => {
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
    project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
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
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
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
    expect(app?.content.dependencies?.['@trpc/server']).toBeDefined();
    expect(app?.content.dependencies?.['@trpc/tanstack-react-query']).toBeDefined();
    expect(app?.content.dependencies?.['server-only']).toBeDefined();
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

describe('ESLint linter (turborepo)', () => {
  function findByPath(results: ReturnType<typeof generateAllPackageJsons>, path: string) {
    return results.find((r) => r.path === path);
  }

  const ctx: TemplateContext = {
    projectName: 'test-eslint',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { linter: 'eslint', tooling: [] },
    git: true,
  };

  test('generates eslint-config shared package', () => {
    const results = generateAllPackageJsons(ctx);
    const eslintPkg = findByPath(results, 'packages/eslint-config/package.json');

    expect(eslintPkg).toBeDefined();
    expect(eslintPkg?.content.name).toBe('@repo/eslint-config');
  });

  test('eslint-config package has all devDependencies', () => {
    const results = generateAllPackageJsons(ctx);
    const eslintPkg = findByPath(results, 'packages/eslint-config/package.json');

    expect(eslintPkg?.content.devDependencies?.eslint).toBeDefined();
    expect(eslintPkg?.content.devDependencies?.['@eslint/js']).toBeDefined();
    expect(eslintPkg?.content.devDependencies?.['typescript-eslint']).toBeDefined();
    expect(eslintPkg?.content.devDependencies?.globals).toBeDefined();
    expect(eslintPkg?.content.devDependencies?.['eslint-plugin-react']).toBeDefined();
  });

  test('eslint-config package has exports', () => {
    const results = generateAllPackageJsons(ctx);
    const eslintPkg = findByPath(results, 'packages/eslint-config/package.json');

    expect(eslintPkg?.content.exports?.['./base']).toBe('./base.js');
    expect(eslintPkg?.content.exports?.['./next']).toBe('./next.js');
    expect(eslintPkg?.content.exports?.['./server']).toBe('./server.js');
  });

  test('apps reference @repo/eslint-config', () => {
    const results = generateAllPackageJsons(ctx);
    const web = findByPath(results, 'apps/web/package.json');
    const api = findByPath(results, 'apps/api/package.json');

    expect(web?.content.devDependencies?.['@repo/eslint-config']).toBe('*');
    expect(api?.content.devDependencies?.['@repo/eslint-config']).toBe('*');
  });

  test('apps have lint script from appPackageJson', () => {
    const results = generateAllPackageJsons(ctx);
    const web = findByPath(results, 'apps/web/package.json');
    const api = findByPath(results, 'apps/api/package.json');

    expect(web?.content.scripts?.lint).toBe('eslint .');
    expect(api?.content.scripts?.lint).toBe('eslint .');
  });

  test('apps have eslint as direct devDependency', () => {
    const results = generateAllPackageJsons(ctx);
    const web = findByPath(results, 'apps/web/package.json');
    const api = findByPath(results, 'apps/api/package.json');

    expect(web?.content.devDependencies?.eslint).toBeDefined();
    expect(api?.content.devDependencies?.eslint).toBeDefined();
  });

  test('root package.json does NOT have eslint devDependencies', () => {
    const results = generateAllPackageJsons(ctx);
    const root = findByPath(results, 'package.json');

    expect(root?.content.devDependencies?.eslint).toBeUndefined();
    expect(root?.content.devDependencies?.['@eslint/js']).toBeUndefined();
  });
});

describe('ESLint linter (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-eslint-single',
    repo: 'single',
    apps: [{ appName: 'test-eslint-single', stackName: 'nextjs', libraries: [] }],
    project: { linter: 'eslint', tooling: [] },
    git: true,
  };

  test('includes all eslint deps directly in package.json', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);

    expect(result.content.devDependencies?.eslint).toBeDefined();
    expect(result.content.devDependencies?.['@eslint/js']).toBeDefined();
    expect(result.content.devDependencies?.['typescript-eslint']).toBeDefined();
    expect(result.content.devDependencies?.globals).toBeDefined();
    expect(result.content.devDependencies?.['eslint-plugin-react']).toBeDefined();
    expect(result.content.devDependencies?.['eslint-plugin-react-hooks']).toBeDefined();
    expect(result.content.devDependencies?.['@next/eslint-plugin-next']).toBeDefined();
  });

  test('includes lint script', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.lint).toBe('eslint .');
  });

  test('does not have @repo/eslint-config reference', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.['@repo/eslint-config']).toBeUndefined();
  });

  test('does not generate eslint-config package', () => {
    const results = generateAllPackageJsons(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('package.json');
  });
});

describe('Prettier linter (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-prettier-single',
    repo: 'single',
    apps: [{ appName: 'test-prettier-single', stackName: 'nextjs', libraries: [] }],
    project: { linter: 'prettier', tooling: [] },
    git: true,
  };

  test('includes prettier devDependencies', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.prettier).toBeDefined();
    expect(result.content.devDependencies?.['prettier-plugin-tailwindcss']).toBeDefined();
  });

  test('includes format scripts', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.format).toContain('prettier');
    expect(result.content.scripts?.['format:check']).toContain('prettier');
  });
});

describe('Prettier linter (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-prettier-turbo',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { linter: 'prettier', tooling: [] },
    git: true,
    pm: 'bun',
  };

  test('root package.json has prettier deps and scripts', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies?.prettier).toBeDefined();
    expect(result.content.devDependencies?.['prettier-plugin-tailwindcss']).toBeDefined();
    expect(result.content.scripts?.format).toContain('prettier');
    expect(result.content.scripts?.['format:check']).toContain('prettier');
  });

  test('does not generate a prettier package', () => {
    const results = generateAllPackageJsons(ctx);
    const paths = results.map((r) => r.path);
    expect(paths).not.toContain('packages/prettier/package.json');
  });
});

describe('ESLint + Prettier composite (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-eslint-prettier-single',
    repo: 'single',
    apps: [{ appName: 'test-eslint-prettier-single', stackName: 'nextjs', libraries: [] }],
    project: { linter: 'eslint-prettier', tooling: [] },
    git: true,
  };

  test('includes all eslint deps', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.eslint).toBeDefined();
    expect(result.content.devDependencies?.['@eslint/js']).toBeDefined();
    expect(result.content.devDependencies?.['typescript-eslint']).toBeDefined();
    expect(result.content.devDependencies?.['eslint-plugin-react']).toBeDefined();
  });

  test('includes prettier deps', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.prettier).toBeDefined();
    expect(result.content.devDependencies?.['prettier-plugin-tailwindcss']).toBeDefined();
  });

  test('includes eslint-config-prettier', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies?.['eslint-config-prettier']).toBeDefined();
  });

  test('includes both lint and format scripts', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts?.lint).toBe('eslint .');
    expect(result.content.scripts?.format).toContain('prettier');
    expect(result.content.scripts?.['format:check']).toContain('prettier');
  });
});

describe('ESLint + Prettier composite (turborepo)', () => {
  function findByPath(results: ReturnType<typeof generateAllPackageJsons>, path: string) {
    return results.find((r) => r.path === path);
  }

  const ctx: TemplateContext = {
    projectName: 'test-eslint-prettier-turbo',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { linter: 'eslint-prettier', tooling: [] },
    git: true,
    pm: 'bun',
  };

  test('generates eslint-config package with eslint + eslint-config-prettier deps', () => {
    const results = generateAllPackageJsons(ctx);
    const eslintPkg = findByPath(results, 'packages/eslint-config/package.json');

    expect(eslintPkg).toBeDefined();
    expect(eslintPkg?.content.name).toBe('@repo/eslint-config');
    expect(eslintPkg?.content.devDependencies?.eslint).toBeDefined();
    expect(eslintPkg?.content.devDependencies?.['eslint-config-prettier']).toBeDefined();
  });

  test('root package.json has prettier deps and scripts', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies?.prettier).toBeDefined();
    expect(result.content.devDependencies?.['prettier-plugin-tailwindcss']).toBeDefined();
    expect(result.content.scripts?.format).toContain('prettier');
    expect(result.content.scripts?.['format:check']).toContain('prettier');
  });

  test('root does NOT have eslint deps', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies?.eslint).toBeUndefined();
    expect(result.content.devDependencies?.['@eslint/js']).toBeUndefined();
  });

  test('apps reference @repo/eslint-config and have lint script', () => {
    const results = generateAllPackageJsons(ctx);
    const web = findByPath(results, 'apps/web/package.json');
    const api = findByPath(results, 'apps/api/package.json');

    expect(web?.content.devDependencies?.['@repo/eslint-config']).toBe('*');
    expect(api?.content.devDependencies?.['@repo/eslint-config']).toBe('*');
    expect(web?.content.scripts?.lint).toBe('eslint .');
    expect(api?.content.scripts?.lint).toBe('eslint .');
  });
});

describe('syncpack (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-syncpack',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: true,
    pm: 'bun',
  };

  test('includes syncpack as devDependency', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies?.syncpack).toBeDefined();
  });

  test('includes versions:list and versions:fix scripts', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.scripts?.['versions:list']).toBe('syncpack list-mismatches');
    expect(result.content.scripts?.['versions:fix']).toBe('syncpack fix');
  });

  test('includes syncpack config with local packages excluded', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.syncpack).toEqual({
      dependencyTypes: ['!local'],
      lintFormatting: false,
    });
  });
});

describe('getPackageManager', () => {
  test('returns bun@<version> format', () => {
    const result = getPackageManager('bun');
    expect(result).toMatch(/^bun@\d+\.\d+\.\d+/);
  });

  test('returns npm@<version> format', () => {
    const result = getPackageManager('npm');
    expect(result).toMatch(/^npm@\d+\.\d+\.\d+/);
  });
});

describe('generateRootPackageJson', () => {
  const ctx: TemplateContext = {
    projectName: 'test-root',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: true,
    pm: 'bun',
  };

  test('includes packageManager field', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.packageManager).toBeDefined();
    expect(result.content.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/);
  });

  test('defaults to npm when pm is undefined', () => {
    const ctxNoPm: TemplateContext = { ...ctx, pm: undefined };
    const result = generateRootPackageJson(ctxNoPm);
    expect(result.content.packageManager).toMatch(/^npm@\d+\.\d+\.\d+/);
  });

  test('includes turbo scripts', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.scripts?.dev).toBe('turbo dev');
    expect(result.content.scripts?.build).toBe('turbo build');
  });

  test('includes biome scripts and deps when linter is biome', () => {
    const ctxBiome: TemplateContext = {
      ...ctx,
      project: { linter: 'biome', tooling: [] },
    };
    const result = generateRootPackageJson(ctxBiome);
    expect(result.content.devDependencies?.['@biomejs/biome']).toBeDefined();
    expect(result.content.scripts?.format).toBeDefined();
    expect(result.content.scripts?.check).toBeDefined();
  });

  test('biome overwrites turbo lint with biome lint at root', () => {
    const ctxBiome: TemplateContext = {
      ...ctx,
      project: { linter: 'biome', tooling: [] },
    };
    const result = generateRootPackageJson(ctxBiome);
    expect(result.content.scripts?.lint).toBe('biome lint');
  });

  test('does NOT include eslint deps at root when linter is eslint', () => {
    const ctxEslint: TemplateContext = {
      ...ctx,
      project: { linter: 'eslint', tooling: [] },
    };
    const result = generateRootPackageJson(ctxEslint);
    expect(result.content.devDependencies?.eslint).toBeUndefined();
    expect(result.content.devDependencies?.['@eslint/js']).toBeUndefined();
  });

  test('clean script uses rimraf (not turbo task)', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.scripts?.clean).toContain('rimraf');
    expect(result.content.scripts?.clean).not.toBe('turbo clean');
  });

  test('includes rimraf as devDependency', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies?.rimraf).toBeDefined();
  });

  test('lint is turbo lint when linter is eslint', () => {
    const ctxEslint: TemplateContext = {
      ...ctx,
      project: { linter: 'eslint', tooling: [] },
    };
    const result = generateRootPackageJson(ctxEslint);
    expect(result.content.scripts?.lint).toBe('turbo lint');
  });

  test('lint is turbo lint when linter is eslint-prettier', () => {
    const ctxEslintPrettier: TemplateContext = {
      ...ctx,
      project: { linter: 'eslint-prettier', tooling: [] },
    };
    const result = generateRootPackageJson(ctxEslintPrettier);
    expect(result.content.scripts?.lint).toBe('turbo lint');
  });

  test('no turbo lint when linter is prettier only', () => {
    const ctxPrettier: TemplateContext = {
      ...ctx,
      project: { linter: 'prettier', tooling: [] },
    };
    const result = generateRootPackageJson(ctxPrettier);
    expect(result.content.scripts?.lint).toBeUndefined();
  });

  test('no lint script when no linter selected', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.scripts?.lint).toBeUndefined();
  });
});

describe('packageManager in single repo', () => {
  test('includes packageManager when pm is set', () => {
    const ctx: TemplateContext = {
      projectName: 'test-single',
      repo: 'single',
      apps: [{ appName: 'test-single', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: true,
      pm: 'bun',
    };
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/);
  });

  test('omits packageManager when pm is undefined', () => {
    const ctx: TemplateContext = {
      projectName: 'test-single',
      repo: 'single',
      apps: [{ appName: 'test-single', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: true,
      pm: undefined,
    };
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.packageManager).toBeUndefined();
  });

  test('does not add packageManager to turborepo app package.json', () => {
    const ctx: TemplateContext = {
      projectName: 'test-turbo',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: true,
      pm: 'bun',
    };
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.packageManager).toBeUndefined();
  });
});

describe('Husky lint-staged (single repo)', () => {
  function makeSingleCtx(linter?: string): TemplateContext {
    return {
      projectName: 'test-husky',
      repo: 'single',
      apps: [{ appName: 'test-husky', stackName: 'nextjs', libraries: [] }],
      project: { linter, tooling: ['husky'] },
      git: true,
    };
  }

  test('biome: lint-staged has only biome command', () => {
    const result = generateAppPackageJson(makeSingleCtx('biome').apps[0], makeSingleCtx('biome'), 0);
    const lintStaged = result.content['lint-staged'] as Record<string, string[]>;
    expect(lintStaged).toBeDefined();
    const commands = Object.values(lintStaged)[0];
    expect(commands).toEqual(['biome check --write --unsafe --no-errors-on-unmatched']);
  });

  test('eslint: lint-staged has only eslint command', () => {
    const ctx = makeSingleCtx('eslint');
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    const lintStaged = result.content['lint-staged'] as Record<string, string[]>;
    expect(lintStaged).toBeDefined();
    const commands = Object.values(lintStaged)[0];
    expect(commands).toEqual(['eslint --fix']);
  });

  test('prettier: lint-staged has only prettier command', () => {
    const ctx = makeSingleCtx('prettier');
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    const lintStaged = result.content['lint-staged'] as Record<string, string[]>;
    expect(lintStaged).toBeDefined();
    const commands = Object.values(lintStaged)[0];
    expect(commands).toEqual(['prettier --write']);
  });

  test('eslint-prettier: lint-staged has both eslint and prettier commands', () => {
    const ctx = makeSingleCtx('eslint-prettier');
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    const lintStaged = result.content['lint-staged'] as Record<string, string[]>;
    expect(lintStaged).toBeDefined();
    const commands = Object.values(lintStaged)[0];
    expect(commands).toEqual(['eslint --fix', 'prettier --write']);
  });

  test('no linter: no lint-staged key in output', () => {
    const ctx = makeSingleCtx();
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content['lint-staged']).toBeUndefined();
  });
});

describe('Husky lint-staged (turborepo)', () => {
  function makeTurboCtx(linter?: string): TemplateContext {
    return {
      projectName: 'test-husky-turbo',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { linter, tooling: ['husky'] },
      git: true,
      pm: 'bun',
    };
  }

  test('biome: root package.json has lint-staged with biome command', () => {
    const ctx = makeTurboCtx('biome');
    const result = generateRootPackageJson(ctx);
    const lintStaged = result.content['lint-staged'] as Record<string, string[]>;
    expect(lintStaged).toBeDefined();
    const commands = Object.values(lintStaged)[0];
    expect(commands).toEqual(['biome check --write --unsafe --no-errors-on-unmatched']);
  });

  test('eslint-prettier: root has both commands', () => {
    const ctx = makeTurboCtx('eslint-prettier');
    const result = generateRootPackageJson(ctx);
    const lintStaged = result.content['lint-staged'] as Record<string, string[]>;
    expect(lintStaged).toBeDefined();
    const commands = Object.values(lintStaged)[0];
    expect(commands).toEqual(['eslint --fix', 'prettier --write']);
  });

  test('no linter: no lint-staged key in root output', () => {
    const ctx = makeTurboCtx();
    const result = generateRootPackageJson(ctx);
    expect(result.content['lint-staged']).toBeUndefined();
  });
});
