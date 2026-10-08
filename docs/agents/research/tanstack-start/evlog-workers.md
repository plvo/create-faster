# evlog on TanStack Start without Nitro, on Cloudflare Workers

Research for [#176](https://github.com/plvo/create-faster/issues/176), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: complete (2026-10-08).

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
- No evlog drain, enricher or sampling is generated today: the Nitro module only receives `env.service`, so events go to the console.
- Frontmatter `deploymentSkip` exists (`TemplateFrontmatter` in `apps/cli/src/types/meta.ts`), but `template-resolver.ts` only honours it in `resolveTemplatesForStack`; `resolveTemplatesForLibrary` ignores both `deploymentSkip` and `deploymentPath`. So `nitro.config.ts.tanstack-start.hbs`, a library template, cannot be skipped under `cloudflare` today without extending the resolver generically.

## Answer

**Yes, evlog works on TanStack Start on Cloudflare Workers without Nitro, and it keeps one wide event per request, drains (flushed through `waitUntil` after the response) and structured `EvlogError` responses. It does not work by dropping the Nitro module and keeping today's `evlogErrorHandler`: that combination builds and serves, but errors silently disappear from the wide event.** Both wirings below were run in workerd (`vite dev` and `vite build` + `vite preview`):

1. **Custom Worker entry with `evlog/workers` (`withEvlog`)**, the documented, non-beta evlog API. `src/server.ts` wraps TanStack Start's `handler.fetch` with `withEvlog`, passes the logger as `requestOpts.context.log`, and optionally runs the handler in an `AsyncLocalStorage` scope so a `useLogger()` works anywhere. Events also get `cfRay`, `traceparent`, `colo`, `country`, `asn`. It requires `wrangler.jsonc` `main: "src/server.ts"`.
2. **A global TanStack Start request middleware built on `evlog/toolkit` (`defineFrameworkIntegration`)**, with `waitUntil` imported from `cloudflare:workers`. It keeps the default `main: "@tanstack/react-start/server-entry"`, but the toolkit is marked **beta** in evlog's docs, and Cloudflare request fields have to be added by hand.

In both, the error handler has to be a small local middleware that reads `context.log` (or `useLogger()`), calls `log.error(error)`, and rethrows an `EvlogError` as a JSON `Response`. That is what `evlogErrorHandler` does, minus the `nitro/context` lookup. evlog's core API alone (`createWorkersLogger` / `defineWorkerFetch`) also runs, but it emits by hand and skips `routes`, `redact`, `enrich`, `keep` and `plugins`, so it is the weakest of the three.

The parity gaps compared with the Nitro path:

- The code that reads the logger changes. Nitro code uses `useRequest().context.log` from `nitro/context`; on Workers it is `context.log` in middleware, server routes and server functions, or a project-local `useLogger()`.
- Errors that TanStack Start turns into a response before request middleware sees them, namely SSR loader errors and server function errors on the RPC path, reach the wide event only as a status (`500` for a loader, `200` for an RPC), with no `error` field. This was observed on Workers. I infer the same happens on the Nitro path, because `evlogErrorHandler` is the same request middleware there, but I did not test it.
- `log.fork()` is unavailable in both cases: not on Nitro (evlog docs, PR #697), and not through `withEvlog`. The toolkit variant does attach `fork` when given `storage`, but I did not test it.

Upstream, [evloghq/evlog#362](https://github.com/evloghq/evlog/issues/362) is still open with no answer and no linked PR as of 2026-10-08. create-faster has to own this wiring for now.

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

### Variant 1b: local error middleware reading `context.log`

Same `withEvlog` entry. The root route's `evlogErrorHandler` was replaced by:

```ts
const evlogErrors = createMiddleware().server(async ({ next, context }) => {
  try {
    return await next()
  } catch (error) {
    context.log?.error(error)
    if (EvlogError.isEvlogError(error)) {
      throw new Response(JSON.stringify(error.toJSON()), {
        status: error.status || 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw error
  }
})
```

| Check | Result |
|---|---|
| `EvlogError` in a server route | `402` JSON response unchanged; wide event `level: 'error'` with `error.{name,message,stack,status,why,fix}`; the drain receives it. |
| Plain `Error` in a server route | `500`; wide event `level: 'error'` with `error.{name,message,stack}`. |
| `EvlogError` thrown by a server function in an SSR loader (`/loader-crash`) | Page answers `500`; wide event `status: 500`, `level: 'info'`, no `error`. The error never reaches request middleware. |
| Server functions over RPC (`/_serverFn/<id>`, with `Origin` and `Sec-Fetch-Site: same-origin` to pass Start's CSRF check) | `context.log` is available (fields set in the function reach the event). A thrown `EvlogError` comes back as `200` with a serialized `$TSR/Error` that keeps only `message`; the wide event has `status: 200`, no `error`. |
| `useLogger()` from `createLoggerStorage` (`evlog/toolkit/storage`), with `src/server.ts` calling `loggerStorage.run(log, () => handler.fetch(...))` | Works from a helper called after an `await` inside a server route: its field reaches the wide event (needs `nodejs_compat`, which the Cloudflare guide already sets). |

### Variant 2: global request middleware with `evlog/toolkit`, default server entry

`wrangler.jsonc` back to `main: "@tanstack/react-start/server-entry"`, no `src/server.ts`. `src/start.ts`:

```ts
import { createMiddleware, createStart } from '@tanstack/react-start'
import { initLogger } from 'evlog'
import { defineFrameworkIntegration } from 'evlog/toolkit'
import { waitUntil } from 'cloudflare:workers'
import { loggerStorage } from './logger'

initLogger({ env: { service: 'exp-mw' }, pretty: false, stringify: false })

const integration = defineFrameworkIntegration<{ request: Request }>({
  name: 'tanstack-start',
  extractRequest: ({ request }) => ({
    method: request.method,
    path: new URL(request.url).pathname,
    headers: request.headers,
    requestId: request.headers.get('cf-ray') ?? undefined,
  }),
  attachLogger: () => {},
  storage: loggerStorage,
})

const evlogRequest = createMiddleware().server(async ({ request, next }) => {
  const { logger, finish, finishResponse, skipped, runWith } = integration.start({ request }, { waitUntil, drain })
  if (skipped) return next()
  try {
    const result = await runWith(() => next({ context: { log: logger } }))
    return await finishResponse(result.response)
  } catch (error) {
    await finish({ error })
    throw error
  }
})

export const startInstance = createStart(() => ({ requestMiddleware: [evlogRequest] }))
```

The variant 1b root-route error middleware was kept. Results, in both `vite build` + `vite preview` and `vite dev`: one wide event per request; `context.log` works in server routes and in the SSR server function; `useLogger()` works in a deep helper; `EvlogError` (`402`, `level: 'error'`) and plain `Error` (`500`, `level: 'error'`) are on the event; the drain runs after the response through `waitUntil` from `cloudflare:workers`. `colo`/`country`/`asn`/`cfRay` are absent, because this `attachLogger` adds nothing; `evlog/workers` adds them through its internal `applyCloudflareContext`, which is not exported.

A request middleware may return a `Response` in place of `next()`'s result. `executeMiddleware` in `start-server-core` calls `setResponse(response)` when the returned value is or carries a response, so returning `finishResponse(...)`'s possibly wrapped streaming `Response` is supported.

`waitUntil` as a module import from `cloudflare:workers` is documented in the Cloudflare changelog ["Directly import `waitUntil` in Workers"](https://developers.cloudflare.com/changelog/post/2025-08-08-add-waituntil-cloudflare-workers/) (2025-08-08). It behaves like `ctx.waitUntil()`, and the [Context API](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil) gives a 30 second limit after the response.

## Inferences

These are reasoned from the facts above, not tested end to end in a generated create-faster project.

- **Recommended wiring for create-faster: variant 1 (custom `src/server.ts` with `withEvlog`) plus the variant 1b local error middleware.** It uses evlog's stable, documented Workers adapter rather than the beta toolkit, includes the Cloudflare request fields, and supports `include`/`exclude`, `routes`, `redact`, `enrich`, `keep`, `plugins` and `drain` as `withEvlog` options. Its cost is owning `src/server.ts` and `main`. The Cloudflare guide already recommends that file for queues, cron and Durable Objects, so it is likely to exist anyway once TanStack Start on Cloudflare grows. Variant 2 is the fallback if the Cloudflare TanStack Start brick wants to keep `main` on the default entry.
- **The local error middleware could be shared by both runtimes** if it reads the logger through a single accessor. On Nitro the logger lives at `useRequest().context.log`; on Workers at `context.log`. One template guarded by `{{#if (has "deployment" "cloudflare")}}` is the smallest change; a fully shared helper is possible but not tested on Nitro.
- **Keeping `evlogErrorHandler` from `evlog/nitro/v3` on Cloudflare must not be done**, even though it builds: it pulls a Nitro-named import into a Nitro-free app and drops every error from the wide event without a warning.
- **Template and META impact (for the delivery ticket, not decided here).**
  - Under `cloudflare`: no `nitro.config.ts`; a `src/server.ts` (or `src/start.ts`) evlog template; the root route's error middleware switches source; `wrangler.jsonc` `main` points at `src/server.ts` when evlog is selected.
  - Skipping a **library** template per deployment needs `deploymentSkip` honoured in `resolveTemplatesForLibrary`. That is a generic resolver change, in line with the Declarative Choice Logic rule. The alternative is moving the Nitro wiring into the stack templates, which already honour it.
  - `wrangler.jsonc` `main` depending on a library is a stack-and-library interaction. The generic way to express it is a Handlebars condition (`hasLibrary "evlog"`) in the wrangler template, not a resolver branch.
  - No new npm dependency: `evlog/workers`, `evlog/toolkit` and `evlog/toolkit/storage` all ship in `evlog`.
- **Version floor.** `withEvlog` arrived in `2.23.0` and the `waitUntil` registration of batched drains in `2.27.0`. create-faster's `^2.28.0` floor already covers both.
- **Not verified:** a real `wrangler deploy` (only workerd locally); `log.fork()` through the toolkit variant; whether the Nitro path also misses SSR loader and RPC server function errors on the wide event; behaviour with a real drain adapter (only a custom drain was used); the interaction with better-auth or tRPC handlers on TanStack Start.

## Open questions for the decision ticket

1. Custom `src/server.ts` with `withEvlog` (stable adapter, Cloudflare fields, owns `main`), or a global request middleware on the beta `evlog/toolkit` (keeps the default entry)?
2. Should the generated Cloudflare app expose a project-local `useLogger()` (an `AsyncLocalStorage` scope, `nodejs_compat`), or only `context.log`? On Nitro, generated code reads `useRequest().context.log`.
3. Is it acceptable that SSR loader errors and RPC server function errors do not appear on the wide event, as today on Nitro (assumed, not tested)? Or should a server function middleware log them too?
4. Should library templates honour `deploymentSkip`/`deploymentPath` (a generic resolver change), or should the Nitro evlog wiring move into the TanStack Start stack templates?
5. Should the error middleware become one template that works on both runtimes, or stay split by a `has "deployment" "cloudflare"` condition?

## Sources

- evlog issue [#362](https://github.com/evloghq/evlog/issues/362), issue [#405](https://github.com/evloghq/evlog/issues/405), issue [#416](https://github.com/evloghq/evlog/issues/416), PR [#429](https://github.com/evloghq/evlog/pull/429), PR [#472](https://github.com/evloghq/evlog/pull/472), PR [#697](https://github.com/evloghq/evlog/pull/697).
- evlog docs: [TanStack Start](https://github.com/evloghq/evlog/blob/main/apps/docs/content/4.integrate/frameworks/05.tanstack-start.md), [Cloudflare Workers](https://github.com/evloghq/evlog/blob/main/apps/docs/content/4.integrate/frameworks/12.cloudflare-workers.md), [Custom framework](https://github.com/evloghq/evlog/blob/main/apps/docs/content/6.extend/10.custom-framework.md).
- evlog source: [`src/workers/index.ts`](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/workers/index.ts), [`src/shared/integration.ts`](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/shared/integration.ts), [`src/shared/storage.ts`](https://github.com/evloghq/evlog/blob/main/packages/evlog/src/shared/storage.ts), [`src/nitro-v3/`](https://github.com/evloghq/evlog/tree/main/packages/evlog/src/nitro-v3); published `evlog@2.30.1` tarball (`package.json` exports, `dist/nitro/v3/*.mjs`, `dist/workers.mjs`, `dist/toolkit/storage.mjs`).
- TanStack Start: `@tanstack/react-start@1.168.60` `src/default-entry/server.ts`; `@tanstack/start-server-core@1.169.39` `src/createStartHandler.ts`, `src/server-functions-handler.ts`, `src/request-handler.ts`.
- Cloudflare: [TanStack Start framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), [Context API, `waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil), [Fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/), [changelog: import `waitUntil`](https://developers.cloudflare.com/changelog/post/2025-08-08-add-waituntil-cloudflare-workers/).
- create-faster: `apps/cli/src/__meta__.ts`, `apps/cli/src/types/meta.ts`, `apps/cli/src/lib/template-resolver.ts`, `apps/cli/templates/libraries/evlog/`, `apps/cli/templates/stack/tanstack-start/`.
