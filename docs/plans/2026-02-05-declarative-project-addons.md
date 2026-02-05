# Declarative Project Addons Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the addon system to separate per-app libraries from project-level addons with declarative prompt configuration in META.

**Architecture:** Split `META.addons` into `META.libraries` (per-app, stack-filtered) and `META.project` (project-level categories with prompt config). Context changes from `globalAddons: string[]` to structured `project: { database?, orm?, tooling[] }`. Templates restructured to match. CLI flow becomes a simple loop over `META.project` categories.

**Tech Stack:** Bun, TypeScript, Handlebars, Zod

---

## Context

**Branch:** `refactor/declarative-project-addons`

**Current State:**
- `META.addons` contains all addons with `type: 'module' | 'orm' | 'database' | 'extra'`
- `ctx.apps[].addons` for per-app modules
- `ctx.globalAddons: string[]` flat array for database/orm/extras
- `cli.ts` hardcodes prompt logic for each addon type
- `templates/addons/` contains all addons flat

**Target State:**
- `META.libraries` for per-app addons
- `META.project.{database,orm,tooling}` with prompt config
- `ctx.apps[].libraries` for per-app
- `ctx.project: { database?, orm?, tooling[] }` structured
- `cli.ts` loops over `META.project` dynamically
- `templates/libraries/` and `templates/project/{database,orm,tooling}/`

### Files Impacted (in dependency order)

1. `apps/cli/src/types/meta.ts` — new types
2. `apps/cli/src/types/ctx.ts` — update context types
3. `apps/cli/src/__meta__.ts` — restructure META
4. `apps/cli/src/lib/addon-utils.ts` — update helpers
5. `apps/cli/src/lib/handlebars.ts` — new helpers
6. `apps/cli/src/lib/template-resolver.ts` — new paths
7. `apps/cli/src/lib/package-json-generator.ts` — use new context
8. `apps/cli/src/prompts/stack-prompts.ts` — update prompts
9. `apps/cli/src/cli.ts` — declarative loop
10. `apps/cli/src/flags.ts` — update flag parsing
11. `apps/cli/src/tui/summary.ts` — update display
12. `apps/cli/templates/` — restructure directories

---

## Task 1: Update types/meta.ts

**Files:**
- Modify: `apps/cli/src/types/meta.ts`
- Create: `apps/cli/tests/meta-types.test.ts`

**Step 1: Write the failing test**

Create `apps/cli/tests/meta-types.test.ts`:

```typescript
// ABOUTME: Type tests for declarative project addons
// ABOUTME: Ensures MetaAddon and MetaProjectCategory types are correct

import { describe, test, expect } from 'bun:test';
import type {
  MetaAddon,
  MetaProjectCategory,
  AddonMono,
  StackName,
} from '../src/types/meta';

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
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/meta-types.test.ts`
Expected: FAIL — `MetaProjectCategory` not exported

**Step 3: Update types/meta.ts**

Replace `apps/cli/src/types/meta.ts`:

```typescript
// ABOUTME: Type definitions for META configuration
// ABOUTME: Declarative project addons with libraries and project categories

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type RepoType = 'single' | 'turborepo';
export type MonoScope = 'app' | 'pkg' | 'root';

export type AddonMono = { scope: 'app' } | { scope: 'pkg'; name: string } | { scope: 'root' };

export interface AddonSupport {
  stacks?: StackName[] | 'all';
  require?: string[];
}

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface MetaAddon {
  label: string;
  hint?: string;
  support?: AddonSupport;
  require?: { git?: boolean };
  mono?: AddonMono;
  packageJson?: PackageJsonConfig;
}

export interface MetaProjectCategory {
  prompt: string;
  selection: 'single' | 'multi';
  require?: string[];
  options: Record<string, MetaAddon>;
}

export interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  packageJson: PackageJsonConfig;
}

export interface MetaRepoStack {
  label: string;
  hint?: string;
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  libraries: Record<string, MetaAddon>;
  project: Record<string, MetaProjectCategory>;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/meta-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/types/meta.ts apps/cli/tests/meta-types.test.ts
git commit -m "refactor(types): add MetaProjectCategory for declarative project addons"
```

---

## Task 2: Update types/ctx.ts

**Files:**
- Modify: `apps/cli/src/types/ctx.ts`
- Create: `apps/cli/tests/ctx-types.test.ts`

**Step 1: Write the failing test**

Create `apps/cli/tests/ctx-types.test.ts`:

```typescript
// ABOUTME: Type tests for template context
// ABOUTME: Ensures AppContext and TemplateContext have correct structure

import { describe, test, expect } from 'bun:test';
import type { AppContext, TemplateContext, ProjectContext } from '../src/types/ctx';

describe('AppContext types', () => {
  test('AppContext has libraries instead of addons', () => {
    const app: AppContext = {
      appName: 'web',
      stackName: 'nextjs',
      libraries: ['shadcn', 'tanstack-query'],
    };
    expect(app.libraries).toContain('shadcn');
  });
});

describe('ProjectContext types', () => {
  test('ProjectContext has structured fields', () => {
    const project: ProjectContext = {
      database: 'postgres',
      orm: 'drizzle',
      tooling: ['biome', 'husky'],
    };
    expect(project.database).toBe('postgres');
    expect(project.orm).toBe('drizzle');
    expect(project.tooling).toContain('biome');
  });

  test('ProjectContext database and orm are optional', () => {
    const project: ProjectContext = {
      tooling: [],
    };
    expect(project.database).toBeUndefined();
    expect(project.orm).toBeUndefined();
  });
});

describe('TemplateContext types', () => {
  test('TemplateContext has project instead of globalAddons', () => {
    const ctx: TemplateContext = {
      projectName: 'myapp',
      repo: 'single',
      apps: [{ appName: 'myapp', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: true,
    };
    expect(ctx.project.tooling).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/ctx-types.test.ts`
Expected: FAIL — `ProjectContext` not exported, `libraries` not in `AppContext`

**Step 3: Update types/ctx.ts**

Replace `apps/cli/src/types/ctx.ts`:

```typescript
// ABOUTME: Context types for template rendering and CLI flow
// ABOUTME: AppContext for per-app config, TemplateContext for full generation

import type { StackName } from './meta';

export interface AppContext {
  appName: string;
  stackName: StackName;
  libraries: string[];
}

export interface ProjectContext {
  database?: string;
  orm?: string;
  tooling: string[];
}

export type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  project: ProjectContext;
  git: boolean;
  pm?: PackageManager;
  skipInstall?: boolean;
}

export interface TemplateFile {
  source: string;
  destination: string;
}

export type EnrichedTemplateContext = TemplateContext & Partial<AppContext>;
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/ctx-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/types/ctx.ts apps/cli/tests/ctx-types.test.ts
git commit -m "refactor(types): update context with libraries and ProjectContext"
```

---

## Task 3: Restructure __meta__.ts

**Files:**
- Modify: `apps/cli/src/__meta__.ts`
- Modify: `apps/cli/tests/meta-addons.test.ts`

**Step 1: Write validation test**

Replace `apps/cli/tests/meta-addons.test.ts`:

```typescript
// ABOUTME: Validation tests for META with declarative project addons
// ABOUTME: Ensures libraries and project categories are correctly structured

import { describe, test, expect } from 'bun:test';
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
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/meta-addons.test.ts`
Expected: FAIL — `META.libraries` and `META.project` don't exist

**Step 3: Rewrite __meta__.ts**

Replace `apps/cli/src/__meta__.ts`:

```typescript
// ABOUTME: Single source of truth for all stacks, libraries, and project addons
// ABOUTME: Libraries are per-app, project categories are project-level with prompt config

import type { Meta } from '@/types/meta';

export const META: Meta = {
  stacks: {
    nextjs: {
      type: 'app',
      label: 'Next.js',
      hint: 'React framework with SSR',
      packageJson: {
        dependencies: {
          next: '^16.1.1',
          react: '^19.2.3',
          'react-dom': '^19.2.3',
          'lucide-react': '^0.487.0',
          'tw-animate-css': '^1.3.4',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': '^20',
          '@types/react': '^19.2.3',
          '@types/react-dom': '^19.2.3',
          tailwindcss: '^4.1.10',
          '@next/bundle-analyzer': '^16.1.1',
        },
        scripts: {
          analyze: 'next experimental-analyze',
          dev: 'next dev --port {{port}}',
          build: 'next build',
          start: 'next start --port {{port}}',
        },
      },
    },
    expo: {
      type: 'app',
      label: 'Expo',
      hint: 'React Native framework',
      packageJson: {
        dependencies: {
          expo: '~52.0.0',
          'expo-status-bar': '~2.0.0',
          react: '^18.3.1',
          'react-native': '0.76.5',
        },
        devDependencies: {
          typescript: '^5.3.0',
          '@types/react': '~18.3.12',
        },
        scripts: {
          start: 'expo start',
          android: 'expo start --android',
          ios: 'expo start --ios',
          web: 'expo start --web',
        },
      },
    },
    hono: {
      type: 'server',
      label: 'Hono',
      hint: 'Fast web framework',
      packageJson: {
        dependencies: {
          hono: '^4.7.4',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': '^20',
        },
        scripts: {
          dev: 'bun run --hot src/index.ts',
          start: 'bun run src/index.ts',
        },
      },
    },
    'tanstack-start': {
      type: 'app',
      label: 'TanStack Start',
      hint: 'Full-stack React framework',
      packageJson: {
        dependencies: {
          '@tanstack/react-router': '^1.95.1',
          '@tanstack/start': '^1.95.1',
          react: '^19.2.3',
          'react-dom': '^19.2.3',
          vinxi: '^0.5.1',
        },
        devDependencies: {
          typescript: '^5',
          '@types/react': '^19.2.3',
          '@types/react-dom': '^19.2.3',
          vite: '^6.0.0',
        },
        scripts: {
          dev: 'vinxi dev --port {{port}}',
          build: 'vinxi build',
          start: 'vinxi start --port {{port}}',
        },
      },
    },
  },

  // Per-app libraries, filtered by stack compatibility
  libraries: {
    shadcn: {
      label: 'shadcn/ui',
      hint: 'A set of beautifully designed components',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      mono: { scope: 'pkg', name: 'ui' },
      packageJson: {
        dependencies: {
          'radix-ui': '^1.4.2',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          cmdk: '^1.1.1',
          vaul: '^1.1.2',
          'tailwind-merge': '^3.3.1',
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.1.10',
        },
        exports: {
          './': './src/components/',
          './components/*': './src/components/*.tsx',
          './hooks/*': './src/hooks/*.ts',
          './lib/*': './src/lib/*.ts',
        },
      },
    },
    'next-themes': {
      label: 'Next Themes',
      hint: 'Theme management for Next.js',
      support: { stacks: ['nextjs'] },
      packageJson: {
        dependencies: {
          'next-themes': '^0.4.6',
        },
      },
    },
    mdx: {
      label: 'MDX',
      hint: 'Markdown-based content',
      support: { stacks: ['nextjs'] },
      packageJson: {
        dependencies: {
          '@mdx-js/loader': '^3',
          '@mdx-js/react': '^3',
          '@next/mdx': '^16.1.1',
          'next-mdx-remote': '^5.0.0',
        },
        devDependencies: {
          '@types/mdx': '^2.0.13',
        },
      },
    },
    pwa: {
      label: 'PWA',
      hint: 'Progressive Web App support',
      support: { stacks: ['nextjs'] },
      packageJson: {},
    },
    'better-auth': {
      label: 'Better Auth',
      hint: 'Comprehensive authentication framework',
      support: { stacks: ['nextjs'], require: ['drizzle', 'prisma'] },
      mono: { scope: 'pkg', name: 'auth' },
      packageJson: {
        dependencies: {
          'better-auth': '^1.4.10',
        },
        exports: {
          '.': './src/index.ts',
          './client': './src/client.ts',
        },
      },
    },
    'tanstack-query': {
      label: 'TanStack Query',
      hint: 'Powerful asynchronous state management',
      support: { stacks: 'all' },
      packageJson: {
        dependencies: {
          '@tanstack/react-query': '^5.90.0',
        },
      },
    },
    'tanstack-devtools': {
      label: 'TanStack Devtools',
      hint: 'Devtools panel for TanStack libraries',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        devDependencies: {
          '@tanstack/react-devtools': '^0.7.0',
          '@tanstack/react-query-devtools': '^5.90.1',
        },
      },
    },
    'react-hook-form': {
      label: 'React Hook Form',
      hint: 'Performant form validation',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          'react-hook-form': '^7.56.1',
          '@hookform/resolvers': '^5.2.1',
        },
      },
    },
    'tanstack-form': {
      label: 'TanStack Form',
      hint: 'Headless form library',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          '@tanstack/react-form': '^1.23.7',
        },
      },
    },
    nativewind: {
      label: 'NativeWind',
      hint: 'Tailwind CSS for React Native',
      support: { stacks: ['expo'] },
      packageJson: {
        dependencies: {
          nativewind: '^4.1.23',
        },
        devDependencies: {
          tailwindcss: '^3.4.17',
        },
      },
    },
    'aws-lambda': {
      label: 'AWS Lambda',
      hint: 'Serverless deployment for Hono',
      support: { stacks: ['hono'] },
      packageJson: {
        dependencies: {
          '@hono/aws-lambda': '^1.0.0',
        },
      },
    },
  },

  // Project-level categories, prompted in order
  project: {
    database: {
      prompt: 'Include a database?',
      selection: 'single',
      options: {
        postgres: {
          label: 'PostgreSQL',
          hint: 'Relational database',
          mono: { scope: 'root' },
          packageJson: {
            dependencies: {
              pg: '^8.13.1',
            },
            devDependencies: {
              '@types/pg': '^8.11.10',
            },
          },
        },
        mysql: {
          label: 'MySQL',
          hint: 'Relational database',
          mono: { scope: 'root' },
          packageJson: {
            dependencies: {
              mysql2: '^3.11.5',
            },
          },
        },
      },
    },
    orm: {
      prompt: 'Configure an ORM?',
      selection: 'single',
      require: ['database'],
      options: {
        drizzle: {
          label: 'Drizzle',
          hint: 'Lightweight TypeScript ORM',
          mono: { scope: 'pkg', name: 'db' },
          packageJson: {
            dependencies: {
              'drizzle-orm': '^0.38.3',
            },
            devDependencies: {
              'drizzle-kit': '^0.30.1',
            },
            scripts: {
              'db:generate': 'drizzle-kit generate',
              'db:migrate': 'drizzle-kit migrate',
              'db:push': 'drizzle-kit push',
              'db:studio': 'drizzle-kit studio',
              'db:seed': 'bun run scripts/seed.ts',
            },
            exports: {
              '.': './index.ts',
              './schema': './schema.ts',
              './types': './types.ts',
            },
          },
        },
        prisma: {
          label: 'Prisma',
          hint: 'Type-safe ORM with migrations',
          mono: { scope: 'pkg', name: 'db' },
          packageJson: {
            dependencies: {
              '@prisma/client': '^6.13.0',
            },
            devDependencies: {
              prisma: '^6.13.0',
            },
            scripts: {
              'db:generate': 'prisma generate',
              'db:migrate': 'prisma migrate dev',
              'db:push': 'prisma db push',
              'db:studio': 'prisma studio',
              'db:seed': 'bun run scripts/seed.ts',
            },
            exports: {
              '.': './index.ts',
            },
          },
        },
      },
    },
    tooling: {
      prompt: 'Add any extras?',
      selection: 'multi',
      options: {
        biome: {
          label: 'Biome',
          hint: 'Fast linter & formatter',
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              '@biomejs/biome': '^2.3.11',
            },
            scripts: {
              format: 'biome format --write .',
              lint: 'biome lint',
            },
          },
        },
        husky: {
          label: 'Husky',
          hint: 'Git hooks',
          require: { git: true },
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              husky: '^9',
            },
            scripts: {
              prepare: 'husky',
            },
          },
        },
      },
    },
  },

  repo: {
    stacks: {
      single: {
        label: 'Single',
        hint: 'Single repository',
      },
      turborepo: {
        label: 'Turborepo',
        hint: 'Monorepo repository',
      },
    },
  },
} as const satisfies Meta;

// Inferred type for project category names
export type ProjectCategoryName = keyof typeof META.project;
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/meta-addons.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/tests/meta-addons.test.ts
git commit -m "refactor(__meta__): restructure with libraries and project categories"
```

---

## Task 4: Update addon-utils.ts

**Files:**
- Modify: `apps/cli/src/lib/addon-utils.ts`
- Modify: `apps/cli/tests/addon-utils.test.ts`

**Step 1: Write the failing test**

Replace `apps/cli/tests/addon-utils.test.ts`:

```typescript
// ABOUTME: Tests for addon utility functions
// ABOUTME: Tests compatibility checking for libraries

import { describe, test, expect } from 'bun:test';
import { isLibraryCompatible, getProjectAddon } from '../src/lib/addon-utils';
import { META } from '../src/__meta__';

describe('isLibraryCompatible', () => {
  test('shadcn is compatible with nextjs', () => {
    expect(isLibraryCompatible(META.libraries.shadcn, 'nextjs')).toBe(true);
  });

  test('shadcn is not compatible with expo', () => {
    expect(isLibraryCompatible(META.libraries.shadcn, 'expo')).toBe(false);
  });

  test('tanstack-query is compatible with all', () => {
    expect(isLibraryCompatible(META.libraries['tanstack-query'], 'nextjs')).toBe(true);
    expect(isLibraryCompatible(META.libraries['tanstack-query'], 'expo')).toBe(true);
    expect(isLibraryCompatible(META.libraries['tanstack-query'], 'hono')).toBe(true);
  });

  test('nativewind is only compatible with expo', () => {
    expect(isLibraryCompatible(META.libraries.nativewind, 'expo')).toBe(true);
    expect(isLibraryCompatible(META.libraries.nativewind, 'nextjs')).toBe(false);
  });
});

describe('getProjectAddon', () => {
  test('gets addon from database category', () => {
    const addon = getProjectAddon('database', 'postgres');
    expect(addon?.label).toBe('PostgreSQL');
  });

  test('gets addon from orm category', () => {
    const addon = getProjectAddon('orm', 'drizzle');
    expect(addon?.label).toBe('Drizzle');
  });

  test('gets addon from tooling category', () => {
    const addon = getProjectAddon('tooling', 'biome');
    expect(addon?.label).toBe('Biome');
  });

  test('returns undefined for unknown addon', () => {
    const addon = getProjectAddon('database', 'unknown');
    expect(addon).toBeUndefined();
  });

  test('returns undefined for unknown category', () => {
    const addon = getProjectAddon('unknown' as any, 'postgres');
    expect(addon).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/addon-utils.test.ts`
Expected: FAIL — `isLibraryCompatible` and `getProjectAddon` don't exist

**Step 3: Rewrite addon-utils.ts**

Replace `apps/cli/src/lib/addon-utils.ts`:

```typescript
// ABOUTME: Helper functions for working with libraries and project addons
// ABOUTME: Compatibility checking and addon lookup

import { META, type ProjectCategoryName } from '@/__meta__';
import type { MetaAddon, StackName } from '@/types/meta';

export function isLibraryCompatible(library: MetaAddon, stackName: StackName): boolean {
  if (!library.support?.stacks) return true;
  if (library.support.stacks === 'all') return true;
  return library.support.stacks.includes(stackName);
}

export function getProjectAddon(category: ProjectCategoryName | string, name: string): MetaAddon | undefined {
  const cat = META.project[category as ProjectCategoryName];
  if (!cat) return undefined;
  return cat.options[name];
}

export function isProjectCategoryMet(category: string, project: { database?: string; orm?: string; tooling: string[] }): boolean {
  const cat = META.project[category as ProjectCategoryName];
  if (!cat?.require) return true;

  for (const dep of cat.require) {
    const value = project[dep as keyof typeof project];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return false;
    }
  }
  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/addon-utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/addon-utils.ts apps/cli/tests/addon-utils.test.ts
git commit -m "refactor(addon-utils): update for libraries and project categories"
```

---

## Task 5: Update handlebars.ts with new helpers

**Files:**
- Modify: `apps/cli/src/lib/handlebars.ts`
- Modify: `apps/cli/tests/handlebars.test.ts`

**Step 1: Write the failing test**

Create `apps/cli/tests/handlebars.test.ts`:

```typescript
// ABOUTME: Tests for Handlebars helpers
// ABOUTME: Tests hasLibrary and has helpers

import { describe, test, expect, beforeAll } from 'bun:test';
import Handlebars from 'handlebars';
import { registerHandlebarsHelpers } from '../src/lib/handlebars';
import type { EnrichedTemplateContext } from '../src/types/ctx';

beforeAll(() => {
  registerHandlebarsHelpers();
});

describe('hasLibrary helper', () => {
  test('returns true when library exists', () => {
    const template = Handlebars.compile('{{#if (hasLibrary "shadcn")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      libraries: ['shadcn', 'mdx'],
    };
    expect(template(ctx)).toBe('yes');
  });

  test('returns false when library does not exist', () => {
    const template = Handlebars.compile('{{#if (hasLibrary "shadcn")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      libraries: ['mdx'],
    };
    expect(template(ctx)).toBe('no');
  });
});

describe('has helper', () => {
  test('returns true for matching database', () => {
    const template = Handlebars.compile('{{#if (has "database" "postgres")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { database: 'postgres', tooling: [] },
    };
    expect(template(ctx)).toBe('yes');
  });

  test('returns false for non-matching database', () => {
    const template = Handlebars.compile('{{#if (has "database" "mysql")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { database: 'postgres', tooling: [] },
    };
    expect(template(ctx)).toBe('no');
  });

  test('returns true for matching orm', () => {
    const template = Handlebars.compile('{{#if (has "orm" "drizzle")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { orm: 'drizzle', tooling: [] },
    };
    expect(template(ctx)).toBe('yes');
  });

  test('returns true for tooling in array', () => {
    const template = Handlebars.compile('{{#if (has "tooling" "biome")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { tooling: ['biome', 'husky'] },
    };
    expect(template(ctx)).toBe('yes');
  });

  test('returns false for tooling not in array', () => {
    const template = Handlebars.compile('{{#if (has "tooling" "husky")}}yes{{else}}no{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { tooling: ['biome'] },
    };
    expect(template(ctx)).toBe('no');
  });
});

describe('direct project access', () => {
  test('can access project.database directly', () => {
    const template = Handlebars.compile('{{#if project.database}}{{project.database}}{{else}}none{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { database: 'postgres', tooling: [] },
    };
    expect(template(ctx)).toBe('postgres');
  });

  test('can check if project.orm exists', () => {
    const template = Handlebars.compile('{{#if project.orm}}has orm{{else}}no orm{{/if}}');
    const ctx: Partial<EnrichedTemplateContext> = {
      project: { tooling: [] },
    };
    expect(template(ctx)).toBe('no orm');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/handlebars.test.ts`
Expected: FAIL — helpers use old context structure

**Step 3: Rewrite handlebars.ts**

Replace `apps/cli/src/lib/handlebars.ts`:

```typescript
// ABOUTME: Handlebars template engine setup with custom helpers
// ABOUTME: Provides helpers for libraries and project addons

import Handlebars from 'handlebars';
import type { AppContext, EnrichedTemplateContext, TemplateContext } from '@/types/ctx';

export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every((v) => Boolean(v)));
  Handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some((v) => Boolean(v)));

  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('hasLibrary', function (this: EnrichedTemplateContext, name: string) {
    return Array.isArray(this.libraries) && this.libraries.includes(name);
  });

  Handlebars.registerHelper('has', function (this: EnrichedTemplateContext, category: string, value: string) {
    if (!this.project) return false;

    switch (category) {
      case 'database':
        return this.project.database === value;
      case 'orm':
        return this.project.orm === value;
      case 'tooling':
        return Array.isArray(this.project.tooling) && this.project.tooling.includes(value);
      default:
        return false;
    }
  });

  Handlebars.registerHelper('hasContext', function (this: TemplateContext, contextName: keyof TemplateContext) {
    return contextName in this && this[contextName] !== undefined;
  });

  Handlebars.registerHelper('appPort', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    const index = root.apps?.findIndex((app: AppContext) => app.appName === appName) ?? -1;
    return index === -1 ? 3000 : 3000 + index;
  });

  Handlebars.registerHelper('databaseUrl', function (this: TemplateContext) {
    if (this.project?.database === 'postgres') {
      return `postgresql://postgres:password@localhost:5432/postgres-${this.projectName}`;
    } else if (this.project?.database === 'mysql') {
      return `mysql://mysql:password@localhost:3306/mysql-${this.projectName}`;
    }
    return null;
  });
}

export function renderTemplate(templateContent: string, context: TemplateContext): string {
  try {
    const template = Handlebars.compile(templateContent, {
      noEscape: true,
      strict: false,
      preventIndent: false,
    });

    return template(context);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Handlebars compilation failed: ${error.message}`);
    }
    throw error;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/handlebars.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/handlebars.ts apps/cli/tests/handlebars.test.ts
git commit -m "refactor(handlebars): update helpers for hasLibrary and has"
```

---

## Task 6: Update template-resolver.ts

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts`
- Modify: `apps/cli/tests/template-resolver.test.ts`

**Step 1: Write the failing test**

Replace `apps/cli/tests/template-resolver.test.ts`:

```typescript
// ABOUTME: Tests for template path resolution
// ABOUTME: Tests libraries and project addon template resolution

import { describe, test, expect } from 'bun:test';
import { resolveLibraryDestination, resolveProjectAddonDestination } from '../src/lib/template-resolver';
import { META } from '../src/__meta__';
import type { TemplateContext } from '../src/types/ctx';

describe('resolveLibraryDestination', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }],
    project: { tooling: [] },
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', libraries: ['shadcn'] }],
    project: { tooling: [] },
    git: true,
  };

  test('turborepo: pkg library goes to packages/', () => {
    const result = resolveLibraryDestination('components/button.tsx', META.libraries.shadcn, turborepoCtx, 'web', {});
    expect(result).toBe('packages/ui/components/button.tsx');
  });

  test('single: uses file-based path', () => {
    const result = resolveLibraryDestination('components/button.tsx', META.libraries.shadcn, singleCtx, 'test', {});
    expect(result).toBe('components/button.tsx');
  });
});

describe('resolveProjectAddonDestination', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [],
    project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [],
    project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    git: true,
  };

  test('database addon goes to root', () => {
    const addon = META.project.database.options.postgres;
    const result = resolveProjectAddonDestination('docker-compose.yml', addon, turborepoCtx, {});
    expect(result).toBe('docker-compose.yml');
  });

  test('orm addon goes to packages/db in turborepo', () => {
    const addon = META.project.orm.options.drizzle;
    const result = resolveProjectAddonDestination('schema.ts', addon, turborepoCtx, {});
    expect(result).toBe('packages/db/schema.ts');
  });

  test('orm addon uses frontmatter path in single repo', () => {
    const addon = META.project.orm.options.drizzle;
    const result = resolveProjectAddonDestination('schema.ts', addon, singleCtx, { path: 'src/lib/db/schema.ts' });
    expect(result).toBe('src/lib/db/schema.ts');
  });

  test('tooling addon goes to root', () => {
    const addon = META.project.tooling.options.biome;
    const result = resolveProjectAddonDestination('biome.json', addon, turborepoCtx, {});
    expect(result).toBe('biome.json');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/template-resolver.test.ts`
Expected: FAIL — functions use old signature

**Step 3: Rewrite template-resolver.ts**

Replace `apps/cli/src/lib/template-resolver.ts`:

```typescript
// ABOUTME: Resolves template files to destination paths
// ABOUTME: Uses frontmatter and META mono config for libraries and project addons

import { join } from 'node:path';
import { META, type ProjectCategoryName } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import type { TemplateFrontmatter } from './frontmatter';
import { parseStackSuffix, readFrontmatterFile, shouldSkipTemplate } from './frontmatter';

const VALID_STACKS = Object.keys(META.stacks);

export function resolveLibraryDestination(
  relativePath: string,
  library: MetaAddon,
  ctx: TemplateContext,
  appName: string,
  frontmatter: TemplateFrontmatter,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  if (!isTurborepo) {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? library.mono?.scope ?? 'app';
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'root':
      return filePath;
    case 'pkg': {
      const name = library.mono?.scope === 'pkg' ? library.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }
    case 'app':
    default:
      return `apps/${appName}/${filePath}`;
  }
}

export function resolveProjectAddonDestination(
  relativePath: string,
  addon: MetaAddon,
  ctx: TemplateContext,
  frontmatter: TemplateFrontmatter,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  if (!isTurborepo) {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? addon.mono?.scope ?? 'root';
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'pkg': {
      const name = addon.mono?.scope === 'pkg' ? addon.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }
    case 'app':
      return `apps/${ctx.apps[0]?.appName ?? ctx.projectName}/${filePath}`;
    case 'root':
    default:
      return filePath;
  }
}

export function resolveStackDestination(relativePath: string, ctx: TemplateContext, appName: string): string {
  const isTurborepo = ctx.repo === 'turborepo';
  return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
}

function readFrontmatter(source: string): { frontmatter: TemplateFrontmatter; only: string | undefined } {
  try {
    const parsed = readFrontmatterFile(source);
    return { frontmatter: parsed.data, only: parsed.data.only };
  } catch {
    return { frontmatter: {}, only: undefined };
  }
}

function resolveTemplatesForStack(stackName: StackName, appName: string, ctx: TemplateContext): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stack', stackName);
  const files = scanDirectory(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(stackDir, file);
    const { only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedFilename = transformFilename(file);
    const destination = resolveStackDestination(transformedFilename, ctx, appName);
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForLibrary(
  libraryName: string,
  appName: string,
  ctx: TemplateContext,
  stackName: StackName,
): TemplateFile[] {
  const library = META.libraries[libraryName];
  if (!library) return [];

  const libraryDir = join(TEMPLATES_DIR, 'libraries', libraryName);
  const files = scanDirectory(libraryDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(libraryDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix && fileSuffix !== stackName) continue;

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);
    const destination = resolveLibraryDestination(transformedPath, library, ctx, appName, frontmatter);
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForProjectAddon(
  category: ProjectCategoryName,
  addonName: string,
  ctx: TemplateContext,
): TemplateFile[] {
  const addon = META.project[category]?.options[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'project', category, addonName);
  const files = scanDirectory(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(file);
    const destination = resolveProjectAddonDestination(transformedPath, addon, ctx, frontmatter);
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForRepo(ctx: TemplateContext): TemplateFile[] {
  const repoDir = join(TEMPLATES_DIR, 'repo', ctx.repo);
  const files = scanDirectory(repoDir);

  return files.map((file) => {
    const source = join(repoDir, file);
    const transformedPath = transformFilename(file);
    return { source, destination: transformedPath };
  });
}

export function getAllTemplatesForContext(ctx: TemplateContext): TemplateFile[] {
  const templates: TemplateFile[] = [];

  templates.push(...resolveTemplatesForRepo(ctx));

  for (const app of ctx.apps) {
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx));

    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (library && isLibraryCompatible(library, app.stackName)) {
        templates.push(...resolveTemplatesForLibrary(libraryName, app.appName, ctx, app.stackName));
      }
    }
  }

  // Project addons
  if (ctx.project.database) {
    templates.push(...resolveTemplatesForProjectAddon('database', ctx.project.database, ctx));
  }
  if (ctx.project.orm) {
    templates.push(...resolveTemplatesForProjectAddon('orm', ctx.project.orm, ctx));
  }
  for (const tooling of ctx.project.tooling) {
    templates.push(...resolveTemplatesForProjectAddon('tooling', tooling, ctx));
  }

  return templates;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/template-resolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts apps/cli/tests/template-resolver.test.ts
git commit -m "refactor(template-resolver): update for libraries and project categories"
```

---

## Task 7: Update package-json-generator.ts

**Files:**
- Modify: `apps/cli/src/lib/package-json-generator.ts`
- Modify: `apps/cli/tests/package-json-generator.test.ts`

**Step 1: Update the test file**

Update `apps/cli/tests/package-json-generator.test.ts` to use new context structure. Key changes:
- Replace `app.addons` with `app.libraries`
- Replace `ctx.globalAddons` with `ctx.project`

**Step 2: Update package-json-generator.ts**

Key changes:
- Replace `app.addons` → `app.libraries`
- Replace `ctx.globalAddons` → iterate over `ctx.project.database`, `ctx.project.orm`, `ctx.project.tooling`
- Update `getPackageName` to look up in correct META location
- Update `generateAllPackageJsons` to use project structure

**Step 3: Run tests**

Run: `bun test --cwd apps/cli tests/package-json-generator.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/cli/src/lib/package-json-generator.ts apps/cli/tests/package-json-generator.test.ts
git commit -m "refactor(package-json-generator): update for new context structure"
```

---

## Task 8: Update prompts/stack-prompts.ts

**Files:**
- Modify: `apps/cli/src/prompts/stack-prompts.ts`

**Step 1: Rewrite prompts**

Key changes:
- Rename `multiselectAddonsPrompt` → `multiselectLibrariesPrompt`
- Use `META.libraries` instead of `getAddonsByType(META).module`
- Remove `selectGlobalAddonPrompt` and `multiselectGlobalAddonsPrompt`
- Add `promptProjectCategory` that reads config from `META.project`

**Step 2: Run full test suite**

Run: `bun test --cwd apps/cli`
Expected: Tests related to prompts pass

**Step 3: Commit**

```bash
git add apps/cli/src/prompts/stack-prompts.ts
git commit -m "refactor(prompts): update for libraries and project categories"
```

---

## Task 9: Update cli.ts

**Files:**
- Modify: `apps/cli/src/cli.ts`

**Step 1: Rewrite CLI flow**

Replace hardcoded database/orm/extras prompts with loop over `META.project`:

```typescript
// Project-level addons - loop over META.project
for (const [category, config] of Object.entries(META.project)) {
  if (!isProjectCategoryMet(category, ctx.project)) continue;

  const selected = await promptProjectCategory(category, config, ctx);

  if (config.selection === 'single') {
    (ctx.project as any)[category] = selected;
  } else {
    (ctx.project as any)[category] = selected ?? [];
  }
}
```

**Step 2: Run full test suite**

Run: `bun test --cwd apps/cli`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/cli/src/cli.ts
git commit -m "refactor(cli): declarative loop over META.project categories"
```

---

## Task 10: Update flags.ts

**Files:**
- Modify: `apps/cli/src/flags.ts`

**Step 1: Update flag parsing**

Key changes:
- Replace `--addon` with `--database`, `--orm`, `--tooling` flags
- Or keep `--addon` but parse into correct `ctx.project` field
- Update `parseAppFlag` to use `libraries` instead of `addons`
- Update validation to check `ctx.project` structure

**Step 2: Run tests**

Run: `bun test --cwd apps/cli`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/cli/src/flags.ts
git commit -m "refactor(flags): update for new context structure"
```

---

## Task 11: Update tui/summary.ts

**Files:**
- Modify: `apps/cli/src/tui/summary.ts`

**Step 1: Update display**

Key changes:
- Replace `ctx.globalAddons` checks with `ctx.project` checks
- Replace `app.addons` with `app.libraries`
- Update CLI command generation to use new flag format

**Step 2: Verify output looks correct**

Run CLI manually and verify summary displays correctly.

**Step 3: Commit**

```bash
git add apps/cli/src/tui/summary.ts
git commit -m "refactor(summary): update for new context structure"
```

---

## Task 12: Restructure templates directory

**Files:**
- Move: `apps/cli/templates/addons/` → split into `libraries/` and `project/`

**Step 1: Create new directory structure**

```bash
mkdir -p apps/cli/templates/libraries
mkdir -p apps/cli/templates/project/database
mkdir -p apps/cli/templates/project/orm
mkdir -p apps/cli/templates/project/tooling
```

**Step 2: Move library templates**

```bash
mv apps/cli/templates/addons/shadcn apps/cli/templates/libraries/
mv apps/cli/templates/addons/mdx apps/cli/templates/libraries/
mv apps/cli/templates/addons/pwa apps/cli/templates/libraries/
mv apps/cli/templates/addons/nativewind apps/cli/templates/libraries/
mv apps/cli/templates/addons/better-auth apps/cli/templates/libraries/
```

**Step 3: Move project templates**

```bash
mv apps/cli/templates/addons/postgres apps/cli/templates/project/database/
mv apps/cli/templates/addons/mysql apps/cli/templates/project/database/
mv apps/cli/templates/addons/drizzle apps/cli/templates/project/orm/
mv apps/cli/templates/addons/prisma apps/cli/templates/project/orm/
mv apps/cli/templates/addons/biome apps/cli/templates/project/tooling/
mv apps/cli/templates/addons/husky apps/cli/templates/project/tooling/
```

**Step 4: Remove old addons directory**

```bash
rmdir apps/cli/templates/addons
```

**Step 5: Run full test suite**

Run: `bun test --cwd apps/cli`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/cli/templates/
git commit -m "refactor(templates): restructure into libraries and project categories"
```

---

## Task 13: Delete old addon-types.test.ts

**Files:**
- Delete: `apps/cli/tests/addon-types.test.ts` (replaced by meta-types.test.ts)

**Step 1: Delete file**

```bash
rm apps/cli/tests/addon-types.test.ts
```

**Step 2: Commit**

```bash
git add -u apps/cli/tests/addon-types.test.ts
git commit -m "chore: remove old addon-types test file"
```

---

## Task 14: Run full integration tests

**Files:**
- Test: `apps/cli/tests/cli-integration.test.ts`

**Step 1: Run full test suite**

Run: `bun test --cwd apps/cli`
Expected: All tests pass

**Step 2: Manual smoke test**

Run: `bun run --cwd apps/cli src/index.ts`
Expected: CLI works interactively with new prompts

**Step 3: Fix any remaining issues**

If tests fail, fix the issues and commit.

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify all integration tests pass with new structure"
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| `META.addons` | `META.libraries` + `META.project.{database,orm,tooling}.options` |
| `AddonType = 'module' \| 'orm' \| 'database' \| 'extra'` | Structure implies type |
| `ctx.apps[].addons` | `ctx.apps[].libraries` |
| `ctx.globalAddons: string[]` | `ctx.project: { database?, orm?, tooling[] }` |
| `templates/addons/` | `templates/libraries/` + `templates/project/` |
| `has "database" "postgres"` lookup in META | Direct `ctx.project.database === 'postgres'` |
| Hardcoded prompts in cli.ts | Loop over `META.project` |
