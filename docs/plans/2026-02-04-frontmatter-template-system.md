# Frontmatter Template System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace magic comments with YAML frontmatter (gray-matter) for per-file template configuration, using a `mono` naming convention throughout.

**Architecture:** Templates use optional YAML frontmatter for path resolution and filtering. META keeps `mono: { scope, name }` as defaults. Filename convention `file.ext.{stack}.hbs` handles stack-specific templates. Resolution: frontmatter overrides META defaults, which override file-based routing.

**Tech Stack:** gray-matter (YAML frontmatter parser), Handlebars, Bun test runner, Zod (validation)

---

## Context

**Branch:** `refactor/use-frontmatter-instead-of-magic-comment`
**Baseline:** 78 pass, 2 fail, 1 error (existing bugs from prior refactor — will be fixed as part of this work)

### Current System (being replaced)
- Magic comments: `{{!-- @dest:app --}}` and `{{!-- @only:turborepo --}}` as first line of `.hbs` files
- META `destination`: `{ target: 'app' | 'package' | 'root', name?: string, singlePath?: string }`
- 13 template files use magic comments, ~95+ have none

### Target System
- YAML frontmatter parsed by gray-matter
- `mono: { scope, name }` in META (replaces `destination`)
- Stack-specific files via filename convention: `file.ext.{stack}.hbs`
- Frontmatter is optional — absence means "use defaults"

### Frontmatter Schema
```yaml
---
path: string              # output path for single repo (overrides file-based)
mono:
  scope: app | pkg | root  # where in monorepo (overrides META default)
  path: string             # output path in monorepo (relative to scope prefix)
only: mono | single        # repo type filter
---
```

### META `mono` Field (replaces `destination`)
```typescript
// AddonMono replaces AddonDestination
type AddonMono =
  | { scope: 'app' }
  | { scope: 'pkg'; name: string }
  | { scope: 'root' };

interface MetaAddon {
  // ...existing fields
  mono?: AddonMono;  // replaces destination
}
```

### Filename Convention
- `file.ext.hbs` → all stacks
- `file.ext.{stack}.hbs` → stack-specific (suffix validated against META.stacks, stripped from output)

### Resolution Algorithm
```
1. Parse filename → detect stack suffix, compute output filename
2. Parse frontmatter (if present) → extract path, mono, only
3. Filter: skip if stack suffix doesn't match current app stack
4. Filter: skip if `only` doesn't match current repo type
5. Resolve output path:
   - Single repo: frontmatter.path ?? file-based-path
   - Monorepo:
       scope = frontmatter.mono.scope ?? META.mono.scope ?? 'app'
       prefix = scope switch:
         'app'  → apps/{appName}/
         'pkg'  → packages/{META.mono.name}/
         'root' → (empty)
       suffix = frontmatter.mono.path ?? file-based-path
       result = prefix + suffix
```

### Files Impacted (in dependency order)
1. `apps/cli/src/types/meta.ts` — new `AddonMono` type, replace `AddonDestination`
2. `apps/cli/src/__meta__.ts` — `destination` → `mono`
3. `apps/cli/src/lib/frontmatter.ts` — NEW: replaces `magic-comments.ts`
4. `apps/cli/src/lib/template-resolver.ts` — rewrite resolution with frontmatter
5. `apps/cli/src/lib/template-processor.ts` — strip frontmatter instead of magic comments
6. `apps/cli/src/lib/file-writer.ts` — update `transformFilename` for stack suffix
7. `apps/cli/src/lib/package-json-generator.ts` — `destination` → `mono` references
8. `apps/cli/src/lib/addon-utils.ts` — no changes needed (doesn't reference destination)
9. 13 template files — magic comments → frontmatter
10. Test files — update all affected tests

### Template Migration Map (13 files)

| File | Current | Frontmatter |
|------|---------|-------------|
| `addons/drizzle/__env.example.hbs` | `@dest:root` | `mono: { scope: root }` |
| `addons/drizzle/tsconfig.json.hbs` | `@only:turborepo` | `only: mono` |
| `addons/drizzle/drizzle.config.ts.hbs` | `@dest:root` | `mono: { scope: root }` |
| `addons/drizzle/scripts/seed.ts.hbs` | `@dest:root` | `mono: { scope: root }` |
| `addons/better-auth/src/app/api/auth/[...all]/route.ts.hbs` | `@dest:app` | `mono: { scope: app }` |
| `addons/better-auth/tsconfig.json.hbs` | `@only:turborepo` | `only: mono` |
| `addons/prisma/__env.example.hbs` | `@dest:root` | `mono: { scope: root }` |
| `addons/prisma/tsconfig.json.hbs` | `@only:turborepo` | `only: mono` |
| `addons/prisma/scripts/seed.ts.hbs` | `@dest:root` | `mono: { scope: root }` |
| `addons/shadcn/postcss.config.mjs.hbs` | `@only:turborepo` | `only: mono` |
| `addons/shadcn/tsconfig.json.hbs` | `@only:turborepo` | `only: mono` |
| `addons/shadcn/components.json.hbs` | `@dest:app` | `mono: { scope: app }` |
| `stack/hono/tsconfig.json.hbs` | `@only:turborepo` | `only: mono` |

---

## Task 1: Install gray-matter

**Files:**
- Modify: `apps/cli/package.json`

**Step 1: Install the dependency**

Run: `cd apps/cli && bun add gray-matter`

**Step 2: Verify installation**

Run: `bun --cwd apps/cli -e "const m = require('gray-matter'); console.log(typeof m)"`
Expected: `function`

**Step 3: Commit**

```bash
git add apps/cli/package.json apps/cli/bun.lock
git commit -m "chore: add gray-matter dependency for template frontmatter"
```

---

## Task 2: Update types — AddonMono replaces AddonDestination

**Files:**
- Modify: `apps/cli/src/types/meta.ts`
- Modify: `apps/cli/tests/addon-types.test.ts`

**Step 1: Write the failing tests**

Replace the entire contents of `apps/cli/tests/addon-types.test.ts` with:

```typescript
// ABOUTME: Type tests for unified addon architecture
// ABOUTME: Ensures MetaAddon types enforce correct mono constraints

import { describe, expect, test } from 'bun:test';
import type { AddonMono, AddonSupport, AddonType, MetaAddon, MonoScope, StackName } from '../src/types/meta';

describe('MetaAddon types', () => {
  test('AddonType includes all valid types', () => {
    const types: AddonType[] = ['module', 'orm', 'database', 'extra'];
    expect(types).toHaveLength(4);
  });

  test('MonoScope includes all valid scopes', () => {
    const scopes: MonoScope[] = ['app', 'pkg', 'root'];
    expect(scopes).toHaveLength(3);
  });

  test('AddonMono app scope has no required fields', () => {
    const mono: AddonMono = { scope: 'app' };
    expect(mono.scope).toBe('app');
  });

  test('AddonMono pkg scope requires name', () => {
    const mono: AddonMono = { scope: 'pkg', name: 'ui' };
    expect(mono.scope).toBe('pkg');
    expect(mono.name).toBe('ui');
  });

  test('AddonMono root scope has no required fields', () => {
    const mono: AddonMono = { scope: 'root' };
    expect(mono.scope).toBe('root');
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
      addons: ['postgres', 'mysql'],
    };
    expect(support.addons).toContain('postgres');
  });

  test('MetaAddon with pkg mono has required name', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'shadcn/ui',
      mono: { scope: 'pkg', name: 'ui' },
      packageJson: { dependencies: { 'radix-ui': '^1.4.2' } },
    };
    expect(addon.mono?.scope).toBe('pkg');
    if (addon.mono?.scope === 'pkg') {
      expect(addon.mono.name).toBe('ui');
    }
  });

  test('MetaAddon defaults mono to app when omitted', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'TanStack Query',
      packageJson: { dependencies: { '@tanstack/react-query': '^5.90.0' } },
    };
    expect(addon.mono).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/addon-types.test.ts`
Expected: FAIL — `AddonMono`, `MonoScope` not exported from types/meta.ts

**Step 3: Write minimal implementation**

Replace the contents of `apps/cli/src/types/meta.ts` with:

```typescript
// ABOUTME: Type definitions for META configuration
// ABOUTME: Unified addon system with mono scope for monorepo destination

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type AddonType = 'module' | 'orm' | 'database' | 'extra';
export type RepoType = 'single' | 'turborepo';
export type MonoScope = 'app' | 'pkg' | 'root';

export type AddonMono =
  | { scope: 'app' }
  | { scope: 'pkg'; name: string }
  | { scope: 'root' };

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
  mono?: AddonMono;
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
```

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/addon-types.test.ts`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add apps/cli/src/types/meta.ts apps/cli/tests/addon-types.test.ts
git commit -m "refactor: replace AddonDestination with AddonMono in types"
```

---

## Task 3: Update __meta__.ts — destination → mono

**Files:**
- Modify: `apps/cli/src/__meta__.ts`
- Modify: `apps/cli/tests/meta-addons.test.ts`

**Step 1: Update the META validation tests**

In `apps/cli/tests/meta-addons.test.ts`, replace the `package destinations have required name` test:

```typescript
  test('pkg mono scopes have required name', () => {
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.mono?.scope === 'pkg') {
        expect(addon.mono.name, `${name} pkg mono needs name`).toBeDefined();
      }
    }
  });
```

This replaces the test that currently checks `addon.destination?.target === 'package'`.

**Step 2: Run test to verify it fails**

Run: `bun test --cwd apps/cli tests/meta-addons.test.ts`
Expected: FAIL — META still uses `destination` not `mono`

**Step 3: Update __meta__.ts**

Replace all `destination` fields with `mono`. The key changes:

- `shadcn`: `destination: { target: 'package', name: 'ui' }` → `mono: { scope: 'pkg', name: 'ui' }`
- `better-auth`: `destination: { target: 'package', name: 'auth' }` → `mono: { scope: 'pkg', name: 'auth' }`
- `drizzle`: `destination: { target: 'package', name: 'db', singlePath: 'src/lib/db/' }` → `mono: { scope: 'pkg', name: 'db' }`
- `prisma`: `destination: { target: 'package', name: 'db', singlePath: 'src/lib/db/' }` → `mono: { scope: 'pkg', name: 'db' }`
- `postgres`: `destination: { target: 'root' }` → `mono: { scope: 'root' }`
- `mysql`: `destination: { target: 'root' }` → `mono: { scope: 'root' }`
- `biome`: `destination: { target: 'root' }` → `mono: { scope: 'root' }`
- `husky`: `destination: { target: 'root' }` → `mono: { scope: 'root' }`

Note: `singlePath` is removed from META — it moves to per-file frontmatter in Task 7.

**Step 4: Run test to verify it passes**

Run: `bun test --cwd apps/cli tests/meta-addons.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/tests/meta-addons.test.ts
git commit -m "refactor: replace destination with mono in META addons"
```

---

## Task 4: Create frontmatter parser (replaces magic-comments.ts)

**Files:**
- Create: `apps/cli/src/lib/frontmatter.ts`
- Modify: `apps/cli/tests/magic-comments.test.ts` → rename to `apps/cli/tests/frontmatter.test.ts`

**Step 1: Write the failing tests**

Create `apps/cli/tests/frontmatter.test.ts`:

```typescript
// ABOUTME: Unit tests for template frontmatter parsing
// ABOUTME: Tests YAML frontmatter extraction, validation, and stack suffix detection

import { describe, test, expect } from 'bun:test';
import {
  parseFrontmatter,
  shouldSkipTemplate,
  removeFrontmatter,
  parseStackSuffix,
} from '../src/lib/frontmatter';
import type { TemplateContext } from '../src/types/ctx';

describe('parseFrontmatter', () => {
  test('parses path field', () => {
    const content = '---\npath: src/lib/db/schema.ts\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.path).toBe('src/lib/db/schema.ts');
  });

  test('parses mono.scope field', () => {
    const content = '---\nmono:\n  scope: root\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.mono?.scope).toBe('root');
  });

  test('parses mono.path field', () => {
    const content = '---\nmono:\n  scope: pkg\n  path: src/schema.ts\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.mono?.scope).toBe('pkg');
    expect(result.data.mono?.path).toBe('src/schema.ts');
  });

  test('parses only field', () => {
    const content = '---\nonly: mono\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.only).toBe('mono');
  });

  test('returns empty data for no frontmatter', () => {
    const content = 'just template content';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.content).toBe('just template content');
  });

  test('separates content from frontmatter', () => {
    const content = '---\nonly: mono\n---\ntemplate content here';
    const result = parseFrontmatter(content);
    expect(result.content).toBe('template content here');
  });

  test('handles empty frontmatter', () => {
    const content = '---\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
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

  test('only:mono skips in single repo', () => {
    expect(shouldSkipTemplate('mono', singleCtx)).toBe(true);
    expect(shouldSkipTemplate('mono', turborepoCtx)).toBe(false);
  });

  test('only:single skips in turborepo', () => {
    expect(shouldSkipTemplate('single', turborepoCtx)).toBe(true);
    expect(shouldSkipTemplate('single', singleCtx)).toBe(false);
  });

  test('no only value never skips', () => {
    expect(shouldSkipTemplate(undefined, turborepoCtx)).toBe(false);
    expect(shouldSkipTemplate(undefined, singleCtx)).toBe(false);
  });
});

describe('removeFrontmatter', () => {
  test('removes frontmatter from content', () => {
    const content = '---\nonly: mono\n---\nrest of file';
    expect(removeFrontmatter(content)).toBe('rest of file');
  });

  test('preserves content without frontmatter', () => {
    const content = 'no frontmatter\nrest of file';
    expect(removeFrontmatter(content)).toBe('no frontmatter\nrest of file');
  });

  test('handles empty frontmatter', () => {
    const content = '---\n---\nrest of file';
    expect(removeFrontmatter(content)).toBe('rest of file');
  });
});

describe('parseStackSuffix', () => {
  const validStacks = ['nextjs', 'expo', 'hono', 'tanstack-start'];

  test('detects stack suffix in filename', () => {
    const result = parseStackSuffix('route.ts.nextjs.hbs', validStacks);
    expect(result.stackName).toBe('nextjs');
    expect(result.cleanFilename).toBe('route.ts.hbs');
  });

  test('returns null for no stack suffix', () => {
    const result = parseStackSuffix('page.tsx.hbs', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('page.tsx.hbs');
  });

  test('detects tanstack-start suffix', () => {
    const result = parseStackSuffix('route.ts.tanstack-start.hbs', validStacks);
    expect(result.stackName).toBe('tanstack-start');
    expect(result.cleanFilename).toBe('route.ts.hbs');
  });

  test('does not match partial stack names', () => {
    const result = parseStackSuffix('route.ts.next.hbs', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('route.ts.next.hbs');
  });

  test('errors on unknown stack-like suffix', () => {
    expect(() => parseStackSuffix('route.ts.foobar.hbs', validStacks)).toThrow();
  });

  test('does not confuse dotfiles', () => {
    const result = parseStackSuffix('__env.example.hbs', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('__env.example.hbs');
  });

  test('handles files without .hbs extension', () => {
    const result = parseStackSuffix('icon.png', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('icon.png');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test --cwd apps/cli tests/frontmatter.test.ts`
Expected: FAIL — module `../src/lib/frontmatter` doesn't exist

**Step 3: Implement the frontmatter parser**

Create `apps/cli/src/lib/frontmatter.ts`:

```typescript
// ABOUTME: Parses YAML frontmatter from template files using gray-matter
// ABOUTME: Handles path resolution config, repo filtering, and stack suffix detection

import matter from 'gray-matter';
import type { TemplateContext } from '@/types/ctx';
import type { MonoScope } from '@/types/meta';

export interface TemplateFrontmatter {
  path?: string;
  mono?: {
    scope?: MonoScope;
    path?: string;
  };
  only?: 'mono' | 'single';
}

export interface ParsedTemplate {
  data: TemplateFrontmatter;
  content: string;
}

export interface StackSuffixResult {
  stackName: string | null;
  cleanFilename: string;
}

const KNOWN_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'mjs', 'cjs',
  'css', 'scss', 'html', 'md', 'mdx', 'yaml', 'yml',
  'toml', 'xml', 'svg', 'txt', 'env', 'example',
  'config', 'lock', 'png', 'jpg', 'jpeg', 'gif',
  'webp', 'ico', 'woff', 'woff2', 'ttf', 'eot',
]);

export function parseFrontmatter(rawContent: string): ParsedTemplate {
  const { data, content } = matter(rawContent);

  return {
    data: data as TemplateFrontmatter,
    content,
  };
}

export function shouldSkipTemplate(only: string | undefined, ctx: TemplateContext): boolean {
  if (!only) return false;

  if (only === 'mono') return ctx.repo !== 'turborepo';
  if (only === 'single') return ctx.repo !== 'single';

  return false;
}

export function removeFrontmatter(rawContent: string): string {
  const { content } = matter(rawContent);
  return content;
}

export function parseStackSuffix(filename: string, validStacks: string[]): StackSuffixResult {
  if (!filename.endsWith('.hbs')) {
    return { stackName: null, cleanFilename: filename };
  }

  const withoutHbs = filename.slice(0, -4);
  const lastDotIndex = withoutHbs.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return { stackName: null, cleanFilename: filename };
  }

  const possibleStack = withoutHbs.slice(lastDotIndex + 1);
  const beforeStack = withoutHbs.slice(0, lastDotIndex);

  if (KNOWN_EXTENSIONS.has(possibleStack)) {
    return { stackName: null, cleanFilename: filename };
  }

  if (validStacks.includes(possibleStack)) {
    return { stackName: possibleStack, cleanFilename: `${beforeStack}.hbs` };
  }

  if (!beforeStack.includes('.') || KNOWN_EXTENSIONS.has(beforeStack.split('.').pop() ?? '')) {
    return { stackName: null, cleanFilename: filename };
  }

  throw new Error(
    `Unknown stack suffix "${possibleStack}" in template "${filename}". ` +
    `Valid stacks: ${validStacks.join(', ')}`,
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test --cwd apps/cli tests/frontmatter.test.ts`
Expected: PASS (all tests)

**Step 5: Delete old magic-comments.ts and its tests**

```bash
rm apps/cli/src/lib/magic-comments.ts
rm apps/cli/tests/magic-comments.test.ts
```

**Step 6: Commit**

```bash
git add apps/cli/src/lib/frontmatter.ts apps/cli/tests/frontmatter.test.ts
git add -u apps/cli/src/lib/magic-comments.ts apps/cli/tests/magic-comments.test.ts
git commit -m "refactor: replace magic comments with frontmatter parser"
```

---

## Task 5: Update file-writer — stack suffix in transformFilename

**Files:**
- Modify: `apps/cli/src/lib/file-writer.ts`

**Step 1: Verify current transformFilename behavior**

No changes needed to `file-writer.ts` for now. The `transformFilename` function strips `.hbs` extensions. Stack suffix stripping is handled in the resolver (Task 6), not in the filename transformer, because the resolver needs the raw filename to detect stack suffixes.

This is a no-op task. The resolver will call `parseStackSuffix()` to get `cleanFilename`, then pass that to `transformFilename()`.

**Step 2: Commit (skip — no changes)**

---

## Task 6: Rewrite template-resolver with frontmatter

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts`
- Modify: `apps/cli/tests/template-resolver.test.ts`

This is the largest task. The resolver needs to:
1. Use frontmatter instead of magic comments
2. Handle stack suffix filtering
3. Use `mono` from META instead of `destination`
4. Apply the full resolution algorithm

**Step 1: Write the failing tests**

Replace `apps/cli/tests/template-resolver.test.ts` with:

```typescript
// ABOUTME: Tests for template path resolution with frontmatter
// ABOUTME: Tests destination resolution for all addon types and repo configurations

import { describe, test, expect } from 'bun:test';
import { resolveAddonDestination } from '../src/lib/template-resolver';
import { META } from '../src/__meta__';
import type { TemplateContext } from '../src/types/ctx';
import type { TemplateFrontmatter } from '../src/lib/frontmatter';

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

  describe('mono.scope = pkg (from META)', () => {
    const shadcnAddon = META.addons.shadcn;

    test('turborepo: goes to packages/{name}/', () => {
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, turborepoCtx, 'web', {});
      expect(result).toBe('packages/ui/components/button.tsx');
    });

    test('single: uses file-based path (no frontmatter path)', () => {
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, singleCtx, 'test', {});
      expect(result).toBe('components/button.tsx');
    });

    test('single: uses frontmatter.path when provided', () => {
      const fm: TemplateFrontmatter = { path: 'src/components/ui/button.tsx' };
      const result = resolveAddonDestination('components/button.tsx', shadcnAddon, singleCtx, 'test', fm);
      expect(result).toBe('src/components/ui/button.tsx');
    });

    test('frontmatter mono.scope:app overrides META pkg scope', () => {
      const fm: TemplateFrontmatter = { mono: { scope: 'app' } };
      const result = resolveAddonDestination('components.json', shadcnAddon, turborepoCtx, 'web', fm);
      expect(result).toBe('apps/web/components.json');
    });

    test('frontmatter mono.scope:root overrides META pkg scope', () => {
      const fm: TemplateFrontmatter = { mono: { scope: 'root' } };
      const result = resolveAddonDestination('drizzle.config.ts', META.addons.drizzle, turborepoCtx, 'web', fm);
      expect(result).toBe('drizzle.config.ts');
    });
  });

  describe('mono.scope = root (from META)', () => {
    const biomeAddon = META.addons.biome;

    test('turborepo: goes to root', () => {
      const result = resolveAddonDestination('biome.json', biomeAddon, turborepoCtx, 'web', {});
      expect(result).toBe('biome.json');
    });

    test('single: goes to root', () => {
      const result = resolveAddonDestination('biome.json', biomeAddon, singleCtx, 'test', {});
      expect(result).toBe('biome.json');
    });
  });

  describe('no mono (default = app)', () => {
    const tanstackQueryAddon = META.addons['tanstack-query'];

    test('turborepo: goes to apps/{appName}/', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        turborepoCtx,
        'web',
        {},
      );
      expect(result).toBe('apps/web/providers/query-provider.tsx');
    });

    test('single: goes to root (file-based)', () => {
      const result = resolveAddonDestination(
        'providers/query-provider.tsx',
        tanstackQueryAddon,
        singleCtx,
        'test',
        {},
      );
      expect(result).toBe('providers/query-provider.tsx');
    });
  });

  describe('frontmatter mono.path override', () => {
    test('monorepo uses frontmatter.mono.path instead of file-based', () => {
      const fm: TemplateFrontmatter = { mono: { path: 'src/custom/schema.ts' } };
      const result = resolveAddonDestination('schema.ts', META.addons.drizzle, turborepoCtx, 'web', fm);
      expect(result).toBe('packages/db/src/custom/schema.ts');
    });
  });

  describe('frontmatter path for single repo', () => {
    test('drizzle files use frontmatter.path in single repo', () => {
      const fm: TemplateFrontmatter = { path: 'src/lib/db/schema.ts' };
      const result = resolveAddonDestination('schema.ts', META.addons.drizzle, singleCtx, 'test', fm);
      expect(result).toBe('src/lib/db/schema.ts');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test --cwd apps/cli tests/template-resolver.test.ts`
Expected: FAIL — `resolveAddonDestination` signature changed (now takes `TemplateFrontmatter` instead of `DestType | null`)

**Step 3: Rewrite template-resolver.ts**

Replace `apps/cli/src/lib/template-resolver.ts` with:

```typescript
// ABOUTME: Resolves template files to destination paths
// ABOUTME: Uses frontmatter and META mono config for path resolution

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { isAddonCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import { parseFrontmatter, parseStackSuffix, shouldSkipTemplate } from './frontmatter';
import type { TemplateFrontmatter } from './frontmatter';

const VALID_STACKS = Object.keys(META.stacks);

export function resolveAddonDestination(
  relativePath: string,
  addon: MetaAddon,
  ctx: TemplateContext,
  appName: string,
  frontmatter: TemplateFrontmatter,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  if (!isTurborepo) {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? addon.mono?.scope ?? 'app';
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'root':
      return filePath;

    case 'pkg': {
      const name = addon.mono?.scope === 'pkg' ? addon.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }

    case 'app':
    default:
      return `apps/${appName}/${filePath}`;
  }
}

export function resolveStackDestination(relativePath: string, ctx: TemplateContext, appName: string): string {
  const isTurborepo = ctx.repo === 'turborepo';
  return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
}

function readFrontmatter(source: string): { frontmatter: TemplateFrontmatter; only: string | undefined } {
  try {
    const raw = readFileSync(source, 'utf-8');
    const parsed = parseFrontmatter(raw);
    return { frontmatter: parsed.data, only: parsed.data.only };
  } catch {
    return { frontmatter: {}, only: undefined };
  }
}

function resolveTemplatesForStack(
  stackName: StackName,
  appName: string,
  ctx: TemplateContext,
): TemplateFile[] {
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

function resolveTemplatesForAddon(
  addonName: string,
  appName: string,
  ctx: TemplateContext,
  stackName?: StackName,
): TemplateFile[] {
  const addon = META.addons[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'addons', addonName);
  const files = scanDirectory(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix && stackName && fileSuffix !== stackName) continue;

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);
    const destination = resolveAddonDestination(transformedPath, addon, ctx, appName, frontmatter);

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

    for (const addonName of app.addons) {
      const addon = META.addons[addonName];
      if (addon && isAddonCompatible(addon, app.stackName)) {
        templates.push(...resolveTemplatesForAddon(addonName, app.appName, ctx, app.stackName));
      }
    }
  }

  for (const addonName of ctx.globalAddons) {
    templates.push(...resolveTemplatesForAddon(addonName, ctx.projectName, ctx));
  }

  return templates;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test --cwd apps/cli tests/template-resolver.test.ts`
Expected: PASS (all 10 tests)

**Step 5: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts apps/cli/tests/template-resolver.test.ts
git commit -m "refactor: rewrite template resolver with frontmatter support"
```

---

## Task 7: Update template-processor — frontmatter stripping

**Files:**
- Modify: `apps/cli/src/lib/template-processor.ts`

**Step 1: Update imports and frontmatter removal**

In `apps/cli/src/lib/template-processor.ts`, replace the import of `removeAllMagicComments` with `removeFrontmatter`:

Replace:
```typescript
import { removeAllMagicComments } from './magic-comments';
```
With:
```typescript
import { removeFrontmatter } from './frontmatter';
```

And replace the usage inside `processTemplate`:
```typescript
content = removeAllMagicComments(content);
```
With:
```typescript
content = removeFrontmatter(content);
```

**Step 2: Run all tests**

Run: `bun test --cwd apps/cli`
Expected: No new failures from this change

**Step 3: Commit**

```bash
git add apps/cli/src/lib/template-processor.ts
git commit -m "refactor: use frontmatter removal in template processor"
```

---

## Task 8: Update package-json-generator — destination → mono

**Files:**
- Modify: `apps/cli/src/lib/package-json-generator.ts`
- Test: `apps/cli/tests/package-json-generator.test.ts` (should pass unchanged)

**Step 1: Update hasPackageDestination helper**

In `apps/cli/src/lib/package-json-generator.ts`, rename `hasPackageDestination` to `getPackageName` and update its implementation:

Replace:
```typescript
function hasPackageDestination(addonName: string): string | null {
  const addon = META.addons[addonName];
  if (addon?.destination?.target === 'package') {
    return addon.destination.name;
  }
  return null;
}
```
With:
```typescript
function getPackageName(addonName: string): string | null {
  const addon = META.addons[addonName];
  if (addon?.mono?.scope === 'pkg') {
    return addon.mono.name;
  }
  return null;
}
```

Also update all call sites of `hasPackageDestination` to `getPackageName` (3 occurrences in the same file).

Update `generateAllPackageJsons` where it checks `addon.destination?.target === 'package'`:

Replace:
```typescript
if (addon?.destination?.target === 'package') {
  const pkgName = addon.destination.name;
```
With:
```typescript
if (addon?.mono?.scope === 'pkg') {
  const pkgName = addon.mono.name;
```

Same for the ORM addon check:
Replace:
```typescript
if (ormAddon?.destination?.target === 'package') {
  const pkgName = ormAddon.destination.name;
```
With:
```typescript
if (ormAddon?.mono?.scope === 'pkg') {
  const pkgName = ormAddon.mono.name;
```

And update the condition for extras in turborepo:
Replace:
```typescript
} else if (!isTurborepo || addon.destination?.target === 'root') {
```
With:
```typescript
} else if (!isTurborepo || addon.mono?.scope === 'root') {
```

**Step 2: Run tests**

Run: `bun test --cwd apps/cli tests/package-json-generator.test.ts`
Expected: PASS (all 13 tests unchanged — they test behavior, not implementation details)

**Step 3: Commit**

```bash
git add apps/cli/src/lib/package-json-generator.ts
git commit -m "refactor: use mono instead of destination in package-json-generator"
```

---

## Task 9: Migrate template files — magic comments → frontmatter

**Files:**
- Modify: 13 template files (see migration map above)

**Step 1: Migrate all 13 files**

For each file, replace the magic comment first line with YAML frontmatter.

**`@dest:root` files (5 files):**
Replace `{{!-- @dest:root --}}\n` with:
```yaml
---
mono:
  scope: root
---
```

Files:
- `apps/cli/templates/addons/drizzle/__env.example.hbs`
- `apps/cli/templates/addons/drizzle/drizzle.config.ts.hbs`
- `apps/cli/templates/addons/drizzle/scripts/seed.ts.hbs`
- `apps/cli/templates/addons/prisma/__env.example.hbs`
- `apps/cli/templates/addons/prisma/scripts/seed.ts.hbs`

**`@only:turborepo` files (6 files):**
Replace `{{!-- @only:turborepo --}}\n` with:
```yaml
---
only: mono
---
```

Files:
- `apps/cli/templates/addons/drizzle/tsconfig.json.hbs`
- `apps/cli/templates/addons/better-auth/tsconfig.json.hbs`
- `apps/cli/templates/addons/prisma/tsconfig.json.hbs`
- `apps/cli/templates/addons/shadcn/postcss.config.mjs.hbs`
- `apps/cli/templates/addons/shadcn/tsconfig.json.hbs`
- `apps/cli/templates/stack/hono/tsconfig.json.hbs`

**`@dest:app` files (2 files):**
Replace `{{!-- @dest:app --}}\n` with:
```yaml
---
mono:
  scope: app
---
```

Files:
- `apps/cli/templates/addons/better-auth/src/app/api/auth/[...all]/route.ts.hbs`
- `apps/cli/templates/addons/shadcn/components.json.hbs`

**Step 2: Add `path` frontmatter for drizzle single-repo files**

Drizzle previously used `singlePath: 'src/lib/db/'` in META. Now each file needs its own `path`:

- `apps/cli/templates/addons/drizzle/schema.ts.hbs`:
```yaml
---
path: src/lib/db/schema.ts
---
```

- `apps/cli/templates/addons/drizzle/index.ts.hbs`:
```yaml
---
path: src/lib/db/index.ts
---
```

- `apps/cli/templates/addons/drizzle/types.ts.hbs`:
```yaml
---
path: src/lib/db/types.ts
---
```

- `apps/cli/templates/addons/drizzle/drizzle.config.ts.hbs` (already has `mono.scope: root`):
```yaml
---
path: drizzle.config.ts
mono:
  scope: root
---
```

- `apps/cli/templates/addons/drizzle/__env.example.hbs` (already has `mono.scope: root`):
```yaml
---
path: .env.example
mono:
  scope: root
---
```

- `apps/cli/templates/addons/drizzle/scripts/seed.ts.hbs` (already has `mono.scope: root`):
```yaml
---
path: scripts/seed.ts
mono:
  scope: root
---
```

Do the same for prisma files that need `path` for single-repo placement:

- `apps/cli/templates/addons/prisma/index.ts.hbs`:
```yaml
---
path: src/lib/db/index.ts
---
```

- `apps/cli/templates/addons/prisma/schema.prisma.hbs`:
```yaml
---
path: src/lib/db/schema.prisma
---
```

Note: Check each drizzle and prisma template file. Only add `path` if the file would go to `packages/db/` in monorepo but needs a `src/lib/db/` prefix in single repo. Root-scoped files (drizzle.config.ts, .env.example, seed.ts) don't need `path` since they go to root in both repo types.

**Step 3: Run full test suite**

Run: `bun test --cwd apps/cli`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/cli/templates/
git commit -m "refactor: migrate all templates from magic comments to frontmatter"
```

---

## Task 10: Run integration tests and fix issues

**Files:**
- Possibly: any file that fails

**Step 1: Run the full test suite**

Run: `bun test --cwd apps/cli`
Expected: All tests pass (78+ tests, 0 failures)

**Step 2: If any integration tests fail, debug and fix**

The integration tests (`cli-integration.test.ts`) are the most likely to surface issues because they run the full CLI flow. Pay attention to:

- File paths in generated projects (single vs turborepo)
- Package.json content (workspace references)
- Template rendering (frontmatter should be stripped from output)

**Step 3: Verify no references to old types remain**

Run: `grep -r 'AddonDestination\|destination\.\(target\|singlePath\)\|magic-comments\|removeAllMagicComments\|parseMagicComments' apps/cli/src/ --include='*.ts'`
Expected: No matches

**Step 4: Run biome check**

Run: `bun run --cwd apps/cli ../../node_modules/.bin/biome check --write apps/cli/src apps/cli/tests`
Or from root: `bun run check` (if configured)

**Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix: resolve integration test issues from frontmatter migration"
```

---

## Task 11: Cleanup and final validation

**Files:**
- Modify: `apps/cli/src/lib/handlebars.ts` (no changes expected)
- Delete: confirm `magic-comments.ts` is gone (done in Task 4)

**Step 1: Verify magic-comments.ts is deleted**

Run: `ls apps/cli/src/lib/magic-comments.ts`
Expected: "No such file or directory"

**Step 2: Verify no orphan imports**

Run: `grep -r "magic-comments" apps/cli/src/ --include='*.ts'`
Expected: No matches

**Step 3: Run full test suite one final time**

Run: `bun test --cwd apps/cli`
Expected: All tests pass

**Step 4: Update CLAUDE.md if needed**

If any architectural documentation in `.claude/CLAUDE.md` references magic comments, update it to reference frontmatter. Check for mentions of `@dest:`, `@only:`, `@scope:`, `@repo:`, `magic-comments.ts`.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: cleanup orphan references after frontmatter migration"
```

---

## Summary of changes

| What | Before | After |
|------|--------|-------|
| Template metadata | Magic comments (`{{!-- @dest:root --}}`) | YAML frontmatter (`---\nmono:\n  scope: root\n---`) |
| META addon routing | `destination: { target, name, singlePath }` | `mono: { scope, name }` |
| Single-repo paths | `singlePath` in META (shared for all addon files) | `path` in per-file frontmatter |
| Stack filtering | Not supported per-file | Filename convention: `file.ext.{stack}.hbs` |
| Parser | Custom regex (`magic-comments.ts`) | gray-matter library (`frontmatter.ts`) |
| Type | `AddonDestination` | `AddonMono` + `MonoScope` |
| Repo filter naming | `@only:turborepo` / `@only:single` | `only: mono` / `only: single` |
