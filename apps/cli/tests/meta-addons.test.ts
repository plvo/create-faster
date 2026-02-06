// ABOUTME: Validation tests for META with declarative project addons
// ABOUTME: Ensures libraries and project categories are correctly structured

import { describe, expect, test } from 'bun:test';
import { META } from '../src/__meta__';

describe('META.libraries validation', () => {
  test('all libraries have label', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      expect(lib.label, `${name} should have label`).toBeDefined();
    }
  });

  test('libraries with pkg mono have name', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      if (lib.mono?.scope === 'pkg') {
        expect(lib.mono.name, `${name} pkg mono needs name`).toBeDefined();
      }
    }
  });

  test('shadcn is a library', () => {
    expect(META.libraries.shadcn).toBeDefined();
    expect(META.libraries.shadcn.label).toBe('shadcn/ui');
  });
});

describe('META.project validation', () => {
  test('database category exists with options', () => {
    expect(META.project.database).toBeDefined();
    expect(META.project.database.selection).toBe('single');
    expect(META.project.database.options.postgres).toBeDefined();
    expect(META.project.database.options.mysql).toBeDefined();
  });

  test('orm category requires database', () => {
    expect(META.project.orm).toBeDefined();
    expect(META.project.orm.require).toContain('database');
    expect(META.project.orm.options.drizzle).toBeDefined();
    expect(META.project.orm.options.prisma).toBeDefined();
  });

  test('tooling category is multi-select', () => {
    expect(META.project.tooling).toBeDefined();
    expect(META.project.tooling.selection).toBe('multi');
    expect(META.project.tooling.options.biome).toBeDefined();
    expect(META.project.tooling.options.husky).toBeDefined();
  });

  test('project category order is database, orm, tooling', () => {
    const keys = Object.keys(META.project);
    expect(keys).toEqual(['database', 'orm', 'tooling']);
  });
});

describe('META.stacks validation', () => {
  test('stacks are unchanged', () => {
    expect(META.stacks.nextjs).toBeDefined();
    expect(META.stacks.expo).toBeDefined();
    expect(META.stacks.hono).toBeDefined();
  });
});

describe('META env vars', () => {
  test('postgres declares DATABASE_URL with pkg and app scope', () => {
    const postgres = META.project.database.options.postgres;
    expect(postgres.envs).toBeDefined();
    expect(postgres.envs).toHaveLength(1);
    expect(postgres.envs![0].value).toContain('DATABASE_URL');
    expect(postgres.envs![0].value).toContain('postgresql://');
    expect(postgres.envs![0].monoScope).toContainEqual({ pkg: 'db' });
    expect(postgres.envs![0].monoScope).toContain('app');
  });

  test('mysql declares DATABASE_URL with pkg and app scope', () => {
    const mysql = META.project.database.options.mysql;
    expect(mysql.envs).toBeDefined();
    expect(mysql.envs).toHaveLength(1);
    expect(mysql.envs![0].value).toContain('DATABASE_URL');
    expect(mysql.envs![0].value).toContain('mysql://');
    expect(mysql.envs![0].monoScope).toContainEqual({ pkg: 'db' });
    expect(mysql.envs![0].monoScope).toContain('app');
  });

  test('better-auth declares BETTER_AUTH_SECRET and BETTER_AUTH_URL', () => {
    const auth = META.libraries['better-auth'];
    expect(auth.envs).toBeDefined();
    expect(auth.envs).toHaveLength(2);

    const secret = auth.envs!.find((e) => e.value.includes('BETTER_AUTH_SECRET'));
    expect(secret).toBeDefined();
    expect(secret!.monoScope).toContainEqual({ pkg: 'auth' });
    expect(secret!.monoScope).toContain('app');

    const url = auth.envs!.find((e) => e.value.includes('BETTER_AUTH_URL'));
    expect(url).toBeDefined();
    expect(url!.value).toContain('{{appPort}}');
    expect(url!.monoScope).toContain('app');
  });

  test('addons without env vars have no envs field', () => {
    expect(META.libraries.shadcn.envs).toBeUndefined();
    expect(META.libraries['tanstack-query'].envs).toBeUndefined();
    expect(META.project.tooling.options.biome.envs).toBeUndefined();
  });
});
