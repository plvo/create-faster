# Design — `d1` database option (issue #133)

**Date:** 2026-06-17
**Parent:** #126 (Cloudflare ecosystem)
**Branch:** `feat/d1-database`
**Status:** approved, pre-implementation

## Goal

Add Cloudflare D1 (managed SQLite) as a **4th, distinct `database` option** in
`META.project.database`. D1 is the SQLite *dialect* but its access layer, bindings,
and migration tooling are completely different from a local SQLite file. Modeling it
as a variant of `sqlite` produced a dev(file)-vs-prod(binding) "no man's land", so D1
gets its own option, used the same way locally and in prod (**D1-everywhere**).

Patterns are extracted from a production project (Kodex: Next.js + OpenNext + D1 + R2
+ better-auth on Workers), kept generic.

## Scope boundary (critical)

This slice delivers the **D1 foundation only**: the database option, the connection
seam, migrations, and a raw-query end-to-end proof on Next.js **and** Hono. It does
**not** wire better-auth or tRPC onto D1 — those consumers (`auth.ts`, the auth route,
`trpc/init.ts`) are forked in **#134 (cloudflare-fullstack blueprint)**, where they are
actually exercised.

## Key architectural decisions

### Decision 1 — `d1` is special-cased; existing databases are untouched

The current `db` package exports a **module-level singleton** `db` (a lazy proxy that
connects via `DATABASE_URL`). D1 has no `DATABASE_URL`: the connection comes from a
**per-request binding** (`getCloudflareContext().env.DB` on Next.js/OpenNext, `c.env.DB`
on Hono). A module-level singleton cannot represent that.

Two options were considered:

- **(A) Universal `getEnv()`-async convention** for all 4 databases — consumers become
  database-agnostic, but it changes the generated code for postgres/mysql/sqlite (the
  majority, non-Cloudflare case) → regression risk on the common path.
- **(B) Special-case `d1`** — postgres/mysql/sqlite keep the singleton and emit
  byte-identical output to today; all change is confined to the `d1` branch.

**Chosen: (B).** Zero regression on existing combos. The cost (forked consumers) is
deferred to #134 and mitigated by extracting shared config.

### Decision 2 — `getEnv()` is the single connection seam (no `getDb()`)

A composable, typed `getEnv()` groups the D1 binding **and** runtime secrets
(`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, future R2 vars) in one place. Consumers
destructure what they need:

```ts
const { DB } = await getEnv();
const db = createDb(DB);
```

No dedicated `getDb()` helper — `getEnv()` is the only accessor. This mirrors the Kodex
`env.ts` pattern and gives coding agents one canonical place to read the
build-vs-runtime env split.

### Decision 3 — `env.ts` is a composable cloudflare-deployment template, Next.js flavor

`getEnv()` lives in `templates/project/deployment/cloudflare/env.ts.nextjs.hbs`
(app-scoped, generated per Next.js app that uses cloudflare deployment). It imports
`getCloudflareContext` (OpenNext) and `server-only`, so it is **Next.js-specific**. Its
fields are **composed** by Handlebars conditionals from what the project actually has
(D1 now; better-auth secrets when present; R2 later).

Hono has no `getCloudflareContext()` — it reads bindings from `c.env` directly, typed
via the Hono instance bindings. No `env.ts` is generated for Hono.

It is generated only when there is at least one binding/secret to type (not a
`process.env`-only shell).

## What gets built

### 1. META entry — `META.project.database.options.d1`

- `label: 'Cloudflare D1'`, hint describing managed SQLite on Workers.
- No `DATABASE_URL` env (unlike the other three).
- `wrangler` is already a devDependency via the cloudflare deployment option; the d1
  option adds drizzle-kit's d1 needs only if not already covered by the drizzle ORM
  option.
- Reuses the drizzle sqlite dialect (`sqliteTable`) — schema is shared with the generic
  `sqlite` option, no separate schema template.

### 2. Validation (project-scope)

Rule: **`database: d1` ⇒ at least one app has `deployment: cloudflare`.** D1 is
Cloudflare-specific infra (like RDS — not portable). Incompatible with `aws-lambda` /
`sst` / `terraform-aws` / no-deployment.

- Enforced in `flags.ts` `validateContext()` (mirror the existing
  `orm requires database` / `husky requires git` style and error tone).
- Mirrored in the interactive prompts so the option is unavailable / rejected with a
  clear message when no cloudflare app exists.

Both `database` and `deployment` are project-scope (since PR #147 made deployment a
`META.project.deployment` single-select), so this is a clean single-level rule — the
"cross-level open question" from the issue is moot.

### 3. `db` package — `drizzle/src/index.ts.hbs`

Add a `{{#if (has "database" "d1")}}` branch:

```ts
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
export type Database = ReturnType<typeof createDb>;

export * from 'drizzle-orm';
export * from './schema';
export * from './types';
```

postgres/mysql/sqlite keep the existing singleton `db` proxy unchanged (the `{{else}}`).

### 4. `env.ts` — `templates/project/deployment/cloudflare/env.ts.nextjs.hbs`

```ts
import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export type Env = {
  {{#if (has "database" "d1")}}DB: D1Database;{{/if}}
  {{#if (hasLibrary "better-auth")}}
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  {{/if}}
};

export async function getEnv(): Promise<Env> {
  const { env } = await getCloudflareContext({ async: true });
  return {
    {{#if (has "database" "d1")}}DB: env.DB,{{/if}}
    {{#if (hasLibrary "better-auth")}}
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? '',
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? '',
    {{/if}}
  };
}
```

### 5. `wrangler.jsonc` binding injection (nextjs + hono templates)

Add a conditional `d1_databases` block to both
`templates/project/deployment/cloudflare/wrangler.jsonc.{nextjs,hono}.hbs`:

```jsonc
{{#if (has "database" "d1")}}
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "{{#if (isMono)}}{{appName}}{{else}}{{projectName}}{{/if}}-db",
    "database_id": "REPLACE_WITH_D1_DATABASE_ID",
    "migrations_dir": "drizzle"
  }
],
{{/if}}
```

(`database_id` placeholder documented in the agent env doc — filled by
`wrangler d1 create`.)

### 6. `drizzle.config.ts.hbs` — d1 branch

```ts
dialect: 'sqlite',
// prod: drizzle-kit talks to remote D1 over HTTP
...(isProduction
  ? { driver: 'd1-http', dbCredentials: {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    } }
  : { dbCredentials: { url: getLocalD1DB() ?? '' } }),
```

`getLocalD1DB()` resolves the newest miniflare-persisted D1 sqlite file under
`.wrangler/.../miniflare-D1DatabaseObject` (Kodex helper, generic).

### 7. Scripts (drizzle package.json for d1)

- `db:generate` — `drizzle-kit generate` (SQL only)
- `db:migrate:local` — `wrangler d1 migrations apply <db> --local`
- `db:migrate:remote` — `wrangler d1 migrations apply <db> --remote`
- `local-setup` — create + migrate + seed the local D1 (mirrors Kodex), so a fresh
  clone has a working local DB in one command.

### 8. Env vars (META `envs` for d1)

Declared for the prod `d1-http` path (gitignored `.env`, never committed):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_API_TOKEN`

No `DATABASE_URL`.

### 9. End-to-end proof

A minimal example query through the `DB` binding, on **Next.js** (via `getEnv()`/
`createDb`) and **Hono** (via `c.env.DB`/`createDb`), generated in both repo modes
(single + turborepo). App runs under `wrangler dev` / OpenNext preview against local D1.

### 10. MDX docs

A `d1` database docs page under `apps/www/content/docs/` (mirror the existing database
option pages), documenting the D1-everywhere model, local-setup, and the
`db:migrate:local|remote` workflow.

## Testing (TDD, both repo modes)

- META validation: `--database d1` without a cloudflare app is rejected; with one,
  accepted.
- Resolver/generation: d1 emits `createDb` factory (not the singleton); `env.ts` typed
  with `DB`; `wrangler.jsonc` gains the `d1_databases` binding; `drizzle.config` uses
  the sqlite dialect + d1-http prod branch; no `DATABASE_URL` anywhere.
- Scripts present: `db:migrate:local|remote`, `local-setup`, `db:generate`.
- Negative: incompatible deployments (`aws-lambda`/`sst`) rejected with a clear message.
- Test output must be pristine; expected errors captured and asserted.

## Explicitly out of scope (→ #134)

- better-auth on D1 (`createAuth(db)` factory, `getAuth()`, auth route per-request) and
  the `authConfig` extraction.
- tRPC context on D1.
- Prisma + D1 (deferred — drizzle-only this iteration).
- R2 fields in `env.ts` (future R2 work).
