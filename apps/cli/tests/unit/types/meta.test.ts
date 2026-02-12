import { describe, expect, test } from 'bun:test';
import type { EnvScope, EnvVar, MetaAddon, MetaProjectCategory } from '@/types/meta';

describe('MetaAddon types', () => {
  test('MetaAddon has required fields', () => {
    const addon: MetaAddon = {
      label: 'Test Addon',
      hint: 'A test addon',
      mono: { scope: 'app' },
      packageJson: { dependencies: { test: '^1.0.0' } },
    };
    expect(addon.label).toBe('Test Addon');
  });

  test('MetaAddon with pkg mono requires name', () => {
    const addon: MetaAddon = {
      label: 'UI Library',
      mono: { scope: 'pkg', name: 'ui' },
    };
    expect(addon.mono?.scope).toBe('pkg');
    if (addon.mono?.scope === 'pkg') {
      expect(addon.mono.name).toBe('ui');
    }
  });

  test('MetaAddon support can filter by stacks', () => {
    const addon: MetaAddon = {
      label: 'Next.js Only',
      support: { stacks: ['nextjs'] },
    };
    expect(addon.support?.stacks).toContain('nextjs');
  });

  test('MetaAddon support can be all stacks', () => {
    const addon: MetaAddon = {
      label: 'Universal',
      support: { stacks: 'all' },
    };
    expect(addon.support?.stacks).toBe('all');
  });

  test('MetaAddon require can specify git dependency', () => {
    const addon: MetaAddon = {
      label: 'Git Hooks',
      require: { git: true },
    };
    expect(addon.require?.git).toBe(true);
  });

  test('MetaAddon can have a category', () => {
    const addon: MetaAddon = {
      label: 'UI Library',
      category: 'UI',
    };
    expect(addon.category).toBe('UI');
  });

  test('MetaAddon can declare compose for composite addons', () => {
    const addon: MetaAddon = {
      label: 'ESLint + Prettier',
      compose: ['eslint', 'prettier'],
      mono: { scope: 'pkg', name: 'eslint-config' },
    };
    expect(addon.compose).toEqual(['eslint', 'prettier']);
  });

  test('MetaAddon require can specify orm dependencies', () => {
    const addon: MetaAddon = {
      label: 'Auth Library',
      support: { stacks: ['nextjs'] },
      require: { orm: ['drizzle', 'prisma'] },
    };
    expect(addon.require?.orm).toContain('drizzle');
    expect(addon.require?.orm).toContain('prisma');
  });

  test('MetaAddon can declare env vars with monoScope', () => {
    const addon: MetaAddon = {
      label: 'PostgreSQL',
      envs: [{ value: 'DATABASE_URL="postgresql://localhost:5432/mydb"', monoScope: [{ pkg: 'db' }, 'app'] }],
    };
    expect(addon.envs).toHaveLength(1);
    expect(addon.envs![0].value).toContain('DATABASE_URL');
    expect(addon.envs![0].monoScope).toContain('app');
  });

  test('EnvScope supports root, app, and pkg with name', () => {
    const rootScope: EnvScope = 'root';
    const appScope: EnvScope = 'app';
    const pkgScope: EnvScope = { pkg: 'db' };

    expect(rootScope).toBe('root');
    expect(appScope).toBe('app');
    expect(pkgScope).toEqual({ pkg: 'db' });
  });

  test('EnvVar monoScope can target multiple locations', () => {
    const envVar: EnvVar = {
      value: 'BETTER_AUTH_SECRET= # generate with: openssl rand -base64 32',
      monoScope: [{ pkg: 'auth' }, 'app'],
    };
    expect(envVar.monoScope).toHaveLength(2);
  });
});

describe('MetaProjectCategory types', () => {
  test('MetaProjectCategory has prompt and selection', () => {
    const category: MetaProjectCategory = {
      prompt: 'Include a database?',
      selection: 'single',
      options: {
        postgres: { label: 'PostgreSQL' },
      },
    };
    expect(category.prompt).toBe('Include a database?');
    expect(category.selection).toBe('single');
  });

  test('MetaProjectCategory can have require dependencies', () => {
    const category: MetaProjectCategory = {
      prompt: 'Configure an ORM?',
      selection: 'single',
      require: ['database'],
      options: {
        drizzle: { label: 'Drizzle' },
      },
    };
    expect(category.require).toContain('database');
  });

  test('MetaProjectCategory selection can be multi', () => {
    const category: MetaProjectCategory = {
      prompt: 'Add extras?',
      selection: 'multi',
      options: {
        biome: { label: 'Biome' },
        husky: { label: 'Husky' },
      },
    };
    expect(category.selection).toBe('multi');
  });
});
