import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('META.libraries validation', () => {
  test('all libraries have label', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      expect(lib.label, `${name} should have label`).toBeDefined();
    }
  });

  test('all libraries have a category', () => {
    for (const [name, lib] of Object.entries(META.libraries)) {
      expect(lib.category, `${name} should have a category`).toBeDefined();
      expect(typeof lib.category, `${name} category should be a string`).toBe('string');
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

  test('linter category is single-select with all options', () => {
    expect(META.project.linter).toBeDefined();
    expect(META.project.linter.selection).toBe('single');
    expect(META.project.linter.options.biome).toBeDefined();
    expect(META.project.linter.options['eslint-prettier']).toBeDefined();
    expect(META.project.linter.options.eslint).toBeDefined();
    expect(META.project.linter.options.prettier).toBeDefined();
  });

  test('linter prompt reflects broader code quality scope', () => {
    expect(META.project.linter.prompt).toBe('Code quality tools?');
  });

  test('eslint has pkg-scoped mono with eslint-config name', () => {
    const eslint = META.project.linter.options.eslint;
    expect(eslint.mono?.scope).toBe('pkg');
    if (eslint.mono?.scope === 'pkg') {
      expect(eslint.mono.name).toBe('eslint-config');
    }
  });

  test('eslint has all expected devDependencies', () => {
    const eslint = META.project.linter.options.eslint;
    const devDeps = eslint.packageJson?.devDependencies;
    expect(devDeps?.eslint).toBeDefined();
    expect(devDeps?.['@eslint/js']).toBeDefined();
    expect(devDeps?.['typescript-eslint']).toBeDefined();
    expect(devDeps?.globals).toBeDefined();
    expect(devDeps?.['eslint-plugin-react']).toBeDefined();
    expect(devDeps?.['eslint-plugin-react-hooks']).toBeDefined();
    expect(devDeps?.['@next/eslint-plugin-next']).toBeDefined();
  });

  test('eslint has shared config exports', () => {
    const exports = META.project.linter.options.eslint.packageJson?.exports;
    expect(exports?.['./base']).toBeDefined();
    expect(exports?.['./next']).toBeDefined();
    expect(exports?.['./react']).toBeDefined();
    expect(exports?.['./react-native']).toBeDefined();
    expect(exports?.['./server']).toBeDefined();
  });

  test('eslint has appPackageJson with lint script', () => {
    const eslint = META.project.linter.options.eslint;
    expect(eslint.appPackageJson?.scripts?.lint).toBe('eslint .');
  });

  test('biome has root-scoped mono', () => {
    const biome = META.project.linter.options.biome;
    expect(biome.mono?.scope).toBe('root');
  });

  test('prettier has root-scoped mono with formatter deps', () => {
    const prettier = META.project.linter.options.prettier;
    expect(prettier.mono?.scope).toBe('root');
    expect(prettier.packageJson?.devDependencies?.prettier).toBeDefined();
    expect(prettier.packageJson?.devDependencies?.['prettier-plugin-tailwindcss']).toBeDefined();
    expect(prettier.packageJson?.scripts?.format).toContain('prettier');
    expect(prettier.packageJson?.scripts?.['format:check']).toContain('prettier');
  });

  test('eslint-prettier composes eslint and prettier', () => {
    const eslintPrettier = META.project.linter.options['eslint-prettier'];
    expect(eslintPrettier.compose).toEqual(['eslint', 'prettier']);
    expect(eslintPrettier.mono?.scope).toBe('pkg');
    if (eslintPrettier.mono?.scope === 'pkg') {
      expect(eslintPrettier.mono.name).toBe('eslint-config');
    }
    expect(eslintPrettier.packageJson?.devDependencies?.['eslint-config-prettier']).toBeDefined();
  });

  test('eslint-prettier compose references exist as linter options', () => {
    const eslintPrettier = META.project.linter.options['eslint-prettier'];
    for (const ref of eslintPrettier.compose ?? []) {
      expect(META.project.linter.options[ref], `compose ref '${ref}' should exist`).toBeDefined();
    }
  });

  test('tooling category is multi-select', () => {
    expect(META.project.tooling).toBeDefined();
    expect(META.project.tooling.selection).toBe('multi');
    expect(META.project.tooling.options.husky).toBeDefined();
  });

  test('project category order is database, orm, linter, tooling', () => {
    const keys = Object.keys(META.project);
    expect(keys).toEqual(['database', 'orm', 'linter', 'tooling']);
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
    expect(META.project.linter.options.biome.envs).toBeUndefined();
  });
});
