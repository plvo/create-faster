# Unified Addon Architecture - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the fragmented META structure (modules, orm, database, extras) into a unified `addons` system with consistent destination resolution and simplified magic comments.

**Architecture:** Single `MetaAddon` interface for all add-ons. Destination determined by `destination.target` (app|package|root). Magic comments `@only:` for skip and `@dest:` for override. Templates moved to `templates/addons/{name}/` with final structure (no `src/` prefix). Type determines selection mode: `module` = per-app, others = global.

**Tech Stack:** Bun, TypeScript, Handlebars

---

## Table of Contents

1. [Phase 1: Types and META Structure](#phase-1-types-and-meta-structure)
2. [Phase 2: Magic Comments](#phase-2-magic-comments)
3. [Phase 3: Template Resolver](#phase-3-template-resolver)
4. [Phase 4: Package.json Generator](#phase-4-packagejson-generator)
5. [Phase 5: CLI and Prompts](#phase-5-cli-and-prompts)
6. [Phase 6: Template Migration](#phase-6-template-migration)
7. [Phase 7: Integration Tests](#phase-7-integration-tests)

---

## Phase 1: Types and META Structure

### Task 1.1: Create new unified types

**Files:**
- Modify: `apps/cli/src/types/meta.ts`
- Create: `apps/cli/tests/addon-types.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/cli/tests/addon-types.test.ts

// ABOUTME: Type tests for unified addon architecture
// ABOUTME: Ensures MetaAddon types enforce correct destination constraints

import { describe, test, expect } from 'bun:test';
import type {
  AddonType,
  AddonDestination,
  AddonSupport,
  MetaAddon,
  StackName,
} from '../src/types/meta';

describe('MetaAddon types', () => {
  test('AddonType includes all valid types', () => {
    const types: AddonType[] = ['module', 'orm', 'database', 'extra'];
    expect(types).toHaveLength(4);
  });

  test('AddonDestination app target has no required fields', () => {
    const dest: AddonDestination = { target: 'app' };
    expect(dest.target).toBe('app');
  });

  test('AddonDestination package target requires name', () => {
    const dest: AddonDestination = {
      target: 'package',
      name: 'ui',
      singlePath: 'src/components/ui/'
    };
    expect(dest.target).toBe('package');
    expect(dest.name).toBe('ui');
  });

  test('AddonDestination root target has no required fields', () => {
    const dest: AddonDestination = { target: 'root' };
    expect(dest.target).toBe('root');
  });

  test('AddonSupport accepts stacks array or all', () => {
    const supportArray: AddonSupport = { stacks: ['nextjs', 'expo'] };
    const supportAll: AddonSupport = { stacks: 'all' };
    expect(supportArray.stacks).toContain('nextjs');
    expect(supportAll.stacks).toBe('all');
  });

  test('AddonSupport accepts addon dependencies', () => {
    const support: AddonSupport = {
      stacks: 'all',
      addons: ['postgres', 'mysql']
    };
    expect(support.addons).toContain('postgres');
  });

  test('MetaAddon with package destination has required name', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'shadcn/ui',
      destination: { target: 'package', name: 'ui', singlePath: 'src/components/ui/' },
      packageJson: { dependencies: { 'radix-ui': '^1.4.2' } },
    };
    expect(addon.destination?.target).toBe('package');
    if (addon.destination?.target === 'package') {
      expect(addon.destination.name).toBe('ui');
    }
  });

  test('MetaAddon defaults destination to app when omitted', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'TanStack Query',
      packageJson: { dependencies: { '@tanstack/react-query': '^5.90.0' } },
    };
    expect(addon.destination).toBeUndefined();
    // Default behavior: target = 'app'
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/addon-types.test.ts`
Expected: FAIL with "Cannot find module '../src/types/meta'" (types don't exist yet)

**Step 3: Write the new types**

```typescript
// apps/cli/src/types/meta.ts

// ABOUTME: Type definitions for META configuration
// ABOUTME: Unified addon system with discriminated destination types

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type AddonType = 'module' | 'orm' | 'database' | 'extra';
export type RepoType = 'single' | 'turborepo';

// Discriminated union for destination - package requires name
export type AddonDestination =
  | { target: 'app' }
  | { target: 'package'; name: string; singlePath?: string }
  | { target: 'root' };

export interface AddonSupport {
  stacks?: StackName[] | 'all';
  addons?: string[];
}

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface MetaAddon {
  type: AddonType;
  label: string;
  hint?: string;
  support?: AddonSupport;
  destination?: AddonDestination;
  packageJson?: PackageJsonConfig;
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
  addons: Record<string, MetaAddon>;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}

// Helper: get addons grouped by type (cached)
let addonGroupsCache: Record<AddonType, string[]> | null = null;

export function getAddonsByType(meta: Meta): Record<AddonType, string[]> {
  if (addonGroupsCache) return addonGroupsCache;

  addonGroupsCache = Object.entries(meta.addons).reduce(
    (acc, [name, addon]) => {
      acc[addon.type] ??= [];
      acc[addon.type].push(name);
      return acc;
    },
    {} as Record<AddonType, string[]>
  );

  return addonGroupsCache;
}

// Helper: check if addon is compatible with stack
export function isAddonCompatible(addon: MetaAddon, stackName: StackName): boolean {
  if (!addon.support?.stacks) return true;
  if (addon.support.stacks === 'all') return true;
  return addon.support.stacks.includes(stackName);
}

// Helper: check if addon dependencies are satisfied
export function areAddonDependenciesMet(
  addon: MetaAddon,
  selectedAddons: string[]
): boolean {
  if (!addon.support?.addons || addon.support.addons.length === 0) return true;
  return addon.support.addons.some((dep) => selectedAddons.includes(dep));
}

// Clear cache (for testing)
export function clearAddonGroupsCache(): void {
  addonGroupsCache = null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/addon-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/types/meta.ts apps/cli/tests/addon-types.test.ts
git commit -m "$(cat <<'EOF'
refactor(types): unified MetaAddon interface with discriminated destinations

- AddonType: module | orm | database | extra
- AddonDestination: app | package (with name) | root
- AddonSupport: stacks + addon dependencies
- Helper functions for grouping and compatibility
EOF
)"
```

---

### Task 1.2: Update context types

**Files:**
- Modify: `apps/cli/src/types/ctx.ts`

**Step 1: Update ctx.ts**

```typescript
// apps/cli/src/types/ctx.ts

// ABOUTME: Context types for template rendering and CLI flow
// ABOUTME: AppContext for per-app config, TemplateContext for full generation

import type { StackName } from './meta';

export interface AppContext {
  appName: string;
  stackName: StackName;
  addons: string[];  // Changed from modules to addons
}

export type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  globalAddons: string[];  // Global addons (orm, database, extra types)
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

**Step 2: Commit**

```bash
git add apps/cli/src/types/ctx.ts
git commit -m "refactor(types): update context types for unified addon system"
```

---

### Task 1.3: Rewrite __meta__.ts with unified addons

**Files:**
- Modify: `apps/cli/src/__meta__.ts`
- Create: `apps/cli/tests/meta-addons.test.ts`

**Step 1: Write validation test**

```typescript
// apps/cli/tests/meta-addons.test.ts

// ABOUTME: Validation tests for META with unified addons
// ABOUTME: Ensures all addons have required fields and valid references

import { describe, test, expect } from 'bun:test';
import { META } from '../src/__meta__';
import { getAddonsByType, isAddonCompatible, areAddonDependenciesMet } from '../src/types/meta';

describe('META.addons validation', () => {
  test('all addons have type and label', () => {
    for (const [name, addon] of Object.entries(META.addons)) {
      expect(addon.type, `${name} should have type`).toBeDefined();
      expect(addon.label, `${name} should have label`).toBeDefined();
    }
  });

  test('package destinations have required name', () => {
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.destination?.target === 'package') {
        expect(addon.destination.name, `${name} package destination needs name`).toBeDefined();
      }
    }
  });

  test('addon dependencies reference existing addons', () => {
    const addonNames = Object.keys(META.addons);
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.support?.addons) {
        for (const dep of addon.support.addons) {
          expect(addonNames, `${name} depends on non-existent addon: ${dep}`).toContain(dep);
        }
      }
    }
  });

  test('stack references are valid', () => {
    const stackNames = Object.keys(META.stacks);
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.support?.stacks && addon.support.stacks !== 'all') {
        for (const stack of addon.support.stacks) {
          expect(stackNames, `${name} references non-existent stack: ${stack}`).toContain(stack);
        }
      }
    }
  });
});

describe('getAddonsByType', () => {
  test('groups addons correctly', () => {
    const groups = getAddonsByType(META);

    expect(groups.module).toContain('shadcn');
    expect(groups.orm).toContain('drizzle');
    expect(groups.database).toContain('postgres');
    expect(groups.extra).toContain('biome');
  });
});

describe('isAddonCompatible', () => {
  test('shadcn is compatible with nextjs', () => {
    expect(isAddonCompatible(META.addons.shadcn, 'nextjs')).toBe(true);
  });

  test('shadcn is not compatible with expo', () => {
    expect(isAddonCompatible(META.addons.shadcn, 'expo')).toBe(false);
  });

  test('tanstack-query is compatible with all', () => {
    expect(isAddonCompatible(META.addons['tanstack-query'], 'nextjs')).toBe(true);
    expect(isAddonCompatible(META.addons['tanstack-query'], 'expo')).toBe(true);
    expect(isAddonCompatible(META.addons['tanstack-query'], 'hono')).toBe(true);
  });
});

describe('areAddonDependenciesMet', () => {
  test('drizzle requires postgres or mysql', () => {
    expect(areAddonDependenciesMet(META.addons.drizzle, ['postgres'])).toBe(true);
    expect(areAddonDependenciesMet(META.addons.drizzle, ['mysql'])).toBe(true);
    expect(areAddonDependenciesMet(META.addons.drizzle, [])).toBe(false);
  });

  test('husky requires git addon or flag', () => {
    // Note: husky check is handled separately via ctx.git flag
    // This tests addons-only dependencies
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/meta-addons.test.ts`
Expected: FAIL (META structure doesn't match)

**Step 3: Rewrite __meta__.ts**

```typescript
// apps/cli/src/__meta__.ts

// ABOUTME: Single source of truth for all stacks and addons
// ABOUTME: Unified addon system - modules, orm, database, extras all share same interface

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

  addons: {
    // ==================== MODULES (per-app selection) ====================
    shadcn: {
      type: 'module',
      label: 'shadcn/ui',
      hint: 'Beautifully designed components',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      destination: { target: 'package', name: 'ui', singlePath: 'src/components/ui/' },
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
      type: 'module',
      label: 'Next Themes',
      hint: 'Theme management',
      support: { stacks: ['nextjs'] },
      packageJson: {
        dependencies: {
          'next-themes': '^0.4.6',
        },
      },
    },
    mdx: {
      type: 'module',
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
      type: 'module',
      label: 'PWA',
      hint: 'Progressive Web App support',
      support: { stacks: ['nextjs'] },
      packageJson: {},
    },
    'better-auth': {
      type: 'module',
      label: 'Better Auth',
      hint: 'Authentication framework',
      support: { stacks: ['nextjs'], addons: ['drizzle', 'prisma'] },
      destination: { target: 'package', name: 'auth', singlePath: 'src/lib/auth/' },
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
      type: 'module',
      label: 'TanStack Query',
      hint: 'Async state management',
      support: { stacks: 'all' },
      packageJson: {
        dependencies: {
          '@tanstack/react-query': '^5.90.0',
        },
      },
    },
    'tanstack-devtools': {
      type: 'module',
      label: 'TanStack Devtools',
      hint: 'Devtools for TanStack',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        devDependencies: {
          '@tanstack/react-devtools': '^0.7.0',
          '@tanstack/react-query-devtools': '^5.90.1',
        },
      },
    },
    'react-hook-form': {
      type: 'module',
      label: 'React Hook Form',
      hint: 'Performant forms',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          'react-hook-form': '^7.56.1',
          '@hookform/resolvers': '^5.2.1',
        },
      },
    },
    'tanstack-form': {
      type: 'module',
      label: 'TanStack Form',
      hint: 'Type-safe forms',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          '@tanstack/react-form': '^1.23.7',
        },
      },
    },
    nativewind: {
      type: 'module',
      label: 'NativeWind',
      hint: 'Tailwind for React Native',
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
      type: 'module',
      label: 'AWS Lambda',
      hint: 'Serverless deployment',
      support: { stacks: ['hono'] },
      packageJson: {
        dependencies: {
          '@hono/aws-lambda': '^1.0.0',
        },
      },
    },

    // ==================== ORM (global selection) ====================
    drizzle: {
      type: 'orm',
      label: 'Drizzle',
      hint: 'Lightweight TypeScript ORM',
      support: { addons: ['postgres', 'mysql'] },
      destination: { target: 'package', name: 'db', singlePath: 'src/lib/db/' },
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
          '.': './src/index.ts',
          './schema': './src/schema.ts',
          './types': './src/types.ts',
        },
      },
    },
    prisma: {
      type: 'orm',
      label: 'Prisma',
      hint: 'Type-safe ORM with migrations',
      support: { addons: ['postgres', 'mysql'] },
      destination: { target: 'package', name: 'db', singlePath: 'src/lib/db/' },
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
          '.': './src/index.ts',
        },
      },
    },

    // ==================== DATABASE (global selection) ====================
    postgres: {
      type: 'database',
      label: 'PostgreSQL',
      hint: 'Relational database',
      destination: { target: 'root' },
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
      type: 'database',
      label: 'MySQL',
      hint: 'Relational database',
      destination: { target: 'root' },
      packageJson: {
        dependencies: {
          mysql2: '^3.11.5',
        },
      },
    },

    // ==================== EXTRAS (global selection) ====================
    biome: {
      type: 'extra',
      label: 'Biome',
      hint: 'Fast linter & formatter',
      destination: { target: 'root' },
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
      type: 'extra',
      label: 'Husky',
      hint: 'Git hooks (requires git)',
      destination: { target: 'root' },
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
```

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/meta-addons.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/tests/meta-addons.test.ts
git commit -m "refactor(__meta__): unify modules, orm, database, extras into addons"
```

---

## Phase 2: Magic Comments

### Task 2.1: Update magic-comments.ts with @only: support

**Files:**
- Modify: `apps/cli/src/lib/magic-comments.ts`
- Modify: `apps/cli/tests/magic-comments.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/cli/tests/magic-comments.test.ts

// ABOUTME: Unit tests for magic comments parsing
// ABOUTME: Tests @only: for skip and @dest: for destination override

import { describe, test, expect } from 'bun:test';
import {
  parseMagicComments,
  parseDestFromContent,
  parseOnlyFromContent,
  shouldSkipTemplate,
  removeAllMagicComments,
} from '../src/lib/magic-comments';
import type { TemplateContext } from '../src/types/ctx';

describe('parseMagicComments', () => {
  test('parses @dest:app', () => {
    const result = parseMagicComments('{{!-- @dest:app --}}');
    expect(result.dest).toBe('app');
  });

  test('parses @dest:package', () => {
    const result = parseMagicComments('{{!-- @dest:package --}}');
    expect(result.dest).toBe('package');
  });

  test('parses @dest:root', () => {
    const result = parseMagicComments('{{!-- @dest:root --}}');
    expect(result.dest).toBe('root');
  });

  test('parses @only:turborepo', () => {
    const result = parseMagicComments('{{!-- @only:turborepo --}}');
    expect(result.only).toBe('turborepo');
  });

  test('parses @only:single', () => {
    const result = parseMagicComments('{{!-- @only:single --}}');
    expect(result.only).toBe('single');
  });

  test('parses combined @only and @dest', () => {
    const result = parseMagicComments('{{!-- @only:turborepo @dest:package --}}');
    expect(result.only).toBe('turborepo');
    expect(result.dest).toBe('package');
  });

  test('returns empty for no magic comments', () => {
    const result = parseMagicComments('// regular comment');
    expect(result.dest).toBeUndefined();
    expect(result.only).toBeUndefined();
  });
});

describe('parseDestFromContent', () => {
  test('extracts dest from first line', () => {
    const content = '{{!-- @dest:root --}}\nrest of file';
    expect(parseDestFromContent(content)).toBe('root');
  });

  test('returns null for no dest', () => {
    const content = 'no magic comment\nrest of file';
    expect(parseDestFromContent(content)).toBeNull();
  });
});

describe('parseOnlyFromContent', () => {
  test('extracts only from first line', () => {
    const content = '{{!-- @only:turborepo --}}\nrest of file';
    expect(parseOnlyFromContent(content)).toBe('turborepo');
  });

  test('returns null for no only', () => {
    const content = '{{!-- @dest:root --}}\nrest of file';
    expect(parseOnlyFromContent(content)).toBeNull();
  });
});

describe('shouldSkipTemplate', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [],
    globalAddons: [],
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [],
    globalAddons: [],
    git: true,
  };

  test('@only:turborepo skips in single', () => {
    expect(shouldSkipTemplate('turborepo', singleCtx)).toBe(true);
    expect(shouldSkipTemplate('turborepo', turborepoCtx)).toBe(false);
  });

  test('@only:single skips in turborepo', () => {
    expect(shouldSkipTemplate('single', turborepoCtx)).toBe(true);
    expect(shouldSkipTemplate('single', singleCtx)).toBe(false);
  });

  test('no @only never skips', () => {
    expect(shouldSkipTemplate(null, turborepoCtx)).toBe(false);
    expect(shouldSkipTemplate(null, singleCtx)).toBe(false);
  });
});

describe('removeAllMagicComments', () => {
  test('removes @dest comment', () => {
    const content = '{{!-- @dest:root --}}\nrest of file';
    expect(removeAllMagicComments(content)).toBe('rest of file');
  });

  test('removes @only comment', () => {
    const content = '{{!-- @only:turborepo --}}\nrest of file';
    expect(removeAllMagicComments(content)).toBe('rest of file');
  });

  test('removes combined comments', () => {
    const content = '{{!-- @only:turborepo @dest:package --}}\nrest of file';
    expect(removeAllMagicComments(content)).toBe('rest of file');
  });

  test('preserves content without magic comments', () => {
    const content = 'no magic comment\nrest of file';
    expect(removeAllMagicComments(content)).toBe('no magic comment\nrest of file');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/magic-comments.test.ts`
Expected: FAIL (functions don't exist)

**Step 3: Implement magic-comments.ts**

```typescript
// apps/cli/src/lib/magic-comments.ts

// ABOUTME: Magic comment parser for template processing
// ABOUTME: Supports @only:turborepo|single for skip and @dest:app|package|root for destination

import type { TemplateContext } from '@/types/ctx';

export type DestType = 'app' | 'package' | 'root';
export type OnlyType = 'turborepo' | 'single';

export interface ParsedMagicComments {
  dest?: DestType;
  only?: OnlyType;
}

const MAGIC_COMMENT_REGEX = /^\{\{!--\s*((?:@(?:dest|only):[a-z]+\s*)+)--\}\}/;
const DEST_REGEX = /@dest:(app|package|root)/;
const ONLY_REGEX = /@only:(turborepo|single)/;

export function extractFirstLine(content: string): string {
  const firstLineEnd = content.indexOf('\n');
  return firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
}

export function parseMagicComments(firstLine: string): ParsedMagicComments {
  const result: ParsedMagicComments = {};

  const commentMatch = firstLine.match(MAGIC_COMMENT_REGEX);
  if (!commentMatch) return result;

  const innerContent = commentMatch[1];

  const destMatch = innerContent.match(DEST_REGEX);
  if (destMatch) {
    result.dest = destMatch[1] as DestType;
  }

  const onlyMatch = innerContent.match(ONLY_REGEX);
  if (onlyMatch) {
    result.only = onlyMatch[1] as OnlyType;
  }

  return result;
}

export function parseDestFromContent(content: string): DestType | null {
  const firstLine = extractFirstLine(content);
  const parsed = parseMagicComments(firstLine);
  return parsed.dest ?? null;
}

export function parseOnlyFromContent(content: string): OnlyType | null {
  const firstLine = extractFirstLine(content);
  const parsed = parseMagicComments(firstLine);
  return parsed.only ?? null;
}

export function shouldSkipTemplate(only: OnlyType | null, ctx: TemplateContext): boolean {
  if (!only) return false;
  return only !== ctx.repo;
}

export function removeAllMagicComments(content: string): string {
  return content.replace(/^\{\{!--\s*(?:@(?:dest|only):[a-z]+\s*)+--\}\}\n?/, '');
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/magic-comments.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/magic-comments.ts apps/cli/tests/magic-comments.test.ts
git commit -m "feat(magic-comments): add @only:turborepo|single for conditional skip"
```

---

## Phase 3: Template Resolver

### Task 3.1: Rewrite template-resolver.ts for unified addons

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts`
- Modify: `apps/cli/tests/template-resolver.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/cli/tests/template-resolver.test.ts

// ABOUTME: Tests for unified template resolution
// ABOUTME: Tests destination resolution for all addon types

import { describe, test, expect } from 'bun:test';
import {
  resolveAddonDestination,
  getAllTemplatesForContext,
} from '../src/lib/template-resolver';
import { META } from '../src/__meta__';
import type { TemplateContext } from '../src/types/ctx';

describe('resolveAddonDestination', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', addons: ['shadcn'] }],
    globalAddons: ['drizzle', 'postgres', 'biome'],
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', addons: ['shadcn'] }],
    globalAddons: ['drizzle', 'postgres', 'biome'],
    git: true,
  };

  describe('destination.target = package', () => {
    const shadcnAddon = META.addons.shadcn;

    test('turborepo: goes to packages/{name}/', () => {
      const result = resolveAddonDestination(
        'components/button.tsx',
        shadcnAddon,
        turborepoCtx,
        'web',
        null
      );
      expect(result).toBe('packages/ui/components/button.tsx');
    });

    test('single: goes to singlePath', () => {
      const result = resolveAddonDestination(
        'components/button.tsx',
        shadcnAddon,
        singleCtx,
        'test',
        null
      );
      expect(result).toBe('src/components/ui/components/button.tsx');
    });

    test('@dest:app override goes to app', () => {
      const result = resolveAddonDestination(
        'components.json',
        shadcnAddon,
        turborepoCtx,
        'web',
        'app'
      );
      expect(result).toBe('apps/web/components.json');
    });

    test('@dest:root override goes to root', () => {
      const result = resolveAddonDestination(
        'drizzle.config.ts',
        META.addons.drizzle,
        turborepoCtx,
        'web',
        'root'
      );
      expect(result).toBe('drizzle.config.ts');
    });
  });

  describe('destination.target = root', () => {
    const biomeAddon = META.addons.biome;

    test('turborepo: goes to root', () => {
      const result = resolveAddonDestination(
        'biome.json',
        biomeAddon,
        turborepoCtx,
        'web',
        null
      );
      expect(result).toBe('biome.json');
    });

    test('single: goes to root', () => {
      const result = resolveAddonDestination(
        'biome.json',
        biomeAddon,
        singleCtx,
        'test',
        null
      );
      expect(result).toBe('biome.json');
    });
  });

  describe('destination.target = app (default)', () => {
    const tanstackQueryAddon = META.addons['tanstack-query'];

    test('turborepo: goes to apps/{appName}/', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        turborepoCtx,
        'web',
        null
      );
      expect(result).toBe('apps/web/providers/query-provider.tsx');
    });

    test('single: goes to root', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        singleCtx,
        'test',
        null
      );
      expect(result).toBe('providers/query-provider.tsx');
    });
  });
});

describe('getAllTemplatesForContext', () => {
  test('includes stack templates', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'test', stackName: 'nextjs', addons: [] }],
      globalAddons: [],
      git: true,
    };
    const templates = getAllTemplatesForContext(ctx);
    const destinations = templates.map((t) => t.destination);

    expect(destinations.some((d) => d.includes('page.tsx'))).toBe(true);
  });

  test('includes addon templates', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'turborepo',
      apps: [{ appName: 'web', stackName: 'nextjs', addons: ['shadcn'] }],
      globalAddons: [],
      git: true,
    };
    const templates = getAllTemplatesForContext(ctx);
    const destinations = templates.map((t) => t.destination);

    expect(destinations.some((d) => d.includes('packages/ui/'))).toBe(true);
  });

  test('includes global addon templates', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'test', stackName: 'nextjs', addons: [] }],
      globalAddons: ['biome'],
      git: true,
    };
    const templates = getAllTemplatesForContext(ctx);
    const destinations = templates.map((t) => t.destination);

    expect(destinations.some((d) => d.includes('biome.json'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/template-resolver.test.ts`
Expected: FAIL

**Step 3: Implement template-resolver.ts**

```typescript
// apps/cli/src/lib/template-resolver.ts

// ABOUTME: Resolves template files to destination paths
// ABOUTME: Unified resolution for all addon types using META destination config

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'fast-glob';
import { META } from '@/__meta__';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { isAddonCompatible } from '@/types/meta';
import { transformSpecialFilename } from './file-writer';
import type { DestType, OnlyType } from './magic-comments';
import { parseDestFromContent, parseOnlyFromContent, shouldSkipTemplate } from './magic-comments';

export function resolveAddonDestination(
  relativePath: string,
  addon: MetaAddon,
  ctx: TemplateContext,
  appName: string,
  destOverride: DestType | null
): string {
  const isTurborepo = ctx.repo === 'turborepo';
  const target = destOverride ?? addon.destination?.target ?? 'app';

  switch (target) {
    case 'root':
      return relativePath;

    case 'package': {
      if (!addon.destination || addon.destination.target !== 'package') {
        return relativePath;
      }
      if (isTurborepo) {
        return `packages/${addon.destination.name}/${relativePath}`;
      }
      // Single repo: use singlePath if defined
      const singlePath = addon.destination.singlePath ?? '';
      return `${singlePath}${relativePath}`;
    }

    case 'app':
    default:
      return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
  }
}

export function resolveStackDestination(
  relativePath: string,
  ctx: TemplateContext,
  appName: string
): string {
  const isTurborepo = ctx.repo === 'turborepo';
  return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
}

function scanTemplates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return globSync('**/*', { cwd: dir, onlyFiles: true, dot: true });
  } catch {
    return [];
  }
}

function transformFilename(filename: string): string {
  let result = filename.replace(/\.hbs$/, '');
  result = transformSpecialFilename(result);
  return result;
}

function resolveTemplatesForStack(
  stackName: StackName,
  appName: string,
  ctx: TemplateContext
): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stack', stackName);
  const files = scanTemplates(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    if (file.endsWith('package.json.hbs')) continue;

    const source = join(stackDir, file);
    const transformedPath = transformFilename(file);
    const destination = resolveStackDestination(transformedPath, ctx, appName);

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForAddon(
  addonName: string,
  appName: string,
  ctx: TemplateContext
): TemplateFile[] {
  const addon = META.addons[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'addons', addonName);
  const files = scanTemplates(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    if (file.endsWith('package.json.hbs')) continue;

    const source = join(addonDir, file);

    // Read file for magic comments
    let destOverride: DestType | null = null;
    let onlyValue: OnlyType | null = null;
    try {
      const content = readFileSync(source, 'utf-8');
      destOverride = parseDestFromContent(content);
      onlyValue = parseOnlyFromContent(content);
    } catch {
      // Can't read file, use defaults
    }

    // Skip if @only doesn't match repo type
    if (shouldSkipTemplate(onlyValue, ctx)) continue;

    const transformedPath = transformFilename(file);
    const destination = resolveAddonDestination(
      transformedPath,
      addon,
      ctx,
      appName,
      destOverride
    );

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForRepo(ctx: TemplateContext): TemplateFile[] {
  const repoDir = join(TEMPLATES_DIR, 'repo', ctx.repo);
  const files = scanTemplates(repoDir);

  return files
    .filter((file) => !file.endsWith('package.json.hbs'))
    .map((file) => {
      const source = join(repoDir, file);
      const transformedPath = transformFilename(file);
      return { source, destination: transformedPath };
    });
}

export function getAllTemplatesForContext(ctx: TemplateContext): TemplateFile[] {
  const templates: TemplateFile[] = [];

  // 1. Repo templates (turborepo or single config files)
  templates.push(...resolveTemplatesForRepo(ctx));

  // 2. Stack and per-app addon templates
  for (const app of ctx.apps) {
    // Stack templates
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx));

    // Per-app addons (modules)
    for (const addonName of app.addons) {
      const addon = META.addons[addonName];
      if (addon && isAddonCompatible(addon, app.stackName)) {
        templates.push(...resolveTemplatesForAddon(addonName, app.appName, ctx));
      }
    }
  }

  // 3. Global addons (orm, database, extras)
  // Use first app name for app-scoped files (if any)
  const defaultAppName = ctx.apps[0]?.appName ?? ctx.projectName;
  for (const addonName of ctx.globalAddons) {
    templates.push(...resolveTemplatesForAddon(addonName, defaultAppName, ctx));
  }

  return templates;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/template-resolver.test.ts`
Expected: PASS (after template migration in Phase 6)

**Step 5: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts apps/cli/tests/template-resolver.test.ts
git commit -m "refactor(template-resolver): unified resolution for all addon types"
```

---

## Phase 4: Package.json Generator

### Task 4.1: Update package-json-generator.ts for unified addons

**Files:**
- Modify: `apps/cli/src/lib/package-json-generator.ts`
- Modify: `apps/cli/tests/package-json-generator.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/cli/tests/package-json-generator.test.ts

// ABOUTME: Tests for programmatic package.json generation
// ABOUTME: Tests merge logic with unified addons

import { describe, test, expect } from 'bun:test';
import {
  generateAllPackageJsons,
  generateAppPackageJson,
  generatePackagePackageJson,
  mergePackageJsonConfigs,
} from '../src/lib/package-json-generator';
import type { TemplateContext } from '../src/types/ctx';

describe('mergePackageJsonConfigs', () => {
  test('merges dependencies', () => {
    const result = mergePackageJsonConfigs(
      { dependencies: { a: '1.0.0' } },
      { dependencies: { b: '2.0.0' } }
    );
    expect(result.dependencies).toEqual({ a: '1.0.0', b: '2.0.0' });
  });

  test('later config overrides earlier', () => {
    const result = mergePackageJsonConfigs(
      { dependencies: { a: '1.0.0' } },
      { dependencies: { a: '2.0.0' } }
    );
    expect(result.dependencies?.a).toBe('2.0.0');
  });
});

describe('generateAppPackageJson (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-project',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', addons: ['shadcn'] },
      { appName: 'api', stackName: 'hono', addons: [] },
    ],
    globalAddons: ['drizzle', 'postgres'],
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

  test('references workspace packages for addons with package destination', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies?.['@repo/ui']).toBe('*');
    expect(result.content.dependencies?.['radix-ui']).toBeUndefined();
  });

  test('references @repo/db when orm addon is selected', () => {
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
    apps: [{ appName: 'test-single', stackName: 'nextjs', addons: ['shadcn'] }],
    globalAddons: ['drizzle', 'postgres', 'biome'],
    git: true,
  };

  test('generates at root with project name', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.path).toBe('package.json');
    expect(result.content.name).toBe('test-single');
  });

  test('includes addon dependencies directly (no workspace)', () => {
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

  test('includes extras', () => {
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
        { appName: 'web', stackName: 'nextjs', addons: ['shadcn'] },
        { appName: 'api', stackName: 'hono', addons: [] },
      ],
      globalAddons: ['drizzle', 'postgres'],
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
      apps: [{ appName: 'test-single', stackName: 'nextjs', addons: [] }],
      globalAddons: [],
      git: true,
    };

    const results = generateAllPackageJsons(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('package.json');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/package-json-generator.test.ts`
Expected: FAIL

**Step 3: Implement package-json-generator.ts**

```typescript
// apps/cli/src/lib/package-json-generator.ts

// ABOUTME: Programmatic generation of package.json files
// ABOUTME: Merges dependencies from META based on unified addon system

import { META } from '@/__meta__';
import type { PackageJsonConfig } from '@/types/meta';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { isAddonCompatible, getAddonsByType } from '@/types/meta';

export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  type?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface GeneratedPackageJson {
  path: string;
  content: PackageJson;
}

export function mergePackageJsonConfigs(
  ...configs: (PackageJsonConfig | undefined)[]
): PackageJsonConfig {
  const result: PackageJsonConfig = {};

  for (const config of configs) {
    if (!config) continue;

    if (config.dependencies) {
      result.dependencies = { ...result.dependencies, ...config.dependencies };
    }
    if (config.devDependencies) {
      result.devDependencies = { ...result.devDependencies, ...config.devDependencies };
    }
    if (config.scripts) {
      result.scripts = { ...result.scripts, ...config.scripts };
    }
    if (config.exports) {
      result.exports = { ...result.exports, ...config.exports };
    }
  }

  return result;
}

function resolveScriptPorts(
  scripts: Record<string, string>,
  port: number
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = value.replace(/\{\{port\}\}/g, String(port));
  }
  return resolved;
}

function removePortPlaceholders(scripts: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = value.replace(/\s*--port\s*\{\{port\}\}/g, '');
  }
  return resolved;
}

function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted = {} as T;
  for (const key of Object.keys(obj).sort()) {
    (sorted as Record<string, unknown>)[key] = obj[key];
  }
  return sorted;
}

function hasPackageDestination(addonName: string): string | null {
  const addon = META.addons[addonName];
  if (addon?.destination?.target === 'package') {
    return addon.destination.name;
  }
  return null;
}

export function generateAppPackageJson(
  app: AppContext,
  ctx: TemplateContext,
  appIndex: number
): GeneratedPackageJson {
  const stack = META.stacks[app.stackName];
  const port = 3000 + appIndex;
  const isTurborepo = ctx.repo === 'turborepo';

  let merged = mergePackageJsonConfigs(stack.packageJson);

  // Per-app addons (modules)
  for (const addonName of app.addons) {
    const addon = META.addons[addonName];
    if (!addon || !isAddonCompatible(addon, app.stackName)) continue;

    const packageName = hasPackageDestination(addonName);
    if (packageName && isTurborepo) {
      // Add workspace reference
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${packageName}`]: '*',
      };
    } else {
      // Merge dependencies directly
      merged = mergePackageJsonConfigs(merged, addon.packageJson);
    }
  }

  // Global addons
  const addonGroups = getAddonsByType(META);

  for (const addonName of ctx.globalAddons) {
    const addon = META.addons[addonName];
    if (!addon) continue;

    const packageName = hasPackageDestination(addonName);

    if (packageName && isTurborepo) {
      // Add workspace reference for packages (e.g., @repo/db)
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${packageName}`]: '*',
      };
    } else if (!isTurborepo || addon.destination?.target === 'root') {
      // Single repo: merge all directly
      // Turborepo with root target: merge extras
      merged = mergePackageJsonConfigs(merged, addon.packageJson);
    }
  }

  // In single repo, extras go into the app package.json
  if (!isTurborepo) {
    for (const addonName of ctx.globalAddons) {
      const addon = META.addons[addonName];
      if (addon?.type === 'extra') {
        merged = mergePackageJsonConfigs(merged, addon.packageJson);
      }
    }
  }

  // Resolve port placeholders
  let scripts = merged.scripts ?? {};
  if (isTurborepo) {
    scripts = resolveScriptPorts(scripts, port);
  } else {
    scripts = removePortPlaceholders(scripts);
  }

  const pkg: PackageJson = {
    name: isTurborepo ? app.appName : ctx.projectName,
    version: '0.1.0',
    private: true,
    scripts: sortObjectKeys(scripts),
    dependencies: sortObjectKeys(merged.dependencies ?? {}),
    devDependencies: sortObjectKeys(merged.devDependencies ?? {}),
  };

  const path = isTurborepo ? `apps/${app.appName}/package.json` : 'package.json';

  return { path, content: pkg };
}

export function generatePackagePackageJson(
  packageName: string,
  config: PackageJsonConfig
): GeneratedPackageJson {
  const pkg: PackageJson = {
    name: `@repo/${packageName}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: config.exports,
    scripts: config.scripts ? sortObjectKeys(config.scripts) : undefined,
    dependencies: config.dependencies ? sortObjectKeys(config.dependencies) : undefined,
    devDependencies: config.devDependencies
      ? sortObjectKeys(config.devDependencies)
      : undefined,
  };

  const cleanPkg = Object.fromEntries(
    Object.entries(pkg).filter(([, v]) => v !== undefined)
  ) as PackageJson;

  return {
    path: `packages/${packageName}/package.json`,
    content: cleanPkg,
  };
}

export function generateRootPackageJson(ctx: TemplateContext): GeneratedPackageJson {
  const scripts: Record<string, string> = {
    dev: 'turbo dev',
    build: 'turbo build',
    lint: 'turbo lint',
    clean: 'turbo clean',
  };

  let devDependencies: Record<string, string> = {
    turbo: '^2.4.0',
  };

  // Add extras to root in turborepo
  for (const addonName of ctx.globalAddons) {
    const addon = META.addons[addonName];
    if (addon?.type === 'extra' && addon.packageJson) {
      if (addon.packageJson.devDependencies) {
        devDependencies = { ...devDependencies, ...addon.packageJson.devDependencies };
      }
      if (addon.packageJson.scripts) {
        Object.assign(scripts, addon.packageJson.scripts);
      }
    }
  }

  const pkg: PackageJson = {
    name: ctx.projectName,
    version: '0.0.0',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: sortObjectKeys(scripts),
    devDependencies: sortObjectKeys(devDependencies),
  };

  return { path: 'package.json', content: pkg };
}

export function generateAllPackageJsons(ctx: TemplateContext): GeneratedPackageJson[] {
  const results: GeneratedPackageJson[] = [];
  const isTurborepo = ctx.repo === 'turborepo';

  if (isTurborepo) {
    results.push(generateRootPackageJson(ctx));

    ctx.apps.forEach((app, index) => {
      results.push(generateAppPackageJson(app, ctx, index));
    });

    // Collect extracted packages
    const extractedPackages = new Map<string, PackageJsonConfig>();

    // From per-app addons
    for (const app of ctx.apps) {
      for (const addonName of app.addons) {
        const addon = META.addons[addonName];
        if (addon?.destination?.target === 'package') {
          const pkgName = addon.destination.name;
          if (!extractedPackages.has(pkgName)) {
            extractedPackages.set(pkgName, addon.packageJson ?? {});
          }
        }
      }
    }

    // From global addons (orm + database merged into db package)
    const ormAddons = ctx.globalAddons.filter((n) => META.addons[n]?.type === 'orm');
    const dbAddons = ctx.globalAddons.filter((n) => META.addons[n]?.type === 'database');

    if (ormAddons.length > 0) {
      const ormAddon = META.addons[ormAddons[0]];
      if (ormAddon?.destination?.target === 'package') {
        const pkgName = ormAddon.destination.name;
        let config = ormAddon.packageJson ?? {};

        // Merge database driver
        for (const dbName of dbAddons) {
          const dbAddon = META.addons[dbName];
          if (dbAddon?.packageJson) {
            config = mergePackageJsonConfigs(config, dbAddon.packageJson);
          }
        }

        extractedPackages.set(pkgName, config);
      }
    }

    for (const [name, config] of extractedPackages) {
      results.push(generatePackagePackageJson(name, config));
    }
  } else {
    const firstApp = ctx.apps[0];
    if (firstApp) {
      results.push(generateAppPackageJson(firstApp, ctx, 0));
    }
  }

  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/package-json-generator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/package-json-generator.ts apps/cli/tests/package-json-generator.test.ts
git commit -m "refactor(package-json-generator): support unified addon system"
```

---

## Phase 5: CLI and Prompts

### Task 5.1: Update flags.ts for unified addons

**Files:**
- Modify: `apps/cli/src/flags.ts`

**Step 1: Update flags.ts**

Replace references to `modules`, `orm`, `database`, `extras` with unified `addons` approach. The `--app` flag format changes from `name:stack:module1,module2` to `name:stack:addon1,addon2`. Global addons use `--addon` flag.

```typescript
// apps/cli/src/flags.ts

// ABOUTME: CLI flags parser for non-interactive mode
// ABOUTME: Parses --app and --addon flags into TemplateContext

import { Command } from 'commander';
import color from 'picocolors';
import { META } from '@/__meta__';
import { ASCII } from '@/lib/constants';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { isAddonCompatible, getAddonsByType, areAddonDependenciesMet, type StackName } from '@/types/meta';

interface ParsedFlags {
  projectName?: string;
  app?: string[];
  addon?: string[];
  git?: boolean;
  pm?: string;
  install?: boolean;
}

export function parseFlags(): Partial<TemplateContext> {
  const program = new Command();

  const addonGroups = getAddonsByType(META);
  const ormNames = addonGroups.orm?.join(', ') ?? '';
  const dbNames = addonGroups.database?.join(', ') ?? '';
  const extraNames = addonGroups.extra?.join(', ') ?? '';

  program
    .addHelpText('before', ASCII)
    .name(color.blue('npx create-faster'))
    .usage(color.blue('<project-name> [options]'))
    .description(color.cyan('Modern CLI scaffolding tool for production-ready projects'))
    .argument('[project-name]', 'Name of the project to create')
    .optionsGroup(color.bold('Options:'))
    .helpOption('--help', 'Display help for command')
    .option('--app <name:stack:addons>', 'Add app (repeatable)', collect, [])
    .option('--addon <name>', 'Add global addon (repeatable)', collect, [])
    .option('--git', 'Initialize git repository')
    .option('--no-git', 'Skip git initialization')
    .option('--pm <manager>', 'Package manager (bun, npm, pnpm)')
    .option('--no-install', 'Skip dependency installation')
    .addHelpText(
      'after',
      `
${color.bold('Examples:')}
  ${color.gray('Single app:')}
    $ ${color.blue('npx create-faster myapp')} --app myapp:nextjs:shadcn,tanstack-query
    $ ${color.blue('npx create-faster mysaas')} --app mysaas:nextjs --addon drizzle --addon postgres --git

  ${color.gray('Multi apps (turborepo):')}
    $ ${color.blue('npx create-faster myapp')} --app web:nextjs:shadcn --app mobile:expo:nativewind
    $ ${color.blue('npx create-faster mysaas')} --app web:nextjs --app api:hono --addon drizzle --addon postgres

  ${color.gray('Available stacks:')} ${Object.keys(META.stacks).join(', ')}
  ${color.gray('Available ORMs:')} ${ormNames}
  ${color.gray('Available databases:')} ${dbNames}
  ${color.gray('Available extras:')} ${extraNames}
`
    )
    .allowUnknownOption(false)
    .showHelpAfterError(color.bold('(use --help for additional information)'));

  program.parse();

  const flags = program.opts<ParsedFlags>();
  const projectName = program.args[0];

  if (Object.keys(flags).length === 0 && !projectName) {
    return {};
  }

  const partial: Partial<TemplateContext> = {};

  if (projectName) {
    partial.projectName = projectName;
  }

  if (flags.app && flags.app.length > 0) {
    partial.apps = flags.app.map((appFlag) => parseAppFlag(appFlag));
  }

  if (flags.addon && flags.addon.length > 0) {
    partial.globalAddons = [];
    for (const addonName of flags.addon) {
      if (!META.addons[addonName]) {
        printError(`Invalid addon '${addonName}'`, `Available addons: ${Object.keys(META.addons).join(', ')}`);
        process.exit(1);
      }
      partial.globalAddons.push(addonName);
    }
  }

  if (flags.git !== undefined) {
    partial.git = flags.git;
  }

  if (flags.pm) {
    const validPms = ['bun', 'npm', 'pnpm'];
    if (!validPms.includes(flags.pm)) {
      printError(`Invalid package manager '${flags.pm}'`, `Available: ${validPms.join(', ')}`);
      process.exit(1);
    }
    partial.pm = flags.pm as 'bun' | 'npm' | 'pnpm';
  }

  if (flags.install === false) {
    partial.skipInstall = true;
  }

  validateContext(partial);

  return partial;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseAppFlag(appFlag: string): AppContext {
  const parts = appFlag.split(':');

  if (parts.length < 2 || parts.length > 3) {
    printError(
      `Invalid app format '${appFlag}'`,
      'Expected format: name:stack or name:stack:addon1,addon2',
      'Examples:',
      '  --app web:nextjs',
      '  --app web:nextjs:shadcn,mdx'
    );
    process.exit(1);
  }

  const [appName, stackName, addonsStr] = parts as [string, string, string | undefined];

  if (!META.stacks[stackName as StackName]) {
    printError(
      `Invalid stack '${stackName}' for app '${appName}'`,
      `Available stacks: ${Object.keys(META.stacks).join(', ')}`
    );
    process.exit(1);
  }

  const addons: string[] = addonsStr ? addonsStr.split(',').map((m) => m.trim()) : [];

  for (const addonName of addons) {
    const addon = META.addons[addonName];
    if (!addon) {
      printError(`Invalid addon '${addonName}'`, `Available addons: ${Object.keys(META.addons).join(', ')}`);
      process.exit(1);
    }
    if (addon.type !== 'module') {
      printError(
        `Addon '${addonName}' is not a module`,
        'Use --addon flag for orm, database, and extras',
        `Example: --addon ${addonName}`
      );
      process.exit(1);
    }
    if (!isAddonCompatible(addon, stackName as StackName)) {
      const compatibleStacks = addon.support?.stacks === 'all'
        ? 'all'
        : (addon.support?.stacks as string[])?.join(', ') ?? 'none';
      printError(
        `Addon '${addonName}' is not compatible with stack '${stackName}'`,
        `Compatible stacks: ${compatibleStacks}`
      );
      process.exit(1);
    }
  }

  return {
    appName: appName.trim(),
    stackName: stackName as StackName,
    addons,
  };
}

function validateContext(partial: Partial<TemplateContext>): void {
  const globalAddons = partial.globalAddons ?? [];

  // Check addon dependencies
  for (const addonName of globalAddons) {
    const addon = META.addons[addonName];
    if (addon && !areAddonDependenciesMet(addon, globalAddons)) {
      const required = addon.support?.addons?.join(' or ') ?? '';
      printError(
        `Addon '${addonName}' requires one of: ${required}`,
        `Add --addon ${addon.support?.addons?.[0] ?? 'postgres'}`
      );
      process.exit(1);
    }
  }

  // Husky requires git
  if (globalAddons.includes('husky') && !partial.git) {
    printError('Husky requires git', 'Add --git flag');
    process.exit(1);
  }

  // Validate app names are unique
  if (partial.apps && partial.apps.length > 1) {
    const names = partial.apps.map((app) => app.appName);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      printError('App names must be unique', `Duplicate names found: ${duplicates.join(', ')}`);
      process.exit(1);
    }
  }
}

function printError(title: string, ...messages: string[]): void {
  console.error(`\n${color.red('✖')} ${color.bold(color.red(title))}`);
  for (const msg of messages) {
    console.error(color.gray(msg));
  }
  console.error('');
}
```

**Step 2: Commit**

```bash
git add apps/cli/src/flags.ts
git commit -m "refactor(flags): update for unified addon system with --addon flag"
```

---

### Task 5.2: Update cli.ts and prompts for unified addons

**Files:**
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/prompts/stack-prompts.ts`

**Step 1: Update stack-prompts.ts**

```typescript
// apps/cli/src/prompts/stack-prompts.ts

// ABOUTME: Custom prompts for stack and addon selection
// ABOUTME: Groups addons by type for better UX

import { isCancel, SelectPrompt } from '@clack/core';
import { cancel, groupMultiselect, type Option } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { S_CONNECT_LEFT, S_GRAY_BAR, symbol } from '@/tui/symbols';
import { isAddonCompatible, getAddonsByType, type StackName } from '@/types/meta';

export async function selectStackPrompt(message: string): Promise<string> {
  const SelectStackPrompt = new SelectPrompt({
    options: Object.entries(META.stacks)
      .sort(([, a], [, b]) => {
        if (a.type === b.type) return 0;
        return a.type === 'app' ? -1 : 1;
      })
      .map(([key, meta]) => ({
        value: key,
        label: meta.label,
        hint: meta.hint,
        section: meta.type === 'app' ? 'Web / Mobile App' : 'Server / API',
      })),

    render() {
      let output = `${S_GRAY_BAR}\n${symbol(this.state)} ${message}`;
      let currentSection = '';

      this.options.forEach((option, i) => {
        if (option.section !== currentSection) {
          currentSection = option.section;
          output += `\n${S_GRAY_BAR}\n${color.gray(S_CONNECT_LEFT)} ${color.underline(color.bold(currentSection))}`;
        }

        const isSelected = i === this.cursor;
        const hint = isSelected && option.hint ? color.dim(`(${option.hint})`) : '';

        output += `\n${S_GRAY_BAR} ${symbol(isSelected ? 'active' : 'submit')} ${option.label} ${hint}`;
      });

      return output;
    },
  });

  const result = await SelectStackPrompt.prompt();

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}

export async function multiselectAddonsPrompt(
  stackName: StackName,
  message: string,
  required: boolean
): Promise<string[]> {
  const addonGroups = getAddonsByType(META);
  const moduleAddons = addonGroups.module ?? [];

  const compatibleAddons = moduleAddons.filter((addonName) => {
    const addon = META.addons[addonName];
    return addon && isAddonCompatible(addon, stackName);
  });

  if (compatibleAddons.length === 0) {
    return [];
  }

  const groupedOptions: Record<string, Option<string>[]> = {
    Modules: compatibleAddons.map((addonName) => {
      const addon = META.addons[addonName];
      return {
        value: addonName,
        label: addon.label,
        hint: addon.hint,
      };
    }),
  };

  const result = await groupMultiselect({
    options: groupedOptions,
    message,
    required,
    selectableGroups: true,
  });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}

export async function multiselectGlobalAddonsPrompt(
  type: 'orm' | 'database' | 'extra',
  message: string,
  required: boolean
): Promise<string[]> {
  const addonGroups = getAddonsByType(META);
  const addons = addonGroups[type] ?? [];

  if (addons.length === 0) {
    return [];
  }

  const groupedOptions: Record<string, Option<string>[]> = {
    [type.charAt(0).toUpperCase() + type.slice(1)]: addons.map((addonName) => {
      const addon = META.addons[addonName];
      return {
        value: addonName,
        label: addon.label,
        hint: addon.hint,
      };
    }),
  };

  const result = await groupMultiselect({
    options: groupedOptions,
    message,
    required,
    selectableGroups: false,
  });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}
```

**Step 2: Update cli.ts**

Update cli.ts to use the new context structure with `addons` instead of `modules` and `globalAddons` instead of separate orm/database/extras fields. The core flow remains the same but uses the unified addon system.

```typescript
// apps/cli/src/cli.ts

// ABOUTME: Main CLI flow with interactive prompts
// ABOUTME: Collects project config and returns TemplateContext

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, log } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { promptConfirm, promptSelect, promptText } from '@/prompts/base-prompts';
import { multiselectAddonsPrompt, multiselectGlobalAddonsPrompt, selectStackPrompt } from '@/prompts/stack-prompts';
import { Progress } from '@/tui/progress';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { areAddonDependenciesMet, type StackName } from '@/types/meta';
import { S_GRAY_BAR } from './tui/symbols';

export async function cli(partial?: Partial<TemplateContext>): Promise<Omit<TemplateContext, 'repo'>> {
  const progress = new Progress(['Project', 'Apps', 'Database', 'Extras', 'Install']);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    globalAddons: [],
    git: false,
  };

  // Project name
  if (partial?.projectName) {
    ctx.projectName = partial.projectName;
    log.info(`${color.green('✓')} Using project name: ${color.bold(partial.projectName)}`);
    const fullPath = join(process.cwd(), partial.projectName);
    if (existsSync(fullPath)) {
      cancel(`Directory "${partial.projectName}" already exists.`);
      process.exit(1);
    }
  } else {
    ctx.projectName = await promptText<string>(progress.message('Name of your project?'), {
      placeholder: 'my-app',
      initialValue: 'my-app',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'Project name is required';
        const fullPath = join(process.cwd(), trimmed);
        if (existsSync(fullPath)) {
          return `Directory "${trimmed}" already exists.`;
        }
      },
    });
  }
  progress.next();

  // Apps
  if (partial?.apps && partial.apps.length > 0) {
    ctx.apps = partial.apps;
    log.info(`${color.green('✓')} Using ${partial.apps.length} app(s): ${partial.apps.map((a) => a.appName).join(', ')}`);
  } else {
    const appCount = await promptText<number>(
      `${progress.message('How many apps?')}
${S_GRAY_BAR}  ${color.italic(color.gray('Multiple apps = Turborepo monorepo'))}`,
      {
        initialValue: '1',
        placeholder: 'Enter a number',
        validate: (value) => {
          const num = Number(value);
          if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
        },
      }
    );

    ctx.apps = await promptAllApps(Number(appCount), ctx.projectName, progress);
  }
  progress.next();

  // Global addons: Database
  if (partial?.globalAddons !== undefined) {
    ctx.globalAddons = partial.globalAddons;
    if (partial.globalAddons.length > 0) {
      log.info(`${color.green('✓')} Using addons: ${partial.globalAddons.join(', ')}`);
    }
  } else {
    const database = await multiselectGlobalAddonsPrompt(
      'database',
      progress.message(`Include a ${color.bold('database')}?`),
      false
    );
    ctx.globalAddons.push(...database);

    // ORM (only if database selected)
    if (database.length > 0) {
      const orm = await multiselectGlobalAddonsPrompt(
        'orm',
        progress.message(`Configure an ${color.bold('ORM')}?`),
        false
      );

      // Validate ORM dependencies
      for (const ormName of orm) {
        const ormAddon = META.addons[ormName];
        if (ormAddon && !areAddonDependenciesMet(ormAddon, ctx.globalAddons)) {
          log.warn(`${ormName} requires a database. Skipping.`);
          continue;
        }
        ctx.globalAddons.push(ormName);
      }
    }
  }
  progress.next();

  // Git
  if (partial?.git !== undefined) {
    ctx.git = partial.git;
    if (partial.git) {
      log.info(`${color.green('✓')} Git initialization enabled`);
    }
  } else {
    ctx.git = await promptConfirm(progress.message(`Initialize ${color.bold('Git')}?`), {
      initialValue: true,
    });
  }

  // Extras
  if (partial?.globalAddons === undefined) {
    const extras = await multiselectGlobalAddonsPrompt(
      'extra',
      progress.message(`Add any ${color.bold('extras')}?`),
      false
    );

    // Validate husky requires git
    for (const extra of extras) {
      if (extra === 'husky' && !ctx.git) {
        log.warn('Husky requires git. Skipping.');
        continue;
      }
      ctx.globalAddons.push(extra);
    }
  }
  progress.next();

  // Package manager
  if (partial?.skipInstall) {
    ctx.skipInstall = true;
    log.info(`${color.green('✓')} Skipping dependency installation`);
  } else if (partial?.pm !== undefined) {
    ctx.pm = partial.pm;
    log.info(`${color.green('✓')} Using package manager: ${color.bold(partial.pm)}`);
  } else {
    ctx.pm = await promptSelect(undefined, progress.message(`Install dependencies ${color.bold('now')}?`), ctx, {
      options: [
        { label: 'Install with bun', value: 'bun' },
        { label: 'Install with pnpm', value: 'pnpm' },
        { label: 'Install with npm', value: 'npm' },
        { label: 'Skip installation', value: undefined },
      ],
    });
  }
  progress.next();

  return ctx;
}

async function promptAllApps(count: number, projectName: string, progress: Progress): Promise<AppContext[]> {
  if (count <= 1) {
    const app = await promptApp(1, progress, projectName);
    return [app];
  }

  const apps: AppContext[] = [];
  for (let i = 0; i < count; i++) {
    const app = await promptApp(i + 1, progress, undefined);
    apps.push(app);
  }
  return apps;
}

async function promptApp(index: number, progress: Progress, projectNameIfOneApp?: string): Promise<AppContext> {
  let appName = '';

  if (projectNameIfOneApp) {
    appName = projectNameIfOneApp;
  } else {
    appName = await promptText<string>(progress.message(`Name of app ${color.bold(`#${index}`)}?`), {
      defaultValue: `app-${index}`,
      placeholder: `app-${index}`,
      validate: (value) => {
        if (!value.trim()) return 'App name is required';
      },
    });
  }

  const stackName = (await selectStackPrompt(
    progress.message(`Stack for ${color.bold(appName)}`)
  )) as StackName;

  const metaStack = META.stacks[stackName];
  if (!metaStack) {
    cancel(`Stack "${stackName}" not found`);
    process.exit(0);
  }

  const addons = await multiselectAddonsPrompt(
    stackName,
    progress.message(`Add ${color.bold(metaStack.label)} modules to ${color.bold(appName)}?`),
    false
  );

  return { appName, stackName, addons };
}
```

**Step 3: Commit**

```bash
git add apps/cli/src/cli.ts apps/cli/src/prompts/stack-prompts.ts
git commit -m "refactor(cli): update prompts for unified addon system"
```

---

## Phase 6: Template Migration

### Task 6.1: Restructure templates directory

**Files:**
- Move: `templates/modules/{stack}/{addon}/` → `templates/addons/{addon}/`
- Move: `templates/orm/{orm}/` → `templates/addons/{orm}/`
- Move: `templates/database/{db}/` → `templates/addons/{db}/`
- Move: `templates/extras/{extra}/` → `templates/addons/{extra}/`

**Step 1: Create migration script**

```bash
#!/bin/bash
# Run from apps/cli/

# Create addons directory
mkdir -p templates/addons

# Migrate modules (flatten from stack subdirs)
for stack in templates/modules/*/; do
  for addon in "$stack"*/; do
    addonName=$(basename "$addon")
    if [ ! -d "templates/addons/$addonName" ]; then
      cp -r "$addon" "templates/addons/$addonName"
    fi
  done
done

# Migrate ORM
for orm in templates/orm/*/; do
  ormName=$(basename "$orm")
  cp -r "$orm" "templates/addons/$ormName"
done

# Migrate database
for db in templates/database/*/; do
  dbName=$(basename "$db")
  cp -r "$db" "templates/addons/$dbName"
done

# Migrate extras
for extra in templates/extras/*/; do
  extraName=$(basename "$extra")
  cp -r "$extra" "templates/addons/$extraName"
done

echo "Migration complete. Review templates/addons/ before deleting old directories."
```

**Step 2: Run migration**

Run: `cd apps/cli && bash migrate-templates.sh`

**Step 3: Update magic comments in migrated templates**

For each addon template that needs conditional rendering or destination override:

- `drizzle/tsconfig.json.hbs`: Add `{{!-- @only:turborepo --}}`
- `drizzle/__env.example.hbs`: Add `{{!-- @dest:root --}}`
- `drizzle/scripts/seed.ts.hbs`: Add `{{!-- @dest:root --}}`
- `drizzle/drizzle.config.ts.hbs`: Add `{{!-- @dest:root --}}`
- `shadcn/components.json.hbs`: Add `{{!-- @dest:app --}}`

**Step 4: Remove src/ prefix from ORM templates**

Rename files in `templates/addons/drizzle/`:
- `src/index.ts.hbs` → `index.ts.hbs`
- `src/schema.ts.hbs` → `schema.ts.hbs`
- `src/types.ts.hbs` → `types.ts.hbs`

Same for `templates/addons/prisma/`.

**Step 5: Delete old directories**

```bash
rm -rf templates/modules templates/orm templates/database templates/extras
```

**Step 6: Commit**

```bash
git add templates/
git commit -m "refactor(templates): migrate to unified addons structure"
```

---

## Phase 7: Integration Tests

### Task 7.1: Update CLI integration tests

**Files:**
- Modify: `apps/cli/tests/cli-integration.test.ts`

**Step 1: Update integration tests**

```typescript
// apps/cli/tests/cli-integration.test.ts

// ABOUTME: End-to-end tests for CLI project generation
// ABOUTME: Tests both single repo and turborepo with unified addons

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'create-faster-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

describe('CLI Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo generation', () => {
    test('generates basic Next.js project', async () => {
      const projectName = 'test-nextjs-single';
      const projectPath = join(tempDir, projectName);

      await $`bun run src/index.ts ${projectName} --app ${projectName}:nextjs --no-install`.cwd(
        join(import.meta.dir, '..')
      );

      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/app/page.tsx'))).toBe(true);

      const pkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(pkg.name).toBe(projectName);
      expect(pkg.dependencies.next).toBeDefined();
    });

    test('generates Next.js with shadcn addon', async () => {
      const projectName = 'test-nextjs-shadcn';
      const projectPath = join(tempDir, projectName);

      await $`bun run src/index.ts ${projectName} --app ${projectName}:nextjs:shadcn --no-install`.cwd(
        join(import.meta.dir, '..')
      );

      const pkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['radix-ui']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/components/ui/button.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'components.json'))).toBe(true);
    });

    test('generates Next.js with drizzle addon', async () => {
      const projectName = 'test-nextjs-drizzle';
      const projectPath = join(tempDir, projectName);

      await $`bun run src/index.ts ${projectName} --app ${projectName}:nextjs --addon postgres --addon drizzle --no-install`.cwd(
        join(import.meta.dir, '..')
      );

      const pkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['drizzle-orm']).toBeDefined();
      expect(pkg.dependencies.pg).toBeDefined();
      expect(pkg.scripts['db:generate']).toBeDefined();

      // ORM files in correct location
      expect(await fileExists(join(projectPath, 'src/lib/db/schema.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'drizzle.config.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'scripts/seed.ts'))).toBe(true);
    });
  });

  describe('Turborepo generation', () => {
    test('generates multi-app turborepo', async () => {
      const projectName = 'test-turborepo';
      const projectPath = join(tempDir, projectName);

      await $`bun run src/index.ts ${projectName} --app web:nextjs --app api:hono --no-install`.cwd(
        join(import.meta.dir, '..')
      );

      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'turbo.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/api/package.json'))).toBe(true);

      const rootPkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(rootPkg.workspaces).toContain('apps/*');
    });

    test('generates turborepo with extracted packages', async () => {
      const projectName = 'test-turborepo-packages';
      const projectPath = join(tempDir, projectName);

      await $`bun run src/index.ts ${projectName} --app web:nextjs:shadcn --app mobile:expo --addon postgres --addon drizzle --no-install`.cwd(
        join(import.meta.dir, '..')
      );

      // Packages extracted
      expect(await fileExists(join(projectPath, 'packages/ui/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/db/package.json'))).toBe(true);

      // Web app references packages
      const webPkg = await readJsonFile<any>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.dependencies['@repo/ui']).toBe('*');
      expect(webPkg.dependencies['@repo/db']).toBe('*');

      // UI package has shadcn deps
      const uiPkg = await readJsonFile<any>(join(projectPath, 'packages/ui/package.json'));
      expect(uiPkg.dependencies['radix-ui']).toBeDefined();

      // DB package has drizzle deps
      const dbPkg = await readJsonFile<any>(join(projectPath, 'packages/db/package.json'));
      expect(dbPkg.dependencies['drizzle-orm']).toBeDefined();
      expect(dbPkg.dependencies.pg).toBeDefined();
    });
  });
});
```

**Step 2: Run integration tests**

Run: `cd apps/cli && bun test tests/cli-integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/cli/tests/cli-integration.test.ts
git commit -m "test: update integration tests for unified addon system"
```

---

### Task 7.2: Clean up old test files

**Files:**
- Delete: `apps/cli/tests/meta-types.test.ts` (replaced by addon-types.test.ts)
- Delete: `apps/cli/tests/meta-validation.test.ts` (replaced by meta-addons.test.ts)

**Step 1: Remove old tests**

```bash
rm apps/cli/tests/meta-types.test.ts apps/cli/tests/meta-validation.test.ts
```

**Step 2: Run all tests**

Run: `cd apps/cli && bun test`
Expected: All tests PASS

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: clean up old tests after addon unification"
```

---

## Summary

This plan refactors the template system from fragmented categories (modules, orm, database, extras) into a unified `addons` system:

1. **Types**: Single `MetaAddon` interface with discriminated `AddonDestination`
2. **Magic Comments**: `@only:turborepo|single` for skip, `@dest:app|package|root` for destination
3. **Templates**: Flattened to `templates/addons/{name}/` with final structure (no `src/` prefix)
4. **Resolution**: Single `resolveAddonDestination()` function for all addon types
5. **CLI**: `--addon` flag for global addons, type determines per-app vs global selection

Total changes: ~15 files modified, ~5 files created, ~20 files deleted (templates restructured)
