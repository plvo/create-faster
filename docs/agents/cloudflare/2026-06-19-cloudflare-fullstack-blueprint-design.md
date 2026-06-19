# Design — `cloudflare-fullstack` blueprint (issue #134)

**Date:** 2026-06-19
**Parent:** #126 (Cloudflare ecosystem)
**Branch:** `feat/cloudflare-fullstack-blueprint`
**Status:** approved, pre-implementation

## Goal

Ship `cloudflare-fullstack` — the Cloudflare counterpart of `org-dashboard`, the last
big slice of the Cloudflare ecosystem (#126). A full-stack starter running entirely on
Cloudflare: Next.js (OpenNext) web app + a Hono cron Worker, auth + RBAC, an auth-gated
CRUD domain backed by D1, and direct-binding R2 file uploads. Patterns are extracted
from the production Kodex CRM (Next.js + OpenNext + D1 + R2 + better-auth on Workers),
kept generic.

The differentiator vs `org-dashboard` is **the stack** (D1 / R2 / cron Worker /
OpenNext), not the feature set. RBAC, CRUD, and the admin pattern intentionally mirror
`org-dashboard` so the two blueprints feel like siblings.

## Scope boundary (critical)

The structural Cloudflare wiring already exists and is **composed, not rebuilt**:

- `deployment: cloudflare` (OpenNext for Next.js, plain Wrangler for Hono) — merged.
- `database: d1` + `orm: drizzle`, with `createDb(d1: D1Database)` exported from
  `@repo/db` and the per-request `getDb()` / `getAuth()` seam in
  `src/lib/server.ts` — merged (#150, #153/#155).
- better-auth + tRPC wired per-request on D1 (`serverlessConsumersWired: true`) —
  merged (#153/#155). The blueprint does **not** re-do this wiring.

This blueprint is therefore almost entirely **application-level**: a new META blueprint
entry + blueprint application templates (pages, routers, components, cron handler, agent
docs) + a small number of concrete overrides of structural Cloudflare templates to add
the R2 binding and the cron triggers.

**No changes to core algorithms (resolver, generator, flags parser, prompts) and no new
`META.project` options.** Everything is expressed through the existing blueprint
mechanism (META blueprint entry + `templates/blueprints/cloudflare-fullstack/` with
override semantics).

## Composition

Two apps ⇒ **turborepo** by construction (no single-repo variant exists for a
2-app blueprint).

```
apps/
  web   → nextjs + [shadcn, next-themes, better-auth, trpc, tanstack-query, tanstack-form]
  cron  → hono   (no libraries; entrypoint { fetch, scheduled } + triggers.crons supplied by blueprint)
project: database: d1, orm: drizzle, deployment: cloudflare
```

META blueprint entry (`META.blueprints['cloudflare-fullstack']`), shape mirrored from
`org-dashboard` / `cloudflare-static-site`:

- `label`, `hint`, `category: 'Business'`
- `agentArchitecture`: multi-line summary + links to `docs/agents/*`
- `context.apps`: the two apps above
- `context.project`: `{ database: 'd1', orm: 'drizzle', deployment: 'cloudflare' }`
- `packageJson` (all turbo apps): `lucide-react`, `sonner`, `zod`
- `pkgPackageJson.ui`: `@tanstack/react-form` (+ its peer deps), matching org-dashboard
- `rootPackageJson`: `@faker-js/faker` (dev) + scripts the d1 META does not already
  provide (`db:seed`, `start`). D1 already contributes `db:migrate*` **and**
  `local-setup` via `deploymentPackageJson.cloudflare`, so the blueprint does **not**
  redefine `local-setup` (it only needs `local-setup` to chain `db:seed`, which it does
  already).
- `envs`: app-scoped `NEXT_PUBLIC_APP_URL`. R2 needs no env var (it is a binding; the
  bucket name lives in `wrangler.jsonc`).

`tanstack-form` is added beyond the literal #134 list — needed for the document
create form, and keeps parity with `org-dashboard`.

## Key decisions (resolved against real code)

### Decision A — cron DB access reuses the existing `createDb`, no new factory

`@repo/db` already exports `createDb(d1: D1Database)` (verified at
`apps/cli/templates/project/orm/drizzle/src/index.ts.hbs`). The Next.js side wraps it in
`getDb()` via `getEnv()` / `getCloudflareContext` in `src/lib/server.ts` (which is
`server-only`). The cron is a **plain Hono Worker, not OpenNext** — it cannot use
`server.ts`. Instead, its `scheduled(event, env, ctx)` handler gets bindings directly:

```ts
import { createDb } from '@repo/db';
// inside scheduled():
const db = createDb(env.DB);
```

Zero new connection code, zero core change. Confirmed this is exactly the Kodex
`@repo/db` shape.

### Decision B — R2 upload is a Next.js Route Handler, not tRPC

Confirmed against Kodex production: file uploads go through Next.js **Route Handlers**
(`apps/web/src/app/api/docs/[docId]/assets/route.ts`), not tRPC. The handler reads
`req.formData()`, validates content-type/size, then
`STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } })` with the
R2 binding from `getEnv()`, auth via `getAuth()`, db via `getDb()`. tRPC over JSON would
force base64 (+33% payload, Worker size limits) — wrong tool for binary.

The blueprint ships `apps/web/src/app/api/documents/upload/route.ts` (POST, simplified:
session + ownership check, no Kodex-specific visibility/RBAC-row machinery). tRPC keeps
the metadata CRUD (`documents.list`, `documents.delete`).

The issue text said "upload through tRPC"; this supersedes it based on the production
pattern. (Presigned R2 URLs / `aws4fetch` remain out of scope per #126.)

## What gets built

### 1. META blueprint entry

`META.blueprints['cloudflare-fullstack']` as described under Composition. No new
`META.project` option, no validation changes — `d1` already `require`s
`deployment: cloudflare`, which the blueprint satisfies.

### 2. RBAC (extensible base)

Better Auth **admin plugin + access-control**, roles **admin / user / manager**, mirrored
from `org-dashboard`'s pattern and adapted to the D1 `createAuth(db)` factory shape.
Purpose: a clean starting scaffold the developer extends — not an exhaustive permission
system.

- Blueprint **overrides** `auth.ts` to add the admin plugin + access-control statements
  inside the d1 `createAuth(db)` factory (org-dashboard's auth config adapted from the
  singleton shape to the factory shape).
- Ships `lib/rbac.ts` (role/permission statements), the `<Can>` permission gate
  component, and the dashboard route protection (mirrored from org-dashboard).
- Role semantics on the documents domain: `user` = CRUD own documents; `manager` =
  read all documents; `admin` = manage users (admin panel) + all documents.

### 3. Documents domain

- **Drizzle schema** (sqlite dialect, shared D1 schema): `documents` table —
  `id`, `userId`, `title`, `r2Key`, `size`, `mimeType`, `createdAt`, `expiresAt`.
  Added to the blueprint's schema override alongside the better-auth tables.
- **tRPC** (`@repo/api`): `documents.list` (role-scoped), `documents.delete`; admin
  user-management via the better-auth admin plugin.
- **Route Handler**: `POST /api/documents/upload` (Decision B).
- **Pages**:
  - `(auth)`: `login`, `signup`
  - `(dashboard)`: documents list + upload, `profile`, `admin/users` (admin-gated)

### 4. R2 binding + cron — concrete overrides of structural Cloudflare templates

Because R2 is not (yet) a generic deployment capability, the blueprint ships **concrete**
(non-conditional) versions of these structural files — legitimate blueprint override
semantics, the blueprint's context is fixed:

- `apps/web/wrangler.jsonc` — `d1_databases` (DB) **+** `r2_buckets` (STORAGE).
- `apps/web/src/lib/env.ts` — concrete `Env` with `DB`, `STORAGE`, `BETTER_AUTH_*`,
  and the matching `getEnv()` mapping.
- `apps/cron/wrangler.jsonc` — `d1_databases` (DB) + `r2_buckets` (STORAGE) +
  `triggers.crons`.
- `apps/cron/src/index.ts` — Hono Worker `export default { fetch, scheduled }`.

> Future generalization (out of scope): an `r2` generic binding capability so any
> cloudflare project can opt into R2 declaratively, instead of blueprint overrides.
> Noted, deferred — YAGNI for this slice.

### 5. Cron job

`scheduled` handler: query D1 for `documents` with `expiresAt < now`, delete the
corresponding R2 objects (`env.STORAGE.delete`), then delete the D1 rows. Idempotent,
small, illustrative. Testable via `wrangler dev --test-scheduled`.

### 6. Seed + local-setup

Blueprint `scripts/seed.ts` seeds roles (admin/user/manager), a couple of users, and a
few example documents (faker), mirroring org-dashboard's seed. `local-setup` chains the
D1 local migration (already provided by the d1 META scripts) + seed, so a fresh clone
gets a working local DB in one command.

### 7. Agent docs (`docs/agents/*` in the generated project)

- `auth-rbac.md` — admin plugin, roles, `<Can>`, how to extend.
- `data-layer.md` — D1 + drizzle per-request (`createDb`, `getDb`, cron `env.DB`).
- `storage.md` — R2 `STORAGE` binding, the upload Route Handler, key scheme.
- `cloudflare-deploy.md` — OpenNext web + Hono cron Worker, `wrangler d1 create` /
  `r2 bucket create`, the build-vs-runtime env split, deploy commands.

`agentArchitecture` in META links these.

## Generated-project acceptance (from #134)

- `bunx create-faster t --blueprint cloudflare-fullstack` → `bun install`, local
  setup, OpenNext preview work end-to-end (auth + CRUD on local D1).
- Cron `scheduled` handler testable via `wrangler dev --test-scheduled`.
- R2 upload works against the local binding.
- Blueprint appears in interactive mode and validates via `--blueprint`.
- Design review by Pelavo (HITL) on pages/UX.
- MDX docs page (documenting-blueprint skill).

## Testing (TDD)

- META: blueprint entry resolves; `--blueprint cloudflare-fullstack` validated;
  mutual exclusion with composition flags honored (existing generic behavior).
- Generation (turborepo): web app emits OpenNext wrangler with DB + STORAGE bindings;
  cron app emits wrangler with DB + STORAGE + `triggers.crons` and a `{ fetch, scheduled }`
  entrypoint; `@repo/db` `createDb` consumed by both; auth.ts carries the admin plugin +
  access-control; documents schema/router/route present; agent docs emitted.
- Negative/pristine: no `DATABASE_URL` anywhere (d1-everywhere); test output pristine,
  expected errors captured and asserted.
- Generated project smoke: `bun install` + typecheck of the generated turborepo.

## Explicitly out of scope

- Presigned R2 URLs (`aws4fetch`) — #126 future work.
- Prisma + D1 — drizzle-only this iteration.
- A generic `r2` binding capability — deferred (blueprint overrides for now).
- Custom RBAC beyond the admin/user/manager scaffold — the base is intentionally
  extensible, not exhaustive.
- GitHub Actions CD templates for Cloudflare — #126 future work.
