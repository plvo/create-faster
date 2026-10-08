# Module-level db on Workers through `cloudflare:workers`

Research for [#171](https://github.com/plvo/create-faster/issues/171), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: complete.

## Question

On TanStack Start deployed with `@cloudflare/vite-plugin`, bindings can be imported at module scope (`import { env } from 'cloudflare:workers'`). Can better-auth and tRPC use a module-level Drizzle `db` built from them? Answer separately for D1 and for postgres/mysql through Hyperdrive. Otherwise they stay per-request, like the Next.js D1 wiring (`getDb()` / `getAuth()` in the app's `src/lib/server.ts`).

Cover:

- reuse of I/O objects across requests on Workers;
- connection lifetime for `pg` and `mysql2` behind Hyperdrive;
- whether `betterAuth()` at module level does I/O, timers or randomness at construction;
- what the answer implies for META's `needsSingletonDb`, `serverlessBinding`, `serverlessConsumersWired` and `isSingletonDbSatisfied`.

## Answer

**D1: yes.** A module-level `export const db = drizzle(env.DB, { schema })`, a module-level `export const auth = betterAuth({ database: drizzleAdapter(db, ...) })` and a module-level tRPC router whose context carries that `db` all work on TanStack Start with `@cloudflare/vite-plugin`. The D1 binding is not a request-scoped I/O object: every query goes through the binding's fetcher in the calling request's context. `betterAuth()` does no I/O, sets no timer and draws no randomness at construction. Verified by reading the sources and by running a build under `vite preview` (workerd), including bursts of 30 and 40 concurrent requests.

**Postgres and MySQL through Hyperdrive: no.** A driver client or pool cannot live at module level:

- Cloudflare says so explicitly: "Do not create database clients or connection pools in the global scope."
- Reading `env.HYPERDRIVE.connectionString` or `.host` at global scope throws in local workerd. That is the case for a module bundled by a production build.
- A singleton created lazily during the first request breaks the next ones:
  - `pg` `Pool`: every other request hangs and is cancelled by the runtime;
  - `mysql2` pool: `Cannot perform I/O on behalf of a different request`;
  - `pg` `Pool` with `maxUses: 1`: passes sequential requests, then wedges for good after a burst of 40 concurrent requests.

Both drivers must open a client per request, as the existing `createDb(hyperdrive)` templates already do. A per-request client survived the same 40-request burst for both drivers. better-auth and tRPC therefore stay per-request on Hyperdrive, whatever the stack.

**For META:** the capability model is already correct, and the stack does not change it. `d1` keeps `serverlessConsumersWired: true`. TanStack Start may use the simpler module-level form for D1, and that is a template choice, not a META change. `postgres` and `mysql` keep `serverlessBinding: 'hyperdrive'` without `serverlessConsumersWired`, so `isSingletonDbSatisfied` keeps rejecting better-auth or tRPC with them on Cloudflare until per-request consumers are wired for them. That holds on Next.js and on TanStack Start alike.

## Verified facts

### Workers runtime rules

1. `env` imported from `cloudflare:workers` is readable at module scope, but "Workers do not allow I/O from outside a request context": secrets, variables and stub creation work at top level, calling binding methods (KV, service bindings, Durable Object stub methods) does not. ([Bindings, importing `env` as a global](https://developers.cloudflare.com/workers/runtime-apis/bindings/#importing-env-as-a-global))
2. Global scope forbids more than I/O. workerd throws `Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope.` from `IoContext::current()` when no request is active. ([workerd `io-context.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/io-context.c%2B%2B))
3. `crypto.getRandomValues()` and `crypto.randomUUID()` both go through `IoContext::current()`, so both throw at global scope. ([workerd `crypto.c++`, `Crypto::getRandomValues` and `Crypto::randomUUID`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/crypto.c%2B%2B))
4. I/O objects created in one request's handler cannot be used from another request: `Cannot perform I/O on behalf of a different request. I/O objects (such as streams, request/response bodies, and others) created in the context of one request handler cannot be accessed from a different request's handler.` ([Workers errors](https://developers.cloudflare.com/workers/observability/errors/#cannot-perform-io-on-behalf-of-a-different-request), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#do-not-store-request-scoped-state-in-global-scope))
5. A binding-only redeploy may reuse running isolates, so a client built at global scope from `env` can outlive a changed secret or binding; Cloudflare's recommended approach is "to create a new client instance for each request". ([Bindings, making changes to bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/#making-changes-to-bindings))

### When TanStack Start evaluates application modules

6. `createStartHandler` loads the router entry, the start entry and the plugin adapters with dynamic `import()` the first time a request arrives (`loadEntries()` / `getEntries()` in `@tanstack/start-server-core` `createStartHandler.ts`, read in 1.168.60). The router entry is what pulls in the route tree, the server route handlers and everything they import (`lib/db`, `lib/auth`, the tRPC router).
7. Vite keeps code splitting for this build. It only disables it when the `ssr` environment has `ssr.target === 'webworker'` (Vite 8.3.4 `dist/node/chunks/node.js`), and `@cloudflare/vite-plugin` 1.63.1 sets neither `ssr.target` nor `codeSplitting`. The production build of the experiment below emits `dist/server/index.js`, which calls `import("./assets/router-<hash>.js")`, and the application code (`betterAuth`, `drizzle`, the probes) lives only in that router chunk.
8. **Measured:** in a production build served by `vite preview` (workerd), that lazily imported chunk is still evaluated **as global scope**. A module-level `crypto.getRandomValues()` probe in the router chunk throws `Disallowed operation called within global scope` although the import is triggered from inside the first request. So under a production build, module-level code in a TanStack Start app obeys the global scope rules: no I/O, no timers, no randomness.
9. **Measured:** under `vite dev`, the same probe succeeds: the Vite module runner evaluates modules inside the first request's context. Dev is therefore more permissive than preview and deploy. Code that draws randomness or reads a Hyperdrive property at module level works in dev and fails after build.

### D1

10. `drizzle(client, config)` from `drizzle-orm/d1` only builds a dialect, a session and a database object around the binding. It calls nothing on the binding at construction. (drizzle-orm 0.45.4 `d1/driver.js`)
11. The D1 binding object (`D1Database` in workerd `src/cloudflare/internal/d1-api.ts`) wraps the binding's `Fetcher`. Each `prepare().run()`, `batch()` or `exec()` issues a fetch through that fetcher **when it is called**, so it runs in the calling request's context and carries no state tied to an earlier request. Holding `drizzle(env.DB)` at module level is equivalent to holding `env.DB` itself.
12. **Measured:** a module-level `drizzle(env.DB, { schema })` answers D1 queries from many requests, sequential and in concurrent bursts of 30 and 40, with no cross-request error.

### Hyperdrive with `pg` and `mysql2`

13. Cloudflare's Hyperdrive documentation is explicit: "You should always create database clients inside your request handlers (`fetch`, `queue`, and similar), not in the global scope. [...] Using a driver-level pool (such as `new Pool()` or `createPool()`) in the global script scope will leave you with stale connections that result in failed queries and hard errors." ([Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/#cleaning-up-client-connections))
14. Worker-side connections live for one invocation. Hyperdrive keeps the origin connection pooled: "In a Cloudflare Worker, database client connections within the Worker are only kept alive for the duration of a single invocation. With Hyperdrive, creating a new client on each invocation is fast and recommended." No `client.end()` / `connection.end()` call is needed; the edge connection is cleaned up when the request ends. ([Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/))
15. Hyperdrive pools in transaction mode. One invocation may use several origin connections, and session state set with `SET` does not survive outside a transaction. ([Hyperdrive connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/#pooling-mode))
16. The official driver examples create the client inside `fetch`:
    - `pg` >= 8.16.3: `new Client({ connectionString: env.HYPERDRIVE.connectionString })` ([node-postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/));
    - `mysql2` >= 3.13.0: `createConnection({ host, user, password, database, port, disableEval: true })` ([mysql2](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/mysql2/));
    - Drizzle: same driver setup, then `drizzle(client)` / `drizzle(connection)` inside the handler ([Drizzle with Postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/), [Drizzle with MySQL](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/drizzle-orm/)).
17. In workerd's open-source Hyperdrive binding, `getHost()` and `getConnectionString()` call `registerConnectOverride()`, which calls `IoContext::current()` and draws entropy. Reading those properties therefore throws at global scope. ([workerd `hyperdrive.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/hyperdrive.c%2B%2B)) **Measured:** a module-level `new Pool({ connectionString: env.PG.connectionString })` in the TanStack Start router chunk throws `Disallowed operation called within global scope` under `vite preview`, so every request fails. **Unverified:** whether the production edge binding, which is not this open-source implementation, behaves the same. Fact 13 forbids the pattern either way.
18. **Measured:** with a singleton built lazily on the first request (`pool ??= new Pool(...)`), which is the only way around fact 17:
    - `pg` `Pool`, default options: requests alternate between success and `The Workers runtime canceled this request because it detected that your Worker's code had hung`. The idle client kept from the previous request cannot be used, and the pool discards it after the failure.
    - `mysql2` `createPool`: requests alternate between success and `Cannot perform I/O on behalf of a different request`.
    - `pg` `Pool` with `maxUses: 1`: six sequential requests succeed. A burst of 40 concurrent requests returns 10 successes (the pool's default `max`) and 30 failures, after which **every** later request hangs. The pool never recovers.
19. **Measured, control:** a client created per request (`new Pool({ ..., maxUses: 1 })` per call, as in the current `createDb(hyperdrive)` template; `await createConnection(...)` per call for `mysql2`) returns 80 of 80 successes over two bursts of 40 concurrent requests for each driver.

### better-auth construction (1.7.7)

20. `betterAuth(options)` calls `createBetterAuth(options, init)`, which starts `init(options)` **immediately** and keeps the promise as `authContext`; the handler awaits it per request. (`better-auth/dist/auth/full.mjs`, `auth/base.mjs`) So everything in `init` runs while the module is evaluated, which is global scope after a production build (fact 8).
21. What `init` → `createAuthContext` does (`context/init.mjs`, `context/create-context.mjs`):
    - `getAdapter(options)` calls the `drizzleAdapter(db, ...)` factory, which only builds the adapter.
    - It reads secrets and URLs from `process.env` through `@better-auth/core/env`.
    - It builds cookies, tables and social providers, plus `getTrustedOrigins` / `getTrustedProviders` from options.
    - `createTelemetry` returns a no-op `publish` unless `BETTER_AUTH_TELEMETRY_ENDPOINT` is set (`@better-auth/telemetry`). When telemetry is enabled, it would call `fetch`, which global scope forbids.
    - It runs plugin `init` hooks. `tanstackStartCookies()` declares none (`dist/integrations/tanstack-start.mjs`) and was exercised at global scope without error.
    - It wires `generateId`, `crypto.randomUUID()` and password hashing as functions **called per operation**, never at construction.
22. After `init` resolves, `createBetterAuth` calls `ctx.checkSchema?.()`. For the Drizzle adapter, that check is `findDrizzleSchemaProblems`, a static diff of the Drizzle schema object against the expected auth tables. It sends no database query. (`@better-auth/drizzle-adapter` `dist/index.mjs`, `schema-check-*.mjs`; `@better-auth/core` `db/schema-check.mjs`)
23. No `setTimeout` / `setInterval` sits on the construction path. The timer call sites in `better-auth/dist` are client-side modules, the captcha plugin, and functions called while a request is handled (email verification, account revocation).
24. **Measured:** a module-level `betterAuth({ database: drizzleAdapter(db, { provider: 'sqlite', schema }), emailAndPassword, plugins: [tanstackStartCookies()] })` over the module-level D1 `db` handles sign-up, `get-session` and sign-in under `vite preview`, plus 30 concurrent `get-session` requests, with no global scope error.

### tRPC

25. **Measured:** a module-level `initTRPC.context().create({ transformer: superjson })` router (@trpc/server 11.19.0) is served through `fetchRequestHandler` from a TanStack Start server route. Its `createContext` returns the module-level D1 `db` and the session from the module-level `auth.api.getSession`. It answered single and 40 concurrent requests under `vite preview` and 20 concurrent requests under `vite dev`, signed in and signed out.

## Experiment

The experiment ran in a throwaway project outside the repo, deleted after the run.

**Setup:**

- Stack: TanStack Start 1.168.60 with `@cloudflare/vite-plugin` 1.63.1, `cloudflare({ viteEnvironment: { name: 'ssr' } })`, and `main: "@tanstack/react-start/server-entry"`, as in the [TanStack Start hosting guide](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/hosting.md).
- Tooling: Vite 8.3.4, wrangler 4.149.0, workerd 1.20261006.1, `nodejs_compat`.
- Bindings: one local D1 binding, plus two Hyperdrive bindings whose `localConnectionString` pointed at throwaway `postgres:17` and `mysql:8` containers.
- Libraries: better-auth 1.7.7, drizzle-orm 0.45.4, pg 8.23.1, mysql2 3.24.5, @trpc/server 11.19.0.

**Routes:**

- `/api/probe`: a module-scope probe plus a D1 query through the module-level `db`.
- `/api/auth/$`: the module-level `auth.handler`.
- `/api/trpc/$`: the module-level tRPC router.
- `/api/hyperdrive?client=...`: runs `select 1` through each client variant.

**Build and runtimes:** `vite build`, then `vite preview` (workerd running the production bundle); `vite dev` for the dev comparison.

| Case | `vite preview` (production build) | `vite dev` |
| --- | --- | --- |
| Module evaluation scope (probe) | global scope, randomness throws | inside the first request |
| Module-level `drizzle(env.DB)` | works, 30 and 40 concurrent OK | works |
| Module-level `betterAuth()` on D1 | sign-up, session, sign-in OK, 30 concurrent OK | works |
| Module-level tRPC router with D1 `db` and session | works, 40 concurrent OK | works, 20 concurrent OK |
| Module-level `new Pool({ connectionString: env.PG.connectionString })` | every request fails: `Disallowed operation called within global scope` | not tested |
| Lazy singleton `pg` `Pool` | every other request hangs and is cancelled | not tested |
| Lazy singleton `mysql2` pool | every other request: `Cannot perform I/O on behalf of a different request` | not tested |
| Lazy singleton `pg` `Pool`, `maxUses: 1` | sequential OK; under 40 concurrent, 10 OK and 30 fail, then wedged | not tested |
| Per-request `pg` `Pool`, `maxUses: 1` | 80 of 80 OK in two concurrent bursts | not tested |
| Per-request `mysql2` `createConnection` | 80 of 80 OK in two concurrent bursts | not tested |

Limits of the experiment:

- It ran on local workerd through `vite preview`, not on a deployed Worker. Local workerd enforces the same global scope and cross-request rules as production; the Workers errors page reproduces the cross-request error "in local development".
- Hyperdrive's local mode connects straight to the database instead of going through the edge pooler. Fact 17's global scope failure comes from the open-source binding and is unverified on the edge (see fact 17).

## Inferences

These follow from the facts above but were not tested directly.

- **Next.js on OpenNext is not affected by this answer.** The current Next.js wiring reads bindings through `getCloudflareContext()` per request, and nothing here argues for changing it. Whether a module-level D1 `db` would also work under OpenNext was not tested; it is out of scope.
- **Rotating a secret may not reach a module-level `auth`.** `wrangler secret put` changes bindings without changing code, so warm isolates can be reused (fact 5). A module-level `auth` captured `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` at construction, so it may keep the old values on warm isolates until they are recycled. A per-request `getAuth()` reads them on every request. The same applies to a module-level `drizzle(env.DB)` after a binding-only change of `database_id`. This is a real trade-off of the module-level form, but a rare one. Not measured.
- **The module-level form saves work per request.** It avoids rebuilding the better-auth context (option merging, endpoint table, adapter) on every request. The cost of that rebuild was not measured.
- **Dev passes what preview fails.** Because of facts 8 and 9, a generated TanStack Start + Cloudflare project should be validated with `vite build` + `vite preview`, not only `vite dev`. That matches the acceptance bar already recorded in map #170.
- **A module-level `auth` on Hyperdrive is possible only through indirection.** better-auth's Drizzle adapter takes a `db` instance at construction. The `auth` object could stay module-level if that `db` were a proxy forwarding each call to a per-request client, for example one stored in `AsyncLocalStorage` for the duration of the request. Nothing in the sources forbids this, but it was not built or tested; per-request `createAuth(db)` is the proven path.

## Implications for META

The mechanism in `apps/cli/src/lib/addon-utils.ts`:

```ts
export function isSingletonDbSatisfied(addon, ctx) {
  if (!addon?.serverlessBinding) return true;
  if (addon.serverlessConsumersWired) return true;
  // binding database on a binding-providing deployment:
  // unavailable when a selected library needsSingletonDb
}
```

- **`needsSingletonDb` (better-auth, trpc).** Unchanged. It still describes the default templates: outside binding deployments, both libraries consume a module-singleton `db`.
- **`serverlessBinding`.** Unchanged and accurate for both values:
  - `'hyperdrive'` (postgres, mysql) means a client must be created per request on every stack (facts 13, 17, 18).
  - `'d1'` means the binding is reachable at module scope, but only Workers-native module evaluation (TanStack Start with `@cloudflare/vite-plugin`) can use that directly.
- **`serverlessConsumersWired`.**
  - `d1` keeps `true`. On TanStack Start, the d1 consumers can be wired either per request (mirroring Next.js `getDb()` / `getAuth()`) or module-level from `cloudflare:workers`. Both satisfy the flag, so the choice is template-level, expressed with `{{#if (has "stack" ...)}}` or stack-suffixed files, with no core change.
  - `postgres` and `mysql` must not get `true` until better-auth and tRPC are wired per request for Hyperdrive, on each stack that supports them. The module-level route is closed for them (Answer).
- **`isSingletonDbSatisfied`.** No change is needed. Its inputs are per database, per deployment and per library, and the research shows the stack does not change the answer for any database. Adding a stack dimension (for example "d1 is wired on TanStack Start but not on Next.js") would only become necessary if a future template wired consumers on one stack and not the other. That would call for a generic per-stack form of `serverlessConsumersWired`, never a stack check in core.
- **One coupling for Spec 1.** The drizzle template `project/orm/drizzle/src/index.ts.hbs` already exposes `createDb(d1)` and `createDb(hyperdrive)` factories with no singleton under Cloudflare. If TanStack Start takes the module-level D1 form, either:
  - the db package also exports a module-level `db` built from `cloudflare:workers` when the stack is TanStack Start, so that package becomes stack-aware; or
  - the app builds it, in a TanStack Start counterpart of `src/lib/server.ts`.

  In a Turborepo, `packages/db` is shared by every app. A module-level export that imports `cloudflare:workers` would break a non-Workers consumer of the same package, such as a Node script or a Hono app off Cloudflare. That argues for building the module-level `db` in the app, not in the package.

## Open questions for the grilling ticket

1. For TanStack Start + D1, should better-auth and tRPC use the module-level form (`import { env } from 'cloudflare:workers'`, a `db` and an `auth` built once), or mirror Next.js with per-request `getDb()` / `getAuth()` for consistency across stacks? Trade-offs:
   - module-level is simpler and avoids per-request construction;
   - per-request picks up rotated secrets immediately (see Inferences) and matches the existing Next.js wiring and docs.
2. If module-level, where is it built: in the app (a TanStack Start counterpart of `src/lib/server.ts`) or in the shared `packages/db` / `packages/auth`? The Turborepo concern above argues for the app.
3. Is wiring better-auth and tRPC per request on Hyperdrive (postgres/mysql + Cloudflare) in Spec 1's scope for TanStack Start, or does it stay disabled through `isSingletonDbSatisfied` as it is today on Next.js? If it is in scope, should Next.js gain the same wiring in the same brick, so that `serverlessConsumersWired` can be set on `postgres` and `mysql` for both stacks at once?
4. Should the Hyperdrive driver code follow Cloudflare's current examples (`new Client` + `connect()` per request) instead of the current per-request `new Pool({ maxUses: 1 })`? Both work per request (fact 19); `Client` is what the docs show.

## Sources

Cloudflare documentation:

- [Bindings: importing `env` as a global, making changes to bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [Workers errors: Cannot perform I/O on behalf of a different request](https://developers.cloudflare.com/workers/observability/errors/#cannot-perform-io-on-behalf-of-a-different-request)
- [Workers best practices: do not store request-scoped state in global scope](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#do-not-store-request-scoped-state-in-global-scope)
- [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
- [Hyperdrive connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)
- [Hyperdrive with node-postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)
- [Hyperdrive with mysql2](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/mysql2/)
- [Hyperdrive with Drizzle, Postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/)
- [Hyperdrive with Drizzle, MySQL](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/drizzle-orm/)

workerd source:

- [`src/workerd/io/io-context.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/io-context.c%2B%2B): global scope error and `IoContext::current()`
- [`src/workerd/api/crypto/crypto.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/crypto.c%2B%2B): `getRandomValues`, `randomUUID`
- [`src/workerd/api/hyperdrive.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/hyperdrive.c%2B%2B): `getHost`, `getConnectionString`, `registerConnectOverride`
- [`src/cloudflare/internal/d1-api.ts`](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/d1-api.ts): `D1Database` over a `Fetcher`

TanStack:

- [TanStack Start hosting guide, Cloudflare Workers](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/hosting.md)
- [`@tanstack/start-server-core` `createStartHandler.ts`](https://github.com/TanStack/router/blob/main/packages/start-server-core/src/createStartHandler.ts): `loadEntries()` dynamic imports

Package sources read from the npm tarballs:

- better-auth 1.7.7: `dist/auth/full.mjs`, `dist/auth/base.mjs`, `dist/context/init.mjs`, `dist/context/create-context.mjs`
- @better-auth/core 1.7.7: `dist/env/env-impl.mjs`, `dist/db/schema-check.mjs`
- @better-auth/drizzle-adapter 1.7.7: `dist/index.mjs`
- @better-auth/telemetry 1.7.7: `dist/index.mjs`
- drizzle-orm 0.45.4: `d1/driver.js`
- pg-pool, from pg 8.23.1: `maxUses` handling
- Vite 8.3.4: `codeSplitting` default
- @cloudflare/vite-plugin 1.63.1

Repository context:

- `apps/cli/src/lib/addon-utils.ts` (`isSingletonDbSatisfied`), `apps/cli/src/__meta__.ts`, `apps/cli/src/types/meta.ts`
- `apps/cli/templates/project/deployment/cloudflare/src/lib/server.ts.nextjs.hbs`, `env.ts.nextjs.hbs`
- `apps/cli/templates/libraries/better-auth/src/lib/auth/auth.ts.hbs`
- `apps/cli/templates/project/orm/drizzle/src/index.ts.hbs`
- `docs/agents/superpowers/specs/2026-06-18-postgres-cloudflare-hyperdrive-design.md`
