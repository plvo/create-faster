# evlog on TanStack Start without Nitro, on Cloudflare Workers

Research for [#176](https://github.com/plvo/create-faster/issues/176), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: draft, research in progress.

## Question

create-faster wires evlog on TanStack Start through Nitro: `nitro.config.ts` registers the `evlog/nitro/v3` module, and the root route's request middleware wraps `evlogErrorHandler`. On Cloudflare the runtime is `@cloudflare/vite-plugin`, without Nitro. Can evlog still work there, through:

- `evlog/workers`;
- a TanStack Start request middleware;
- or evlog's core API?

Does it keep the same wide events, drains and error handler?

## Current create-faster wiring

- META `evlog` (`apps/cli/src/__meta__.ts`): `support.stacks` is `nextjs`, `hono`, `tanstack-start`, `node`; the only package is `evlog ^2.28.0`. No deployment-specific data.
- `apps/cli/templates/libraries/evlog/nitro.config.ts.tanstack-start.hbs`: Nitro config with `experimental.asyncContext: true` and `modules: [evlog({ env: { service: '{{appName}}' } })]` from `evlog/nitro/v3`.
- `apps/cli/templates/stack/tanstack-start/src/routes/___root.tsx.hbs`: under `hasLibrary "evlog"`, `server.middleware: [createMiddleware().server(evlogErrorHandler)]` with `evlogErrorHandler` imported from `evlog/nitro/v3`.
- `apps/cli/templates/stack/tanstack-start/vite.config.ts.hbs`: `nitro()` from `nitro/vite` is always in the plugin list.

## Answer

To be written.

## Verified facts

Versions read: evlog `2.30.1` (npm `latest` on 2026-10-08, same as `packages/evlog/package.json` on `main` at `59a105f`). create-faster pins `evlog ^2.28.0`.

### Upstream status

- [evloghq/evlog#362](https://github.com/evloghq/evlog/issues/362) "support tanstack start with cloudflare vite plugin" (opened 2026-06-05) is open, labelled `enhancement`, with zero comments. It notes evlog's docs only cover Nitro for TanStack Start.
- [evloghq/evlog#416](https://github.com/evloghq/evlog/issues/416) asked for `waitUntil` in the custom-integration toolkit, citing #362 and TanStack Start on Workers. It was closed by [PR #429](https://github.com/evloghq/evlog/pull/429) (merged 2026-07-16, released in `2.22.0`): `waitUntil` on `createMiddlewareLogger` / `BaseEvlogOptions`, and `extractWaitUntil` on `defineFrameworkIntegration` manifests.
- [evloghq/evlog#405](https://github.com/evloghq/evlog/issues/405) (open) documents a `createSerializationAdapter` in `src/start.ts` so `EvlogError` fields (`why`, `fix`) survive TanStack Start server functions. This is runtime-agnostic.
- Re-checked on 2026-10-08: #362 is still open with zero comments (last update 2026-06-05). No evlog PR or issue mentions TanStack Start on Workers besides #362 and #416. The latest release is `evlog@2.30.1` (2026-10-06).
- [PR #697](https://github.com/evloghq/evlog/pull/697) (merged 2026-09-12) added a "Background work" section to the TanStack Start page: `log.fork()` is not available there, because `evlog/nitro/v3` attaches the logger to the Nitro request event and registers no `AsyncLocalStorage` storage.
- evlog's TanStack Start page states "TanStack Start uses Nitro v3 as its server layer, so evlog integrates via the `evlog/nitro/v3` module" and documents only that path ([source](https://github.com/evloghq/evlog/blob/main/apps/docs/content/4.integrate/frameworks/05.tanstack-start.md), [site](https://www.evlog.dev/integrate/frameworks/tanstack-start)). Drains, enrichers and tail sampling there are Nitro plugins hooking `evlog:drain`, `evlog:enrich`, `evlog:emit:keep`; the request logger is read through `useRequest()` from `nitro/context` (needs `experimental.asyncContext`).

### `evlog/workers`

Source: [`packages/evlog/src/workers/index.ts`](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/workers/index.ts); docs: [Cloudflare Workers](https://github.com/evloghq/evlog/blob/main/apps/docs/content/4.integrate/frameworks/12.cloudflare-workers.md).

- Exports `initWorkersLogger(config)` (calls `initLogger` with `pretty: false, stringify: false`), `withEvlog(handler, options)`, `defineWorkerFetch(handler)`, `createWorkersLogger(request, { executionCtx | waitUntil, requestId, headers })`.
- `withEvlog` and `defineWorkerFetch` both return `{ fetch(request, env, ctx) }`: they wrap the **whole Worker `fetch` export**, and hand the logger to user code as the handler's fourth argument.
- `withEvlog` runs the shared middleware pipeline (`include`/`exclude`, `routes`, `redact`, `enrich`, `keep`, `plugins`, `drain`), emits when the handler returns, defers the emit for streaming bodies, and takes `waitUntil` from `ctx` (third `fetch` argument). Added in `2.23.0` ([PR #472](https://github.com/evloghq/evlog/pull/472), CHANGELOG).
- Every event carries `cfRay`, `traceparent`, and `colo`/`country`/`asn` from `request.cf`. `requestId` is `x-request-id`, else `cf-ray`.
- The adapter deliberately has **no `AsyncLocalStorage`** ("`evlog/workers` must stay free of `node:async_hooks` so it runs without `nodejs_compat`", source comment), so there is no `useLogger()` and no `log.fork()` there.
- `defineWorkerFetch` / `createWorkersLogger` are the manual-emit path: the docs state route filtering, `routes`, `redact`, `enrich`, `keep` and `plugins` do not apply there.

### `evlog/toolkit` (custom integrations)

Source: [`packages/evlog/src/shared/integration.ts`](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/shared/integration.ts), [`shared/storage.ts`](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/shared/storage.ts); docs: [Custom framework](https://github.com/evloghq/evlog/blob/main/apps/docs/content/6.extend/10.custom-framework.md) (toolkit marked **beta**).

- `defineFrameworkIntegration({ name, extractRequest, attachLogger, storage?, extractWaitUntil? })` returns `start(ctx, options)` → `{ logger, finish, finishResponse, skipped, runWith }`. It is what Hono, Express, Fastify, Elysia, oRPC, NestJS, React Router and SvelteKit integrations are built on (CHANGELOG `2.23.0`, PR #471).
- With `storage` from `createLoggerStorage()`, `runWith(fn)` runs downstream code in `AsyncLocalStorage`, `useLogger()` works, and `log.fork()` is attached. The docs advise importing `createLoggerStorage` from `evlog/toolkit/storage` on Workers so `node:async_hooks` is isolated from the main barrel.
- Per-request `options.waitUntil` wins over `extractWaitUntil`; without either, drains are awaited inline. The docs show `import { waitUntil } from 'cloudflare:workers'` as one source for it.
- Since `2.27.0`, the shared middleware registers the drain pipeline's `settled()` with the runtime `waitUntil`, so batched events are not stranded on serverless (CHANGELOG `2.27.0`).

### `evlog/nitro/v3` and `evlogErrorHandler`

Source: [`packages/evlog/src/nitro-v3/`](https://github.com/evloghq/evlog/tree/main/packages/evlog/src/nitro-v3).

- The default export is a Nitro module (build-time `setup(nitro)`): it pushes a runtime plugin, prepends an error handler, and bakes options into `runtimeConfig`. Without Nitro there is nothing to run it.
- `evlogErrorHandler` (`nitro-v3/middleware.ts`) is a TanStack Start server middleware function: it awaits `next()`, and on an `EvlogError` it tries `await import('nitro/context')` → `useRequest().context.log.error(err)` inside a `try { } catch { }` that ignores failure, then **throws a `Response`** with `evlogError.toJSON()` and the error status. Non-evlog errors are rethrown.
- The `evlog` package sets `"sideEffects": false`; `nitro/v3/index.mjs` re-exports the module, `useLogger`, `evlogErrorHandler`, `createError`, `parseError`.
- `evlog/nitro/v3` has a single export entry (`dist/nitro/v3/index.mjs`), so importing `evlogErrorHandler` also loads `module.mjs`, whose top level runs `dirname(fileURLToPath(import.meta.url))` with `node:path` and `node:url`. In a production build `sideEffects: false` lets the bundler drop it; in an unbundled dev runtime it executes (behaviour on workerd checked in the experiment below).
- The handler's only Nitro dependency is the guarded `await import('nitro/context')`; the type file imports `RequestServerResult` from `@tanstack/start-client-core` (an optional peer dependency).

### TanStack Start on Workers: entry point and request context

Source: [Cloudflare TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), `@tanstack/react-start` `1.168.60` and `@tanstack/start-server-core` `1.169.39` from npm.

- The Cloudflare guide wires `cloudflare({ viteEnvironment: { name: 'ssr' } })` before `tanstackStart()`, sets `compatibility_flags: ["nodejs_compat"]`, and `main: "@tanstack/react-start/server-entry"`. It documents a custom `src/server.ts` (`main: "src/server.ts"`) that imports the default handler and re-exports `fetch: handler.fetch` next to `queue`/`scheduled` handlers.
- The default server entry is `createServerEntry({ fetch })` with `fetch = createStartHandler(defaultStreamHandler)` (`react-start/src/default-entry/server.ts`). Its signature is `(request, requestOpts?)`; `requestOpts.context` becomes the initial `context` of the request middleware chain (`createStartHandler.ts`, `executeMiddleware(..., { context: createNullProtoObject(requestOpts?.context) })`), and is merged into server function context on the RPC path (`handleServerAction({ request, context: requestOpts?.context })`, then `safeObjectMerge(payload?.context, context)` in `server-functions-handler.ts`).
- So a custom Worker entry can create the evlog logger and hand it to every Start middleware, server route and server function as `context.log`, without `AsyncLocalStorage`.

## Experiment

Throwaway app outside the repo (not committed): `@tanstack/react-start` `1.168.60`, `@cloudflare/vite-plugin` `1.63.1`, `wrangler` `4.149.0`, `vite` `8.3.4`, `evlog` `2.30.1`, **no `nitro` installed**. `wrangler.jsonc` with `nodejs_compat` and `main: "src/server.ts"`:

```ts
// src/server.ts
import handler from '@tanstack/react-start/server-entry'
import { initWorkersLogger, withEvlog } from 'evlog/workers'

initWorkersLogger({ env: { service: 'exp' } })

export default withEvlog(
  (request, _env, _ctx, log) => handler.fetch(request, { context: { log } }),
  { drain: async (ctx) => { await new Promise((r) => setTimeout(r, 50)); console.log('DRAIN', ...) } },
)
```

The root route kept create-faster's current `server.middleware: [createMiddleware().server(evlogErrorHandler)]` with `evlogErrorHandler` imported from `evlog/nitro/v3`. Routes: a server route reading `context.log` and calling `log.set({ user })`, a server route throwing `createError({ status: 402, why, fix })`, a server route throwing a plain `Error`, and an index page whose loader calls a `createServerFn` that reads `context.log`.

Observed, both in `vite build` + `vite preview` (workerd) and in `vite dev` (workerd):

| Check | Result |
|---|---|
| Build without `nitro` installed | Succeeds. Vite replaces the optional peer `nitro/context` with a stub chunk that throws `Could not resolve "nitro/context"`; `evlogErrorHandler`'s `try { } catch { }` swallows it. `module.mjs` (and its `fileURLToPath`) is not in the server bundle. `vite dev` also runs without error. |
| One wide event per request | Yes, with `method`, `path`, `requestId`, `status`, `duration`, `service`, `environment`, plus `colo`/`country`/`asn` from `request.cf`. |
| `context.log` in a server route | Yes, fields set there appear on the wide event. |
| `context.log` in a server function called during SSR | Yes, fields set there appear on the event of the page request. |
| Drain | Runs after the response through `ctx.waitUntil` (the delayed `DRAIN` lines print after the request log lines). |
| `EvlogError` response | Unchanged: `402` with `{"name":"EvlogError","message":...,"status":402,"data":{"why":...,"fix":...}}`. |
| `EvlogError` on the wide event | **Lost.** The event has `status: 402` but `level: 'info'` and no `error` field, because `evlogErrorHandler` only attaches the error through `nitro/context`. |
| Plain `Error` on the wide event | **Lost.** Start catches it and answers `500`; the event has `status: 500`, `level: 'info'`, no `error`. `withEvlog`'s `finish({ error })` never runs, since the handler returns a response instead of throwing. |

## Inferences

To be written.

## Sources

To be written.
