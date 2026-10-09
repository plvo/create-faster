import { describe, expect, test } from 'bun:test';
import { $when, resolveConditionals } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';

function makeCtx(project: Partial<TemplateContext['project']> = {}): TemplateContext {
  return {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [], ...project },
    git: true,
  };
}

describe('$when', () => {
  test('creates a tagged item that resolveConditionals recognizes', () => {
    const item = $when({ linter: 'biome' }, 'biome check');
    const ctx = makeCtx({ linter: 'biome' });
    const result = resolveConditionals([item], ctx);
    expect(result).toEqual(['biome check']);
  });

  test('non-matching item is excluded', () => {
    const item = $when({ linter: 'biome' }, 'biome check');
    const ctx = makeCtx({ linter: 'eslint' });
    const result = resolveConditionals([item], ctx);
    expect(result).toEqual([]);
  });
});

describe('resolveConditionals', () => {
  test('keeps plain values unchanged', () => {
    const ctx = makeCtx();
    expect(resolveConditionals('hello', ctx)).toBe('hello');
    expect(resolveConditionals(42, ctx)).toBe(42);
    expect(resolveConditionals(null, ctx)).toBe(null);
  });

  test('filters $when items in arrays', () => {
    const data = [
      $when({ linter: 'biome' }, 'biome check --write'),
      $when({ linter: 'eslint' }, 'eslint --fix'),
      $when({ linter: 'prettier' }, 'prettier --write'),
    ];
    const ctx = makeCtx({ linter: 'biome' });
    expect(resolveConditionals(data, ctx)).toEqual(['biome check --write']);
  });

  test('mixes plain and $when items in arrays', () => {
    const data = ['always-here', $when({ linter: 'biome' }, 'biome check'), $when({ linter: 'eslint' }, 'eslint')];
    const ctx = makeCtx({ linter: 'biome' });
    expect(resolveConditionals(data, ctx)).toEqual(['always-here', 'biome check']);
  });

  test('resolves nested objects recursively', () => {
    const data = {
      'lint-staged': {
        '*.ts': [$when({ linter: 'biome' }, 'biome check'), $when({ linter: 'eslint' }, 'eslint --fix')],
      },
    };
    const ctx = makeCtx({ linter: 'eslint' });
    const result = resolveConditionals(data, ctx);
    expect(result).toEqual({
      'lint-staged': {
        '*.ts': ['eslint --fix'],
      },
    });
  });

  test('omits keys whose resolved value is an empty object', () => {
    const data = {
      'lint-staged': {
        '*.ts': [$when({ linter: 'biome' }, 'biome check')],
      },
    };
    const ctx = makeCtx({ linter: 'eslint' });
    const result = resolveConditionals(data, ctx);
    expect(result).toEqual({});
  });

  test('omits entire lint-staged when all glob patterns resolve to empty', () => {
    const data = {
      scripts: { prepare: 'husky' },
      'lint-staged': {
        '*.ts': [$when({ linter: 'biome' }, 'biome check')],
      },
    };
    const ctx = makeCtx();
    const result = resolveConditionals(data, ctx);
    expect(result).toEqual({ scripts: { prepare: 'husky' } });
  });
});

describe('composite linter matching via array conditions', () => {
  test('eslint-prettier matches both eslint and prettier array conditions', () => {
    const data = [
      $when({ linter: 'biome' }, 'biome check'),
      $when({ linter: ['eslint', 'eslint-prettier'] }, 'eslint --fix'),
      $when({ linter: ['prettier', 'eslint-prettier'] }, 'prettier --write'),
    ];
    const ctx = makeCtx({ linter: 'eslint-prettier' });
    expect(resolveConditionals(data, ctx)).toEqual(['eslint --fix', 'prettier --write']);
  });

  test('eslint only matches eslint condition, not prettier', () => {
    const data = [
      $when({ linter: ['eslint', 'eslint-prettier'] }, 'eslint --fix'),
      $when({ linter: ['prettier', 'eslint-prettier'] }, 'prettier --write'),
    ];
    const ctx = makeCtx({ linter: 'eslint' });
    expect(resolveConditionals(data, ctx)).toEqual(['eslint --fix']);
  });
});

describe('no selection', () => {
  test('all $when items removed when category not selected', () => {
    const data = {
      'lint-staged': {
        '*.ts': [
          $when({ linter: 'biome' }, 'biome check'),
          $when({ linter: 'eslint' }, 'eslint --fix'),
          $when({ linter: 'prettier' }, 'prettier --write'),
        ],
      },
    };
    const ctx = makeCtx();
    const result = resolveConditionals(data, ctx);
    expect(result['lint-staged']).toBeUndefined();
  });
});

describe('multiple conditions', () => {
  test('all conditions must match', () => {
    const item = $when({ linter: 'eslint', orm: 'drizzle' }, 'special-cmd');
    const ctxMatch = makeCtx({ linter: 'eslint', orm: 'drizzle' });
    const ctxPartial = makeCtx({ linter: 'eslint' });

    expect(resolveConditionals([item], ctxMatch)).toEqual(['special-cmd']);
    expect(resolveConditionals([item], ctxPartial)).toEqual([]);
  });
});

describe('repo matcher', () => {
  test('matches when repo type matches', () => {
    const item = $when({ repo: 'turborepo' }, '@repo/db');
    const turboCtx: TemplateContext = { ...makeCtx(), repo: 'turborepo' };
    const singleCtx: TemplateContext = { ...makeCtx(), repo: 'single' };

    expect(resolveConditionals([item], turboCtx)).toEqual(['@repo/db']);
    expect(resolveConditionals([item], singleCtx)).toEqual([]);
  });

  test('works as object value (dep version)', () => {
    const data = { '@repo/db': $when({ repo: 'turborepo' }, '*') };
    const turboCtx: TemplateContext = { ...makeCtx(), repo: 'turborepo' };
    const singleCtx: TemplateContext = { ...makeCtx(), repo: 'single' };

    expect(resolveConditionals(data, turboCtx)).toEqual({ '@repo/db': '*' });
    expect(resolveConditionals(data, singleCtx)).toEqual({});
  });
});

describe('stack matcher', () => {
  function makeCtxWithStack(stackName: 'nextjs' | 'hono' | 'expo' | 'tanstack-start'): TemplateContext {
    return {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'app', stackName, libraries: [] }],
      project: { tooling: [] },
      git: true,
    };
  }

  test('matches single stack', () => {
    const item = $when({ stack: 'nextjs' }, 'nextjs-only');
    expect(resolveConditionals([item], makeCtxWithStack('nextjs'))).toEqual(['nextjs-only']);
    expect(resolveConditionals([item], makeCtxWithStack('hono'))).toEqual([]);
  });

  test('matches any of multiple stacks', () => {
    const item = $when({ stack: ['nextjs', 'tanstack-start'] }, 'react-dep');
    expect(resolveConditionals([item], makeCtxWithStack('nextjs'))).toEqual(['react-dep']);
    expect(resolveConditionals([item], makeCtxWithStack('tanstack-start'))).toEqual(['react-dep']);
    expect(resolveConditionals([item], makeCtxWithStack('hono'))).toEqual([]);
  });

  test('matches if ANY app uses the stack (multi-app)', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { tooling: [] },
      git: true,
    };
    const item = $when({ stack: 'nextjs' }, 'nextjs-plugin');
    expect(resolveConditionals([item], ctx)).toEqual(['nextjs-plugin']);
  });

  test('works as object value (dep version)', () => {
    const data = { '@next/eslint-plugin-next': $when({ stack: 'nextjs' }, '^16.0.0') };
    expect(resolveConditionals(data, makeCtxWithStack('nextjs'))).toEqual({
      '@next/eslint-plugin-next': '^16.0.0',
    });
    expect(resolveConditionals(data, makeCtxWithStack('hono'))).toEqual({});
  });
});

describe('library matcher', () => {
  function makeCtxWithLibrary(libraries: string[]): TemplateContext {
    return {
      projectName: 'test',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries }],
      project: { tooling: [] },
      git: true,
    };
  }

  test('matches when app has the library', () => {
    const item = $when({ library: 'better-auth' }, '@repo/auth');
    expect(resolveConditionals([item], makeCtxWithLibrary(['better-auth']))).toEqual(['@repo/auth']);
    expect(resolveConditionals([item], makeCtxWithLibrary([]))).toEqual([]);
  });

  test('matches any of multiple libraries', () => {
    const item = $when({ library: ['shadcn', 'nativewind'] }, 'ui-dep');
    expect(resolveConditionals([item], makeCtxWithLibrary(['shadcn']))).toEqual(['ui-dep']);
    expect(resolveConditionals([item], makeCtxWithLibrary(['nativewind']))).toEqual(['ui-dep']);
    expect(resolveConditionals([item], makeCtxWithLibrary([]))).toEqual([]);
  });

  test('matches if ANY app has the library', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { tooling: [] },
      git: true,
    };
    const item = $when({ library: 'better-auth' }, '@repo/auth');
    expect(resolveConditionals([item], ctx)).toEqual(['@repo/auth']);
  });
});

describe('true value in ProjectContext matcher', () => {
  test('orm: true matches any orm value', () => {
    const item = $when({ orm: true }, '@repo/db');
    expect(resolveConditionals([item], makeCtx({ orm: 'drizzle' }))).toEqual(['@repo/db']);
    expect(resolveConditionals([item], makeCtx({ orm: 'prisma' }))).toEqual(['@repo/db']);
    expect(resolveConditionals([item], makeCtx())).toEqual([]);
  });

  test('can combine repo and orm: true', () => {
    const item = $when({ repo: 'turborepo', orm: true }, '*');
    const turboWithOrm: TemplateContext = { ...makeCtx({ orm: 'drizzle' }), repo: 'turborepo' };
    const turboNoOrm: TemplateContext = { ...makeCtx(), repo: 'turborepo' };
    const singleWithOrm: TemplateContext = { ...makeCtx({ orm: 'drizzle' }), repo: 'single' };

    expect(resolveConditionals([item], turboWithOrm)).toEqual(['*']);
    expect(resolveConditionals([item], turboNoOrm)).toEqual([]);
    expect(resolveConditionals([item], singleWithOrm)).toEqual([]);
  });
});

function resolveValues(items: ReturnType<typeof $when<string>>[], ctx: TemplateContext): string[] {
  return resolveConditionals(items, ctx) as unknown as string[];
}

describe('not matcher', () => {
  const item = $when({ deployment: { not: 'cloudflare' } }, 'non-cloudflare-dep');

  test('excludes the negated value and keeps any other', () => {
    expect(resolveValues([item], makeCtx({ deployment: 'cloudflare' }))).toEqual([]);
    expect(resolveValues([item], makeCtx({ deployment: 'terraform-aws' }))).toEqual(['non-cloudflare-dep']);
  });

  test('is true when the category has no selection', () => {
    expect(resolveValues([item], makeCtx())).toEqual(['non-cloudflare-dep']);
  });

  test('list form excludes every listed value', () => {
    const listItem = $when({ deployment: { not: ['cloudflare', 'cloudflare-static'] } }, 'server-dep');
    expect(resolveValues([listItem], makeCtx({ deployment: 'cloudflare' }))).toEqual([]);
    expect(resolveValues([listItem], makeCtx({ deployment: 'cloudflare-static' }))).toEqual([]);
    expect(resolveValues([listItem], makeCtx({ deployment: 'terraform-aws' }))).toEqual(['server-dep']);
    expect(resolveValues([listItem], makeCtx())).toEqual(['server-dep']);
  });

  test('not: true matches only when the category is unselected', () => {
    const unselected = $when({ orm: { not: true } }, 'no-orm');
    expect(resolveValues([unselected], makeCtx({ orm: 'drizzle' }))).toEqual([]);
    expect(resolveValues([unselected], makeCtx())).toEqual(['no-orm']);
  });

  test('negates against every value of a multi-select category', () => {
    const noHusky = $when({ tooling: { not: 'husky' } }, 'no-husky');
    expect(resolveValues([noHusky], makeCtx({ tooling: ['husky', 'other'] }))).toEqual([]);
    expect(resolveValues([noHusky], makeCtx({ tooling: ['other'] }))).toEqual(['no-husky']);
  });

  test('treats an empty multi-select category as unselected', () => {
    const noTooling = $when({ tooling: { not: true } }, 'no-tooling');
    const anyTooling = $when({ tooling: true }, 'some-tooling');
    expect(resolveValues([noTooling], makeCtx())).toEqual(['no-tooling']);
    expect(resolveValues([noTooling], makeCtx({ tooling: ['husky'] }))).toEqual([]);
    expect(resolveValues([anyTooling], makeCtx())).toEqual([]);
    expect(resolveValues([anyTooling], makeCtx({ tooling: ['husky'] }))).toEqual(['some-tooling']);
  });

  test('negates the repo key', () => {
    const notTurbo = $when({ repo: { not: 'turborepo' } }, 'single-only');
    expect(resolveValues([notTurbo], makeCtx())).toEqual(['single-only']);
    expect(resolveValues([notTurbo], { ...makeCtx(), repo: 'turborepo' })).toEqual([]);
  });

  test('negates the stack key: true only when no app uses a listed stack', () => {
    const noNextjs = $when({ stack: { not: 'nextjs' } }, 'no-nextjs');
    const mixed: TemplateContext = {
      ...makeCtx(),
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
    };
    const honoOnly: TemplateContext = { ...mixed, apps: [{ appName: 'api', stackName: 'hono', libraries: [] }] };
    expect(resolveValues([noNextjs], mixed)).toEqual([]);
    expect(resolveValues([noNextjs], honoOnly)).toEqual(['no-nextjs']);
  });

  test('negates the library key: true only when no app has a listed library', () => {
    const noAuth = $when({ library: { not: ['better-auth'] } }, 'no-auth');
    const withAuth: TemplateContext = {
      ...makeCtx(),
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
    };
    expect(resolveValues([noAuth], withAuth)).toEqual([]);
    expect(resolveValues([noAuth], makeCtx())).toEqual(['no-auth']);
  });

  test('combines with a positive condition', () => {
    const combined = $when({ database: 'postgres', deployment: { not: 'cloudflare' } }, 'pg-direct');
    expect(resolveValues([combined], makeCtx({ database: 'postgres' }))).toEqual(['pg-direct']);
    expect(resolveValues([combined], makeCtx({ database: 'postgres', deployment: 'cloudflare' }))).toEqual([]);
    expect(resolveValues([combined], makeCtx({ deployment: 'terraform-aws' }))).toEqual([]);
  });
});
