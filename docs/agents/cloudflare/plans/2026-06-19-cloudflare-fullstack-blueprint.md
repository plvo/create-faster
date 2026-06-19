# cloudflare-fullstack Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each blueprint authoring task should also follow the project `adding-blueprints` skill.

**Goal:** Ship the `cloudflare-fullstack` blueprint — a turborepo Next.js (OpenNext) web app + Hono cron Worker, with Better Auth + RBAC, an auth-gated `documents` CRUD on D1, and direct-binding R2 file uploads, all running on Cloudflare.

**Architecture:** A new `META.blueprints['cloudflare-fullstack']` entry composes existing building blocks (`d1` + `drizzle` + `cloudflare` + `nextjs`/`hono` + better-auth/trpc/tanstack-query/tanstack-form/shadcn/next-themes). All Cloudflare/D1 structural wiring already exists and is **composed, not rebuilt**. The blueprint adds application templates under `apps/cli/templates/blueprints/cloudflare-fullstack/` (override semantics) plus a few concrete overrides of structural Cloudflare templates to add the R2 binding and cron triggers. **No core algorithm, resolver, generator, flags, or `META.project` option changes.**

**Tech Stack:** TypeScript, Bun, Handlebars templates, Next.js 16 (App Router) + OpenNext, Hono on Workers, Better Auth (admin plugin + access-control), tRPC v11, Drizzle (sqlite dialect on D1), Cloudflare D1 + R2 + Wrangler, Vitest.

## Global Constraints

These apply to **every** task. They are the rules that make this blueprint correct; copied verbatim where exact.

- **Turborepo-only.** The blueprint declares 2 apps (`web`, `cron`) ⇒ always turborepo. No single-repo variant; do not add `only: single` files; `isMono` is always true. Imports use `@repo/*` directly.
- **D1 per-request, never a singleton.** Everywhere the `org-dashboard` blueprint uses the module singleton `auth` (`import { auth } from '@repo/auth/auth'`) or singleton `db`, this blueprint MUST use the per-request factory instead:
  - **Server Components / Route Handlers (web app):** `import { getAuth, getDb } from '@/lib/server'`, then `const auth = await getAuth()` / `const db = await getDb()`. (`src/lib/server.ts` is the merged structural template — already provides `getDb()`/`getAuth()` for d1.)
  - **tRPC procedures:** use `ctx.db` and `ctx.session` (the d1 tRPC context already injects `db` and builds `createAuth(opts.db)`). For permission checks build auth from `ctx.db`: `createAuth(ctx.db).api.userHasPermission(...)`.
  - **Cron Worker (hono app):** `import { createDb } from '@repo/db'`, then `const db = createDb(env.DB)` inside `scheduled(event, env, ctx)`.
- **Blueprint pkg-scoped overrides MUST carry the package name in frontmatter** so they resolve to (and override) the structural destination. Use `mono: { scope: pkg, name: <auth|db|api|ui>, path: <relative> }`. App-scoped overrides use `mono: { scope: app, path: <relative> }` or no frontmatter (default app scope).
- **Handlebars escape gotcha:** JSX containing literal `{{ }}` (e.g. `style={{...}}`, `className={...}` is fine, but `{{ }}` object literals in JSX) must be wrapped in `{{{{raw}}}}...{{{{/raw}}}}` or escaped `\{{`. Client component templates copied from org-dashboard already use `{{{{raw}}}}` blocks — preserve them.
- **Versions (reuse org-dashboard's pinned versions verbatim — do not bump or invent):**
  - root deps: `lucide-react@^0.487.0`, `react-error-boundary@^5.0.0`, `sonner@^2.0.7`, `zod@^4.2.1`
  - ui pkg deps: `@tanstack/react-form@^1.23.7`, `react-dom@^19.2.3`, `vaul@^1.1.2`; devDep `@types/react-dom@^19.2.3`
  - root devDep: `@faker-js/faker@^10.4.0`
- **No `DATABASE_URL` anywhere** (D1-everywhere). D1 connection is the `DB` binding only.
- **Test output must be pristine.** Capture and assert any expected errors; never leave stray error logs in passing tests.
- **HITL:** Tasks 7–10 (application pages/UX) require Pelavo's design review before they are considered done. Mark them complete only after that review.

## Reference sources (read these before editing; they are the verified, in-repo patterns)

| What | Path |
|---|---|
| Structural better-auth (d1 `createAuth` factory) | `apps/cli/templates/libraries/better-auth/src/lib/auth/auth.ts.hbs` |
| Structural drizzle schema (sqlite/d1 better-auth tables) | `apps/cli/templates/project/orm/drizzle/src/schema.ts.hbs` |
| Structural drizzle index (`createDb`) | `apps/cli/templates/project/orm/drizzle/src/index.ts.hbs` |
| Structural d1 server seam (`getDb`/`getAuth`) | `apps/cli/templates/project/deployment/cloudflare/src/lib/server.ts.nextjs.hbs` |
| Structural d1 env (`getEnv`/`Env`) | `apps/cli/templates/project/deployment/cloudflare/src/lib/env.ts.nextjs.hbs` |
| Structural web wrangler (nextjs/OpenNext) | `apps/cli/templates/project/deployment/cloudflare/wrangler.jsonc.nextjs.hbs` |
| Structural cron wrangler (hono) | `apps/cli/templates/project/deployment/cloudflare/wrangler.jsonc.hono.hbs` |
| Structural tRPC init (`protectedProcedure`, d1 ctx) | `apps/cli/templates/libraries/trpc/src/trpc/init.ts.hbs` |
| Structural tRPC root router | `apps/cli/templates/libraries/trpc/src/trpc/routers/_app.ts.hbs` |
| org-dashboard auth + admin plugin | `apps/cli/templates/blueprints/org-dashboard/src/lib/auth/auth.ts.hbs` |
| org-dashboard permissions (ac/roles) | `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs` |
| org-dashboard auth-client | `apps/cli/templates/blueprints/org-dashboard/src/lib/auth/auth-client.ts.hbs` |
| org-dashboard `<Can>` + `usePermission` | `.../org-dashboard/src/components/can.tsx.hbs`, `.../src/hooks/use-permission.ts.hbs` |
| org-dashboard rbac middleware | `.../org-dashboard/src/trpc/middleware/rbac.ts.hbs` |
| org-dashboard contact router (CRUD model) | `.../org-dashboard/src/trpc/routers/contact.ts.hbs` |
| org-dashboard (auth)/(dashboard) layouts | `.../org-dashboard/src/app/(auth)/layout.tsx.hbs`, `.../(dashboard)/layout.tsx.hbs` |
| org-dashboard seed | `.../org-dashboard/scripts/seed.ts.hbs` |
| kodex cron Worker (scheduled + createDb) | `/home/ttecim/.lab/kodex/apps/alerting-cron/src/index.ts` + `wrangler.jsonc` |
| kodex R2 upload route (FormData → STORAGE.put) | `/home/ttecim/.lab/kodex/apps/web/src/app/api/docs/[docId]/assets/route.ts` |

The design spec: `docs/agents/cloudflare/2026-06-19-cloudflare-fullstack-blueprint-design.md`.

---

## Task 1: META blueprint entry + generation skeleton test

**Files:**
- Modify: `apps/cli/src/__meta__.ts` (add `cloudflare-fullstack` to `META.blueprints`)
- Test: `apps/cli/tests/blueprints/cloudflare-fullstack.test.ts` (new)

**Interfaces:**
- Produces: `META.blueprints['cloudflare-fullstack']` consumed by the generic blueprint resolver, flags (`--blueprint`), and interactive mode (all already generic — no code change).

- [ ] **Step 1: Write the failing test** — generation resolves the blueprint to the right composition.

```ts
// apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
import { describe, expect, it } from 'vitest';
import { META } from '@/__meta__';

describe('cloudflare-fullstack blueprint META', () => {
  const bp = META.blueprints['cloudflare-fullstack'];

  it('exists with the cloudflare composition', () => {
    expect(bp).toBeDefined();
    expect(bp.context.project).toEqual({ database: 'd1', orm: 'drizzle', deployment: 'cloudflare' });
    const apps = Object.fromEntries(bp.context.apps.map((a) => [a.appName, a]));
    expect(apps.web.stackName).toBe('nextjs');
    expect(apps.web.libraries).toEqual(
      expect.arrayContaining(['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form']),
    );
    expect(apps.cron.stackName).toBe('hono');
    expect(apps.cron.libraries).toEqual([]);
  });

  it('only adds blueprint-specific extras to packageJson', () => {
    expect(bp.packageJson?.dependencies).toMatchObject({ 'lucide-react': '^0.487.0', sonner: '^2.0.7', zod: '^4.2.1' });
    expect(bp.rootPackageJson?.devDependencies).toMatchObject({ '@faker-js/faker': '^10.4.0' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: FAIL — `bp` is undefined.

- [ ] **Step 3: Add the META entry.** Insert into `META.blueprints` (after `cloudflare-static-site`), mirroring `org-dashboard`'s shape.

```ts
'cloudflare-fullstack': {
  label: 'Cloudflare Fullstack',
  hint: 'Auth + RBAC dashboard with a documents CRUD on D1, R2 uploads, and a cron Worker — all on Cloudflare',
  category: 'Business',
  agentArchitecture: [
    'Fullstack Cloudflare app: a Next.js (OpenNext) web app + a Hono cron Worker (Turborepo),',
    'Better Auth with the admin plugin + access-control (admin/user/manager), tRPC for typed',
    'APIs, TanStack Query for client data, Drizzle on Cloudflare D1, and direct-binding R2',
    'uploads. The cron Worker purges expired documents (D1 rows + R2 objects) on a schedule.',
    '',
    'Per-aspect detail in `docs/agents/`:',
    '- [Auth & RBAC](docs/agents/auth-rbac.md)',
    '- [Data layer (D1 + Drizzle)](docs/agents/data-layer.md)',
    '- [Storage (R2)](docs/agents/storage.md)',
    '- [Cloudflare deploy](docs/agents/cloudflare-deploy.md)',
  ].join('\n'),
  context: {
    apps: [
      {
        appName: 'web',
        stackName: 'nextjs',
        libraries: ['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form'],
      },
      {
        appName: 'cron',
        stackName: 'hono',
        libraries: [],
      },
    ],
    project: {
      database: 'd1',
      orm: 'drizzle',
      deployment: 'cloudflare',
    },
  },
  packageJson: {
    dependencies: {
      'lucide-react': '^0.487.0',
      'react-error-boundary': '^5.0.0',
      sonner: '^2.0.7',
      zod: '^4.2.1',
    },
  },
  pkgPackageJson: {
    ui: {
      dependencies: {
        '@tanstack/react-form': '^1.23.7',
        'react-dom': '^19.2.3',
        vaul: '^1.1.2',
      },
      devDependencies: {
        '@types/react-dom': '^19.2.3',
      },
    },
  },
  rootPackageJson: {
    dependencies: {
      '@repo/auth': '*',
      '@repo/db': '*',
    },
    devDependencies: {
      '@repo/config': '*',
      '@faker-js/faker': '^10.4.0',
    },
    scripts: {
      'db:seed': 'bun --env-file=packages/db/.env scripts/seed.ts',
      start: 'turbo start',
    },
  },
  envs: [
    {
      value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
      monoScope: ['app'],
    },
  ],
},
```

> Note: `local-setup` is intentionally NOT redefined here — the `d1` option's `deploymentPackageJson.cloudflare` already provides a `local-setup` that runs `wrangler ... d1 migrations apply` then `bun run db:seed`. This blueprint only supplies the `db:seed` script that chain calls.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the META still type-checks**

Run: `cd apps/cli && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack META entry"
```

---

## Task 2: Blueprint schema override (sqlite better-auth tables + admin columns + documents)

The structural d1 schema (`schema.ts.hbs`) has the better-auth sqlite tables but **no admin-plugin columns** (`role`/`banned`/`banReason`/`banExpires`) and no `documents` table. Override the schema with a clean sqlite-only version (blueprint context is fixed to d1).

**Files:**
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs`
- Test: extend `apps/cli/tests/blueprints/cloudflare-fullstack.test.ts`

**Interfaces:**
- Produces: `userTable` (with `role`/`banned`/`banReason`/`banExpires`), `documentTable` (`id`, `userId`, `title`, `r2Key`, `size`, `mimeType`, `createdAt`, `updatedAt`, `expiresAt`), better-auth tables — all sqlite dialect, exported from `@repo/db`.

- [ ] **Step 1: Write the failing generation test.** Add to the existing test file a generation assertion (use the repo's generation test harness; mirror an existing blueprint generation test such as `org-dashboard`'s if present, otherwise assert the template file exists and contains the expected tables).

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('ships a sqlite schema with admin columns + documents table', () => {
  const schema = readFileSync(
    join(__dirname, '../../templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs'),
    'utf8',
  );
  expect(schema).toContain("sqliteTable('documents'");
  expect(schema).toContain("role: text('role')");
  expect(schema).toContain("banned: integer('banned'");
  expect(schema).toContain('expiresAt');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write the schema override.** Concrete sqlite (no postgres/mysql conditionals). Frontmatter matches the structural schema destination (`db` pkg).

```handlebars
---
path: src/lib/db/schema.ts
mono:
  scope: pkg
  name: db
  path: src/schema.ts
---
import { relations, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timeColumns = {
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
};

export const userTable = sqliteTable('users', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  avatarUrl: text('avatar_url'),

  role: text('role').notNull().default('user'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp' }),

  phone: text('phone'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  ...timeColumns,
});

export const userTableRelations = relations(userTable, ({ many }) => ({
  accounts: many(userAccountTable),
  sessions: many(userSessionTable),
  documents: many(documentTable),
}));

// https://www.better-auth.com/docs/concepts/database#session
export const userSessionTable = sqliteTable('user_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => userTable.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  ...timeColumns,
});

export const userSessionTableRelations = relations(userSessionTable, ({ one }) => ({
  user: one(userTable, { fields: [userSessionTable.userId], references: [userTable.id] }),
}));

// https://www.better-auth.com/docs/concepts/database#account
export const userAccountTable = sqliteTable('user_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => userTable.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  ...timeColumns,
});

export const userAccountTableRelations = relations(userAccountTable, ({ one }) => ({
  user: one(userTable, { fields: [userAccountTable.userId], references: [userTable.id] }),
}));

// https://www.better-auth.com/docs/concepts/database#verification
export const userVerificationTable = sqliteTable('user_verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ...timeColumns,
});

export const documentTable = sqliteTable('documents', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  userId: text('user_id').notNull().references(() => userTable.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  r2Key: text('r2_key').notNull(),
  size: integer('size').notNull().default(0),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  ...timeColumns,
});

export const documentTableRelations = relations(documentTable, ({ one }) => ({
  owner: one(userTable, { fields: [documentTable.userId], references: [userTable.id] }),
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack d1 schema with admin columns + documents"
```

---

## Task 3: Auth override (createAuth factory + admin plugin), permissions, auth-client

**Files:**
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth/auth.ts.hbs`
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth/permissions.ts.hbs`
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth/auth-client.ts.hbs`

**Interfaces:**
- Consumes: `Database`, better-auth tables from `@repo/db` (Task 2).
- Produces: `createAuth(db: Database)` (admin plugin + ac/roles) and `type Auth` from `@repo/auth/auth`; `ac`, `roles`, `AppRole` from `@repo/auth/permissions`; `authClient` from `@repo/auth/auth-client`. These override the structural better-auth templates.

- [ ] **Step 1: Write `permissions.ts.hbs`** — copy org-dashboard's `packages/auth/src/permissions.ts.hbs` verbatim, then change the resource statement from `contact` to `document`.

```handlebars
---
mono:
  scope: pkg
  name: auth
  path: src/permissions.ts
---
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  document: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

// Single source of truth for what each role may do. `roles` is built from this.
export const roleDefinitions = {
  admin: {
    ...adminAc.statements,
    document: ['create', 'read', 'update', 'delete'],
  },
  user: {
    document: ['create', 'read', 'update', 'delete'],
  },
  manager: {
    document: ['read'],
  },
} as const;

export const roles = {
  admin: ac.newRole(roleDefinitions.admin),
  user: ac.newRole(roleDefinitions.user),
  manager: ac.newRole(roleDefinitions.manager),
};

export type AppRole = keyof typeof roleDefinitions;
```

- [ ] **Step 2: Write `auth.ts.hbs`** — the structural d1 `createAuth(db)` factory (see `templates/libraries/better-auth/src/lib/auth/auth.ts.hbs`) with the admin plugin added. Concrete (turbo-only).

```handlebars
---
mono:
  scope: pkg
  name: auth
  path: src/auth.ts
---
import { type Database, userAccountTable, userSessionTable, userTable, userVerificationTable } from '@repo/db';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { ac, roles } from './permissions';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const isDev = process.env.NODE_ENV === 'development';
const prodHost = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).host : undefined;

export function createAuth(db: Database) {
  return betterAuth({
    baseURL: {
      allowedHosts: [prodHost, ...(isDev ? ['localhost:*', '*.localhost:*'] : [])].filter(Boolean) as string[],
      fallback: process.env.BETTER_AUTH_URL,
      protocol: isDev ? 'http' : 'auto',
    },
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      usePlural: false,
      schema: {
        user: userTable,
        account: userAccountTable,
        session: userSessionTable,
        verification: userVerificationTable,
      },
    }),
    plugins: [admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] }), nextCookies()],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      modelName: 'user',
      fields: { name: 'username', email: 'email', emailVerified: 'emailVerified', image: 'avatarUrl', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
    session: {
      modelName: 'session',
      fields: { userId: 'userId', token: 'token', expiresAt: 'expiresAt', ipAddress: 'ipAddress', userAgent: 'userAgent', createdAt: 'createdAt', updatedAt: 'updatedAt' },
      expiresIn: 15 * DAY,
    },
    account: {
      modelName: 'account',
      fields: { userId: 'userId', accountId: 'accountId', providerId: 'providerId', accessToken: 'accessToken', refreshToken: 'refreshToken', accessTokenExpiresAt: 'accessTokenExpiresAt', refreshTokenExpiresAt: 'refreshTokenExpiresAt', scope: 'scope', idToken: 'idToken', password: 'password', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
    verification: {
      modelName: 'verification',
      fields: { identifier: 'identifier', value: 'value', expiresAt: 'expiresAt', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 3: Write `auth-client.ts.hbs`** — copy org-dashboard's auth-client verbatim (it is db-agnostic). Keep its dual frontmatter.

```handlebars
---
mono:
  scope: pkg
  name: auth
  path: src/auth-client.ts
path: src/lib/auth/auth-client.ts
---
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { Auth } from './auth';
import { ac, roles } from './permissions';

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles }), inferAdditionalFields<Auth>()],
});
```

> Adaptation vs org-dashboard: `inferAdditionalFields<typeof auth>()` → `inferAdditionalFields<Auth>()` because d1 exports the `Auth` type (factory return), not a singleton `auth` value.

- [ ] **Step 4: Add a test** asserting the auth override carries the admin plugin and the d1 factory shape.

```ts
it('auth override uses createAuth factory + admin plugin', () => {
  const auth = readFileSync(
    join(__dirname, '../../templates/blueprints/cloudflare-fullstack/src/lib/auth/auth.ts.hbs'),
    'utf8',
  );
  expect(auth).toContain('export function createAuth(db: Database)');
  expect(auth).toContain("admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] })");
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack auth factory with admin plugin + RBAC"
```

---

## Task 4: tRPC documents router + d1-adapted RBAC middleware + root router

**Files:**
- Create: `.../cloudflare-fullstack/src/trpc/middleware/rbac.ts.hbs`
- Create: `.../cloudflare-fullstack/src/trpc/routers/documents.ts.hbs`
- Create: `.../cloudflare-fullstack/src/trpc/routers/_app.ts.hbs` (override)

**Interfaces:**
- Consumes: `protectedProcedure`, `router` from the structural tRPC init (`ctx.db`, `ctx.session`); `createAuth` from `@repo/auth/auth`; `documentTable` from `@repo/db`; `getEnv` from `@/lib/env` is NOT used here (R2 delete uses the binding via the context — see note).
- Produces: `appRouter` with `documents` + `hello`; `documentsRouter`; `permissionProcedure`/`adminProcedure`.

- [ ] **Step 1: Write `rbac.ts.hbs`** — adapt org-dashboard's middleware to the d1 per-request factory (build auth from `ctx.db`, not a singleton).

```handlebars
---
mono:
  scope: pkg
  name: api
  path: src/middleware/rbac.ts
---
import { createAuth } from '@repo/auth/auth';
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../trpc';

export const adminProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.session.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can access this resource' });
  }
  return opts.next({ ctx: opts.ctx });
});

export const permissionProcedure = (resource: string, action: string) =>
  protectedProcedure.use(async (opts) => {
    const auth = createAuth(opts.ctx.db);
    const result = await auth.api.userHasPermission({
      body: { userId: opts.ctx.session.user.id, permissions: { [resource]: [action] } },
    });
    if (!result.success) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission' });
    }
    return opts.next({ ctx: opts.ctx });
  });
```

> Frontmatter `name: api` — the trpc routers live in the `api` package (see hello/contact routers). The d1 tRPC context already provides `ctx.db` and `ctx.session` (verified in `init.ts.hbs`).

- [ ] **Step 2: Write `documents.ts.hbs`** — model after org-dashboard's contact router, scoped by role. `manager` reads all; `user` reads own; admins implied via `admin` role having all document perms. Deletion removes the R2 object via the `STORAGE` binding obtained from `getEnv()`.

```handlebars
---
mono:
  scope: pkg
  name: api
  path: src/router/documents.ts
---
import { and, desc, documentTable, eq } from '@repo/db';
import { z } from 'zod';
import { router } from '../trpc';
import { permissionProcedure } from '../middleware/rbac';

export const documentsRouter = router({
  list: permissionProcedure('document', 'read').query(async ({ ctx }) => {
    const isPrivileged = ctx.session.user.role === 'admin' || ctx.session.user.role === 'manager';
    return ctx.db
      .select()
      .from(documentTable)
      .where(isPrivileged ? undefined : eq(documentTable.userId, ctx.session.user.id))
      .orderBy(desc(documentTable.createdAt));
  }),

  delete: permissionProcedure('document', 'delete')
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select()
        .from(documentTable)
        .where(
          ctx.session.user.role === 'admin'
            ? eq(documentTable.id, input.id)
            : and(eq(documentTable.id, input.id), eq(documentTable.userId, ctx.session.user.id)),
        )
        .limit(1);
      if (!doc) return { deleted: false };

      const { getEnv } = await import('@/lib/env');
      const { STORAGE } = await getEnv();
      await STORAGE.delete(doc.r2Key);
      await ctx.db.delete(documentTable).where(eq(documentTable.id, doc.id));
      return { deleted: true };
    }),
});
```

> R2 delete pattern (`STORAGE.delete(key)`) mirrors kodex, where object deletion lives in the tRPC mutation (kodex has no standalone DELETE route). `getEnv()` is the structural d1 env seam — Task 5 extends it with `STORAGE`. The dynamic `import('@/lib/env')` keeps the api package free of a hard `server-only` dependency at module load.

- [ ] **Step 3: Write `_app.ts.hbs` override** — register `documents` alongside the kept `hello` router. Match the structural frontmatter.

```handlebars
---
path: src/trpc/routers/_app.ts
mono:
  scope: pkg
  name: api
  path: src/root.ts
---
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { router } from './trpc';
import { documentsRouter } from './router/documents';
import { helloRouter } from './router/hello';

export const appRouter = router({
  hello: helloRouter,
  documents: documentsRouter,
});

export type AppRouter = typeof appRouter;
export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;
```

> The override's mono path is `src/root.ts` and it imports `./trpc`, `./router/documents`, `./router/hello` — exactly the turbo layout the structural `_app.ts.hbs` produces (`isMono` branch). The structural `hello.ts` is kept (not overridden).

- [ ] **Step 4: Add a test** asserting the router + middleware shape.

```ts
it('registers a documents router using d1 per-request auth', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack/src/trpc');
  expect(readFileSync(join(base, 'routers/_app.ts.hbs'), 'utf8')).toContain('documents: documentsRouter');
  expect(readFileSync(join(base, 'middleware/rbac.ts.hbs'), 'utf8')).toContain('createAuth(opts.ctx.db)');
  expect(readFileSync(join(base, 'routers/documents.ts.hbs'), 'utf8')).toContain('STORAGE.delete(doc.r2Key)');
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/trpc apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack documents tRPC router + d1 RBAC middleware"
```

---

## Task 5: R2 binding — web wrangler + env.ts overrides + upload Route Handler

**Files:**
- Create: `.../cloudflare-fullstack/wrangler.jsonc.nextjs.hbs` (override web wrangler)
- Create: `.../cloudflare-fullstack/src/lib/env.ts.nextjs.hbs` (override env seam)
- Create: `.../cloudflare-fullstack/src/app/api/documents/upload/route.ts.hbs` (new)

**Interfaces:**
- Consumes: `getAuth`, `getDb` from `@/lib/server`; `documentTable` from `@repo/db`.
- Produces: `Env` with `DB` + `STORAGE` + auth secrets; `getEnv()` returning them; `POST /api/documents/upload`.

- [ ] **Step 1: Write the web wrangler override.** Concrete (d1 + R2). Stack suffix `.nextjs` routes it to the web app; no frontmatter (default app scope, same as the structural file it overrides).

```handlebars
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "{{appName}}",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-06-12",
  // global_fetch_strictly_public routes fetch() through the public internet so OpenNext asset serving avoids Worker subrequest limits
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "{{appName}}-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "../../packages/db/drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "STORAGE",
      "bucket_name": "{{projectName}}-storage",
      "preview_bucket_name": "{{projectName}}-storage-preview"
    }
  ]
}
```

- [ ] **Step 2: Write the env.ts override.** Concrete `Env` with `DB` + `STORAGE` + better-auth secrets and the matching `getEnv()`.

```handlebars
---
path: src/lib/env.ts
mono:
  scope: app
  path: src/lib/env.ts
---
import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export type Env = {
  DB: D1Database;
  STORAGE: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

export async function getEnv(): Promise<Env> {
  const { env } = await getCloudflareContext({ async: true });
  return {
    DB: env.DB,
    STORAGE: env.STORAGE,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? '',
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? '',
  };
}
```

> The structural d1 `env.ts.nextjs.hbs` is app-scoped at `src/lib/env.ts`; this override matches that destination. `R2Bucket`/`D1Database` are global Workers types (provided by `wrangler types` / `@cloudflare/workers-types` already pulled by the cloudflare deployment).

- [ ] **Step 3: Write the upload Route Handler.** Simplified from the kodex pattern (session + own-document, FormData → arrayBuffer → `STORAGE.put`).

```handlebars
---
path: src/app/api/documents/upload/route.ts
mono:
  scope: app
  path: src/app/api/documents/upload/route.ts
---
import { documentTable } from '@repo/db';
import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getAuth, getDb } from '@/lib/server';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — safe under the 128 MB Worker memory cap

export async function POST(req: Request) {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse('Invalid multipart body', { status: 400 });
  }
  const file = form.get('file');
  const title = (form.get('title') as string | null)?.trim();
  if (!(file instanceof File)) return new NextResponse('Missing file field', { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return new NextResponse(`File too large (${Math.floor(MAX_BYTES / 1024 / 1024)} MB max)`, { status: 413 });
  }

  const { STORAGE } = await getEnv();
  const id = crypto.randomUUID();
  const key = `documents/${session.user.id}/${id}`;
  const contentType = file.type || 'application/octet-stream';
  await STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } });

  const db = await getDb();
  const [doc] = await db
    .insert(documentTable)
    .values({ id, userId: session.user.id, title: title || file.name, r2Key: key, size: file.size, mimeType: contentType })
    .returning();

  return NextResponse.json({ document: doc });
}
```

- [ ] **Step 4: Add a test** asserting the R2 wiring.

```ts
it('adds the R2 STORAGE binding, env field, and upload route', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack');
  expect(readFileSync(join(base, 'wrangler.jsonc.nextjs.hbs'), 'utf8')).toContain('"binding": "STORAGE"');
  expect(readFileSync(join(base, 'src/lib/env.ts.nextjs.hbs'), 'utf8')).toContain('STORAGE: R2Bucket');
  expect(readFileSync(join(base, 'src/app/api/documents/upload/route.ts.hbs'), 'utf8')).toContain('STORAGE.put(key');
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/wrangler.jsonc.nextjs.hbs apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/env.ts.nextjs.hbs apps/cli/templates/blueprints/cloudflare-fullstack/src/app/api apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack R2 binding + upload route"
```

---

## Task 6: Cron Worker — hono index ({ fetch, scheduled }) + cron wrangler override

**Files:**
- Create: `.../cloudflare-fullstack/src/index.ts.hono.hbs` (cron app entrypoint override)
- Create: `.../cloudflare-fullstack/wrangler.jsonc.hono.hbs` (cron wrangler override)

**Interfaces:**
- Consumes: `createDb`, `documentTable`, `lt` (or `lte`)/`isNotNull` from `@repo/db`.
- Produces: a Worker that exposes `GET /health` (fetch) and a `scheduled` handler purging expired documents (D1 rows + R2 objects).

- [ ] **Step 1: Write the cron entrypoint.** Hono for `fetch` (health) + `scheduled` for the purge, building the db per-invocation (`createDb(env.DB)`), mirroring kodex's cron pattern.

```handlebars
---
mono:
  scope: app
  path: src/index.ts
---
import { and, createDb, documentTable, isNotNull, lt } from '@repo/db';
import { Hono } from 'hono';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));

async function purgeExpiredDocuments(env: Env): Promise<number> {
  const db = createDb(env.DB);
  const now = new Date();

  const expired = await db
    .select({ id: documentTable.id, r2Key: documentTable.r2Key })
    .from(documentTable)
    .where(and(isNotNull(documentTable.expiresAt), lt(documentTable.expiresAt, now)));

  for (const doc of expired) {
    try {
      await env.STORAGE.delete(doc.r2Key);
      await db.delete(documentTable).where(eqId(documentTable, doc.id));
    } catch (err) {
      console.error(`[cron] failed to purge document ${doc.id}:`, err);
    }
  }

  console.log(`[cron] purged ${expired.length} expired document(s)`);
  return expired.length;
}

// local helper keeps the import list minimal; `eq` is re-exported from @repo/db
function eqId(table: typeof documentTable, id: string) {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle column typing
  const { eq } = require('@repo/db') as { eq: (...args: any[]) => any };
  return eq(table.id, id);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeExpiredDocuments(env));
  },
};
```

> Simplify the `eqId` helper during implementation by importing `eq` at the top: `import { and, createDb, documentTable, eq, isNotNull, lt } from '@repo/db'` and calling `eq(documentTable.id, doc.id)` directly — the helper above is only to make the dependency explicit. Prefer the direct top-level import. (`eq`, `and`, `lt`, `isNotNull` are all re-exported from `@repo/db` via `export * from 'drizzle-orm'`.)

- [ ] **Step 2: Write the cron wrangler override.** Concrete: DB + STORAGE bindings + `triggers.crons`. Stack suffix `.hono` routes it to the cron app.

```handlebars
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "{{appName}}",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-12",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": {
    "crons": ["0 3 * * *"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "web-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "../../packages/db/drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "STORAGE",
      "bucket_name": "{{projectName}}-storage"
    }
  ]
}
```

> The cron shares the web app's D1 database (`web-db`) and R2 bucket (`{{projectName}}-storage`) — same `database_id`/`bucket_name` the user fills in once. Document this in the agent deploy doc (Task 12). Cron schedule `0 3 * * *` = daily 03:00 UTC.

- [ ] **Step 3: Add a test** asserting the cron wiring.

```ts
it('ships a cron worker with scheduled purge + triggers.crons', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack');
  const idx = readFileSync(join(base, 'src/index.ts.hono.hbs'), 'utf8');
  expect(idx).toContain('async scheduled(');
  expect(idx).toContain('createDb(env.DB)');
  const wr = readFileSync(join(base, 'wrangler.jsonc.hono.hbs'), 'utf8');
  expect(wr).toContain('"crons"');
  expect(wr).toContain('"binding": "STORAGE"');
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/index.ts.hono.hbs apps/cli/templates/blueprints/cloudflare-fullstack/wrangler.jsonc.hono.hbs apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack cron worker (scheduled document purge)"
```

---

## Task 7 (HITL): Auth pages + (auth) layout

**Files:**
- Create: `.../cloudflare-fullstack/src/app/(auth)/layout.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/app/(auth)/login/page.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/app/(auth)/signup/page.tsx.hbs`

**Interfaces:**
- Consumes: `authClient` from `@repo/auth/auth-client`; `getAuth` from `@/lib/server`.

- [ ] **Step 1: Copy the (auth) layout from org-dashboard**, adapting the singleton `auth` to the d1 seam.
  - Source: `.../org-dashboard/src/app/(auth)/layout.tsx.hbs`.
  - Edit: replace `import { auth } from '@repo/auth/auth'` + `auth.api.getSession({ headers: await headers() })` with:
    ```ts
    import { getAuth } from '@/lib/server';
    // ...
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    ```
  - Keep the redirect-if-session and the centering `<main>`.

- [ ] **Step 2: Write `login/page.tsx`** — a client form using `authClient.signIn.email`. Use shadcn `Card`/`Input`/`Button` (from `@repo/ui/components/ui/*`) and `sonner` for errors. If org-dashboard already ships a login page (`.../org-dashboard/src/app/(auth)/login/page.tsx.hbs`), copy it verbatim (it depends only on `authClient`, which is db-agnostic) and adjust the post-login redirect to `/`.

- [ ] **Step 3: Write `signup/page.tsx`** — client form using `authClient.signUp.email` with `{ email, password, name }` (mapped to `username`). Mirror the login page styling. Redirect to `/` on success.

- [ ] **Step 4: Render check.** Generate the project (Task 14 harness) and confirm `/login` and `/signup` render and round-trip against local D1.

- [ ] **Step 5: HITL — request Pelavo's review of the auth UX.** Do not mark complete until reviewed.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/\(auth\)
git commit -m "feat(blueprint): cloudflare-fullstack auth pages"
```

---

## Task 8 (HITL): Dashboard layout, navigation, documents pages, permission gate

**Files:**
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/layout.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/page.tsx.hbs` (documents list + upload)
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/profile/page.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/components/can.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/hooks/use-permission.ts.hbs`
- Create: navigation components under `.../src/components/navigation/` (sidebar + header) OR a simpler header — see Step 2.

**Interfaces:**
- Consumes: `authClient`, `AppRole` from `@repo/auth/*`; tRPC client (`documents.list`, `documents.delete`); `POST /api/documents/upload`.

- [ ] **Step 1: Copy `can.tsx` and `use-permission.ts` from org-dashboard verbatim** (`.../org-dashboard/src/components/can.tsx.hbs`, `.../src/hooks/use-permission.ts.hbs`). They are db-agnostic (depend on `authClient`/`AppRole`). Keep the `{{{{raw}}}}` blocks.

- [ ] **Step 2: Copy the (dashboard) layout from org-dashboard**, adapting auth to the d1 seam (same edit as Task 7 Step 1: `getAuth()` instead of singleton `auth`). If org-dashboard's sidebar/header navigation components are heavy, replace the `<AppSidebar/>`+`<AppHeader/>` with a minimal top `<header>` containing the app name, a theme toggle, a `/profile` link, and a sign-out button (`authClient.signOut`). Keep it simple — this is a starter.

- [ ] **Step 3: Write the documents page (`(dashboard)/page.tsx`)** — a client component that:
  - lists documents via tRPC `documents.list` + TanStack Query;
  - has an upload form (`<input type="file">` + title) POSTing `FormData` to `/api/documents/upload`, then invalidating the list query;
  - each row shows title/size/created and a delete button calling tRPC `documents.delete`;
  - wraps the upload control in `<Can permissions={{`{`}} document: ['create'] {{`}`}}>` and the delete button in `<Can permissions={{`{`}} document: ['delete'] {{`}`}}>`.
  - Use `sonner` toasts for success/error.

  > Handlebars note: the `permissions={{ document: [...] }}` JSX object literal MUST be inside a `{{{{raw}}}}...{{{{/raw}}}}` block (whole component body), exactly like org-dashboard client components.

- [ ] **Step 4: Write `profile/page.tsx`** — shows the current user (`authClient.useSession`) and role; a minimal read-only profile card.

- [ ] **Step 5: Render + flow check** via the Task 14 harness: upload a file (lands in local R2), it appears in the list, delete removes it (D1 + R2).

- [ ] **Step 6: HITL — Pelavo reviews dashboard/documents UX.**

- [ ] **Step 7: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/\(dashboard\) apps/cli/templates/blueprints/cloudflare-fullstack/src/components apps/cli/templates/blueprints/cloudflare-fullstack/src/hooks
git commit -m "feat(blueprint): cloudflare-fullstack dashboard + documents UI"
```

---

## Task 9 (HITL): Admin users page

**Files:**
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/admin/users/page.tsx.hbs`

**Interfaces:**
- Consumes: `authClient.admin.*` (the admin plugin client methods: `listUsers`, `setRole`, `banUser`/`unbanUser`).

- [ ] **Step 1: Write the admin users page** — a client component gated by `<Can permissions={{`{`}} user: ['list'] {{`}`}}>` (admin-only via the access-control statement). It lists users via `authClient.admin.listUsers`, lets an admin change a user's role (admin/user/manager via `authClient.admin.setRole`) and ban/unban. Use shadcn table + select; `sonner` for feedback. Wrap the body in `{{{{raw}}}}`.

- [ ] **Step 2: Also server-gate the route** in the (dashboard) layout or an `admin/layout.tsx` that calls `getAuth()` and `redirect('/')` if `session.user.role !== 'admin'` (defense in depth; the `<Can>` gate is client-only).

- [ ] **Step 3: Render + flow check** — as admin, change a user's role and observe it persist; as non-admin, the route redirects.

- [ ] **Step 4: HITL — Pelavo reviews the admin UX.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/\(dashboard\)/admin
git commit -m "feat(blueprint): cloudflare-fullstack admin users page"
```

---

## Task 10 (HITL): Root layout glue — app-providers, home redirect, theme

**Files:**
- Create: `.../cloudflare-fullstack/src/components/app-providers.tsx.hbs` (if the base providers need overriding — see MEMORY note)
- Create/override as needed: `.../cloudflare-fullstack/src/app/page.tsx.hbs` (redirect `/` → `/login` or `/` dashboard depending on session) and `layout.tsx` only if the structural one needs blueprint changes.

**Interfaces:**
- Consumes: theme provider (`next-themes`), tanstack-query provider, trpc provider — these come from the libraries; the blueprint only composes them.

- [ ] **Step 1: Check whether `app-providers` needs an override.** Per project MEMORY (`nextjs-app-providers-empty-jsx`): the base `AppProviders` breaks with zero providers; with `next-themes` + `tanstack-query` + `trpc` selected there ARE providers, so the structural app-providers should render fine. Only add an override if generation shows an empty-JSX error. If needed, copy the structural app-providers and ensure it wraps children in the theme + query + trpc providers.

- [ ] **Step 2: Home route.** Add `src/app/page.tsx` that server-checks session via `getAuth()` and redirects: signed-in → render a short welcome / link to dashboard; signed-out → `redirect('/login')`. (Or route group `(dashboard)` owns `/` and `(auth)` owns `/login` — decide during HITL.)

- [ ] **Step 3: Render check** — cold load redirects correctly; theme toggle works.

- [ ] **Step 4: HITL — Pelavo reviews the top-level flow.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/page.tsx.hbs apps/cli/templates/blueprints/cloudflare-fullstack/src/components/app-providers.tsx.hbs
git commit -m "feat(blueprint): cloudflare-fullstack root layout glue"
```

---

## Task 11: D1 seed + agent docs

**Files:**
- Create: `.../cloudflare-fullstack/scripts/seed.ts.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/auth-rbac.md.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/data-layer.md.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/storage.md.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/cloudflare-deploy.md.hbs`

**Interfaces:**
- Consumes: `createDb` from `@repo/db`, `createAuth` from `@repo/auth/auth`, faker.

- [ ] **Step 1: Write `seed.ts.hbs`** (root-scoped) — seed against the LOCAL D1 sqlite. Adapt org-dashboard's seed (`.../org-dashboard/scripts/seed.ts.hbs`) which uses better-auth's admin API to create users + assign roles. Key adaptations for D1:
  - Resolve the local D1 sqlite file (newest under `.wrangler/.../miniflare-D1DatabaseObject`) the same way `drizzle.config.ts.hbs` does (`getLocalD1DB()` helper — copy that resolution), then `createDb` over a libsql client pointed at that file. (Run after `wrangler d1 migrations apply DB --local`, which `local-setup` already chains.)
  - Create an admin user, a manager, and a user via `createAuth(db).api.signUpEmail` + set roles (`role` column / admin plugin `setRole`).
  - Insert a few `documentTable` rows (faker titles, `r2Key` placeholders, some with `expiresAt` in the past to demo the cron purge).
  - Remove the `#!/usr/bin/env bun` shebang per issue #145 (run via `bun --env-file`).
  - Frontmatter: `mono: { scope: root }`.

  > If the local-D1 seed resolution proves fiddly, fall back to seeding through `wrangler d1 execute web-db --local --file=...` generated SQL. Prefer the `createDb` approach for parity with org-dashboard.

- [ ] **Step 2: Write the 4 agent docs.** Each is a `.md.hbs` with frontmatter `path: docs/agents/<name>.md` + `mono: { scope: root, path: docs/agents/<name>.md }` (mirror `cloudflare-static-site`'s agent docs). Contents:
  - `auth-rbac.md` — admin plugin, the `ac`/`roles` statements (admin/user/manager), `<Can>`/`usePermission`, `permissionProcedure`/`adminProcedure`, how to add a resource/role.
  - `data-layer.md` — D1-everywhere, `createDb(binding)`, web uses `getDb()`/`getAuth()` (per-request), cron uses `createDb(env.DB)`; migrations (`db:generate` + `db:migrate:local|remote`); `local-setup`.
  - `storage.md` — R2 `STORAGE` binding, the upload Route Handler (`STORAGE.put`), delete in the tRPC mutation (`STORAGE.delete`), key scheme `documents/<userId>/<id>`, the 25 MB cap and why (Worker memory).
  - `cloudflare-deploy.md` — `wrangler d1 create web-db` + paste `database_id` into BOTH wrangler.jsonc files; `wrangler r2 bucket create <project>-storage`; secrets via `wrangler secret put BETTER_AUTH_SECRET`; web deploy (`build:cf` + `deploy`/OpenNext) and cron deploy (`wrangler deploy`); `wrangler dev --test-scheduled` to fire the cron locally; build-vs-runtime env split.

- [ ] **Step 3: Add a test** that all four agent docs + seed exist.

```ts
it('ships seed + agent docs', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack');
  for (const f of ['scripts/seed.ts.hbs', 'docs/agents/auth-rbac.md.hbs', 'docs/agents/data-layer.md.hbs', 'docs/agents/storage.md.hbs', 'docs/agents/cloudflare-deploy.md.hbs']) {
    expect(() => readFileSync(join(base, f), 'utf8')).not.toThrow();
  }
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/scripts apps/cli/templates/blueprints/cloudflare-fullstack/docs apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack seed + agent docs"
```

---

## Task 12: End-to-end generation + smoke (turborepo)

**Files:**
- Test: extend `apps/cli/tests/blueprints/cloudflare-fullstack.test.ts` with a full generation test (mirror the existing blueprint generation test pattern in the repo).

- [ ] **Step 1: Write a generation test** that runs the generator for `--blueprint cloudflare-fullstack` into a temp dir and asserts the turborepo layout:
  - `apps/web/wrangler.jsonc` contains `"binding": "DB"` AND `"binding": "STORAGE"`;
  - `apps/cron/wrangler.jsonc` contains `"crons"` + `"binding": "STORAGE"`;
  - `apps/cron/src/index.ts` contains `async scheduled(`;
  - `packages/db/src/schema.ts` contains `documents` table + `role` column;
  - `packages/auth/src/auth.ts` contains `createAuth` + `admin(`;
  - `packages/api/src/root.ts` contains `documents: documentsRouter`;
  - `apps/web/src/app/api/documents/upload/route.ts` exists;
  - no file contains `DATABASE_URL`.

- [ ] **Step 2: Run it**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 3: Manual smoke (record results in the PR).**

```bash
cd /tmp && rm -rf cf-fs-smoke && bunx --bun /home/ttecim/.lab/create-faster/apps/cli/src/index.ts cf-fs-smoke --blueprint cloudflare-fullstack --linter biome --pm bun --git
cd cf-fs-smoke && bun install && bunx tsc --noEmit
# DB + preview:
bun run db:generate && bun run local-setup
# web OpenNext preview (auth + CRUD on local D1):
cd apps/web && bun run preview
# cron scheduled handler:
cd ../cron && bunx wrangler dev --test-scheduled
```
Expected: install + typecheck clean; web preview serves login/dashboard against local D1; uploading a file writes to local R2 and lists it; hitting the cron `__scheduled` endpoint purges expired docs.

- [ ] **Step 4: Run the full CLI test + lint**

Run: `cd apps/cli && bun run vitest run && cd /home/ttecim/.lab/create-faster && bun run check`
Expected: all pass; Biome clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "test(blueprint): cloudflare-fullstack end-to-end generation"
```

---

## Task 13: MDX docs page

**Files:**
- Create: the blueprint docs page under the docs site content dir (follow the `documenting-blueprint` skill and mirror the `cloudflare-static-site` / `org-dashboard` docs page location).

- [ ] **Step 1: Invoke the `documenting-blueprint` skill** and write the MDX page: composition, architecture (web + cron, D1/R2, RBAC), application code tour, CLI usage (`--blueprint cloudflare-fullstack`), extra dependencies, and the deploy/local-setup workflow. Link the four agent docs.

- [ ] **Step 2: Verify** the docs site builds (per the docs app's build command) or at least lints.

- [ ] **Step 3: Commit**

```bash
git add <docs page path>
git commit -m "docs(blueprint): cloudflare-fullstack MDX page"
```

---

## Self-Review (run before handing off)

- **Spec coverage:** every spec section maps to a task — composition (T1), RBAC (T3), documents domain schema/router/route (T2/T4/T5), R2 binding + env override (T5), cron (T6), pages/admin (T7–T10, HITL), seed + agent docs (T11), tests (T1–T12), MDX (T13). ✓
- **Acceptance criteria (#134):** generation + install + OpenNext preview (T12), cron `--test-scheduled` (T6/T12), R2 upload on local binding (T5/T8/T12), interactive + `--blueprint` (T1, generic), design review (HITL gates), MDX docs (T13). ✓
- **Type/name consistency:** `createAuth(db)`, `getAuth()`/`getDb()`, `getEnv()` returning `{ DB, STORAGE, ... }`, `documentTable`/`documentsRouter`, `STORAGE.put`/`STORAGE.delete`, `permissionProcedure('document', …)` — used consistently across T2–T8. ✓
- **No DATABASE_URL** anywhere (asserted T12). ✓
- **Known latent bug #151** (stack-specific addon templates discard frontmatter) is avoided: the `.nextjs`/`.hono` blueprint overrides (`wrangler`, `index.ts`, `env.ts`) rely only on default app scope + stack suffix, never on frontmatter `path`/`mono` for the stack-suffixed files. If any stack-suffixed file needs a non-default path, fix #151 first. ✓
- **#145 (Bun coupling):** the blueprint seed omits the `#!/usr/bin/env bun` shebang. The d1 `local-setup`/`db:migrate` scripts inherited from META still reference `bun run` / `wrangler` — out of scope here, tracked in #145. ✓
