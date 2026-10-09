import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectEnvFiles, collectEnvGroups } from '@/lib/env-generator';
import type { TemplateContext } from '@/types/ctx';
import type { EnvVar, MetaAddon } from '@/types/meta';

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

    expect(files[0].content).toContain('BETTER_AUTH_URL=https://my-project.localhost:1355');
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
    expect(files[0].destination).toBe('.env.example');
    expect(files[0].content).toContain('DATABASE_URL');
    expect(files[0].content).toContain('BETTER_AUTH_SECRET');
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
    expect(groups[0].path).toBe('.env');
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
      blueprint: 'org-dashboard',
    };

    const files = collectEnvFiles(ctx);
    expect(files.length).toBeGreaterThan(0);
    const webEnv = files.find((f) => f.destination.includes('web'));
    expect(webEnv?.content).toContain('BETTER_AUTH_SECRET');
  });
});

describe('EnvVar.stacks filter', () => {
  const STACK_ENVS: EnvVar[] = [
    { value: 'NEXT_PUBLIC_TOKEN=next-token', monoScope: ['app'], stacks: ['nextjs'] },
    { value: 'VITE_TOKEN=vite-token', monoScope: ['app'], stacks: ['tanstack-start'] },
    { value: 'SHARED_TOKEN=shared-token', monoScope: ['app'] },
  ];

  function withEnvs<T>(addon: MetaAddon, envs: EnvVar[], run: () => T): T {
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
    project: { database: 'postgres', tooling: [] },
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
});
