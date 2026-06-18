# Postgres/MySQL on Cloudflare via Hyperdrive

**Issue:** #148 (build fails on `pg-cloudflare`). Step 1 of 2; consumer wiring (better-auth/tRPC) is #153.

## Problem

A Cloudflare Worker cannot open a raw TCP connection to a normal Postgres/MySQL server, and
Workers forbid reusing an I/O object (a DB connection/pool) across requests. So a generated
**Next.js + Cloudflare + Postgres** (or MySQL) project fails `bun run build:cf` on the
unresolved `pg-cloudflare` module, and even past the build the module-singleton `db` would throw
at runtime.

## Solution — Cloudflare Hyperdrive

Hyperdrive is Cloudflare's pooling proxy in front of a Postgres/MySQL server. The Worker talks to
the `HYPERDRIVE` binding; Hyperdrive talks to the database.

- **Postgres:** `node-postgres` (`pg`) — Cloudflare's recommended driver. Per request:
  `new Pool({ connectionString: env.HYPERDRIVE.connectionString, maxUses: 1 })` →
  `drizzle({ client: pool, schema })`. Build needs the `pg-cloudflare` package (the
  `cloudflare:sockets` transport) installed so esbuild resolves it.
- **MySQL:** `mysql2/promise` `createConnection({ host, user, password, database, port } from
  env.HYPERDRIVE, disableEval: true })` → `drizzle(connection)`. `disableEval: true` is required
  on Workers.

Refs: https://developers.cloudflare.com/hyperdrive/ ·
https://opennext.js.org/cloudflare/howtos/db

## Scope (step 1)

Make **Postgres/MySQL + Cloudflare work for apps without a singleton-db consumer**. Cleanly
disable (with reason, via the #152 disabled-prompt machinery) the **auth/tRPC + Cloudflare**
combos until #153 wires per-request consumers — never generate a broken project.

Connection model is **per-request via the `HYPERDRIVE` binding** (mirrors D1's binding model). The
module-singleton `db` is not exported in binding mode.

## Declarative mechanisms (no hardcoded choice values in core)

1. **`deploymentPackageJson`** — new generic operator on META options, `Record<deployment,
   PackageJsonContribution>`, merged generically by `package-json-generator` when
   `ctx.project.deployment` matches a key (mirrors `stackPackageJson` / `deploymentPath`).
   `postgres` declares `pg-cloudflare` under `cloudflare`.
2. **Singleton-db capability** (mirrors `needsServerRuntime` / `providesServerRuntime`):
   - database option: `serverlessBinding?: 'd1' | 'hyperdrive'` — the db is binding-based
     (per-request, no singleton) on a binding-providing deployment.
   - deployment: `providesDbBindings?: boolean` — `cloudflare: true`.
   - library: `needsSingletonDb?: boolean` — `better-auth`, `trpc`.
   - Generic check `isSingletonDbSatisfied(addon, ctx)` in `addon-utils`: a database option is
     unavailable when it would be binding-based under the chosen deployment
     (`addon.serverlessBinding && deployment.providesDbBindings`) AND a selected library needs a
     singleton db. Wired into `getCategoryOptionUnavailability` and `flags.ts` validation. d1's
     existing better-auth block migrates onto this capability for consistency.

## Templates

- `project/orm/drizzle/src/index.ts.hbs` — add a per-request branch for
  `(and (or (has "database" "postgres") (has "database" "mysql")) (has "deployment" "cloudflare"))`:
  `createDb()` reading `getCloudflareContext().env.HYPERDRIVE`, no singleton. Non-binding branch
  unchanged (byte-identical).
- `project/deployment/cloudflare/src/lib/env.ts.nextjs.hbs` — expose `HYPERDRIVE: Hyperdrive` when
  postgres/mysql.
- `project/deployment/cloudflare/wrangler.jsonc.nextjs.hbs` — add the `hyperdrive` binding array
  (binding `HYPERDRIVE`, `id` placeholder, `localConnectionString` = the local docker URL already
  in `.env.example`, dev-only/non-secret) when postgres/mysql.
- Migrations (`drizzle.config`, `db:migrate`) run in Node against `DATABASE_URL` — unchanged.

## Out of scope (→ #153)

Per-request wiring of `better-auth` (`createAuth(db)` factory) and `tRPC` (injected per-request
context) to unblock the auth/tRPC + Cloudflare combos.

## Acceptance

- `--app web:nextjs --database postgres --orm drizzle --deployment cloudflare` → `bun run
  build:cf` passes; the db connects via Hyperdrive. Same for `--database mysql`. Both repo modes.
- Non-binding databases (postgres/mysql/sqlite off Cloudflare) generate byte-identical output.
- better-auth/tRPC + (postgres|mysql|d1) + cloudflare show disabled-with-reason in interactive
  mode and are rejected by the flags validator.
- MDX/agent docs note Hyperdrive + the build/runtime split.
