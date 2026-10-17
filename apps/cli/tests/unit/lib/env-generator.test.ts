import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import {
  collectAppSecrets,
  collectEnvFiles,
  collectEnvGroups,
  collectEnvsToGenerate,
  collectProjectSecrets,
  collectTaskEnv,
  collectThirdPartyEnvs,
} from '@/lib/env-generator';
import type { TemplateContext } from '@/types/ctx';
import type { EnvVar, MetaAddon, MetaBlueprint } from '@/types/meta';

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: {
      database: 'postgres',
      orm: 'drizzle',
      linter: 'biome',
      tooling: [],
    },
    git: true,
    pm: 'bun',
    ...overrides,
  };
}

describe('collectEnvFiles', () => {
  test('generates .env.example for pkg scope in turborepo', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    const dbEnv = files.find((f) => f.destination === 'packages/db/.env.example');
    expect(dbEnv).toBeDefined();
  });

  test('does not generate a pkg scope .env.example when no addon creates that package', () => {
    const ctx = makeContext({ project: { database: 'postgres', linter: 'biome', tooling: [] } });
    const files = collectEnvFiles(ctx);

    expect(files.map((f) => f.destination)).not.toContain('packages/db/.env.example');
    expect(files.find((f) => f.destination === 'apps/web/.env.example')?.content).toContain('DATABASE_URL');
    expect(files.find((f) => f.destination === 'apps/api/.env.example')?.content).toContain('DATABASE_URL');
    expect(collectEnvGroups(ctx).map((g) => g.path)).not.toContain('packages/db/.env');
  });

  test('generates .env.example for app scope per app with library', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    expect(webEnv).toBeDefined();

    // web has better-auth, so should have BETTER_AUTH vars
    const apiEnv = files.find((f) => f.destination === 'apps/api/.env.example');
    expect(apiEnv).toBeDefined();
  });

  test('app scope for project addon envs goes to all apps', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    // DATABASE_URL has app scope (project addon) → all apps get it
    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    const apiEnv = files.find((f) => f.destination === 'apps/api/.env.example');

    expect(webEnv?.content).toContain('DATABASE_URL');
    expect(apiEnv?.content).toContain('DATABASE_URL');
  });

  test('app scope for library envs only goes to apps with that library', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    const apiEnv = files.find((f) => f.destination === 'apps/api/.env.example');

    // web has better-auth, api does not
    expect(webEnv?.content).toContain('BETTER_AUTH_SECRET');
    expect(apiEnv?.content).not.toContain('BETTER_AUTH_SECRET');
  });

  test('resolves {{projectName}} in env values', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    const dbEnv = files.find((f) => f.destination === 'packages/db/.env.example');
    expect(dbEnv?.content).toContain('my-project');
    expect(dbEnv?.content).not.toContain('{{projectName}}');
  });

  test('resolves {{appPort}} per app', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    expect(webEnv?.content).toContain('localhost:3000');
    expect(webEnv?.content).not.toContain('{{appPort}}');
  });

  test('resolves {{appUrl}} to localhost URL without portless', () => {
    const ctx = makeContext({ project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] } });
    const files = collectEnvFiles(ctx);

    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    expect(webEnv?.content).toContain('BETTER_AUTH_URL=http://localhost:3000');
    expect(webEnv?.content).not.toContain('{{appUrl}}');
  });

  test('resolves {{appUrl}} to portless domain in turborepo', () => {
    const ctx = makeContext({
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: ['portless'] },
    });
    const files = collectEnvFiles(ctx);

    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    expect(webEnv?.content).toContain('BETTER_AUTH_URL=https://web.localhost:1355');
  });

  test('resolves {{appUrl}} to portless domain in single repo', () => {
    const ctx = makeContext({
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: ['better-auth'] }],
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: ['portless'] },
    });
    const files = collectEnvFiles(ctx);

    expect(files[0]!.content).toContain('BETTER_AUTH_URL=https://my-project.localhost:1355');
  });

  test('does not pollute .env.example with NEXT_PUBLIC_APP_URL when portless is selected', () => {
    const ctx = makeContext({
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: ['portless'] },
    });
    const files = collectEnvFiles(ctx);

    for (const file of files) {
      expect(file.content).not.toContain('NEXT_PUBLIC_APP_URL');
    }
  });

  test('dedupes env vars by key within same destination', () => {
    const ctx = makeContext();
    const files = collectEnvFiles(ctx);

    const webEnv = files.find((f) => f.destination === 'apps/web/.env.example');
    const databaseUrlCount = (webEnv?.content.match(/DATABASE_URL/g) || []).length;
    expect(databaseUrlCount).toBe(1);
  });

  test('single repo collapses all scopes to root .env.example', () => {
    const ctx = makeContext({
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: ['better-auth'] }],
    });
    const files = collectEnvFiles(ctx);

    expect(files).toHaveLength(1);
    expect(files[0]!.destination).toBe('.env.example');
    expect(files[0]!.content).toContain('DATABASE_URL');
    expect(files[0]!.content).toContain('BETTER_AUTH_SECRET');
  });

  test('returns empty array when no addons have envs', () => {
    const ctx = makeContext({
      project: { linter: 'biome', tooling: [] },
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    });
    const files = collectEnvFiles(ctx);
    expect(files).toHaveLength(0);
  });
});

describe('collectEnvGroups', () => {
  test('returns grouped env var names by path for README', () => {
    const ctx = makeContext();
    const groups = collectEnvGroups(ctx);

    expect(groups.length).toBeGreaterThan(0);

    const dbGroup = groups.find((g) => g.path === 'packages/db/.env');
    expect(dbGroup).toBeDefined();
    expect(dbGroup!.vars).toContain('DATABASE_URL');
  });

  test('single repo uses .env as path', () => {
    const ctx = makeContext({
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: ['better-auth'] }],
    });
    const groups = collectEnvGroups(ctx);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.path).toBe('.env');
  });
});

describe('blueprint env generation', () => {
  test('collects blueprint env vars into .env.example', () => {
    const ctx: TemplateContext = {
      projectName: 'test-bp',
      repo: 'turborepo',
      apps: [
        {
          appName: 'web',
          stackName: 'nextjs',
          libraries: [
            'shadcn',
            'better-auth',
            'trpc',
            'tanstack-query',
            'tanstack-devtools',
            'tanstack-form',
            'next-themes',
          ],
        },
        { appName: 'batch', stackName: 'node', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: false,
      blueprint: 'org-dashboard-nextjs',
    };

    const files = collectEnvFiles(ctx);
    expect(files.length).toBeGreaterThan(0);
    const webEnv = files.find((f) => f.destination.includes('web'));
    expect(webEnv?.content).toContain('BETTER_AUTH_SECRET');
  });
});

describe('EnvVar scope and when', () => {
  const postgres = META.project.database.options.postgres as MetaAddon;
  const noOrmCtx = makeContext({
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { database: 'postgres', linter: 'biome', tooling: [] },
  });

  function withPostgresEnvs<T>(envs: EnvVar[], run: () => T): T {
    const previous = postgres.envs;
    postgres.envs = envs;
    try {
      return run();
    } finally {
      postgres.envs = previous;
    }
  }

  test('a variable scoped only to a missing package falls back to the app scope', () => {
    const files = withPostgresEnvs([{ value: 'ONLY_PKG=1', monoScope: [{ pkg: 'db' }] }], () =>
      collectEnvFiles(noOrmCtx),
    );

    expect(files.map((f) => f.destination).sort()).toEqual(['apps/api/.env.example', 'apps/web/.env.example']);
    expect(files.every((f) => f.content.includes('ONLY_PKG=1'))).toBe(true);
  });

  test('a variable scoped only to an existing package stays in it', () => {
    const files = withPostgresEnvs([{ value: 'ONLY_PKG=1', monoScope: [{ pkg: 'db' }] }], () =>
      collectEnvFiles(makeContext()),
    );

    expect(files.find((f) => f.destination === 'packages/db/.env.example')?.content).toContain('ONLY_PKG=1');
    expect(files.find((f) => f.destination === 'apps/web/.env.example')?.content ?? '').not.toContain('ONLY_PKG');
  });

  test('a variable with a when condition is emitted only when the condition holds', () => {
    const envs: EnvVar[] = [{ value: 'NEEDS_ORM=1', monoScope: ['app'], when: { orm: true } }];

    const withOrm = withPostgresEnvs(envs, () => collectEnvFiles(makeContext()));
    const withoutOrm = withPostgresEnvs(envs, () => collectEnvFiles(noOrmCtx));

    expect(withOrm.find((f) => f.destination === 'apps/web/.env.example')?.content).toContain('NEEDS_ORM=1');
    expect(withoutOrm).toEqual([]);
  });
});

describe('EnvVar.file', () => {
  const postgres = META.project.database.options.postgres as MetaAddon;
  const FILE_ENVS: EnvVar[] = [
    { value: 'IN_DEDICATED=1', monoScope: [{ pkg: 'db' }, 'app'], file: 'secrets' },
    { value: 'IN_DEFAULT=1', monoScope: [{ pkg: 'db' }] },
  ];

  function collect<T>(run: () => T): T {
    const previous = postgres.envs;
    postgres.envs = FILE_ENVS;
    try {
      return run();
    } finally {
      postgres.envs = previous;
    }
  }

  test('a variable with a file lands in .env.<file>.example instead of .env.example', () => {
    const files = collect(() => collectEnvFiles(makeContext()));

    const dedicated = files.find((f) => f.destination === 'packages/db/.env.secrets.example');
    expect(dedicated?.content).toBe('IN_DEDICATED=1\n');
    expect(files.find((f) => f.destination === 'packages/db/.env.example')?.content).toBe('IN_DEFAULT=1\n');
  });

  test('a variable with a file in an app scope stays out of the default file of every app', () => {
    const files = collect(() => collectEnvFiles(makeContext()));

    expect(files.map((f) => f.destination)).toContain('apps/web/.env.secrets.example');
    expect(files.find((f) => f.destination === 'apps/web/.env.example')?.content ?? '').not.toContain('IN_DEDICATED');
  });

  test('single repo collapses a variable with a file into the root .env.<file>.example', () => {
    const files = collect(() =>
      collectEnvFiles(makeContext({ repo: 'single', apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: [] }] })),
    );

    expect(files.map((f) => f.destination).sort()).toEqual(['.env.example', '.env.secrets.example']);
  });

  test('collectEnvGroups names the file without the example suffix', () => {
    const groups = collect(() => collectEnvGroups(makeContext()));

    expect(groups.find((g) => g.path === 'packages/db/.env.secrets')?.vars).toEqual(['IN_DEDICATED']);
  });
});

describe('EnvVar.stacks filter', () => {
  const STACK_ENVS: EnvVar[] = [
    { value: 'NEXT_PUBLIC_TOKEN=next-token', monoScope: ['app'], stacks: ['nextjs'] },
    { value: 'VITE_TOKEN=vite-token', monoScope: ['app'], stacks: ['tanstack-start'] },
    { value: 'SHARED_TOKEN=shared-token', monoScope: ['app'] },
  ];

  function withEnvs<T>(addon: { envs?: EnvVar[] }, envs: EnvVar[], run: () => T): T {
    const previous = addon.envs;
    addon.envs = envs;
    try {
      return run();
    } finally {
      addon.envs = previous;
    }
  }

  const mixedStacksCtx: TemplateContext = {
    projectName: 'mixed',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'site', stackName: 'tanstack-start', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    git: false,
  };

  function contentOf(files: ReturnType<typeof collectEnvFiles>, destination: string): string {
    return files.find((f) => f.destination === destination)?.content ?? '';
  }

  const postgres = META.project.database.options.postgres as MetaAddon;
  const vitest = META.libraries.vitest as MetaAddon;

  test('emits each variable only on apps whose stack is listed (project addon)', () => {
    const files = withEnvs(postgres, STACK_ENVS, () => collectEnvFiles(mixedStacksCtx));

    const web = contentOf(files, 'apps/web/.env.example');
    const site = contentOf(files, 'apps/site/.env.example');
    const api = contentOf(files, 'apps/api/.env.example');

    expect(web).toContain('NEXT_PUBLIC_TOKEN=next-token');
    expect(web).not.toContain('VITE_TOKEN');
    expect(site).toContain('VITE_TOKEN=vite-token');
    expect(site).not.toContain('NEXT_PUBLIC_TOKEN');
    expect(api).not.toContain('NEXT_PUBLIC_TOKEN');
    expect(api).not.toContain('VITE_TOKEN');
  });

  test('variables without stacks still reach every app', () => {
    const files = withEnvs(postgres, STACK_ENVS, () => collectEnvFiles(mixedStacksCtx));

    for (const app of ['web', 'site', 'api']) {
      expect(contentOf(files, `apps/${app}/.env.example`)).toContain('SHARED_TOKEN=shared-token');
    }
  });

  test('applies to library envs, only for apps that have the library and a listed stack', () => {
    const ctx: TemplateContext = {
      ...mixedStacksCtx,
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['vitest'] },
        { appName: 'site', stackName: 'tanstack-start', libraries: ['vitest'] },
        { appName: 'plain', stackName: 'nextjs', libraries: [] },
      ],
    };
    const files = withEnvs(vitest, STACK_ENVS, () => collectEnvFiles(ctx));

    expect(contentOf(files, 'apps/web/.env.example')).toContain('NEXT_PUBLIC_TOKEN');
    expect(contentOf(files, 'apps/web/.env.example')).not.toContain('VITE_TOKEN');
    expect(contentOf(files, 'apps/site/.env.example')).toContain('VITE_TOKEN');
    expect(contentOf(files, 'apps/site/.env.example')).not.toContain('NEXT_PUBLIC_TOKEN');
    expect(contentOf(files, 'apps/plain/.env.example')).not.toContain('_TOKEN');
  });

  test('single repo collapse keeps only the variables of the app stack', () => {
    const ctx: TemplateContext = {
      ...mixedStacksCtx,
      repo: 'single',
      apps: [{ appName: 'mixed', stackName: 'tanstack-start', libraries: [] }],
    };
    const files = withEnvs(postgres, STACK_ENVS, () => collectEnvFiles(ctx));

    const content = contentOf(files, '.env.example');

    expect(files.map((f) => f.destination)).toEqual(['.env.example']);
    expect(content).toContain('VITE_TOKEN=vite-token');
    expect(content).toContain('SHARED_TOKEN=shared-token');
    expect(content).not.toContain('NEXT_PUBLIC_TOKEN');
  });

  test('collectEnvGroups lists the filtered keys per app', () => {
    const groups = withEnvs(postgres, STACK_ENVS, () => collectEnvGroups(mixedStacksCtx));

    expect(groups.find((g) => g.path === 'apps/web/.env')?.vars).toContain('NEXT_PUBLIC_TOKEN');
    expect(groups.find((g) => g.path === 'apps/web/.env')?.vars).not.toContain('VITE_TOKEN');
    expect(groups.find((g) => g.path === 'apps/site/.env')?.vars).toContain('VITE_TOKEN');
    expect(groups.find((g) => g.path === 'apps/site/.env')?.vars).not.toContain('NEXT_PUBLIC_TOKEN');
  });

  test('root scope variable is emitted when any app has a listed stack', () => {
    const rootEnv: EnvVar[] = [{ value: 'ROOT_NEXT=1', monoScope: ['root'], stacks: ['nextjs'] }];

    const withNext = withEnvs(postgres, rootEnv, () => collectEnvFiles(mixedStacksCtx));
    const withoutNext = withEnvs(postgres, rootEnv, () =>
      collectEnvFiles({ ...mixedStacksCtx, apps: mixedStacksCtx.apps.slice(1) }),
    );

    expect(contentOf(withNext, '.env.example')).toContain('ROOT_NEXT=1');
    expect(contentOf(withoutNext, '.env.example')).not.toContain('ROOT_NEXT');
  });

  test('pkg scope variable follows the same any-app stack rule', () => {
    const pkgEnv: EnvVar[] = [{ value: 'DB_NEXT=1', monoScope: [{ pkg: 'db' }], stacks: ['nextjs'] }];

    const withNext = withEnvs(postgres, pkgEnv, () => collectEnvFiles(mixedStacksCtx));
    const withoutNext = withEnvs(postgres, pkgEnv, () =>
      collectEnvFiles({ ...mixedStacksCtx, apps: mixedStacksCtx.apps.slice(1) }),
    );

    expect(contentOf(withNext, 'packages/db/.env.example')).toContain('DB_NEXT=1');
    expect(contentOf(withoutNext, 'packages/db/.env.example')).not.toContain('DB_NEXT');
  });

  test('library root variable needs one app with both the library and a listed stack', () => {
    const libraryRootEnv: EnvVar[] = [{ value: 'LIB_ROOT=1', monoScope: ['root'], stacks: ['nextjs'] }];
    const splitCtx: TemplateContext = {
      ...mixedStacksCtx,
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'site', stackName: 'tanstack-start', libraries: ['vitest'] },
      ],
    };
    const sameAppCtx: TemplateContext = {
      ...mixedStacksCtx,
      apps: [...splitCtx.apps, { appName: 'docs', stackName: 'nextjs', libraries: ['vitest'] }],
    };

    const split = withEnvs(vitest, libraryRootEnv, () => collectEnvFiles(splitCtx));
    const sameApp = withEnvs(vitest, libraryRootEnv, () => collectEnvFiles(sameAppCtx));

    expect(contentOf(split, '.env.example')).not.toContain('LIB_ROOT');
    expect(contentOf(sameApp, '.env.example')).toContain('LIB_ROOT=1');
  });

  test('blueprint envs honor stacks per app', () => {
    const blueprint = META.blueprints['org-dashboard-nextjs'] as MetaBlueprint;
    const blueprintEnvs: EnvVar[] = [
      { value: 'BP_NEXT=1', monoScope: ['app'], stacks: ['nextjs'] },
      { value: 'BP_SHARED=1', monoScope: ['app'] },
    ];
    const ctx: TemplateContext = { ...mixedStacksCtx, blueprint: 'org-dashboard-nextjs' };

    const files = withEnvs(blueprint, blueprintEnvs, () => collectEnvFiles(ctx));

    expect(contentOf(files, 'apps/web/.env.example')).toContain('BP_NEXT=1');
    expect(contentOf(files, 'apps/site/.env.example')).not.toContain('BP_NEXT');
    expect(contentOf(files, 'apps/site/.env.example')).toContain('BP_SHARED=1');
  });

  describe('single repo', () => {
    const singleOf = (stackName: TemplateContext['apps'][number]['stackName']): TemplateContext => ({
      ...mixedStacksCtx,
      repo: 'single',
      apps: [{ appName: 'mixed', stackName, libraries: [] }],
    });
    const scopedEnvs: EnvVar[] = [
      { value: 'ROOT_NEXT=1', monoScope: ['root'], stacks: ['nextjs'] },
      { value: 'DB_NEXT=1', monoScope: [{ pkg: 'db' }], stacks: ['nextjs'] },
    ];

    test('root and pkg scope variables collapse into the root file when the stack matches', () => {
      const files = withEnvs(postgres, scopedEnvs, () => collectEnvFiles(singleOf('nextjs')));
      const content = contentOf(files, '.env.example');

      expect(files.map((f) => f.destination)).toEqual(['.env.example']);
      expect(content).toContain('ROOT_NEXT=1');
      expect(content).toContain('DB_NEXT=1');
    });

    test('root and pkg scope variables are dropped when the stack does not match', () => {
      const files = withEnvs(postgres, scopedEnvs, () => collectEnvFiles(singleOf('tanstack-start')));
      const content = contentOf(files, '.env.example');

      expect(content).not.toContain('ROOT_NEXT');
      expect(content).not.toContain('DB_NEXT');
    });
  });
});

describe('EnvVar.secret', () => {
  const postgres = META.project.database.options.postgres as MetaAddon;
  const SECRET_ENVS: EnvVar[] = [
    { value: 'ALL_APPS_SECRET=1', monoScope: ['app'], secret: true },
    { value: 'NEXT_ONLY_SECRET=1', monoScope: ['app'], secret: true, stacks: ['nextjs'] },
    { value: 'WHEN_SECRET=1', monoScope: ['app'], secret: true, when: { orm: 'prisma' } },
    { value: 'PKG_SECRET=1', monoScope: [{ pkg: 'db' }], secret: true },
    { value: 'FILE_SECRET=1', monoScope: ['app'], secret: true, file: 'cli' },
    { value: 'SST_SECRET=1', monoScope: ['app'], secret: { deployment: 'sst' } },
    { value: 'PLAIN=1', monoScope: ['app'] },
  ];

  function collectWith<T>(run: () => T): T {
    const previous = postgres.envs;
    postgres.envs = SECRET_ENVS;
    try {
      return run();
    } finally {
      postgres.envs = previous;
    }
  }

  const turborepo = makeContext({
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
      { appName: 'site', stackName: 'tanstack-start', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
  });

  test('an app receives the secrets of its libraries and none of another app', () => {
    expect(collectAppSecrets(turborepo, 'web')).toEqual(['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']);
    expect(collectAppSecrets(turborepo, 'site')).toEqual([]);
    expect(collectAppSecrets(turborepo, 'api')).toEqual([]);
  });

  test('a single repo app receives the secrets of its libraries', () => {
    const ctx = makeContext({
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'tanstack-start', libraries: ['better-auth'] }],
    });
    expect(collectAppSecrets(ctx, 'my-project')).toEqual(['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']);
  });

  test('a project addon secret goes to every app, narrowed by stacks and when, and never a package or file variable', () => {
    const [web, site] = collectWith(() => [collectAppSecrets(turborepo, 'web'), collectAppSecrets(turborepo, 'site')]);

    expect(web).toEqual(['ALL_APPS_SECRET', 'NEXT_ONLY_SECRET', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']);
    expect(site).toEqual(['ALL_APPS_SECRET']);
  });

  test('a secret given a condition is a secret only where it holds', () => {
    const underSst = makeContext({ project: { ...turborepo.project, deployment: 'sst' } });
    const underCloudflare = makeContext({ project: { ...turborepo.project, deployment: 'cloudflare' } });

    expect(collectWith(() => collectAppSecrets(underSst, 'api'))).toContain('SST_SECRET');
    expect(collectWith(() => collectAppSecrets(underCloudflare, 'api'))).not.toContain('SST_SECRET');
    expect(collectWith(() => collectAppSecrets(turborepo, 'api'))).not.toContain('SST_SECRET');
  });

  test.each(['postgres', 'mysql'])('the %s connection string is a secret under sst and a binding elsewhere', (database) => {
    const under = (deployment?: string) =>
      collectAppSecrets(makeContext({ project: { database, orm: 'drizzle', tooling: [], deployment } }), 'api');

    expect(under('sst')).toEqual(['DATABASE_URL']);
    expect(under('cloudflare')).toEqual([]);
    expect(under()).toEqual([]);
  });

  describe('collectProjectSecrets', () => {
    const sst = { ...turborepo.project, deployment: 'sst' };

    test('lists once each secret received by an app on a listed stack', () => {
      const ctx = makeContext({
        apps: [
          { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
          { appName: 'site', stackName: 'tanstack-start', libraries: ['better-auth'] },
          { appName: 'api', stackName: 'hono', libraries: [] },
        ],
        project: sst,
      });

      expect(collectProjectSecrets(ctx, ['nextjs', 'tanstack-start', 'hono'])).toEqual([
        'DATABASE_URL',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
      ]);
    });

    test('ignores an app on a stack that is not listed', () => {
      const ctx = makeContext({
        apps: [
          { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
          { appName: 'jobs', stackName: 'node', libraries: [] },
        ],
        project: sst,
      });

      expect(collectProjectSecrets(ctx, ['node'])).toEqual(['DATABASE_URL']);
      expect(collectProjectSecrets(ctx, ['hono'])).toEqual([]);
    });
  });

  test('a blueprint secret reaches every app of the blueprint', () => {
    const ctx: TemplateContext = {
      projectName: 'dapp',
      repo: 'single',
      apps: [{ appName: 'dapp', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: false,
      blueprint: 'dapp-privy-nextjs',
    };
    expect(collectAppSecrets(ctx, 'dapp')).toEqual(['PRIVY_APP_SECRET']);
  });

  test('no variable the browser bundle reads is marked secret', () => {
    const addons: { envs?: EnvVar[] }[] = [
      ...Object.values(META.libraries),
      ...Object.values(META.blueprints),
      ...Object.values(META.project).flatMap((category) => Object.values(category.options) as MetaAddon[]),
    ];
    const secretNames = addons.flatMap((addon) => addon.envs ?? []).filter((env) => env.secret).map((env) => env.value);

    expect(secretNames.length).toBeGreaterThan(0);
    expect(secretNames.filter((value) => /^(NEXT_PUBLIC|VITE)_/.test(value))).toEqual([]);
  });
});

describe('collectTaskEnv', () => {
  test('lists the database URL a seed reads', () => {
    expect(collectTaskEnv(makeContext(), 'db:seed')).toEqual(['DATABASE_URL']);
  });

  test('lists the variables a blueprint declares for the task, once each', () => {
    const ctx = makeContext({
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      blueprint: 'org-dashboard-nextjs',
    });

    expect([...collectTaskEnv(ctx, 'db:seed')].sort()).toEqual(['DATABASE_URL', 'SEED_PASSWORD']);
  });

  test('lists nothing for a database with no URL or for a task no variable names', () => {
    const d1 = makeContext({ project: { ...makeContext().project, database: 'd1' } });

    expect(collectTaskEnv(d1, 'db:seed')).toEqual([]);
    expect(collectTaskEnv(makeContext(), 'build')).toEqual([]);
  });
});

describe('EnvVar.generateCommand', () => {
  const postgres = META.project.database.options.postgres as MetaAddon;
  const GENERATED_ENVS: EnvVar[] = [
    { value: 'SIGNING_KEY=', monoScope: [{ pkg: 'db' }, 'app'], generateCommand: 'make-a-key' },
    { value: 'DEDICATED_KEY=', monoScope: ['app'], file: 'secrets', generateCommand: 'make-a-key' },
    { value: 'PLAIN=1', monoScope: ['app'] },
  ];
  const twoWebApps = makeContext({
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'admin', stackName: 'nextjs', libraries: [] },
    ],
  });

  function collect<T>(run: () => T): T {
    const previous = postgres.envs;
    postgres.envs = GENERATED_ENVS;
    try {
      return run();
    } finally {
      postgres.envs = previous;
    }
  }

  test('lists the .env of each app that receives the variable, never a package file or a dedicated file', () => {
    expect(collect(() => collectEnvsToGenerate(twoWebApps))).toEqual([
      { name: 'SIGNING_KEY', command: 'make-a-key', paths: ['apps/web/.env', 'apps/admin/.env'] },
    ]);
  });

  test('a single repo names the root .env', () => {
    const single = makeContext({
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: [] }],
    });

    expect(collect(() => collectEnvsToGenerate(single))).toEqual([
      { name: 'SIGNING_KEY', command: 'make-a-key', paths: ['.env'] },
    ]);
  });

  test('a project that receives no generated variable has none to list', () => {
    expect(collectEnvsToGenerate(makeContext({ apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }] }))).toEqual(
      [],
    );
  });

  test('the .env.example line names the command that generates the value', () => {
    const files = collect(() => collectEnvFiles(twoWebApps));
    const lines = (destination: string) => files.find((f) => f.destination === destination)?.content.split('\n');

    expect(lines('apps/web/.env.example')).toContain('SIGNING_KEY= # generate with: make-a-key');
    expect(lines('packages/db/.env.example')).toContain('SIGNING_KEY= # generate with: make-a-key');
  });

  test('a variable without a command has no generate comment', () => {
    const files = collect(() => collectEnvFiles(twoWebApps));

    expect(files.find((f) => f.destination === 'apps/web/.env.example')?.content).toContain('PLAIN=1\n');
  });

  test('the secret read by an app is listed for generation and for the runtime secrets by the same rule', () => {
    const secretEnvs: EnvVar[] = [
      { value: 'SIGNING_KEY=', monoScope: [{ pkg: 'db' }, 'app'], secret: true, generateCommand: 'make-a-key' },
    ];
    const previous = postgres.envs;
    postgres.envs = secretEnvs;
    try {
      const generatedPaths = collectEnvsToGenerate(twoWebApps).flatMap(({ paths }) => paths);
      const appsWithTheSecret = twoWebApps.apps.filter(({ appName }) =>
        collectAppSecrets(twoWebApps, appName).includes('SIGNING_KEY'),
      );

      expect(generatedPaths).toEqual(appsWithTheSecret.map(({ appName }) => `apps/${appName}/.env`));
    } finally {
      postgres.envs = previous;
    }
  });

  const addons: { envs?: EnvVar[] }[] = [
    ...Object.values(META.libraries),
    ...Object.values(META.blueprints),
    ...Object.values(META.project).flatMap((category) => Object.values(category.options)),
  ];
  const metaEnvsToGenerate = addons.flatMap((addon) => addon.envs ?? []).filter((env) => env.generateCommand);

  test('every generated variable of META ships blank, so no secret value is committed', () => {
    expect(metaEnvsToGenerate.length).toBeGreaterThan(0);
    for (const env of metaEnvsToGenerate) expect(env.value).toMatch(/^[A-Z_]+=$/);
  });

  test('one variable carries the same command in every META declaration', () => {
    const commandsByName = new Map<string, Set<string>>();
    for (const env of metaEnvsToGenerate) {
      const name = env.value.split('=')[0] ?? '';
      commandsByName.set(name, (commandsByName.get(name) ?? new Set()).add(env.generateCommand ?? ''));
    }

    for (const [name, commands] of commandsByName) {
      expect({ name, commandCount: commands.size }).toEqual({ name, commandCount: 1 });
    }
  });
});

describe('EnvVar.thirdParty', () => {
  const postgres = META.project.database.options.postgres as MetaAddon;
  const SOURCE = { description: 'Acme token', url: 'https://acme.test/keys', whenBlank: 'Acme stays off' };
  const THIRD_PARTY_ENVS: EnvVar[] = [
    { value: 'NEXT_PUBLIC_ACME=', monoScope: ['app'], stacks: ['nextjs'], thirdParty: SOURCE },
    { value: 'VITE_ACME=', monoScope: ['app'], stacks: ['tanstack-start'], thirdParty: SOURCE },
    { value: 'ACME_FILE_KEY=', monoScope: ['app'], file: 'secrets', thirdParty: SOURCE },
    { value: 'PLAIN=1', monoScope: ['app'] },
  ];
  const mixedApps = makeContext({
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'admin', stackName: 'tanstack-start', libraries: [] },
    ],
  });

  function collect<T>(run: () => T): T {
    const previous = postgres.envs;
    postgres.envs = THIRD_PARTY_ENVS;
    try {
      return run();
    } finally {
      postgres.envs = previous;
    }
  }

  test('lists each variable with the .env of the apps that receive it, by stack, never a dedicated file', () => {
    expect(collect(() => collectThirdPartyEnvs(mixedApps))).toEqual([
      { name: 'NEXT_PUBLIC_ACME', ...SOURCE, paths: ['apps/web/.env'] },
      { name: 'VITE_ACME', ...SOURCE, paths: ['apps/admin/.env'] },
    ]);
  });

  test('a single repo names the root .env', () => {
    const single = makeContext({
      repo: 'single',
      apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: [] }],
    });

    expect(collect(() => collectThirdPartyEnvs(single))).toEqual([
      { name: 'NEXT_PUBLIC_ACME', ...SOURCE, paths: ['.env'] },
    ]);
  });

  test('a project that receives no such variable has none to list', () => {
    expect(collectThirdPartyEnvs(makeContext({ apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }] }))).toEqual(
      [],
    );
  });

  test('the .env.example line names the source, and a variable without one has no comment', () => {
    const files = collect(() => collectEnvFiles(mixedApps));
    const lines = (destination: string) => files.find((f) => f.destination === destination)?.content.split('\n');

    expect(lines('apps/web/.env.example')).toContain('NEXT_PUBLIC_ACME= # Acme token: https://acme.test/keys');
    expect(lines('apps/admin/.env.example')).toContain('VITE_ACME= # Acme token: https://acme.test/keys');
    expect(lines('apps/web/.env.example')).toContain('PLAIN=1');
  });

  const addons: { envs?: EnvVar[] }[] = [
    ...Object.values(META.libraries),
    ...Object.values(META.blueprints),
    ...Object.values(META.project).flatMap((category) => Object.values(category.options)),
  ];
  const metaThirdPartyEnvs = addons.flatMap((addon) => addon.envs ?? []).filter((env) => env.thirdParty);

  test('every third-party variable of META ships blank, so no placeholder can start a client', () => {
    expect(metaThirdPartyEnvs.length).toBeGreaterThan(0);
    for (const env of metaThirdPartyEnvs) expect(env.value).toMatch(/^[A-Z_]+=$/);
  });

  test('one variable carries the same source in every META declaration', () => {
    const sourcesByName = new Map<string, Set<string>>();
    for (const env of metaThirdPartyEnvs) {
      const name = env.value.split('=')[0] ?? '';
      sourcesByName.set(name, (sourcesByName.get(name) ?? new Set()).add(JSON.stringify(env.thirdParty)));
    }

    for (const [name, sources] of sourcesByName) {
      expect({ name, sourceCount: sources.size }).toEqual({ name, sourceCount: 1 });
    }
  });
});
