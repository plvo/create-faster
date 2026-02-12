import { describe, expect, test } from 'bun:test';
import { collectEnvFiles, collectEnvGroups } from '@/lib/env-generator';
import type { TemplateContext } from '@/types/ctx';

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
