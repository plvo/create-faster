# Prisma v7 Update — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update Prisma from v6 to v7 in create-faster templates, handling all breaking changes (driver adapters, generator config, import paths, prisma.config.ts).

**Architecture:** Update META dependencies, rewrite 3 Prisma templates (schema, index, seed), add 1 new template (prisma.config.ts), add `generated/` to gitignore templates. No cross-reference changes needed — better-auth auth.ts.hbs imports via our index.ts indirection.

**Tech Stack:** Prisma v7, @prisma/adapter-pg, @prisma/adapter-mariadb, Handlebars templates

**Design doc:** `docs/plans/2026-03-05-prisma-v7-design.md`

---

## Task 1: Update META dependencies in `__meta__.ts`

**Files:**
- Modify: `apps/cli/src/__meta__.ts:387-412`

**Step 1: Update the Prisma ORM entry**

Replace the current prisma entry (lines 387-412) with:

```typescript
prisma: {
  label: 'Prisma',
  hint: 'Type-safe ORM with migrations',
  mono: { scope: 'pkg', name: 'db' },
  packageJson: {
    dependencies: {
      '@prisma/adapter-pg': $when({ database: 'postgres' }, '^7.0.0'),
      '@prisma/adapter-mariadb': $when({ database: 'mysql' }, '^7.0.0'),
      mariadb: $when({ database: 'mysql' }, '^3.0.0'),
    },
    devDependencies: {
      '@types/node': '^22',
      prisma: '^7.0.0',
    },
    scripts: {
      'db:generate': 'prisma generate',
      'db:migrate': 'prisma migrate dev',
      'db:push': 'prisma db push',
      'db:studio': 'prisma studio',
      'db:seed': 'bun run scripts/seed.ts',
    },
    types: $when({ repo: 'turborepo' }, './dist/src/index.d.ts'),
    exports: {
      '.': './src/index.ts',
    },
  },
},
```

Changes from current:
- Remove `@prisma/client` from dependencies
- Remove `postinstall: 'prisma generate'` script
- Add `@prisma/adapter-pg: ^7.0.0` ($when postgres)
- Add `@prisma/adapter-mariadb: ^7.0.0` ($when mysql)
- Add `mariadb: ^3.0.0` ($when mysql)
- Update `prisma` devDep from `^6.13.0` to `^7.0.0`

**Step 2: Run unit tests**

Run: `cd apps/cli && bun test tests/unit/`
Expected: All unit tests pass (some may need adjustment if they check specific versions)

**Step 3: Commit**

```bash
git add apps/cli/src/__meta__.ts
git commit -m "feat(meta): update prisma to v7, add driver adapter deps"
```

---

## Task 2: Update `schema.prisma.hbs` template

**Files:**
- Modify: `apps/cli/templates/project/orm/prisma/prisma/schema.prisma.hbs`

**Step 1: Update generator and datasource blocks**

Replace lines 4-19 (generator + datasource blocks) with:

```handlebars
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  {{#if (has "database" "postgres")}}
  provider = "postgresql"
  {{/if}}
  {{#if (has "database" "mysql")}}
  provider = "mysql"
  {{/if}}
}
```

Changes:
- `"prisma-client-js"` -> `"prisma-client"`
- `output` is now always present (not conditional on mono)
- `url = env("DATABASE_URL")` removed (moves to prisma.config.ts)

Models (User, Post, better-auth tables) are unchanged.

**Step 2: Commit**

```bash
git add apps/cli/templates/project/orm/prisma/prisma/schema.prisma.hbs
git commit -m "feat(templates): update prisma schema for v7 generator"
```

---

## Task 3: Rewrite `index.ts.hbs` for driver adapters

**Files:**
- Modify: `apps/cli/templates/project/orm/prisma/index.ts.hbs`

**Step 1: Rewrite the template**

Replace entire content (after frontmatter) with:

```handlebars
---
path: src/lib/db/index.ts
mono:
  path: src/index.ts
---
{{#if (has "database" "postgres")}}
import { PrismaPg } from '@prisma/adapter-pg';
{{/if}}
{{#if (has "database" "mysql")}}
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
{{/if}}
import { PrismaClient } from '{{#if (isMono)}}../generated/prisma{{else}}../../generated/prisma{{/if}}';

{{#if (has "database" "postgres")}}
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
{{/if}}
{{#if (has "database" "mysql")}}
const url = new URL(process.env.DATABASE_URL!);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
});
{{/if}}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '{{#if (isMono)}}../generated/prisma{{else}}../../generated/prisma{{/if}}';

// Type helpers
export type User = Awaited<ReturnType<typeof prisma.user.findUnique>>;
export type Post = Awaited<ReturnType<typeof prisma.post.findUnique>>;

{{#if (hasLibrary "better-auth")}}
// Auth types
export type Session = Awaited<ReturnType<typeof prisma.session.findUnique>>;
export type Account = Awaited<ReturnType<typeof prisma.account.findUnique>>;
export type Verification = Awaited<ReturnType<typeof prisma.verification.findUnique>>;
{{/if}}
```

Key changes:
- Import PrismaClient from generated path (not `@prisma/client`)
- Conditional adapter import + init based on database type
- MySQL: parse `DATABASE_URL` into individual params for `PrismaMariaDb`
- Postgres: use `connectionString` directly with `PrismaPg`
- Singleton pattern preserved
- Re-export from generated path
- `log` option removed from PrismaClient constructor (v7 driver adapters handle this differently)

**Import path rationale:**
- Single repo: schema at `prisma/schema.prisma`, output at `generated/prisma/`, index at `src/lib/db/index.ts` -> relative path is `../../generated/prisma` (up from `src/lib/db/` to root, then into `generated/prisma/`)
- Mono: schema at `packages/db/prisma/schema.prisma`, output at `packages/db/generated/prisma/`, index at `packages/db/src/index.ts` -> relative path is `../generated/prisma` (up from `src/` to `packages/db/`, then into `generated/prisma/`)

**Step 2: Commit**

```bash
git add apps/cli/templates/project/orm/prisma/index.ts.hbs
git commit -m "feat(templates): rewrite prisma index.ts for v7 driver adapters"
```

---

## Task 4: Create `prisma.config.ts.hbs` template

**Files:**
- Create: `apps/cli/templates/project/orm/prisma/prisma.config.ts.hbs`

**Step 1: Create the new template**

```handlebars
---
path: prisma.config.ts
---
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'bun run scripts/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

Frontmatter uses `path: prisma.config.ts` which places it alongside the `prisma/` directory:
- Single repo: project root (next to `prisma/`)
- Mono: `packages/db/prisma.config.ts` (via META `mono.scope: pkg`)

The `env()` helper from `prisma/config` reads `DATABASE_URL` from the environment (including `.env` files). This is used by CLI tools (migrate, push, studio).

**Step 2: Commit**

```bash
git add apps/cli/templates/project/orm/prisma/prisma.config.ts.hbs
git commit -m "feat(templates): add prisma.config.ts template for v7"
```

---

## Task 5: Update `seed.ts.hbs` import

**Files:**
- Modify: `apps/cli/templates/project/orm/prisma/scripts/seed.ts.hbs`

**Step 1: Update the import**

No change needed. The seed script imports `prisma` from `@repo/db` (mono) or `../src/lib/db` (single) — both of which point to our `index.ts` re-export. Since `index.ts` is the one that creates and exports the PrismaClient, the seed script is not affected by the import path change.

(This task exists for verification only — confirm no changes needed after reviewing.)

---

## Task 6: Add `generated/` to gitignore templates

**Files:**
- Modify: `apps/cli/templates/repo/single/__gitignore.hbs`
- Modify: `apps/cli/templates/repo/turborepo/__gitignore.hbs`

**Step 1: Add generated directory to both gitignore templates**

In both files, after the existing "Build Outputs" section (after line ~35), add a Prisma section:

```handlebars
{{#if (has "orm" "prisma")}}
# Prisma
generated
{{/if}}
```

Place it after the "Build Outputs" section and before the "Debug" section.

**Step 2: Commit**

```bash
git add apps/cli/templates/repo/single/__gitignore.hbs apps/cli/templates/repo/turborepo/__gitignore.hbs
git commit -m "feat(templates): add generated/ to gitignore for prisma v7"
```

---

## Task 7: Run unit tests

**Files:**
- Read: `apps/cli/tests/unit/` (various test files)

**Step 1: Run all unit tests**

Run: `cd apps/cli && bun test tests/unit/`
Expected: All tests pass. If any fail due to version assertions or removed `@prisma/client` dep, fix them.

**Step 2: Commit any test fixes**

```bash
git add apps/cli/tests/
git commit -m "test: fix unit tests for prisma v7 changes"
```

(Skip commit if no fixes needed.)

---

## Task 8: Run E2E tests (existing)

**Step 1: Run existing Prisma E2E tests**

Run: `cd apps/cli && bun test tests/e2e/prisma.test.ts`

This runs:
- `nextjs-prisma-postgres`: Single app, Next.js + shadcn + postgres + prisma -> install, type-check, build
- `turbo-prisma-mysql`: Turborepo, Next.js (better-auth, tanstack-query) + Hono + mysql + prisma -> install, type-check, build

Expected: Both suites pass (install, type-check, build all succeed).

**Step 2: Fix any failures**

If type-check or build fails, investigate the generated output and fix templates. Common issues:
- Wrong import paths for generated prisma client
- Missing adapter package in generated package.json
- TypeScript can't find generated types (need to run `prisma generate` first — check if `bun install` triggers it)

Note: Since `postinstall` was removed, the E2E tests may need to run `prisma generate` after install. Check if `bun install` + `prisma generate` is needed before type-check/build. If so, either:
- Add `prisma generate` back as a postinstall, OR
- Update the E2E test setup to run `prisma generate` after install

---

## Task 9: Verify additional combinations

Run these manually to cover the full verification matrix from the design:

**Combination 1: Single + postgres + prisma (no better-auth)**

Already covered by existing E2E test `nextjs-prisma-postgres`.

**Combination 2: Single + mysql + prisma (no better-auth)**

```bash
cd /tmp && bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-single-mysql \
  --app test-single-mysql:nextjs:shadcn \
  --database mysql \
  --orm prisma \
  --no-git \
  --pm bun
cd test-single-mysql && bun install && bunx prisma generate && bun run build
```

**Combination 3: Turborepo + postgres + prisma + better-auth**

```bash
cd /tmp && bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-turbo-pg \
  --app web:nextjs:better-auth,tanstack-query \
  --app api:hono \
  --database postgres \
  --orm prisma \
  --no-git \
  --pm bun
cd test-turbo-pg && bun install && cd packages/db && bunx prisma generate && cd ../.. && bun run build
```

**Combination 4: Turborepo + mysql + prisma + better-auth**

Already covered by existing E2E test `turbo-prisma-mysql`.

Expected: All combinations install, type-check, and build successfully.

**Step 2: Clean up test directories**

```bash
rm -rf /tmp/test-single-mysql /tmp/test-turbo-pg
```

---

## Task 10: Final commit

**Step 1: Run full test suite one more time**

Run: `cd apps/cli && bun test`
Expected: All tests pass.

**Step 2: Review all changes**

Run: `git diff main --stat` to verify only expected files changed.

Expected modified files:
- `apps/cli/src/__meta__.ts`
- `apps/cli/templates/project/orm/prisma/prisma/schema.prisma.hbs`
- `apps/cli/templates/project/orm/prisma/index.ts.hbs`
- `apps/cli/templates/project/orm/prisma/prisma.config.ts.hbs` (new)
- `apps/cli/templates/repo/single/__gitignore.hbs`
- `apps/cli/templates/repo/turborepo/__gitignore.hbs`
- `docs/plans/` (design + plan docs)
- Possibly test files if assertions needed updating
