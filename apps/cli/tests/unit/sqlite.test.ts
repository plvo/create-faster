import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { isRequirementMet } from '@/lib/addon-utils';
import type { TemplateContext } from '@/types/ctx';

function contextWithDatabase(database: string): TemplateContext {
  return {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', libraries: [] }],
    project: { database, tooling: [] },
    git: false,
  };
}

describe('sqlite database option', () => {
  test('declares no runtime driver dependencies, only the drizzle-kit connector', () => {
    const sqlite = META.project.database.options.sqlite;
    expect(sqlite).toBeDefined();
    expect(sqlite.packageJson?.dependencies ?? {}).toEqual({});
    expect(Object.keys(sqlite.packageJson?.devDependencies ?? {})).toEqual(['@libsql/client']);
  });

  test('declares DATABASE_URL pointing to a local file', () => {
    const envs = META.project.database.options.sqlite.envs ?? [];
    const dbUrl = envs.find((env) => env.value.startsWith('DATABASE_URL='));
    expect(dbUrl).toBeDefined();
    expect(dbUrl?.value).toContain('./db.sqlite');
  });

  test('prisma requirements are not met with sqlite', () => {
    const prisma = META.project.orm.options.prisma;
    expect(isRequirementMet(prisma.require, contextWithDatabase('sqlite'))).toBe(false);
  });

  test('prisma requirements are met with postgres and mysql', () => {
    const prisma = META.project.orm.options.prisma;
    expect(isRequirementMet(prisma.require, contextWithDatabase('postgres'))).toBe(true);
    expect(isRequirementMet(prisma.require, contextWithDatabase('mysql'))).toBe(true);
  });

  test('drizzle requirements are met with sqlite', () => {
    const drizzle = META.project.orm.options.drizzle;
    expect(isRequirementMet(drizzle.require, contextWithDatabase('sqlite'))).toBe(true);
  });
});

describe('better-auth database restriction', () => {
  function contextWithBetterAuth(database: string): TemplateContext {
    return {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
      project: { database, orm: 'drizzle', tooling: [] },
      git: false,
    };
  }

  test('is not satisfied with sqlite (no sqlite adapter until #131)', () => {
    const betterAuth = META.libraries['better-auth'];
    expect(isRequirementMet(betterAuth.require, contextWithBetterAuth('sqlite'))).toBe(false);
  });

  test('is satisfied with postgres and mysql', () => {
    const betterAuth = META.libraries['better-auth'];
    expect(isRequirementMet(betterAuth.require, contextWithBetterAuth('postgres'))).toBe(true);
    expect(isRequirementMet(betterAuth.require, contextWithBetterAuth('mysql'))).toBe(true);
  });
});
