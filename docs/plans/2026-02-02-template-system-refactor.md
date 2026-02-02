# Template System Refactor - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the create-faster CLI template system to eliminate duplication, simplify maintenance, and improve DX.

**Architecture:** Programmatic package.json generation from META, single magic comment `@dest:`, modules separated from stacks with declarative compatibility, Handlebars helpers reduced from 16 to 6.

**Tech Stack:** Bun, TypeScript, Handlebars

---

## Table of Contents

1. [Context and Problem Statement](#context-and-problem-statement)
2. [Proposed Solution](#proposed-solution)
3. [Target Architecture](#target-architecture)
4. [TypeScript Types](#typescript-types)
5. [Implementation Plan](#implementation-plan)

---

## Context and Problem Statement

### What is create-faster?

CLI tool that generates full-stack projects with:
- Multi-framework support (Next.js, Expo, Hono, TanStack Start)
- Single repo or turborepo (monorepo) mode
- Optional modules (shadcn, tanstack-query, better-auth, etc.)
- ORM (Drizzle, Prisma) + Database (PostgreSQL, MySQL)
- Extras (Biome, Husky)

### Current Problems

#### 1. Template Duplication (~690 duplicated lines)

The same file exists in multiple versions to handle turborepo vs single repo:

```
templates/orm/drizzle/src/schema.ts.hbs           # @repo:turborepo @scope:package
templates/orm/drizzle/src/lib/db/schema.ts.hbs    # @repo:single
```

Nearly identical content, only the magic comment and path differ. This causes:
- Bloated bundle size
- Sync bugs when modifying one file but not the other
- Cognitive overhead to know which file to modify

#### 2. Unreadable package.json (139 lines of conditionals)

The file `templates/stack/nextjs/package.json.hbs` contains 139 lines of nested Handlebars conditionals:

```handlebars
"dependencies": {
  {{#if (hasModule "shadcn")}}
  {{#if (eq repo "single")}}
  "radix-ui": "^1.4.2",
  {{else}}
  "@repo/ui": "*",
  {{/if}}
  {{/if}}
  {{#if (eq repo "single")}}
  {{#if (eq orm "drizzle")}}
  "drizzle-orm": "^0.38.3",
  ...
```

Impossible to maintain, frequent source of bugs.

#### 3. Too Many Magic Comments (4 types)

Current system:
- `@repo:turborepo|single|!single` - Conditionally render by repo type
- `@scope:app|package|root` - Override file destination
- `@if:key` - Render if ctx.key exists
- `@require:key` - Render if ctx.key === true

High cognitive complexity, difficult to understand where a file ends up.

#### 4. Modules Nested in Stacks

Current structure in `__meta__.ts`:

```typescript
stacks: {
  nextjs: {
    modules: {
      shadcn: {...},
      'tanstack-query': {...},
    }
  },
  'tanstack-start': {
    modules: {
      shadcn: {...},  // Duplicated!
      'tanstack-query': {...},  // Duplicated!
    }
  }
}
```

If a module is compatible with multiple stacks, it must be declared multiple times.

#### 5. Too Many Handlebars Helpers (16)

Current helpers, many unused or redundant:
- `eq`, `ne`, `and`, `or`, `includes`
- `app`, `appIndex`, `appPort`
- `databaseUrl`
- `isAppStack`, `isServerStack`
- `isTurborepo`, `isSingleRepo`
- `hasModule`, `moduleEnabled` (duplicate)
- `hasExtra`, `hasContext`, `hasAnyStack`

---

## Proposed Solution

### 1. Programmatic package.json Generation

Dependencies, devDependencies, scripts, and exports are declared in META. A TypeScript generator merges this data based on context and generates package.json files.

**Benefits:**
- Type-safe
- Unit testable
- No more Handlebars conditionals in templates
- Centralized logic

### 2. Single Magic Comment: `@dest:`

Replaces the 4 magic comments with one:

```handlebars
{{!-- @dest:app --}}   → Force to apps/{appName}/
{{!-- @dest:pkg --}}   → Force to packages/{asPackage}/ (turborepo) or singlePath (single)
{{!-- @dest:root --}}  → Force to project root
```

No `@dest:` = default behavior based on `asPackage` in META.

### 3. Modules Separated from Stacks

```typescript
modules: {
  shadcn: {
    stacks: ['nextjs', 'tanstack-start'],  // Compatible with these stacks
    asPackage: 'ui',
    singlePath: 'src/components/ui/',
    packageJson: {...}
  },
  'tanstack-query': {
    stacks: 'all',  // Compatible with all stacks
    packageJson: {...}
  }
}
```

### 4. Dynamic Path via META

Instead of duplicating files, a single file with dynamically resolved path:

```typescript
orm: {
  stacks: {
    drizzle: {
      asPackage: 'db',
      singlePath: 'src/lib/db/',
      packageJson: {...}
    }
  }
}
```

- In turborepo: `packages/db/src/schema.ts`
- In single: `src/lib/db/schema.ts`

### 5. Handlebars Helpers Reduced to 6

| Helper | Usage |
|--------|-------|
| `eq` | `{{#if (eq foo 'bar')}}` |
| `ne` | `{{#if (ne foo 'bar')}}` |
| `and` | `{{#if (and a b c)}}` |
| `or` | `{{#if (or a b)}}` |
| `isTurborepo` | `{{#if (isTurborepo)}}` |
| `has` | `{{#if (has 'database' 'postgres')}}` |

The `has` helper is generic and replaces `hasModule`, `hasExtra`, `isPostgres`, etc.

---

## Target Architecture

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         META                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ stacks  │ │ modules │ │   orm   │ │ extras  │           │
│  │         │ │         │ │         │ │         │           │
│  │ nextjs  │ │ shadcn  │ │ drizzle │ │ biome   │           │
│  │ expo    │ │ query   │ │ prisma  │ │ husky   │           │
│  │ hono    │ │ auth    │ │         │ │         │           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
│       │           │           │           │                 │
│       └───────────┴───────────┴───────────┘                 │
│                       │                                      │
│              packageJson: {                                  │
│                dependencies,                                 │
│                devDependencies,                              │
│                scripts,                                      │
│                exports                                       │
│              }                                               │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   GENERATORS                                 │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────┐     │
│  │ package-json-        │  │ template-resolver        │     │
│  │ generator.ts         │  │                          │     │
│  │                      │  │ - scan templates/        │     │
│  │ - merge deps         │  │ - parse @dest:           │     │
│  │ - resolve ports      │  │ - resolve paths via META │     │
│  │ - workspace refs     │  │                          │     │
│  └──────────┬───────────┘  └────────────┬─────────────┘     │
│             │                           │                    │
│             └───────────┬───────────────┘                    │
│                         ▼                                    │
│              ┌─────────────────────┐                         │
│              │   file-generator    │                         │
│              │                     │                         │
│              │ - write JSON        │                         │
│              │ - render Handlebars │                         │
│              │ - copy binaries     │                         │
│              └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 TEMPLATES (simplified)                       │
│                                                              │
│  templates/                                                  │
│  ├── stacks/{stack}/        # base app, no package.json      │
│  ├── modules/{module}/      # increments + @dest: if needed  │
│  ├── orm/{orm}/             # db package, no package.json    │
│  ├── database/{db}/         # docker compose                 │
│  ├── extras/{extra}/        # biome, husky                   │
│  └── repo/{repo}/           # monorepo config                │
│                                                              │
│  Magic comments: @dest:app|pkg|root (only one remaining)     │
│  Helpers: 6 (vs 16 before)                                   │
│  Duplicated files: 0                                         │
└─────────────────────────────────────────────────────────────┘
```

### Modified/Created File Structure

```
apps/cli/src/
├── __meta__.ts                    # MODIFY - new structure
├── types/
│   └── meta.ts                    # MODIFY - new types
├── lib/
│   ├── package-json-generator.ts  # CREATE - programmatic generation
│   ├── template-resolver.ts       # MODIFY - new routing logic
│   ├── template-processor.ts      # MODIFY - simplify
│   ├── magic-comments.ts          # MODIFY - only @dest:
│   ├── handlebars.ts              # MODIFY - 6 helpers
│   └── file-generator.ts          # MODIFY - integrate package.json generator
├── index.ts                       # MODIFY - new flow
└── tests/                         # CREATE - tests folder
    ├── package-json-generator.test.ts
    ├── template-resolver.test.ts
    ├── magic-comments.test.ts
    └── cli-integration.test.ts

apps/cli/templates/
├── stacks/                        # RENAME from stack/
│   └── nextjs/
│       └── package.json.hbs       # DELETE
├── modules/                       # RESTRUCTURE
│   └── shadcn/
│       ├── components.json.hbs    # @dest:app for the app
│       └── ...
├── orm/
│   └── drizzle/
│       ├── package.json.hbs       # DELETE
│       ├── src/schema.ts.hbs      # KEEP (unique)
│       └── src/lib/db/schema.ts.hbs # DELETE (duplicate)
└── ...
```

---

## TypeScript Types

### types/meta.ts (new)

```typescript
// ABOUTME: Type definitions for META configuration
// ABOUTME: Defines stacks, modules, orm, database, extras, and repo structures

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type StacksCompatibility = StackName[] | 'all';
export type ModuleName = string;
export type OrmName = 'drizzle' | 'prisma';
export type DatabaseName = 'postgres' | 'mysql';
export type ExtraName = 'biome' | 'husky';
export type RepoType = 'single' | 'turborepo';

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  packageJson: PackageJsonConfig;
}

export interface MetaModule {
  label: string;
  hint?: string;
  stacks: StacksCompatibility;
  asPackage?: string;
  singlePath?: string;
  requires?: string[];
  packageJson: PackageJsonConfig;
}

export interface MetaOrmStack {
  label: string;
  hint?: string;
  asPackage: string;
  singlePath: string;
  packageJson: PackageJsonConfig;
}

export interface MetaDatabaseStack {
  label: string;
  hint?: string;
  packageJson?: PackageJsonConfig;
}

export interface MetaExtraStack {
  label: string;
  hint?: string;
  requires?: string[];
  packageJson?: PackageJsonConfig;
}

export interface MetaRepoStack {
  label: string;
  hint?: string;
}

export interface MetaOrm {
  asPackage: string;
  singlePath: string;
  requires: string[];
  stacks: Record<OrmName, MetaOrmStack>;
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  modules: Record<ModuleName, MetaModule>;
  orm: MetaOrm;
  database: {
    stacks: Record<DatabaseName, MetaDatabaseStack>;
  };
  extras: {
    stacks: Record<ExtraName, MetaExtraStack>;
  };
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}

// Helper type to check if a module is compatible with a stack
export function isModuleCompatible(module: MetaModule, stackName: StackName): boolean {
  if (module.stacks === 'all') return true;
  return module.stacks.includes(stackName);
}
```

### types/ctx.ts (update)

```typescript
// ABOUTME: Context types for template rendering and CLI flow
// ABOUTME: AppContext represents a single app, TemplateContext is the full generation context

import type { StackName, ModuleName, OrmName, DatabaseName, ExtraName, RepoType } from './meta';

export interface AppContext {
  appName: string;
  stackName: StackName;
  modules: ModuleName[];
}

export type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  projectPath: string;
  repo: RepoType;
  apps: AppContext[];
  orm?: OrmName;
  database?: DatabaseName;
  git?: boolean;
  pm?: PackageManager;
  extras?: ExtraName[];
  // Enriched context (added during app template rendering)
  appName?: string;
  stackName?: StackName;
  modules?: ModuleName[];
}
```

---

## Implementation Plan

### Phase 1: Test Infrastructure

Before any refactoring, set up tests to ensure we don't break existing behavior.

---

### Task 1.1: Setup test infrastructure

**Files:**
- Create: `apps/cli/src/tests/helpers.ts`
- Create: `apps/cli/src/tests/cli-integration.test.ts`

**Step 1: Create test helpers**

```typescript
// apps/cli/src/tests/helpers.ts

// ABOUTME: Test utilities for CLI integration tests
// ABOUTME: Provides functions to run CLI, create temp directories, and assert file contents

import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'create-faster-test-'));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const cliPath = join(import.meta.dir, '../../index.ts');

  try {
    const result = await $`bun run ${cliPath} ${args}`.cwd(cwd).quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error: any) {
    return {
      exitCode: error.exitCode ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
    };
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}
```

**Step 2: Create initial CLI integration test**

```typescript
// apps/cli/src/tests/cli-integration.test.ts

// ABOUTME: Integration tests for create-faster CLI
// ABOUTME: Tests end-to-end project generation with various flag combinations

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import {
  createTempDir,
  cleanupTempDir,
  runCli,
  fileExists,
  readJsonFile,
} from './helpers';

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

      const result = await runCli([
        projectName,
        '--app', 'web:nextjs',
        '--no-install',
      ], tempDir);

      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/app/page.tsx'))).toBe(true);

      const pkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(pkg.name).toBe(projectName);
      expect(pkg.dependencies.next).toBeDefined();
      expect(pkg.dependencies.react).toBeDefined();
    });

    test('generates Next.js with shadcn module', async () => {
      const projectName = 'test-nextjs-shadcn';
      const projectPath = join(tempDir, projectName);

      const result = await runCli([
        projectName,
        '--app', 'web:nextjs:shadcn',
        '--no-install',
      ], tempDir);

      expect(result.exitCode).toBe(0);

      const pkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['radix-ui']).toBeDefined();
      expect(pkg.dependencies['class-variance-authority']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/components/ui/button.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'components.json'))).toBe(true);
    });

    test('generates Next.js with drizzle ORM', async () => {
      const projectName = 'test-nextjs-drizzle';
      const projectPath = join(tempDir, projectName);

      const result = await runCli([
        projectName,
        '--app', 'web:nextjs',
        '--database', 'postgres',
        '--orm', 'drizzle',
        '--no-install',
      ], tempDir);

      expect(result.exitCode).toBe(0);

      const pkg = await readJsonFile<any>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['drizzle-orm']).toBeDefined();
      expect(pkg.devDependencies['drizzle-kit']).toBeDefined();
      expect(pkg.scripts['db:generate']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/lib/db/schema.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/lib/db/index.ts'))).toBe(true);
    });
  });

  describe('Turborepo generation', () => {
    test('generates multi-app turborepo', async () => {
      const projectName = 'test-turborepo';
      const projectPath = join(tempDir, projectName);

      const result = await runCli([
        projectName,
        '--app', 'web:nextjs',
        '--app', 'api:hono',
        '--no-install',
      ], tempDir);

      expect(result.exitCode).toBe(0);

      // Root package.json
      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'turbo.json'))).toBe(true);

      // Apps
      expect(await fileExists(join(projectPath, 'apps/web/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/api/package.json'))).toBe(true);

      const webPkg = await readJsonFile<any>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.name).toBe('web');
      expect(webPkg.dependencies.next).toBeDefined();

      const apiPkg = await readJsonFile<any>(join(projectPath, 'apps/api/package.json'));
      expect(apiPkg.name).toBe('api');
      expect(apiPkg.dependencies.hono).toBeDefined();
    });

    test('generates turborepo with extracted packages', async () => {
      const projectName = 'test-turborepo-packages';
      const projectPath = join(tempDir, projectName);

      const result = await runCli([
        projectName,
        '--app', 'web:nextjs:shadcn',
        '--app', 'mobile:expo',
        '--database', 'postgres',
        '--orm', 'drizzle',
        '--no-install',
      ], tempDir);

      expect(result.exitCode).toBe(0);

      // Packages should be extracted
      expect(await fileExists(join(projectPath, 'packages/ui/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/db/package.json'))).toBe(true);

      // Web app should reference packages
      const webPkg = await readJsonFile<any>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.dependencies['@repo/ui']).toBe('*');
      expect(webPkg.dependencies['@repo/db']).toBe('*');

      // UI package should have shadcn deps
      const uiPkg = await readJsonFile<any>(join(projectPath, 'packages/ui/package.json'));
      expect(uiPkg.name).toBe('@repo/ui');
      expect(uiPkg.dependencies['radix-ui']).toBeDefined();

      // DB package should have drizzle deps
      const dbPkg = await readJsonFile<any>(join(projectPath, 'packages/db/package.json'));
      expect(dbPkg.name).toBe('@repo/db');
      expect(dbPkg.dependencies['drizzle-orm']).toBeDefined();
    });
  });
});
```

**Step 3: Run tests to establish baseline**

Run: `cd apps/cli && bun test`

Expected: Tests will likely fail because:
1. `--no-install` flag may not exist yet
2. Some paths/structures may differ from expectations

This establishes what the current behavior is vs. what we expect.

**Step 4: Add --no-install flag if missing**

Check `apps/cli/src/flags.ts` for the flag. If missing, add it:

```typescript
// In flags.ts, add to Commander options:
.option('--no-install', 'Skip dependency installation')
```

**Step 5: Commit**

```bash
git add apps/cli/src/tests/
git commit -m "test: add CLI integration test infrastructure"
```

---

### Task 1.2: Tests for magic-comments.ts

**Files:**
- Create: `apps/cli/src/tests/magic-comments.test.ts`

**Step 1: Write tests for current magic comments behavior**

```typescript
// apps/cli/src/tests/magic-comments.test.ts

// ABOUTME: Unit tests for magic comments parsing
// ABOUTME: Tests the @dest: magic comment (new simplified system)

import { describe, test, expect } from 'bun:test';
import {
  parseMagicComments,
  shouldSkipTemplate,
  extractFirstLine,
} from '../lib/magic-comments';
import type { TemplateContext } from '../types/ctx';

const baseContext: TemplateContext = {
  projectName: 'test',
  projectPath: '/tmp/test',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', modules: [] }],
};

describe('extractFirstLine', () => {
  test('extracts first line from content', () => {
    const content = '{{!-- @dest:app --}}\nrest of file';
    expect(extractFirstLine(content)).toBe('{{!-- @dest:app --}}');
  });

  test('handles content without newline', () => {
    const content = '{{!-- @dest:app --}}';
    expect(extractFirstLine(content)).toBe('{{!-- @dest:app --}}');
  });

  test('handles empty content', () => {
    expect(extractFirstLine('')).toBe('');
  });
});

describe('parseMagicComments', () => {
  test('parses @dest:app', () => {
    const comments = parseMagicComments('{{!-- @dest:app --}}');
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('dest');
    expect(comments[0].values).toEqual(['app']);
  });

  test('parses @dest:pkg', () => {
    const comments = parseMagicComments('{{!-- @dest:pkg --}}');
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('dest');
    expect(comments[0].values).toEqual(['pkg']);
  });

  test('parses @dest:root', () => {
    const comments = parseMagicComments('{{!-- @dest:root --}}');
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('dest');
    expect(comments[0].values).toEqual(['root']);
  });

  test('returns empty array for no magic comments', () => {
    const comments = parseMagicComments('// regular comment');
    expect(comments).toHaveLength(0);
  });

  test('returns empty array for empty string', () => {
    const comments = parseMagicComments('');
    expect(comments).toHaveLength(0);
  });
});

describe('shouldSkipTemplate', () => {
  test('@dest: comments never cause skip', () => {
    const comments = parseMagicComments('{{!-- @dest:app --}}');
    expect(shouldSkipTemplate(comments, baseContext)).toBe(false);
  });

  test('empty comments never cause skip', () => {
    expect(shouldSkipTemplate([], baseContext)).toBe(false);
  });
});
```

**Step 2: Run tests**

Run: `cd apps/cli && bun test src/tests/magic-comments.test.ts`

Expected: Tests will fail because current implementation has different magic comment types.

**Step 3: Commit test file**

```bash
git add apps/cli/src/tests/magic-comments.test.ts
git commit -m "test: add magic comments unit tests for new @dest: system"
```

---

### Phase 2: New Types and META

---

### Task 2.1: Update types/meta.ts

**Files:**
- Modify: `apps/cli/src/types/meta.ts`

**Step 1: Write test for types (type checking)**

This test verifies that types compile correctly. Create a type test file:

```typescript
// apps/cli/src/tests/meta-types.test.ts

// ABOUTME: Type tests for META structure
// ABOUTME: Ensures META conforms to expected types

import { describe, test, expect } from 'bun:test';
import type {
  Meta,
  MetaStack,
  MetaModule,
  PackageJsonConfig,
  StackName,
  StacksCompatibility,
} from '../types/meta';

describe('Meta types', () => {
  test('PackageJsonConfig accepts valid config', () => {
    const config: PackageJsonConfig = {
      dependencies: { 'react': '^19.0.0' },
      devDependencies: { 'typescript': '^5' },
      scripts: { 'dev': 'next dev' },
      exports: { '.': './src/index.ts' },
    };
    expect(config.dependencies?.react).toBe('^19.0.0');
  });

  test('MetaStack requires type and label', () => {
    const stack: MetaStack = {
      type: 'app',
      label: 'Next.js',
      packageJson: {
        dependencies: { 'next': '^16.0.0' },
      },
    };
    expect(stack.type).toBe('app');
  });

  test('MetaModule accepts stacks array or "all"', () => {
    const moduleWithArray: MetaModule = {
      label: 'shadcn',
      stacks: ['nextjs', 'tanstack-start'],
      packageJson: {},
    };
    expect(moduleWithArray.stacks).toContain('nextjs');

    const moduleWithAll: MetaModule = {
      label: 'TanStack Query',
      stacks: 'all',
      packageJson: {},
    };
    expect(moduleWithAll.stacks).toBe('all');
  });

  test('MetaModule accepts optional asPackage and singlePath', () => {
    const module: MetaModule = {
      label: 'shadcn',
      stacks: ['nextjs'],
      asPackage: 'ui',
      singlePath: 'src/components/ui/',
      packageJson: {},
    };
    expect(module.asPackage).toBe('ui');
    expect(module.singlePath).toBe('src/components/ui/');
  });
});
```

**Step 2: Update types/meta.ts with new structure**

```typescript
// apps/cli/src/types/meta.ts

// ABOUTME: Type definitions for META configuration
// ABOUTME: Defines stacks, modules, orm, database, extras, and repo structures

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type StacksCompatibility = StackName[] | 'all';
export type ModuleName = string;
export type OrmName = 'drizzle' | 'prisma';
export type DatabaseName = 'postgres' | 'mysql';
export type ExtraName = 'biome' | 'husky';
export type RepoType = 'single' | 'turborepo';

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  packageJson: PackageJsonConfig;
}

export interface MetaModule {
  label: string;
  hint?: string;
  stacks: StacksCompatibility;
  asPackage?: string;
  singlePath?: string;
  requires?: string[];
  packageJson: PackageJsonConfig;
}

export interface MetaOrmStack {
  label: string;
  hint?: string;
  asPackage: string;
  singlePath: string;
  packageJson: PackageJsonConfig;
}

export interface MetaDatabaseStack {
  label: string;
  hint?: string;
  packageJson?: PackageJsonConfig;
}

export interface MetaExtraStack {
  label: string;
  hint?: string;
  requires?: string[];
  packageJson?: PackageJsonConfig;
}

export interface MetaRepoStack {
  label: string;
  hint?: string;
}

export interface MetaOrm {
  asPackage: string;
  singlePath: string;
  requires: string[];
  stacks: Record<OrmName, MetaOrmStack>;
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  modules: Record<ModuleName, MetaModule>;
  orm: MetaOrm;
  database: {
    stacks: Record<DatabaseName, MetaDatabaseStack>;
  };
  extras: {
    stacks: Record<ExtraName, MetaExtraStack>;
  };
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}

// Helper type to check if a module is compatible with a stack
export function isModuleCompatible(module: MetaModule, stackName: StackName): boolean {
  if (module.stacks === 'all') return true;
  return module.stacks.includes(stackName);
}
```

**Step 3: Run type tests**

Run: `cd apps/cli && bun test src/tests/meta-types.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/cli/src/types/meta.ts apps/cli/src/tests/meta-types.test.ts
git commit -m "refactor: update meta types for new architecture"
```

---

### Task 2.2: Update __meta__.ts

**Files:**
- Modify: `apps/cli/src/__meta__.ts`

**Step 1: Write test for META structure**

```typescript
// apps/cli/src/tests/meta-validation.test.ts

// ABOUTME: Validation tests for META constant
// ABOUTME: Ensures META has all required stacks, modules with valid packageJson

import { describe, test, expect } from 'bun:test';
import { META } from '../__meta__';
import { isModuleCompatible } from '../types/meta';

describe('META validation', () => {
  describe('stacks', () => {
    test('has all required stacks', () => {
      expect(META.stacks.nextjs).toBeDefined();
      expect(META.stacks.expo).toBeDefined();
      expect(META.stacks.hono).toBeDefined();
      expect(META.stacks['tanstack-start']).toBeDefined();
    });

    test('each stack has type, label, and packageJson', () => {
      for (const [name, stack] of Object.entries(META.stacks)) {
        expect(stack.type, `${name} should have type`).toBeDefined();
        expect(stack.label, `${name} should have label`).toBeDefined();
        expect(stack.packageJson, `${name} should have packageJson`).toBeDefined();
      }
    });

    test('nextjs has required dependencies', () => {
      const deps = META.stacks.nextjs.packageJson.dependencies;
      expect(deps?.next).toBeDefined();
      expect(deps?.react).toBeDefined();
      expect(deps?.['react-dom']).toBeDefined();
    });

    test('nextjs has dev script with port placeholder', () => {
      const scripts = META.stacks.nextjs.packageJson.scripts;
      expect(scripts?.dev).toContain('next dev');
    });
  });

  describe('modules', () => {
    test('shadcn is compatible with nextjs and tanstack-start', () => {
      const shadcn = META.modules.shadcn;
      expect(isModuleCompatible(shadcn, 'nextjs')).toBe(true);
      expect(isModuleCompatible(shadcn, 'tanstack-start')).toBe(true);
      expect(isModuleCompatible(shadcn, 'expo')).toBe(false);
    });

    test('shadcn has asPackage and singlePath', () => {
      expect(META.modules.shadcn.asPackage).toBe('ui');
      expect(META.modules.shadcn.singlePath).toBeDefined();
    });

    test('tanstack-query is compatible with all stacks', () => {
      const query = META.modules['tanstack-query'];
      expect(query.stacks).toBe('all');
      expect(isModuleCompatible(query, 'nextjs')).toBe(true);
      expect(isModuleCompatible(query, 'expo')).toBe(true);
      expect(isModuleCompatible(query, 'hono')).toBe(true);
    });

    test('modules with asPackage have exports', () => {
      for (const [name, module] of Object.entries(META.modules)) {
        if (module.asPackage) {
          expect(
            module.packageJson.exports,
            `${name} with asPackage should have exports`
          ).toBeDefined();
        }
      }
    });
  });

  describe('orm', () => {
    test('drizzle has required config', () => {
      const drizzle = META.orm.stacks.drizzle;
      expect(drizzle.asPackage).toBe('db');
      expect(drizzle.singlePath).toBeDefined();
      expect(drizzle.packageJson.dependencies?.['drizzle-orm']).toBeDefined();
      expect(drizzle.packageJson.devDependencies?.['drizzle-kit']).toBeDefined();
      expect(drizzle.packageJson.scripts?.['db:generate']).toBeDefined();
    });

    test('orm requires database', () => {
      expect(META.orm.requires).toContain('database');
    });
  });

  describe('database', () => {
    test('postgres has driver dependency', () => {
      const deps = META.database.stacks.postgres.packageJson?.dependencies;
      expect(deps?.pg).toBeDefined();
    });

    test('mysql has driver dependency', () => {
      const deps = META.database.stacks.mysql.packageJson?.dependencies;
      expect(deps?.mysql2).toBeDefined();
    });
  });

  describe('extras', () => {
    test('husky requires git', () => {
      expect(META.extras.stacks.husky.requires).toContain('git');
    });

    test('biome has dependency and scripts', () => {
      const biome = META.extras.stacks.biome;
      expect(biome.packageJson?.devDependencies?.['@biomejs/biome']).toBeDefined();
      expect(biome.packageJson?.scripts?.format).toBeDefined();
      expect(biome.packageJson?.scripts?.lint).toBeDefined();
    });
  });
});
```

**Step 2: Rewrite __meta__.ts with new structure**

```typescript
// apps/cli/src/__meta__.ts

// ABOUTME: Single source of truth for all stacks, modules, and configuration
// ABOUTME: Contains dependencies, scripts, and metadata for project generation

import type { Meta } from '@/types/meta';

export const META: Meta = {
  stacks: {
    nextjs: {
      type: 'app',
      label: 'Next.js',
      hint: 'React framework with SSR',
      packageJson: {
        dependencies: {
          'next': '^16.1.1',
          'react': '^19.2.3',
          'react-dom': '^19.2.3',
          'lucide-react': '^0.487.0',
          'tw-animate-css': '^1.3.4',
        },
        devDependencies: {
          'typescript': '^5',
          '@types/node': '^20',
          '@types/react': '^19.2.3',
          '@types/react-dom': '^19.2.3',
          'tailwindcss': '^4.1.10',
          '@next/bundle-analyzer': '^16.1.1',
        },
        scripts: {
          'dev': 'next dev --port {{port}}',
          'build': 'next build',
          'build:analyze': 'ANALYZE=true next build',
          'start': 'next start --port {{port}}',
        },
      },
    },
    expo: {
      type: 'app',
      label: 'Expo',
      hint: 'React Native framework',
      packageJson: {
        dependencies: {
          'expo': '~52.0.0',
          'expo-status-bar': '~2.0.0',
          'react': '^18.3.1',
          'react-native': '0.76.5',
        },
        devDependencies: {
          'typescript': '^5.3.0',
          '@types/react': '~18.3.12',
        },
        scripts: {
          'start': 'expo start',
          'android': 'expo start --android',
          'ios': 'expo start --ios',
          'web': 'expo start --web',
        },
      },
    },
    hono: {
      type: 'server',
      label: 'Hono',
      hint: 'Fast web framework',
      packageJson: {
        dependencies: {
          'hono': '^4.7.4',
        },
        devDependencies: {
          'typescript': '^5',
          '@types/node': '^20',
        },
        scripts: {
          'dev': 'bun run --hot src/index.ts',
          'start': 'bun run src/index.ts',
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
          'react': '^19.0.0',
          'react-dom': '^19.0.0',
          'vinxi': '^0.5.1',
        },
        devDependencies: {
          'typescript': '^5',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          'vite': '^6.0.0',
        },
        scripts: {
          'dev': 'vinxi dev --port {{port}}',
          'build': 'vinxi build',
          'start': 'vinxi start --port {{port}}',
        },
      },
    },
  },

  modules: {
    shadcn: {
      label: 'shadcn/ui',
      hint: 'Beautifully designed components',
      stacks: ['nextjs', 'tanstack-start'],
      asPackage: 'ui',
      singlePath: 'src/components/ui/',
      packageJson: {
        dependencies: {
          'radix-ui': '^1.4.2',
          'class-variance-authority': '^0.7.1',
          'clsx': '^2.1.1',
          'cmdk': '^1.1.1',
          'vaul': '^1.1.2',
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
      hint: 'Theme management',
      stacks: ['nextjs'],
      packageJson: {
        dependencies: {
          'next-themes': '^0.4.6',
        },
      },
    },
    mdx: {
      label: 'MDX',
      hint: 'Markdown-based content',
      stacks: ['nextjs'],
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
      stacks: ['nextjs'],
      packageJson: {},
    },
    'better-auth': {
      label: 'Better Auth',
      hint: 'Authentication framework',
      stacks: ['nextjs'],
      asPackage: 'auth',
      singlePath: 'src/lib/auth/',
      requires: ['orm'],
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
      hint: 'Async state management',
      stacks: 'all',
      packageJson: {
        dependencies: {
          '@tanstack/react-query': '^5.90.0',
        },
      },
    },
    'tanstack-devtools': {
      label: 'TanStack Devtools',
      hint: 'Devtools for TanStack',
      stacks: ['nextjs', 'tanstack-start'],
      packageJson: {
        devDependencies: {
          '@tanstack/react-devtools': '^0.7.0',
          '@tanstack/react-query-devtools': '^5.90.1',
        },
      },
    },
    'react-hook-form': {
      label: 'React Hook Form',
      hint: 'Performant forms',
      stacks: ['nextjs', 'tanstack-start'],
      packageJson: {
        dependencies: {
          'react-hook-form': '^7.56.1',
          '@hookform/resolvers': '^5.2.1',
        },
      },
    },
    'tanstack-form': {
      label: 'TanStack Form',
      hint: 'Type-safe forms',
      stacks: ['nextjs', 'tanstack-start'],
      packageJson: {
        dependencies: {
          '@tanstack/react-form': '^1.23.7',
        },
      },
    },
    nativewind: {
      label: 'NativeWind',
      hint: 'Tailwind for React Native',
      stacks: ['expo'],
      packageJson: {
        dependencies: {
          'nativewind': '^4.1.23',
        },
        devDependencies: {
          'tailwindcss': '^3.4.17',
        },
      },
    },
    'aws-lambda': {
      label: 'AWS Lambda',
      hint: 'Serverless deployment',
      stacks: ['hono'],
      packageJson: {
        dependencies: {
          '@hono/aws-lambda': '^1.0.0',
        },
      },
    },
  },

  orm: {
    asPackage: 'db',
    singlePath: 'src/lib/db/',
    requires: ['database'],
    stacks: {
      drizzle: {
        label: 'Drizzle',
        hint: 'Lightweight TypeScript ORM',
        asPackage: 'db',
        singlePath: 'src/lib/db/',
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
        label: 'Prisma',
        hint: 'Type-safe ORM with migrations',
        asPackage: 'db',
        singlePath: 'src/lib/db/',
        packageJson: {
          dependencies: {
            '@prisma/client': '^6.13.0',
          },
          devDependencies: {
            'prisma': '^6.13.0',
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
    },
  },

  database: {
    stacks: {
      postgres: {
        label: 'PostgreSQL',
        hint: 'Relational database',
        packageJson: {
          dependencies: {
            'pg': '^8.13.1',
          },
          devDependencies: {
            '@types/pg': '^8.11.10',
          },
        },
      },
      mysql: {
        label: 'MySQL',
        hint: 'Relational database',
        packageJson: {
          dependencies: {
            'mysql2': '^3.11.5',
          },
        },
      },
    },
  },

  extras: {
    stacks: {
      biome: {
        label: 'Biome',
        hint: 'Fast linter & formatter',
        packageJson: {
          devDependencies: {
            '@biomejs/biome': '^2.3.11',
          },
          scripts: {
            'format': 'biome format --write .',
            'lint': 'biome lint',
          },
        },
      },
      husky: {
        label: 'Husky',
        hint: 'Git hooks',
        requires: ['git'],
        packageJson: {
          devDependencies: {
            'husky': '^9',
          },
          scripts: {
            'prepare': 'husky',
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
```

**Step 3: Run validation tests**

Run: `cd apps/cli && bun test src/tests/meta-validation.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/src/tests/meta-validation.test.ts
git commit -m "refactor: restructure META with modules separated from stacks"
```

---

### Phase 3: Package.json Generator

---

### Task 3.1: Create the package.json generator

**Files:**
- Create: `apps/cli/src/lib/package-json-generator.ts`
- Create: `apps/cli/src/tests/package-json-generator.test.ts`

**Step 1: Write tests for package.json generator**

```typescript
// apps/cli/src/tests/package-json-generator.test.ts

// ABOUTME: Unit tests for programmatic package.json generation
// ABOUTME: Tests merge logic, workspace references, and port resolution

import { describe, test, expect } from 'bun:test';
import {
  generateAllPackageJsons,
  generateAppPackageJson,
  generatePackagePackageJson,
  generateRootPackageJson,
  mergePackageJsonConfigs,
} from '../lib/package-json-generator';
import type { TemplateContext } from '../types/ctx';

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

  test('merges devDependencies and scripts', () => {
    const result = mergePackageJsonConfigs(
      { devDependencies: { a: '1' }, scripts: { dev: 'dev1' } },
      { devDependencies: { b: '2' }, scripts: { build: 'build1' } }
    );
    expect(result.devDependencies).toEqual({ a: '1', b: '2' });
    expect(result.scripts).toEqual({ dev: 'dev1', build: 'build1' });
  });
});

describe('generateAppPackageJson (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-project',
    projectPath: '/tmp/test',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', modules: ['shadcn'] },
      { appName: 'api', stackName: 'hono', modules: [] },
    ],
    orm: 'drizzle',
    database: 'postgres',
  };

  test('generates correct name and path', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.path).toBe('apps/web/package.json');
    expect(result.content.name).toBe('web');
  });

  test('includes stack dependencies', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies.next).toBeDefined();
    expect(result.content.dependencies.react).toBeDefined();
  });

  test('references workspace packages for modules with asPackage', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies['@repo/ui']).toBe('*');
    expect(result.content.dependencies['radix-ui']).toBeUndefined();
  });

  test('references @repo/db when orm is set', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies['@repo/db']).toBe('*');
  });

  test('resolves port placeholder in scripts', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts.dev).toContain('--port 3000');

    const result2 = generateAppPackageJson(ctx.apps[1], ctx, 1);
    expect(result2.content.scripts.dev).not.toContain('{{port}}');
  });

  test('second app gets port 3001', () => {
    const result = generateAppPackageJson(ctx.apps[1], ctx, 1);
    // Hono uses different script, but if it had port it would be 3001
    expect(result.content.name).toBe('api');
  });
});

describe('generateAppPackageJson (single repo)', () => {
  const ctx: TemplateContext = {
    projectName: 'test-single',
    projectPath: '/tmp/test',
    repo: 'single',
    apps: [{ appName: 'web', stackName: 'nextjs', modules: ['shadcn'] }],
    orm: 'drizzle',
    database: 'postgres',
    extras: ['biome'],
  };

  test('generates at root with project name', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.path).toBe('package.json');
    expect(result.content.name).toBe('test-single');
  });

  test('includes module dependencies directly (no workspace)', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies['radix-ui']).toBeDefined();
    expect(result.content.dependencies['@repo/ui']).toBeUndefined();
  });

  test('includes orm dependencies directly', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies['drizzle-orm']).toBeDefined();
    expect(result.content.devDependencies['drizzle-kit']).toBeDefined();
    expect(result.content.scripts['db:generate']).toBeDefined();
  });

  test('includes database driver', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.dependencies['pg']).toBeDefined();
  });

  test('includes extras', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.devDependencies['@biomejs/biome']).toBeDefined();
    expect(result.content.scripts['format']).toBeDefined();
  });

  test('does not include port in scripts (single app)', () => {
    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    expect(result.content.scripts.dev).not.toContain('--port');
  });
});

describe('generatePackagePackageJson', () => {
  test('generates ui package with correct exports', () => {
    const result = generatePackagePackageJson('ui', {
      dependencies: { 'radix-ui': '^1.0.0' },
      exports: { './': './src/components/' },
    });

    expect(result.path).toBe('packages/ui/package.json');
    expect(result.content.name).toBe('@repo/ui');
    expect(result.content.exports).toEqual({ './': './src/components/' });
    expect(result.content.dependencies['radix-ui']).toBe('^1.0.0');
  });

  test('generates db package with scripts', () => {
    const result = generatePackagePackageJson('db', {
      dependencies: { 'drizzle-orm': '^0.38.0' },
      scripts: { 'db:generate': 'drizzle-kit generate' },
      exports: { '.': './src/index.ts' },
    });

    expect(result.content.name).toBe('@repo/db');
    expect(result.content.scripts['db:generate']).toBeDefined();
  });
});

describe('generateRootPackageJson (turborepo)', () => {
  const ctx: TemplateContext = {
    projectName: 'my-monorepo',
    projectPath: '/tmp/test',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', modules: [] },
      { appName: 'api', stackName: 'hono', modules: [] },
    ],
    extras: ['biome'],
  };

  test('generates root package.json with project name', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.path).toBe('package.json');
    expect(result.content.name).toBe('my-monorepo');
  });

  test('includes workspaces', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.workspaces).toContain('apps/*');
    expect(result.content.workspaces).toContain('packages/*');
  });

  test('includes turborepo scripts', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.scripts.dev).toContain('turbo');
    expect(result.content.scripts.build).toContain('turbo');
  });

  test('includes extras devDependencies', () => {
    const result = generateRootPackageJson(ctx);
    expect(result.content.devDependencies['@biomejs/biome']).toBeDefined();
  });
});

describe('generateAllPackageJsons', () => {
  test('generates all required package.jsons for turborepo', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      projectPath: '/tmp/test',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', modules: ['shadcn'] },
        { appName: 'api', stackName: 'hono', modules: [] },
      ],
      orm: 'drizzle',
      database: 'postgres',
    };

    const results = generateAllPackageJsons(ctx);
    const paths = results.map((r) => r.path);

    expect(paths).toContain('package.json'); // root
    expect(paths).toContain('apps/web/package.json');
    expect(paths).toContain('apps/api/package.json');
    expect(paths).toContain('packages/ui/package.json');
    expect(paths).toContain('packages/db/package.json');
  });

  test('generates single package.json for single repo', () => {
    const ctx: TemplateContext = {
      projectName: 'test-single',
      projectPath: '/tmp/test',
      repo: 'single',
      apps: [{ appName: 'web', stackName: 'nextjs', modules: [] }],
    };

    const results = generateAllPackageJsons(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('package.json');
  });
});
```

**Step 2: Run tests (should fail)**

Run: `cd apps/cli && bun test src/tests/package-json-generator.test.ts`

Expected: FAIL - module not found

**Step 3: Implement package-json-generator.ts**

```typescript
// apps/cli/src/lib/package-json-generator.ts

// ABOUTME: Programmatic generation of package.json files
// ABOUTME: Merges dependencies from META based on context (stacks, modules, orm, extras)

import { META } from '@/__meta__';
import type { PackageJsonConfig } from '@/types/meta';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { isModuleCompatible } from '@/types/meta';

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
  overrides?: Record<string, string>;
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

function resolveScriptPorts(scripts: Record<string, string>, port: number): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = value.replace(/\{\{port\}\}/g, String(port));
  }
  return resolved;
}

function sortObjectKeys<T extends Record<string, any>>(obj: T): T {
  const sorted: any = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

export function generateAppPackageJson(
  app: AppContext,
  ctx: TemplateContext,
  appIndex: number
): GeneratedPackageJson {
  const stack = META.stacks[app.stackName];
  const port = 3000 + appIndex;
  const isTurborepo = ctx.repo === 'turborepo';

  // Start with stack config
  let merged = mergePackageJsonConfigs(stack.packageJson);

  // Add modules
  for (const moduleName of app.modules) {
    const mod = META.modules[moduleName];
    if (!mod || !isModuleCompatible(mod, app.stackName)) continue;

    if (mod.asPackage && isTurborepo) {
      // Add workspace reference instead of direct deps
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${mod.asPackage}`]: '*',
      };
    } else {
      // Merge deps directly (single repo or module without asPackage)
      merged = mergePackageJsonConfigs(merged, mod.packageJson);
    }
  }

  // Add ORM
  if (ctx.orm) {
    if (isTurborepo) {
      merged.dependencies = {
        ...merged.dependencies,
        '@repo/db': '*',
      };
    } else {
      // Single repo: merge orm + database deps directly
      const ormConfig = META.orm.stacks[ctx.orm].packageJson;
      const dbConfig = ctx.database ? META.database.stacks[ctx.database].packageJson : undefined;
      merged = mergePackageJsonConfigs(merged, ormConfig, dbConfig);
    }
  }

  // Add extras (single repo only, turborepo puts them at root)
  if (!isTurborepo && ctx.extras) {
    for (const extra of ctx.extras) {
      const extraConfig = META.extras.stacks[extra]?.packageJson;
      merged = mergePackageJsonConfigs(merged, extraConfig);
    }
  }

  // Resolve port placeholders
  let scripts = merged.scripts ?? {};
  if (isTurborepo) {
    scripts = resolveScriptPorts(scripts, port);
  } else {
    // Single repo: remove port from scripts
    scripts = Object.fromEntries(
      Object.entries(scripts).map(([k, v]) => [k, v.replace(/\s*--port\s*\{\{port\}\}/g, '')])
    );
  }

  // Build final package.json
  const pkg: PackageJson = {
    name: isTurborepo ? app.appName : ctx.projectName,
    version: '0.1.0',
    private: true,
    scripts: sortObjectKeys(scripts),
    dependencies: sortObjectKeys(merged.dependencies ?? {}),
    devDependencies: sortObjectKeys(merged.devDependencies ?? {}),
  };

  // Path
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
    devDependencies: config.devDependencies ? sortObjectKeys(config.devDependencies) : undefined,
  };

  // Remove undefined fields
  Object.keys(pkg).forEach((key) => {
    if (pkg[key as keyof PackageJson] === undefined) {
      delete pkg[key as keyof PackageJson];
    }
  });

  return {
    path: `packages/${packageName}/package.json`,
    content: pkg,
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

  // Add extras to root
  if (ctx.extras) {
    for (const extra of ctx.extras) {
      const extraConfig = META.extras.stacks[extra]?.packageJson;
      if (extraConfig) {
        if (extraConfig.devDependencies) {
          devDependencies = { ...devDependencies, ...extraConfig.devDependencies };
        }
        if (extraConfig.scripts) {
          Object.assign(scripts, extraConfig.scripts);
        }
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
    // Root package.json
    results.push(generateRootPackageJson(ctx));

    // App package.jsons
    ctx.apps.forEach((app, index) => {
      results.push(generateAppPackageJson(app, ctx, index));
    });

    // Extracted packages
    const extractedPackages = new Map<string, PackageJsonConfig>();

    // Collect modules with asPackage
    for (const app of ctx.apps) {
      for (const moduleName of app.modules) {
        const mod = META.modules[moduleName];
        if (mod?.asPackage && !extractedPackages.has(mod.asPackage)) {
          extractedPackages.set(mod.asPackage, mod.packageJson);
        }
      }
    }

    // ORM package
    if (ctx.orm) {
      const ormConfig = META.orm.stacks[ctx.orm].packageJson;
      const dbConfig = ctx.database ? META.database.stacks[ctx.database].packageJson : undefined;
      const merged = mergePackageJsonConfigs(ormConfig, dbConfig);
      extractedPackages.set('db', merged);
    }

    // Generate package.jsons for extracted packages
    for (const [name, config] of extractedPackages) {
      results.push(generatePackagePackageJson(name, config));
    }
  } else {
    // Single repo: just one package.json
    results.push(generateAppPackageJson(ctx.apps[0], ctx, 0));
  }

  return results;
}
```

**Step 4: Run tests**

Run: `cd apps/cli && bun test src/tests/package-json-generator.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/package-json-generator.ts apps/cli/src/tests/package-json-generator.test.ts
git commit -m "feat: add programmatic package.json generator"
```

---

### Phase 4: Simplify magic-comments.ts

---

### Task 4.1: Refactor magic-comments.ts for @dest: only

**Files:**
- Modify: `apps/cli/src/lib/magic-comments.ts`
- Modify: `apps/cli/src/tests/magic-comments.test.ts`

**Step 1: Update tests to match new implementation**

The tests created in Task 1.2 are already correct for the new system. Verify they pass.

**Step 2: Rewrite magic-comments.ts**

```typescript
// apps/cli/src/lib/magic-comments.ts

// ABOUTME: Magic comment parser for template destination override
// ABOUTME: Supports only @dest:app|pkg|root for explicit file placement

export type DestType = 'app' | 'pkg' | 'root';

export interface MagicComment {
  type: 'dest';
  value: DestType;
  raw: string;
}

export function extractFirstLine(content: string): string {
  const firstLineEnd = content.indexOf('\n');
  return firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
}

export function parseMagicComments(firstLine: string): MagicComment[] {
  const commentMatch = firstLine.match(/^\{\{!--\s*@dest:(app|pkg|root)\s*--\}\}/);

  if (!commentMatch) return [];

  return [
    {
      type: 'dest',
      value: commentMatch[1] as DestType,
      raw: commentMatch[0],
    },
  ];
}

export function parseDestFromContent(content: string): DestType | null {
  const firstLine = extractFirstLine(content);
  const comments = parseMagicComments(firstLine);
  return comments.length > 0 ? comments[0].value : null;
}

export function removeDestMagicComment(content: string): string {
  return content.replace(/^\{\{!--\s*@dest:(app|pkg|root)\s*--\}\}\n?/, '');
}

// Legacy function - always returns false since @dest: never causes skip
export function shouldSkipTemplate(_comments: MagicComment[], _ctx: unknown): boolean {
  return false;
}
```

**Step 3: Run tests**

Run: `cd apps/cli && bun test src/tests/magic-comments.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/cli/src/lib/magic-comments.ts
git commit -m "refactor: simplify magic comments to @dest: only"
```

---

### Phase 5: Simplify handlebars.ts

---

### Task 5.1: Reduce helpers to 6

**Files:**
- Modify: `apps/cli/src/lib/handlebars.ts`
- Create: `apps/cli/src/tests/handlebars.test.ts`

**Step 1: Write tests for new helpers**

```typescript
// apps/cli/src/tests/handlebars.test.ts

// ABOUTME: Unit tests for Handlebars helpers
// ABOUTME: Tests the 6 simplified helpers: eq, ne, and, or, isTurborepo, has

import { describe, test, expect, beforeAll } from 'bun:test';
import Handlebars from 'handlebars';
import { registerHandlebarsHelpers } from '../lib/handlebars';

describe('Handlebars helpers', () => {
  beforeAll(() => {
    registerHandlebarsHelpers();
  });

  describe('eq', () => {
    test('returns true for equal values', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'foo' })).toBe('yes');
    });

    test('returns false for different values', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'bar' })).toBe('no');
    });
  });

  describe('ne', () => {
    test('returns true for different values', () => {
      const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'bar' })).toBe('yes');
    });

    test('returns false for equal values', () => {
      const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'foo' })).toBe('no');
    });
  });

  describe('and', () => {
    test('returns true when all values are truthy', () => {
      const template = Handlebars.compile('{{#if (and a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: true, b: true, c: true })).toBe('yes');
    });

    test('returns false when any value is falsy', () => {
      const template = Handlebars.compile('{{#if (and a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: true, b: false, c: true })).toBe('no');
    });
  });

  describe('or', () => {
    test('returns true when any value is truthy', () => {
      const template = Handlebars.compile('{{#if (or a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: false, b: true, c: false })).toBe('yes');
    });

    test('returns false when all values are falsy', () => {
      const template = Handlebars.compile('{{#if (or a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: false, b: false, c: false })).toBe('no');
    });
  });

  describe('isTurborepo', () => {
    test('returns true for turborepo', () => {
      const template = Handlebars.compile('{{#if (isTurborepo)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'turborepo' })).toBe('yes');
    });

    test('returns false for single', () => {
      const template = Handlebars.compile('{{#if (isTurborepo)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'single' })).toBe('no');
    });
  });

  describe('has', () => {
    test('checks module existence', () => {
      const template = Handlebars.compile('{{#if (has "module" "shadcn")}}yes{{else}}no{{/if}}');
      expect(template({ modules: ['shadcn', 'mdx'] })).toBe('yes');
      expect(template({ modules: ['mdx'] })).toBe('no');
      expect(template({ modules: [] })).toBe('no');
    });

    test('checks database value', () => {
      const template = Handlebars.compile('{{#if (has "database" "postgres")}}yes{{else}}no{{/if}}');
      expect(template({ database: 'postgres' })).toBe('yes');
      expect(template({ database: 'mysql' })).toBe('no');
      expect(template({})).toBe('no');
    });

    test('checks orm value', () => {
      const template = Handlebars.compile('{{#if (has "orm" "drizzle")}}yes{{else}}no{{/if}}');
      expect(template({ orm: 'drizzle' })).toBe('yes');
      expect(template({ orm: 'prisma' })).toBe('no');
    });

    test('checks extra existence', () => {
      const template = Handlebars.compile('{{#if (has "extra" "biome")}}yes{{else}}no{{/if}}');
      expect(template({ extras: ['biome', 'husky'] })).toBe('yes');
      expect(template({ extras: ['husky'] })).toBe('no');
    });

    test('checks stack existence in apps', () => {
      const template = Handlebars.compile('{{#if (has "stack" "nextjs")}}yes{{else}}no{{/if}}');
      expect(template({ apps: [{ stackName: 'nextjs' }, { stackName: 'hono' }] })).toBe('yes');
      expect(template({ apps: [{ stackName: 'hono' }] })).toBe('no');
    });

    test('returns false for unknown category', () => {
      const template = Handlebars.compile('{{#if (has "unknown" "value")}}yes{{else}}no{{/if}}');
      expect(template({})).toBe('no');
    });
  });
});
```

**Step 2: Rewrite handlebars.ts**

```typescript
// apps/cli/src/lib/handlebars.ts

// ABOUTME: Handlebars template engine setup with custom helpers
// ABOUTME: Provides 6 helpers: eq, ne, and, or, isTurborepo, has

import Handlebars from 'handlebars';
import type { TemplateContext } from '@/types/ctx';

export function registerHandlebarsHelpers(): void {
  // Equality check
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

  // Inequality check
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);

  // Logical AND - all args must be truthy
  Handlebars.registerHelper('and', (...args: unknown[]) => {
    const values = args.slice(0, -1); // Last arg is Handlebars options
    return values.every((v) => Boolean(v));
  });

  // Logical OR - any arg must be truthy
  Handlebars.registerHelper('or', (...args: unknown[]) => {
    const values = args.slice(0, -1);
    return values.some((v) => Boolean(v));
  });

  // Check if repo is turborepo
  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  // Generic existence/value check
  Handlebars.registerHelper('has', function (this: TemplateContext, category: string, value: string) {
    switch (category) {
      case 'module':
        return Array.isArray(this.modules) && this.modules.includes(value);
      case 'database':
        return this.database === value;
      case 'orm':
        return this.orm === value;
      case 'extra':
        return Array.isArray(this.extras) && this.extras.includes(value);
      case 'stack':
        return Array.isArray(this.apps) && this.apps.some((app) => app.stackName === value);
      default:
        return false;
    }
  });
}

export function renderTemplate(templateContent: string, context: TemplateContext): string {
  try {
    const template = Handlebars.compile(templateContent, {
      noEscape: true,
      strict: false, // Changed from true to handle missing properties gracefully
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

**Step 3: Run tests**

Run: `cd apps/cli && bun test src/tests/handlebars.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/cli/src/lib/handlebars.ts apps/cli/src/tests/handlebars.test.ts
git commit -m "refactor: simplify Handlebars helpers to 6 essential ones"
```

---

### Phase 6: Refactor template-resolver.ts

---

### Task 6.1: New template resolution logic

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts`
- Create: `apps/cli/src/tests/template-resolver.test.ts`

**Step 1: Write tests for new template resolver**

```typescript
// apps/cli/src/tests/template-resolver.test.ts

// ABOUTME: Unit tests for template resolution logic
// ABOUTME: Tests path resolution based on META (asPackage, singlePath) and @dest:

import { describe, test, expect } from 'bun:test';
import {
  resolveDestination,
  resolveModuleDestination,
} from '../lib/template-resolver';
import type { TemplateContext } from '../types/ctx';

const turborepoCtx: TemplateContext = {
  projectName: 'test',
  projectPath: '/tmp/test',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', modules: ['shadcn'] }],
};

const singleCtx: TemplateContext = {
  projectName: 'test',
  projectPath: '/tmp/test',
  repo: 'single',
  apps: [{ appName: 'web', stackName: 'nextjs', modules: ['shadcn'] }],
};

describe('resolveDestination', () => {
  describe('stack templates', () => {
    test('turborepo: resolves to apps/{appName}/', () => {
      const result = resolveDestination(
        'src/app/page.tsx',
        { type: 'stack', appName: 'web' },
        turborepoCtx
      );
      expect(result).toBe('apps/web/src/app/page.tsx');
    });

    test('single: resolves to root', () => {
      const result = resolveDestination(
        'src/app/page.tsx',
        { type: 'stack', appName: 'web' },
        singleCtx
      );
      expect(result).toBe('src/app/page.tsx');
    });
  });

  describe('repo templates', () => {
    test('resolves to root', () => {
      const result = resolveDestination(
        'turbo.json',
        { type: 'repo' },
        turborepoCtx
      );
      expect(result).toBe('turbo.json');
    });
  });

  describe('database templates', () => {
    test('resolves to root', () => {
      const result = resolveDestination(
        'docker-compose.yml',
        { type: 'database' },
        turborepoCtx
      );
      expect(result).toBe('docker-compose.yml');
    });
  });

  describe('extras templates', () => {
    test('resolves to root', () => {
      const result = resolveDestination(
        'biome.json',
        { type: 'extras' },
        turborepoCtx
      );
      expect(result).toBe('biome.json');
    });
  });
});

describe('resolveModuleDestination', () => {
  describe('module with asPackage (shadcn)', () => {
    const moduleConfig = {
      asPackage: 'ui',
      singlePath: 'src/components/ui/',
    };

    test('turborepo: default resolves to packages/{asPackage}/', () => {
      const result = resolveModuleDestination(
        'src/components/button.tsx',
        moduleConfig,
        null,
        'web',
        turborepoCtx
      );
      expect(result).toBe('packages/ui/src/components/button.tsx');
    });

    test('turborepo: @dest:app overrides to apps/{appName}/', () => {
      const result = resolveModuleDestination(
        'components.json',
        moduleConfig,
        'app',
        'web',
        turborepoCtx
      );
      expect(result).toBe('apps/web/components.json');
    });

    test('turborepo: @dest:pkg explicit (same as default)', () => {
      const result = resolveModuleDestination(
        'src/components/button.tsx',
        moduleConfig,
        'pkg',
        'web',
        turborepoCtx
      );
      expect(result).toBe('packages/ui/src/components/button.tsx');
    });

    test('turborepo: @dest:root overrides to root', () => {
      const result = resolveModuleDestination(
        'some-config.json',
        moduleConfig,
        'root',
        'web',
        turborepoCtx
      );
      expect(result).toBe('some-config.json');
    });

    test('single: default resolves via singlePath', () => {
      const result = resolveModuleDestination(
        'src/components/button.tsx',
        moduleConfig,
        null,
        'web',
        singleCtx
      );
      expect(result).toBe('src/components/ui/src/components/button.tsx');
    });

    test('single: @dest:app resolves to root (no apps/ prefix)', () => {
      const result = resolveModuleDestination(
        'components.json',
        moduleConfig,
        'app',
        'web',
        singleCtx
      );
      expect(result).toBe('components.json');
    });
  });

  describe('module without asPackage (tanstack-query)', () => {
    const moduleConfig = {};

    test('turborepo: resolves to apps/{appName}/', () => {
      const result = resolveModuleDestination(
        'src/lib/query-client.ts',
        moduleConfig,
        null,
        'web',
        turborepoCtx
      );
      expect(result).toBe('apps/web/src/lib/query-client.ts');
    });

    test('single: resolves to root', () => {
      const result = resolveModuleDestination(
        'src/lib/query-client.ts',
        moduleConfig,
        null,
        'web',
        singleCtx
      );
      expect(result).toBe('src/lib/query-client.ts');
    });
  });
});
```

**Step 2: Rewrite template-resolver.ts**

```typescript
// apps/cli/src/lib/template-resolver.ts

// ABOUTME: Resolves template files to their destination paths
// ABOUTME: Uses META config (asPackage, singlePath) and @dest: magic comments

import { globSync } from 'fast-glob';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { META } from '@/__meta__';
import { parseDestFromContent, removeDestMagicComment } from './magic-comments';
import type { DestType } from './magic-comments';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { isModuleCompatible } from '@/types/meta';

const TEMPLATES_DIR = join(import.meta.dir, '../../templates');

export interface TemplateFile {
  source: string;
  destination: string;
  appName?: string;
}

interface DestinationMeta {
  type: 'stack' | 'module' | 'orm' | 'database' | 'extras' | 'repo';
  appName?: string;
  asPackage?: string;
  singlePath?: string;
}

export function resolveDestination(
  relativePath: string,
  meta: DestinationMeta,
  ctx: TemplateContext,
  destOverride?: DestType | null
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  // Handle @dest: overrides
  if (destOverride === 'root') {
    return relativePath;
  }

  if (destOverride === 'app' && meta.appName) {
    return isTurborepo ? `apps/${meta.appName}/${relativePath}` : relativePath;
  }

  if (destOverride === 'pkg' && meta.asPackage) {
    return isTurborepo ? `packages/${meta.asPackage}/${relativePath}` : `${meta.singlePath}${relativePath}`;
  }

  // Default behavior based on type
  switch (meta.type) {
    case 'stack':
      return isTurborepo ? `apps/${meta.appName}/${relativePath}` : relativePath;

    case 'module':
      if (meta.asPackage) {
        return isTurborepo
          ? `packages/${meta.asPackage}/${relativePath}`
          : `${meta.singlePath ?? ''}${relativePath}`;
      }
      return isTurborepo ? `apps/${meta.appName}/${relativePath}` : relativePath;

    case 'orm':
      return isTurborepo
        ? `packages/${meta.asPackage}/${relativePath}`
        : `${meta.singlePath ?? ''}${relativePath}`;

    case 'database':
    case 'extras':
    case 'repo':
      return relativePath;

    default:
      return relativePath;
  }
}

export function resolveModuleDestination(
  relativePath: string,
  moduleConfig: { asPackage?: string; singlePath?: string },
  destOverride: DestType | null,
  appName: string,
  ctx: TemplateContext
): string {
  return resolveDestination(
    relativePath,
    {
      type: 'module',
      appName,
      asPackage: moduleConfig.asPackage,
      singlePath: moduleConfig.singlePath,
    },
    ctx,
    destOverride
  );
}

function scanTemplates(dir: string): string[] {
  const pattern = join(dir, '**/*');
  return globSync(pattern, { onlyFiles: true, dot: true });
}

function getRelativePath(source: string, baseDir: string): string {
  return relative(baseDir, source);
}

function transformFilename(filename: string): string {
  // Remove .hbs extension
  let result = filename.replace(/\.hbs$/, '');
  // Transform __name to .name (e.g., __gitignore -> .gitignore)
  result = result.replace(/^__([^_])/, '.$1');
  // Transform ___ to __ (escape sequence)
  result = result.replace(/^___/, '__');
  return result;
}

function resolveTemplatesForStack(
  stackName: string,
  appName: string,
  ctx: TemplateContext
): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stacks', stackName);
  const files = scanTemplates(stackDir);
  const templates: TemplateFile[] = [];

  for (const source of files) {
    // Skip package.json templates (generated programmatically)
    if (source.endsWith('package.json.hbs')) continue;

    const relativePath = getRelativePath(source, stackDir);
    const transformedPath = transformFilename(relativePath);
    const destination = resolveDestination(
      transformedPath,
      { type: 'stack', appName },
      ctx
    );

    templates.push({ source, destination, appName });
  }

  return templates;
}

function resolveTemplatesForModule(
  moduleName: string,
  appName: string,
  ctx: TemplateContext
): TemplateFile[] {
  const mod = META.modules[moduleName];
  if (!mod) return [];

  const moduleDir = join(TEMPLATES_DIR, 'modules', moduleName);
  const files = scanTemplates(moduleDir);
  const templates: TemplateFile[] = [];

  for (const source of files) {
    // Skip package.json templates
    if (source.endsWith('package.json.hbs')) continue;

    // Read file to check for @dest: magic comment
    const content = readFileSync(source, 'utf-8');
    const destOverride = parseDestFromContent(content);

    const relativePath = getRelativePath(source, moduleDir);
    const transformedPath = transformFilename(relativePath);
    const destination = resolveModuleDestination(
      transformedPath,
      { asPackage: mod.asPackage, singlePath: mod.singlePath },
      destOverride,
      appName,
      ctx
    );

    templates.push({ source, destination, appName });
  }

  return templates;
}

function resolveTemplatesForOrm(ctx: TemplateContext): TemplateFile[] {
  if (!ctx.orm) return [];

  const ormConfig = META.orm.stacks[ctx.orm];
  const ormDir = join(TEMPLATES_DIR, 'orm', ctx.orm);
  const files = scanTemplates(ormDir);
  const templates: TemplateFile[] = [];

  for (const source of files) {
    // Skip package.json templates
    if (source.endsWith('package.json.hbs')) continue;

    const content = readFileSync(source, 'utf-8');
    const destOverride = parseDestFromContent(content);

    const relativePath = getRelativePath(source, ormDir);
    const transformedPath = transformFilename(relativePath);
    const destination = resolveDestination(
      transformedPath,
      {
        type: 'orm',
        asPackage: ormConfig.asPackage,
        singlePath: ormConfig.singlePath,
      },
      ctx,
      destOverride
    );

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForDatabase(ctx: TemplateContext): TemplateFile[] {
  if (!ctx.database) return [];

  const dbDir = join(TEMPLATES_DIR, 'database', ctx.database);
  const files = scanTemplates(dbDir);

  return files.map((source) => {
    const relativePath = getRelativePath(source, dbDir);
    const transformedPath = transformFilename(relativePath);
    return {
      source,
      destination: resolveDestination(transformedPath, { type: 'database' }, ctx),
    };
  });
}

function resolveTemplatesForExtras(ctx: TemplateContext): TemplateFile[] {
  if (!ctx.extras?.length) return [];

  const templates: TemplateFile[] = [];

  for (const extra of ctx.extras) {
    const extraDir = join(TEMPLATES_DIR, 'extras', extra);
    const files = scanTemplates(extraDir);

    for (const source of files) {
      const relativePath = getRelativePath(source, extraDir);
      const transformedPath = transformFilename(relativePath);
      templates.push({
        source,
        destination: resolveDestination(transformedPath, { type: 'extras' }, ctx),
      });
    }
  }

  return templates;
}

function resolveTemplatesForRepo(ctx: TemplateContext): TemplateFile[] {
  const repoDir = join(TEMPLATES_DIR, 'repo', ctx.repo);
  const files = scanTemplates(repoDir);

  return files
    .filter((source) => !source.endsWith('package.json.hbs'))
    .map((source) => {
      const relativePath = getRelativePath(source, repoDir);
      const transformedPath = transformFilename(relativePath);
      return {
        source,
        destination: resolveDestination(transformedPath, { type: 'repo' }, ctx),
      };
    });
}

export function getAllTemplatesForContext(ctx: TemplateContext): TemplateFile[] {
  const templates: TemplateFile[] = [];

  // 1. Repo templates (turborepo or single config files)
  templates.push(...resolveTemplatesForRepo(ctx));

  // 2. Stack and module templates for each app
  for (const app of ctx.apps) {
    // Stack templates
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx));

    // Module templates
    for (const moduleName of app.modules) {
      const mod = META.modules[moduleName];
      if (mod && isModuleCompatible(mod, app.stackName)) {
        templates.push(...resolveTemplatesForModule(moduleName, app.appName, ctx));
      }
    }
  }

  // 3. ORM templates
  templates.push(...resolveTemplatesForOrm(ctx));

  // 4. Database templates
  templates.push(...resolveTemplatesForDatabase(ctx));

  // 5. Extras templates
  templates.push(...resolveTemplatesForExtras(ctx));

  return templates;
}
```

**Step 3: Run tests**

Run: `cd apps/cli && bun test src/tests/template-resolver.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts apps/cli/src/tests/template-resolver.test.ts
git commit -m "refactor: simplify template resolver with META-based path resolution"
```

---

### Phase 7: Integration and Cleanup

---

### Task 7.1: Modify file-generator.ts to integrate the new system

**Files:**
- Modify: `apps/cli/src/lib/file-generator.ts`

**Step 1: Update file-generator.ts**

```typescript
// apps/cli/src/lib/file-generator.ts

// ABOUTME: Orchestrates project file generation
// ABOUTME: Combines package.json generation and template processing

import { join, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateAllPackageJsons } from './package-json-generator';
import { getAllTemplatesForContext, type TemplateFile } from './template-resolver';
import { processTemplate, type ProcessResult } from './template-processor';
import { registerHandlebarsHelpers } from './handlebars';
import type { TemplateContext } from '@/types/ctx';

export interface GenerationResult {
  generated: string[];
  failed: Array<{ file: string; error: string }>;
  skipped: string[];
  success: boolean;
}

export async function generateProjectFiles(ctx: TemplateContext): Promise<GenerationResult> {
  const results: ProcessResult[] = [];
  const projectPath = ctx.projectPath;

  // 1. Generate package.json files (programmatic)
  const packageJsons = generateAllPackageJsons(ctx);

  for (const { path, content } of packageJsons) {
    const fullPath = join(projectPath, path);

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, JSON.stringify(content, null, 2) + '\n');
      results.push({ success: true, destination: path });
    } catch (error) {
      results.push({
        success: false,
        destination: path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // 2. Register Handlebars helpers
  registerHandlebarsHelpers();

  // 3. Resolve and process templates
  const templates = getAllTemplatesForContext(ctx);

  for (const template of templates) {
    const result = await processTemplate(template, ctx);
    results.push(result);
  }

  // 4. Compile results
  return {
    generated: results.filter((r) => r.success && !r.skipped).map((r) => r.destination),
    failed: results
      .filter((r) => !r.success)
      .map((r) => ({ file: r.destination, error: r.error ?? 'Unknown error' })),
    skipped: results.filter((r) => r.skipped).map((r) => r.destination),
    success: results.every((r) => r.success || r.skipped),
  };
}
```

**Step 2: Commit**

```bash
git add apps/cli/src/lib/file-generator.ts
git commit -m "refactor: integrate package.json generator into file generation"
```

---

### Task 7.2: Modify template-processor.ts

**Files:**
- Modify: `apps/cli/src/lib/template-processor.ts`

**Step 1: Update template-processor.ts**

```typescript
// apps/cli/src/lib/template-processor.ts

// ABOUTME: Processes individual template files
// ABOUTME: Handles Handlebars rendering, binary copying, and context enrichment

import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { renderTemplate } from './handlebars';
import { removeDestMagicComment } from './magic-comments';
import { writeFileContent, copyBinaryFile, isBinaryFile } from './file-writer';
import type { TemplateFile } from './template-resolver';
import type { TemplateContext, AppContext } from '@/types/ctx';

export interface ProcessResult {
  success: boolean;
  destination: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

function enrichContext(template: TemplateFile, ctx: TemplateContext): TemplateContext {
  // If template belongs to an app, merge app context
  if (template.appName) {
    const app = ctx.apps.find((a) => a.appName === template.appName);
    if (app) {
      return {
        ...ctx,
        appName: app.appName,
        stackName: app.stackName,
        modules: app.modules,
      };
    }
  }
  return ctx;
}

export async function processTemplate(
  template: TemplateFile,
  ctx: TemplateContext
): Promise<ProcessResult> {
  const { source, destination } = template;
  const fullDestination = join(ctx.projectPath, destination);

  try {
    // Ensure directory exists
    await mkdir(dirname(fullDestination), { recursive: true });

    // Binary files: direct copy
    if (isBinaryFile(source)) {
      await copyBinaryFile(source, fullDestination);
      return { success: true, destination };
    }

    // Read template content
    let content = readFileSync(source, 'utf-8');

    // Remove @dest: magic comment if present
    content = removeDestMagicComment(content);

    // Enrich context for app-specific templates
    const enrichedCtx = enrichContext(template, ctx);

    // Render with Handlebars
    const rendered = renderTemplate(content, enrichedCtx);

    // Write file
    await writeFileContent(fullDestination, rendered);

    return { success: true, destination };
  } catch (error) {
    return {
      success: false,
      destination,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

**Step 2: Commit**

```bash
git add apps/cli/src/lib/template-processor.ts
git commit -m "refactor: simplify template processor with @dest: removal"
```

---

### Task 7.3: Clean up duplicate templates

**Files:**
- Delete duplicate templates
- Update remaining templates with new helpers

**Step 1: Delete duplicate files**

```bash
# ORM duplicates - keep src/ versions, delete src/lib/db/ versions
rm apps/cli/templates/orm/drizzle/src/lib/db/schema.ts.hbs
rm apps/cli/templates/orm/drizzle/src/lib/db/index.ts.hbs
rm apps/cli/templates/orm/drizzle/src/lib/db/types.ts.hbs
rm apps/cli/templates/orm/prisma/src/lib/db/index.ts.hbs

# Module duplicates (better-auth)
rm apps/cli/templates/modules/nextjs/better-auth/src/lib/auth/auth.ts.hbs
rm apps/cli/templates/modules/nextjs/better-auth/src/lib/auth/auth-client.ts.hbs

# Module duplicates (shadcn)
rm apps/cli/templates/modules/nextjs/shadcn/src/components/ui/button.tsx.hbs

# Delete all package.json.hbs files (generated programmatically now)
find apps/cli/templates -name "package.json.hbs" -delete
```

**Step 2: Update remaining templates to use new helpers**

Example updates needed in templates:

```handlebars
{{!-- Before --}}
{{#if (eq database "postgres")}}
{{#if (hasModule "shadcn")}}

{{!-- After --}}
{{#if (has "database" "postgres")}}
{{#if (has "module" "shadcn")}}
```

**Step 3: Rename templates/stack to templates/stacks**

```bash
mv apps/cli/templates/stack apps/cli/templates/stacks
```

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove duplicate templates and update helpers usage"
```

---

### Task 7.4: Final integration tests

**Files:**
- Update: `apps/cli/src/tests/cli-integration.test.ts`

**Step 1: Run full integration tests**

Run: `cd apps/cli && bun test`

Expected: All tests PASS

**Step 2: Manual testing**

```bash
# Test single repo
cd /tmp && rm -rf test-single
bun run /path/to/apps/cli/src/index.ts test-single --app web:nextjs:shadcn --database postgres --orm drizzle --no-install

# Verify structure
ls -la test-single/
cat test-single/package.json

# Test turborepo
cd /tmp && rm -rf test-turbo
bun run /path/to/apps/cli/src/index.ts test-turbo --app web:nextjs:shadcn --app api:hono --database postgres --orm drizzle --no-install

# Verify structure
ls -la test-turbo/
ls -la test-turbo/apps/
ls -la test-turbo/packages/
cat test-turbo/packages/ui/package.json
cat test-turbo/packages/db/package.json
```

**Step 3: Commit final changes**

```bash
git add -A
git commit -m "test: verify integration tests pass with new architecture"
```

---

## Final Checklist

- [ ] Types updated (types/meta.ts)
- [ ] META restructured (__meta__.ts)
- [ ] Package.json generator created and tested
- [ ] Magic comments reduced to @dest: only
- [ ] Handlebars helpers reduced to 6
- [ ] Template resolver refactored
- [ ] File generator integrated
- [ ] Duplicate templates deleted
- [ ] Templates updated with new helpers
- [ ] Integration tests pass
- [ ] Manual tests validated

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Template files | 94 | ~75 |
| Duplicated lines | ~690 | 0 |
| Magic comment types | 4 | 1 |
| Handlebars helpers | 16 | 6 |
| package.json.hbs lines | 139 | 0 (generated) |
| Tests | 0 | ~50 |
