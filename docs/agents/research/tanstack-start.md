# TanStack Start parity research

Condensed findings of the TanStack Start parity research: map [#170](https://github.com/plvo/create-faster/issues/170), research tickets [#171](https://github.com/plvo/create-faster/issues/171) to [#178](https://github.com/plvo/create-faster/issues/178), decision tickets [#179](https://github.com/plvo/create-faster/issues/179) to [#186](https://github.com/plvo/create-faster/issues/186).

Every check below is local: build, Nitro `start`, `vite preview` in workerd, a browser. **Nothing was deployed.** Reference versions: `@tanstack/react-start` 1.168.60, Vite 8.3.4 (Rolldown), `nitro` 3.0.260903-beta, `@cloudflare/vite-plugin` 1.63.1, wrangler 4.149.0, React 19.3.0. Repo state read: `main` at `f7d2b0b`.

## 1. Context

- **Goal.** The `tanstack-start` stack reaches parity with `nextjs` for what the two can share: Cloudflare, better-auth and tRPC, SST and terraform-aws, evlog, theme switching, MDX, PostHog, static Cloudflare hosting. Spec 1 is published as an issue with every decision locked, ready for delivery.
- **Runtimes.**
  - Outside Cloudflare: Nitro, shipped in #168. `start` is `node --env-file=.env.start .output/server/index.mjs`; each app gets its own port.
  - Cloudflare: `@cloudflare/vite-plugin`, without Nitro. Rendering defaults to SSR. SPA mode is documented, not offered as an option.
- **Acceptance bar per brick** (no real deploy in CI):
  - Nitro: generate, install, build, typecheck, then `start` serves the page, an asset and the brick's API route.
  - Cloudflare: build, `wrangler deploy --dry-run`, then `vite preview` in workerd serves the page and the API route.
- **Standing rules.** Declarative Choice Logic (`.claude/CLAUDE.md`): core code never branches on a choice value, a missing operator is added generically. `@tanstack/react-start` >= 1.168.60 (1.143.12 to 1.168.59 carry an XSS advisory). One pull request per brick.
- **Out of scope.** pwa on Start (no blueprint uses it); Amplify hosting (not without a real validation deploy); SPA or selective SSR as a CLI option; the unused `@opennextjs/cloudflare` in the cloudflare-fullstack `api` package (#169).
- **Later.** Spec 2 ports the Next.js blueprints to TanStack Start, in a later map opened once Spec 1 is merged.
- **Not yet specified by the map.** How better-auth, tRPC and TanStack Query compose on Start (session in the tRPC context, query client and tRPC proxy in the router context); local persistence of D1 and R2 with `@cloudflare/vite-plugin` in a Turborepo, against today's `{{workspaceRoot}}/.wrangler` convention; the order and blocking edges of Spec 1's delivery tickets.

## 2. Decisions already settled

- `$when` gains a generic negation operator, for example `{ deployment: { not: 'cloudflare' } }`, documented with the other operators.
- better-auth on Start generates the `/api/auth/$` handler route, `tanstackStartCookies()`, the auth client and a `getSession` server function. No generic protected layout.
- AWS: SST is in scope through `sst.aws.TanStackStart` with Nitro's `aws-lambda` preset. terraform-aws covers Start as far as it covers Next.js today.
- Spec 1 also carries an improved root `AGENTS.md`, referenced by `.claude/CLAUDE.md`, and gitignoring `.tanstack/` in generated projects.

## 3. Topics

### 3.1 Database access on Workers (#171, decision #184)

**Answer.** D1: yes. A module-level Drizzle `db` from `import { env } from 'cloudflare:workers'`, a module-level `betterAuth()` over it and a module-level tRPC router all work on Start with `@cloudflare/vite-plugin`, under concurrent bursts. Postgres and MySQL through Hyperdrive: no, a client per request on every stack. META stays as it is.

**Verified facts**
- `env` is readable at module scope, but global scope forbids I/O, timers and randomness: workerd throws `Disallowed operation called within global scope` ([bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/#importing-env-as-a-global), [`io-context.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/io-context.c%2B%2B)). An I/O object from one request cannot be used by another: `Cannot perform I/O on behalf of a different request` ([errors](https://developers.cloudflare.com/workers/observability/errors/#cannot-perform-io-on-behalf-of-a-different-request)).
- The D1 binding wraps a `Fetcher` called at query time, in the calling request's context ([`d1-api.ts`](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/d1-api.ts)). Holding `drizzle(env.DB)` is equivalent to holding `env.DB`. Measured: bursts of 30 and 40 concurrent requests, no error.
- `betterAuth()` 1.7.7 starts `init` at construction but does no I/O, sets no timer and draws no randomness there (telemetry is a no-op unless `BETTER_AUTH_TELEMETRY_ENDPOINT` is set); the Drizzle schema check is a static diff. Measured under `vite preview`: sign-up, session, sign-in, 30 concurrent `get-session`.
- A module-level tRPC router (11.19.0) with the D1 `db` and the session answered 40 concurrent requests.
- Hyperdrive: "Do not create database clients or connection pools in the global scope" ([connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)). Reading `env.HYPERDRIVE.connectionString` at module scope throws in workerd ([`hyperdrive.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/hyperdrive.c%2B%2B)). Lazy singletons, measured: `pg` `Pool` hangs every other request; `mysql2` pool throws the cross-request error; `pg` `Pool` with `maxUses: 1` wedges for good after 40 concurrent requests. Per-request clients: 80 of 80 for both drivers.
- Hyperdrive pools in transaction mode: a `SET` outside a transaction does not persist ([pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)).
- META: `d1` keeps `serverlessConsumersWired: true`; using the module-level form on Start is a template choice. `postgres`/`mysql` stay gated by `isSingletonDbSatisfied` until per-request consumers are wired. The stack does not change the answer for any database.

**Not verified**
- The production edge Hyperdrive binding (only workerd's open-source one was tested).
- That a module-level `auth` keeps an old secret after `wrangler secret put` on a warm isolate (inferred from [binding changes](https://developers.cloudflare.com/workers/runtime-apis/bindings/#making-changes-to-bindings)).
- A module-level `auth` on Hyperdrive through a `db` proxy backed by `AsyncLocalStorage`: possible in theory, not built.
- Whether a module-level D1 `db` would work under OpenNext.

**Pitfalls**
- A production build evaluates Start's lazily imported router chunk **as global scope**; `vite dev` evaluates it inside the first request. Code that draws randomness or reads a Hyperdrive property at module level passes in dev and fails after build.
- In a Turborepo, a module-level `db` importing `cloudflare:workers` inside `packages/db` would break any non-Workers consumer of the package (a Node script, Hono off Cloudflare). Build it in the app.

**Open decisions (#184)**
1. Start + D1: module-level (simpler, no per-request construction) or per-request `getDb()` / `getAuth()` like Next.js (picks up rotated secrets immediately, consistent across stacks)?
2. If module-level: built in the app (a Start counterpart of `src/lib/server.ts`) or in `packages/db` / `packages/auth`?
3. Is per-request better-auth and tRPC wiring on Hyperdrive in Spec 1 for Start? If so, does Next.js get it in the same brick so `serverlessConsumersWired` can be set on `postgres` and `mysql` at once? Or does `isSingletonDbSatisfied` keep disabling it?
4. Does the capability model need a stack dimension? The research says no, unless one stack wires Hyperdrive consumers and the other does not (then a generic per-stack `serverlessConsumersWired`).
5. Hyperdrive drivers: `new Client` + `connect()` per request (Cloudflare's examples) instead of today's per-request `new Pool({ maxUses: 1 })`? Both work.

### 3.2 tRPC (#178, decision #186, depends on #184)

**Answer.** SSR calls go through `unstable_localLink({ router, createContext, transformer: superjson })`, in memory; the browser uses `httpBatchLink`. Both are built per request in `getRouter()` through `createIsomorphicFn`, with a memoized context promise. The superjson `makeQueryClient()` is reused under `setupRouterSsrQueryIntegration`.

**Verified facts** (tRPC 11.19.0, Start 1.168.60)
- `transformer` is **required by the types** once `initTRPC` has one. With it, `localLink` serializes nothing: values cross by reference, rich types intact (even a `Promise`). Without it, outputs are JSON round-tripped and a `Date` becomes a string ([`localLink.ts`](https://github.com/trpc/trpc/blob/main/packages/client/src/links/localLink.ts)). `experimental_localLink` is a deprecated alias.
- `localLink` calls `createContext()` per operation with no argument; the HTTP adapter creates it once per request ([`resolveResponse.ts`](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/http/resolveResponse.ts)).
- Start calls `getRouter()` once per server request, memoized for that request ([`createStartHandler.ts`](https://github.com/TanStack/router/blob/main/packages/start-server-core/src/createStartHandler.ts)), so anything created there is request-scoped. Headers come from `getRequestHeaders()` (`AsyncLocalStorage`).
- `createIsomorphicFn` is replaced by the current environment's branch, then dead code is eliminated, so `appRouter`, `db` and `auth` leave the client bundle (read in the compiler source, not checked in a built bundle).
- `setupRouterSsrQueryIntegration` falls back to the `QueryClient`'s default `serializeData`/`deserializeData`, streamed pending queries included ([`router-ssr-query-core`](https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts)). Dehydration experiment: seroval alone keeps `Date`/`Map`/`Set`/`bigint` but **throws** on `URL` and superjson custom types; with the superjson pair every type survives.
- Errors always arrive as a bare `Error(message)` (`ShallowErrorPlugin`): a `TRPCClientError` loses its class and `data`. Keep the success-or-pending `shouldDehydrateQuery` of `makeQueryClient()`.
- `React.cache` is not usable (Server Components only). The TanStack CLI tRPC add-on does an HTTP loopback without cookies during SSR, so the planned design is not the beaten path.
- Port of the Next.js templates: `init.ts` without `next/headers`; routers and `query-client.ts` unchanged; `server.tsx` replaced by the router integration and loaders; `route.ts` becomes `src/routes/api/trpc/$.ts` (`GET`/`POST` calling `fetchRequestHandler`); `server-only` scoped to Next.js (`$when` on `stack`, or `stackPackageJson`).

**Not verified**
- The full setup was not built. The acceptance run should cover a prefetch awaited inside a `Suspense` boundary (headers resolved late in a stream), a `Date` rendered after hydration, and a client bundle without `appRouter` or the db client.
- Behavior under workerd (`getRequestHeaders()` relies on `AsyncLocalStorage`).

**Pitfalls**
- Memoize the **promise**, not the value, so concurrent loaders share one session lookup.
- The Next.js `server.tsx` does not memoize either: a page prefetching three procedures runs `getSession` three times.

**Open decisions (#186)**
1. What does `trpc` generate on Start: the isomorphic client, the per-request router context `{ queryClient, trpc }`, the `/api/trpc/$` route, loader prefetching, an example route matching Next.js?
2. Must `trpc` on Start **require** `tanstack-query`? Without it there is no SSR cache path, and the official add-on depends on it.
3. Gating of Next-only pieces (`server-only`, `next/headers` in `init.ts`): which helper or suffix? Align the single-repo `init.ts` on the explicit `{ headers }` signature for both stacks, or add `init.ts.tanstack-start.hbs`?
4. Fix the Next.js `server.tsx` context memoization in the same brick, or leave Next.js untouched in Spec 1?
5. Prefetch convention: `ensureQueryData` in the `loader` (blocks navigation) or unawaited `prefetchQuery` plus `useSuspenseQuery` (streams)?
6. Sharing the memoized session with better-auth's `getSession`: a `WeakMap` keyed by `getRequest()` (serves both) or the `getRouter()` closure (tRPC only)?

### 3.3 evlog (#176, decision #183)

**Answer.** evlog works on Start on Workers without Nitro, verified in workerd: a custom `src/server.ts` wraps Start's `handler.fetch` with `withEvlog` from `evlog/workers` and passes the logger as `context.log`. A small local error middleware replaces `evlogErrorHandler`, which silently drops errors outside Nitro.

**Verified facts** (evlog 2.30.1)
- Today: `nitro.config.ts.tanstack-start.hbs` registers `evlog/nitro/v3` (`experimental.asyncContext`), and the root route's middleware wraps `evlogErrorHandler`. No drain, enricher or sampling is generated; events go to the console.
- `withEvlog` wraps the whole Worker `fetch` export: one wide event per request, `routes`/`redact`/`enrich`/`keep`/`plugins`/`drain`, drain flushed through `ctx.waitUntil` after the response, plus `cfRay`, `traceparent`, `colo`, `country`, `asn`. It has no `AsyncLocalStorage` on purpose, so no `useLogger()` and no `log.fork()` ([source](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/workers/index.ts), [docs](https://github.com/evloghq/evlog/blob/main/apps/docs/content/4.integrate/frameworks/12.cloudflare-workers.md)). It requires `wrangler.jsonc` `main: "src/server.ts"`.
- Start's `requestOpts.context` becomes the initial context of request middleware, server routes and server functions, so `context.log` reaches all of them without `AsyncLocalStorage`.
- Keeping `evlogErrorHandler` builds and serves, but errors never reach the wide event: it attaches them through `nitro/context`, an optional import swallowed by a `try/catch`. An `EvlogError` still gets its JSON response (402 in the test), but the event is `level: 'info'` with no `error`.
- A local middleware (`try { return await next() } catch (e) { context.log?.error(e); rethrow an EvlogError as a JSON Response }`) puts errors on the event.
- `useLogger()` through `createLoggerStorage` (`evlog/toolkit/storage`) plus `loggerStorage.run(...)` in `src/server.ts` works (needs `nodejs_compat`).
- Alternative: a global `createStart({ requestMiddleware })` on `evlog/toolkit` (`defineFrameworkIntegration`, marked **beta**) with `waitUntil` from `cloudflare:workers` ([changelog](https://developers.cloudflare.com/changelog/post/2025-08-08-add-waituntil-cloudflare-workers/)). It keeps the default entry but lacks the Cloudflare request fields.
- `evlog/nitro/v3` is a build-time Nitro module: without Nitro nothing runs it. Version floor covered: `withEvlog` 2.23.0, drain `waitUntil` registration 2.27.0, create-faster pins `^2.28.0`.
- Upstream [evloghq/evlog#362](https://github.com/evloghq/evlog/issues/362) (Start + Cloudflare plugin) is open with no answer; create-faster owns this wiring. [#405](https://github.com/evloghq/evlog/issues/405) documents a `createSerializationAdapter` to keep `why`/`fix` across server functions.

**Not verified**
- A real `wrangler deploy`; `log.fork()` through the toolkit; a real drain adapter; interaction with better-auth or tRPC handlers.
- That the Nitro path also misses SSR loader and RPC server function errors (inferred: same middleware).

**Pitfalls**
- SSR loader errors and RPC server function errors never reach request middleware: the event carries only the status (500, or 200 over RPC), no `error`.
- `log.fork()` is unavailable on Nitro ([PR #697](https://github.com/evloghq/evlog/pull/697)) as through `withEvlog`.
- Application code reads the logger differently: `useRequest().context.log` on Nitro, `context.log` (or a local `useLogger()`) on Workers.

**Open decisions (#183)**
1. Is evlog supported on Start + `cloudflare`? If not, which generic META rule disables it with a reason in the prompt (as `getCategoryOptionUnavailability` does)?
2. If yes: `src/server.ts` with `withEvlog` (stable, Cloudflare fields, owns `main`) or a global middleware on the beta toolkit (keeps the default entry)?
3. Expose a project-local `useLogger()` (`AsyncLocalStorage`, `nodejs_compat`) or only `context.log`?
4. Accept that SSR loader and RPC server function errors are missing from the event, or add a server function middleware?
5. Make library templates honour `deploymentSkip`/`deploymentPath` (generic resolver change), or move evlog's Nitro wiring into the stack templates?
6. One error middleware template for both runtimes, or split by `has "deployment" "cloudflare"`?

### 3.4 terraform-aws (#177, decision #185)

**Answer.** The `terraform-aws` deployment provisions **no AWS resource for any stack**: an `infra/` skeleton (AWS provider, S3 backend with native lockfile, `region`/`project_name`/`env` variables, gitignore entries). Start already gets the same skeleton as Next.js, so strict parity is met. Real compute, if wanted, would be Nitro's `aws-lambda` preset as a zip Lambda.

**Verified facts**
- META `terraform-aws` is `label`, `hint`, `mono: { scope: 'root' }`, nothing else: no dependency, script or env. No `{{#each apps}}` or stack test in `infra/`. `diff -r` between a Next.js and a Start project: only the project name differs.
- Real resources (Lambda, API Gateway HTTP API, SQS, EventBridge) exist only in the `lambda-terraform-aws` blueprint, hardcoded for one hono API and two node handlers. `terraform init -backend=false && terraform validate` passes on the skeleton and on the blueprint (Terraform 1.16.1).
- `aws-lambda` preset ([Nitro docs](https://nitro.build/deploy/providers/aws)): `.output/server/index.mjs` exports `handler`; self-contained 1.1 MB server bundle. Local invocation with API Gateway v1 and v2 events: 200 with SSR.
- The preset does **not** serve `.output/public` (assets 404; only `node-server` sets `serveStatic`). `serveStatic: 'inline'` embeds them, binary included (`isBase64Encoded`).
- An `aws-lambda` build breaks `start`: the process exits immediately without listening. The preset must apply only to a deploy build.
- A zip Lambda is enough (50 MB zipped, 250 MB unzipped, [quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)); `.mjs` is ESM and `index.handler` fits ([Node.js handler](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)). `nodejs22.x` is deprecated Apr 30, 2027, `nodejs24.x` on Apr 30, 2028 ([runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)); SST defaults to `nodejs24.x` ([SST `TanStackStart`](https://sst.dev/docs/component/aws/tan-stack-start/)).
- Two shapes: A, one Lambda with `serveStatic: 'inline'` (verified at handler level); B, SSR Lambda + S3 + CloudFront + OAC (the SST shape, no Terraform for it exists in the repo).
- `infra/` templates render once at the root, so per-app compute would use `{{#each apps}}` + `eq stackName` (as `sst.config.ts.hbs` does). Stack-suffixed deployment templates land in `apps/<app>/` in a Turborepo, so they cannot be used for `infra/`.

**Not verified** (needs a real deploy)
- `plan`/`apply`; real API Gateway or function URL events (several `Set-Cookie` for better-auth, `host`/`x-forwarded-*`); cold start and memory at 256 MB; response streaming (`aws-lambda-streaming`, HTTP API v2 support not established); S3 + CloudFront assets; env and secrets delivery (4 KB limit); Lambda Web Adapter.
- That an inline `NAME=value cmd` script runs on Windows under each package manager.

**Pitfalls**
- Buffered responses are capped at 6 MB each: inlined assets suit a starter, not large media.

**Open decisions (#185)**
1. Coverage in Spec 1: same as Next.js (the skeleton, docs only), a reduced scope, or disabled through a generic META rule until a real deploy validates it?
2. If real compute: Next.js too (OpenNext on Lambda is far heavier) or accepted asymmetry? In the generic deployment (`{{#each apps}}` in `infra/main.tf`, which also changes hono and node output) or in a Start blueprint?
3. Assets: shape A (inline) or B (S3 + CloudFront + OAC)?
4. Preset and `start`: a separate deploy script (`NITRO_PRESET=aws-lambda vite build`) or a deployment-conditional `vite.config.ts`, accepting that `start` breaks?
5. Front door: API Gateway HTTP API (the blueprint module) or a function URL (fewer resources, streaming-capable)?
6. Runtime and memory: `nodejs22.x`/256 MB like the blueprint, or `nodejs24.x`/1024 MB like SST?
7. Env and secrets to Lambda: `environment_variables` from tfvars, SSM Parameter Store, Secrets Manager, or left to the user?
8. The `main.tf` docs bug and the blueprint module-format risk (section 5): separate tickets?

### 3.5 PostHog (#174, decision #181)

**Answer.** `PostHogProvider` from `@posthog/react` in the root route's `shellComponent`, plus one splat server route `src/routes/ingest/$.ts` (`ANY`) as the proxy. The same code runs unchanged on Nitro and on Workers. The client token must be `VITE_`-prefixed, which needs a new generic per-stack env operator. No server capture, as on Next.js.

**Verified facts** (Nitro and workerd, real browser, real PostHog with a fake token)
- Next.js today: `instrumentation-client.ts` (`posthog.init`, `api_host: '/ingest'`, `ui_host`, `defaults: '2026-05-30'`, `capture_exceptions`), `/ingest` rewrites in `next.config.ts` (US region hardcoded, `skipTrailingSlashRedirect`), `ingest` excluded from the `proxy.ts` matcher, env `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`. No server capture.
- The provider calls `posthog.init` in a `useEffect`, so it is SSR-safe as is. `defaults: '2026-05-30'` turns on `capture_pageview: 'history_change'`, so client navigations are counted without router wiring ([config](https://posthog.com/docs/libraries/js/config.md)).
- Proxy rules ([proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference.md), [Remix proxy](https://posthog.com/docs/advanced/proxy/remix.md), [Cloudflare proxy](https://posthog.com/docs/advanced/proxy/cloudflare.md)), all verified on the wire:
  - strip the `/ingest` prefix, keep the rest of the path (trailing slash included) and the query string;
  - `/static/*` and `/array/*` go to `https://us-assets.i.posthog.com`, everything else to `https://us.i.posthog.com`;
  - request headers: copy the incoming ones, **delete** `cookie`, `authorization` and `accept-encoding`, **set** `x-forwarded-for` to `cf-connecting-ip` when present, else `getRequestIP({ xForwardedFor: true })` from `@tanstack/react-start/server`;
  - do not set `host`: Node's fetch and workerd both derive it from the target URL;
  - body: `await request.arrayBuffer()` for any method other than `GET`/`HEAD`; `fetch` with `redirect: 'manual'`;
  - response: same status, status text and body; copy the headers but **delete** `content-encoding` and `content-length` (the runtime's fetch decompresses transparently).
- workerd drops the copied `cf-connecting-ip` from the subrequest, so setting `x-forwarded-for` explicitly is what carries the client IP. A splat server route does no trailing-slash redirect, so nothing like `skipTrailingSlashRedirect` is needed.
- Results on both runtimes: `/ingest/static/array.js` 200, `/ingest/flags/?v=2` 401 identical to a direct call, `/ingest/e/` 200; nothing goes to a `posthog.com` origin from the browser; `wrangler deploy --dry-run` passes.
- `posthog-node` resolves its `workerd` export on Workers; there it needs a client per request and `captureImmediate` or `waitUntil(shutdown())` ([Workers doc](https://posthog.com/docs/libraries/cloudflare-workers.md)). PostHog's [Start guide](https://posthog.com/docs/libraries/tanstack-start) shows a module singleton, which only fits Node.
- META: `EnvVar` is `{ value, monoScope }`; `$when` applies only to package.json and its `stack` key matches when **any** app uses the stack, so an env var cannot vary per app stack today. `stackPackageJson['tanstack-start']` covers `@posthog/react`.
- `instrumentation-client.ts.hbs` has no stack suffix: without a rename to `.nextjs.hbs`, it would land in Start apps.

**Not verified**
- A real deploy and real ingestion; `vite dev`; 64 MB bodies (session recordings); the `getRequestIP` fallback on workerd; a template filename containing `$` through the CLI; server capture delivery.
- That evlog's root-route middleware logs every `/ingest` request (inferred from `handleServerRoutes`).

**Open decisions (#181)**
1. Env naming on Start: `VITE_POSTHOG_PROJECT_TOKEN` through a generic `EnvVar.stacks`, a neutral server-side name returned to the client at runtime, or Vite `envPrefix` accepting `NEXT_PUBLIC_`?
2. Provider placement: a library-owned component rendered from `___root.tsx.hbs` under `hasLibrary "posthog"` (the evlog pattern), or inline in the root template?
3. Keep `/ingest` out of evlog's wide events (Next.js excludes it from middleware)? Through a path check in the generated middleware or evlog's route options?
4. Cache `/static/*` and `/array/*` under `cloudflare` (`caches.default`, as PostHog's Cloudflare proxy does), or one identical file for both runtimes?
5. Region: US hardcoded like Next.js, or an EU choice for both stacks (separate ticket)?
6. Confirm server-side capture stays out of Spec 1.

### 3.6 Static Cloudflare hosting (#175, decision #182)

**Answer.** Full prerender by Start alone, without Nitro or `@cloudflare/vite-plugin`: `tanstackStart({ prerender: { enabled: true, crawlLinks: true, autoSubfolderIndex: false } })`, served from `dist/client` by the same assets-only `wrangler.jsonc` as Next.js (no `main`, `not_found_handling: "404-page"`). Server routes and server functions return 404. The SPA shell stays documented only. The 404 page is open.

**Verified facts** (build, typecheck, `wrangler deploy --dry-run`, `wrangler dev` with a browser)
- Next.js today: `require: { stacks: ['nextjs'] }`, `providesServerRuntime: false`, `wrangler.jsonc.nextjs.hbs` (`assets.directory: "out"`, no `main`), `output: 'export'` + `images.unoptimized`, `proxy.ts` skipped by `deploymentSkip`.
- `isServerRuntimeSatisfied` is already stack-agnostic: better-auth, tRPC and PostHog (`needsServerRuntime`) will be excluded from static Start with no new code.
- The prerenderer starts its own `vite.preview()` on the SSR build and writes into the client `outDir` ([`prerender.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/prerender.ts)): static routes are discovered and `<a href>` links crawled, so linked dynamic pages are generated. Any non-2xx response fails the build.
- `autoSubfolderIndex: false` writes `about.html` and avoids the 307 to `/about/` of Workers' default `html_handling` ([SSG routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)).
- With `@cloudflare/vite-plugin`: without `main` the prerender fails on `GET /`; with `main`, `wrangler deploy` follows the `.wrangler/deploy/config.json` redirect and ships a full Worker. Wrong tool here.
- What stops working: server routes 404; server functions 404 with `Invariant failed`; a loader calling a server function works on direct load (build-time value) but fails on client navigation; middleware runs only at build time; unlinked dynamic pages are missing; no `404.html` unless the app provides one.
- SPA mode (`spa.prerender.outputPath: '/index'` + `not_found_handling: "single-page-application"`): every unknown URL, `/api/*` and `/_serverFn/*` included, answers **200 with the shell**, so server calls fail silently.
- create-faster needs only generic pieces: `require.stacks` extended; `stackPackageJson['tanstack-start']` (`deploy: vite build && wrangler deploy`, `preview: wrangler dev`, `cf-typegen`); the `$when` negation (with a list) to drop `nitro` and `start`; a `has` conditional in `vite.config.ts.hbs`; `deploymentSkip` on `.env.start`; a new `wrangler.jsonc.tanstack-start.hbs` (`dist/client`).
- evlog on static Start builds but stays inert, as on static Next.js today.

**Not verified**
- `html_handling: "drop-trailing-slash"` as the alternative; `staticFunctionMiddleware` (experimental); Nitro's static presets.

**Pitfalls**
- `vite dev` runs a real SSR server: routes and server functions work locally and only break after the static build. Start has no guard like Next.js `output: 'export'`.
- `require.stacks` means "at least one app": a Next.js + Start Turborepo already accepts `cloudflare-static`, and the Start app silently gets no `wrangler.jsonc` and no scripts.
- 404 workaround through the SPA shell written to `404.html` needs `maskPath: '/?shell'` (undocumented upstream): mask `/` prevents `index.html` from being written, and a mask matching no route fails the build.

**Open decisions (#182)**
1. Full prerender or SPA shell, and how META says it without branching on a stack in core code (research answer: full prerender, data and templates only).
2. The 404 page: (a) a `/404` route plus a root `notFoundComponent` (renders correctly, React #418 on unknown URLs, `/404` reachable with 200); (b) the SPA shell as `404.html` through `/?shell` (also renders uncrawled dynamic pages, same #418); (c) no `404.html`. Open an upstream issue first?
3. `autoSubfolderIndex: false`, or folder indexes plus `drop-trailing-slash`?
4. Dynamic routes: is "only what is linked gets built" enough, or show `pages: [...]` / `prerender.filter`?
5. Server functions in a static app: document the limits only, or show `staticFunctionMiddleware`?
6. Confirm the SPA shell stays documented only.
7. evlog on `cloudflare-static`: allowed and inert, or a META constraint (which would also change Next.js)?
8. `require.stacks`: keep "at least one app", or introduce an "every web app" semantic?

### 3.7 Theme switching (#172, decision #179)

**Answer.** `next-themes` 0.4.6 works as is on Start, under Nitro and `@cloudflare/vite-plugin`, with no flash and no hydration warning. The provider goes in the root `shellComponent` and `<html>` needs `suppressHydrationWarning`. Recommended: extend the `next-themes` library to `tanstack-start`, no core change.

**Verified facts**
- `next-themes` has only `react`/`react-dom` peers and no `next/*` import. Wrapping the body content, its provider renders an inline `<script>` as the first node of `<body>`, which sets the class and `color-scheme` on `<html>` before paint and hydration.
- Experiment on a generated Start + shadcn app: 8 of 8 loads correct **with JavaScript blocked** (no flash), no hydration or React 19 "script tag" warning, toggle, client navigation, reload and live OS change all work. Same under `vite preview` in workerd.
- Negative control: without `suppressHydrationWarning` on `<html>`, React logs an attribute mismatch on every load. The Start shell has neither that flag nor `lang` today.
- [next-themes#326](https://github.com/pacocoursey/next-themes/issues/326) (streamed Suspense during hydration) does not reproduce on React 19.3: Start hydrates inside `startTransition`.
- TanStack recommends `ScriptOnce` ([docs](https://github.com/TanStack/router/blob/main/docs/router/guide/document-head-management.md#inline-scripts-with-scriptonce)); shadcn's [Start dark-mode guide](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/dark-mode/tanstack-start.mdx) ships a ~90-line local provider on it. Verified equally clean (self-removing script, router CSP nonce), but more generated code, a per-stack `useTheme` import path, and no `resolvedTheme` (used by blueprints).
- Next.js: no `templates/libraries/next-themes/` directory; the library acts only through `hasLibrary` in `app-providers.tsx.hbs`. No toggle, no `disableTransitionOnChange`. Without shadcn, the `.dark` class has no effect on either stack's stock styles.

**Not verified**
- A real Cloudflare deploy: [next-themes#368](https://github.com/pacocoursey/next-themes/issues/368) (flash attributed to edge script rewriting); the `scriptProps={{ 'data-cfasync': 'false' }}` escape hatch.
- A CSP with nonces (create-faster sets none), Turborepo, Firefox and Safari.

**Pitfalls**
- [next-themes#397](https://github.com/pacocoursey/next-themes/issues/397): React 19.2 dev warning when the provider remounts on the client; safe in the `shellComponent`, which never remounts.
- `next-themes` 0.4.6 dates from March 2025: usable, but upstream fixes are unlikely to land fast.
- shadcn's `components.json` writes `"rsc": true` for every stack: inaccurate, harmless on Start.

**Open decisions (#179)**
1. Extend `next-themes` (recommended) or generate shadcn's `ScriptOnce` provider on Start? Renaming the `next-themes` id would break `--app` flags and the recreate command; any compatibility layer needs explicit approval.
2. Keep the id and only make the hint stack-neutral, or change the label too?
3. Provider inline in `___root.tsx.hbs`, or a Start `src/components/app-providers.tsx` (holding only the theme provider today)?
4. Generate a mode toggle on both stacks (shadcn only, with `dropdown-menu`), or keep parity with Next.js, which has none?
5. Fix the Next.js `AppProviders` bug (section 5) in Spec 1, or track it separately?
6. `<html lang="en" suppressHydrationWarning>` unconditional on Start, or only with `next-themes`?
7. Add `disableTransitionOnChange` on both stacks?
8. Keep `next-themes` and `shadcn` independent, or make `next-themes` require `shadcn`?

### 3.8 MDX (#173, decision #180)

**Answer.** `@mdx-js/rollup` with `remark-frontmatter` + `remark-mdx-frontmatter`, compiled at build time, same Vite config under Nitro and `@cloudflare/vite-plugin`. It is the compiler `@next/mdx` already wraps, and it keeps the `mdx-components.tsx` / `useMDXComponents()` contract through `providerImportSource`. fumadocs-mdx is the runner-up; content-collections' MDX fails on Workers. No new operator.

**Verified facts**
- Next.js today ships two pipelines: `@next/mdx` wired but unused, and `next-mdx-remote/rsc` reading `contents/*.mdx` with `fs` **at request time** (used by the example). Frontmatter is parsed by a regex.
- `@mdx-js/rollup` on Vite 8 / Rolldown with Start 1.168.60: build, tsc, `start`, `wrangler deploy --dry-run`, `vite preview`, content in SSR HTML, prerender, clean hydration and client navigation. No `fs` or `eval` in the Worker.
- Loading: eager `import.meta.glob` (every document in the main client chunk, about 20 lines) or lazy (one chunk per document, about 35 lines: a memoized promise per document marked `fulfilled`, read with `use()`).
- fumadocs-mdx (Macro API, `async: true`) also passes on both runtimes, but adds `fumadocs-core`, Shiki, heading ids and Fumadocs-UI attributes, and its API moves fast.
- `@content-collections/mdx` evaluates with `new Function()`: `EvalError: Code generation from strings disallowed` in workerd, page served without content ([content-collections#744](https://github.com/sdorra/content-collections/issues/744)). On Workers it is only a metadata layer over `@mdx-js/rollup`.
- Remaining gap: on Start each document is a client chunk compiled at build time; shipping no MDX JavaScript would need Start Server Components, which are experimental, so out of scope.
- Mapping: `stackPackageJson.nextjs` for `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `next-mdx-remote`; `stackPackageJson['tanstack-start']` for `@mdx-js/rollup` and both remark plugins; `.nextjs` suffix on the route, `mdx-components.tsx` and `lib/mdx.ts`; `contents/` and `mdx.css` shared; the MDX plugin under `hasLibrary "mdx"` in `vite.config.ts.hbs`.

**Not verified**
- Turborepo, `.md` files, imports inside MDX, fumadocs-mdx in `vite dev`, a template name containing `{-$slug}` through the resolver.
- Whether the Next.js `fs` route works on Workers (blocked by opennextjs-cloudflare#1355; OpenNext does not bundle files read at runtime, so a 404 is expected).

**Pitfalls**
- `providerImportSource: '@/mdx-components'` does not resolve from `contents/*.mdx` (Vite 8 applies `tsconfigPaths` only to files the tsconfig includes): use `'/src/mdx-components.tsx'`.
- A module cache filled by the loader breaks hydration (React #418, empty page): the client does not re-run loaders on hydration.
- The `/hello/world` link in `home.mdx` fails the prerender under `@cloudflare/vite-plugin` (exit 1; under Nitro only an `unhandledRejection`, exit 0).
- Prerender is not on by default in the generated Start app.

**Open decisions (#180)**
1. Confirm `@mdx-js/rollup` (+ remark plugins) over fumadocs-mdx. What does the library generate: config, content location, example route?
2. Eager or lazy glob?
3. Start route `/mdx/{-$slug}`; move Next.js to the same shape (`mdx/[[...slug]]`) in the same spec, fixing its `/mdx` 404 and root-level catch-all?
4. Replace the `/hello/world` link (for example with `/mdx/cool`)?
5. Keep both Next.js pipelines, or move the Next.js example to build-time compilation (one model, no request-time `fs`)?
6. Frontmatter: align both stacks on real YAML?
7. Does the Start `mdx` library turn on `prerender`, or stay SSR?
8. A dedicated ticket for opennextjs-cloudflare#1355?

## 4. Generic operators to add

| Operator | What it does | Needed by |
|---|---|---|
| `$when` negation accepting a list | `{ deployment: { not: ['cloudflare', 'cloudflare-static'] } }` drops `nitro` and the `start` script outside Nitro. Settled in #170; the list form comes from #175. `$when` already resolves inside `scripts`. | Cloudflare runtime (#170), static hosting (#175) |
| `deploymentSkip` / `deploymentPath` honoured for library templates | `resolveTemplatesForLibrary` ignores both today (only `resolveTemplatesForStack` honours them). Lets evlog's `nitro.config.ts.tanstack-start.hbs` be skipped under `cloudflare` and `cloudflare-static`. Alternative: move evlog's Nitro wiring into the stack templates. | evlog (#176), static hosting (#175) |
| `EnvVar.stacks` | Optional per-stack filter applied per app in `env-generator.ts` for library envs, so Start gets `VITE_POSTHOG_PROJECT_TOKEN` and Next.js keeps `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`. `$when` does not fit: not applied to envs, and its `stack` key matches the whole project, not the app. | PostHog (#174) |
| Per-stack `serverlessConsumersWired` | Only if one stack wires Hyperdrive consumers and the other does not. Not needed today. | db access (#171) |
| "Every web app" require key | Only if `require.stacks` ("at least one app") must become strict. To decide. | static hosting (#175) |

Everything else uses existing operators: `support.stacks`, `stackPackageJson`, the `.<stack>.hbs` suffix, `hasLibrary` / `has` (theme, MDX, PostHog, tRPC, and a `wrangler.jsonc` whose `main` depends on evlog).

## 5. Out-of-scope bugs found

- **Next.js `layout.tsx.hbs` never renders `AppProviders`.** Verified by generation. Outside blueprints, `next-themes`, TanStack Query and tRPC with TanStack Query generate a provider file nothing mounts. One-line fix in `templates/stack/nextjs/src/app/layout.tsx.hbs`. (#172)
- **Next.js mdx example: `/mdx` returns 404.** Verified (`next build` + `next start`, Next.js 16.4.0). `[...mdxExampleSlug]` is a required catch-all at the app root: `/mdx` looks for `contents/mdx.mdx`, the `home.mdx` branch is dead code, and the route captures every unmatched URL. (#173)
- **Next.js 16.4 + Cloudflare: 500 on every route.** Verified locally with `@opennextjs/cloudflare` 1.20.9: `Unexpected loadManifest(/.next/server/preview-props.json) call!`. Upstream [opennextjs/opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355), open. (#173)
- **SST `tanstack-start` branch uses `sst.aws.Function` without a handler.** Verified locally that the default `node-server` build's `index.mjs` exports only `default`, so `handler: '.output/server/index.handler'` does not exist, and nothing serves the assets. Deploy failure inferred, not deployed. Replaced by the settled `sst.aws.TanStackStart`. (#177)
- **terraform-aws docs list a never-generated `infra/main.tf`.** Verified. `main.tf.hbs` is empty and `template-processor.ts` skips blank output, while `terraform-aws.mdx` lists the file. (#177)
- **Possible module-format issue in the `lambda-terraform-aws` blueprint.** Not verified. `bun build src/index.ts --outfile dist/index.js --target node` is zipped without a `package.json`; Lambda treats `.js` as CommonJS unless `"type": "module"` is set, so if Bun emits ESM by default the handlers would fail to load. (#177)
- **Unused `@opennextjs/cloudflare` in the cloudflare-fullstack `api` package.** Tracked in #169.

## 6. Environment pitfalls for implementers

- `bun test` sets `NODE_ENV=test`. Remove it from the environment of e2e builds (`apps/cli/tests/e2e/helpers.ts` does), otherwise generated builds diverge from a user's shell.
- `vite dev` hides global-scope errors that `vite build` + `vite preview` reveal on Workers (section 3.1). Always validate Cloudflare bricks in preview.
- posthog-js drops events from browsers it classifies as bots (`opt_out_useragent_filter`): automated Chrome sent no `/e/` until `navigator.webdriver` was overridden to `false`. Start also treats headless Chrome's default user agent as a bot and buffers the whole response instead of streaming.
- In `generateAppPackageJson`, `mergePackageJsonConfigs` merges the stack's package.json first, then each library's: on the same key (a script, a dependency), the library overrides the stack. A deployment's `stackPackageJson` merges after the stack too (for example `cloudflare-static`'s `preview: wrangler dev` overrides the stack's `vite preview`).
