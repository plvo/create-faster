# PostHog on TanStack Start

Research for [#174](https://github.com/plvo/create-faster/issues/174), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: complete (2026-10-08).

## Question

How does PostHog integrate with TanStack Start?

- posthog-js provider setup (SSR-safe init);
- a first-party `/ingest` reverse proxy as a Start server route, on Nitro and on Workers (`@cloudflare/vite-plugin`);
- server-side capture (posthog-node, and its Workers constraints), if the Next.js library has it.

What does create-faster's `posthog` library generate for Next.js today: rewrites, provider, env vars, server capture?

## Current create-faster wiring (Next.js only)

Read on `main` at `f7d2b0b`.

- META `posthog` (`apps/cli/src/__meta__.ts`): `support.stacks: ['nextjs']`, `needsServerRuntime: true` (so it is unavailable with `cloudflare-static`), one dependency `posthog-js ^1.435.6`, one env var `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_your-posthog-project-token` with `monoScope: ['app']`. No `posthog-node`, no host env var, no `deploymentPackageJson`.
- `apps/cli/templates/libraries/posthog/src/instrumentation-client.ts.hbs`: Next.js's client instrumentation file. When the token is set, `posthog.init(token, { api_host: '/ingest', ui_host: 'https://us.posthog.com', defaults: '2026-05-30', capture_exceptions: true, debug: NODE_ENV === 'development' })`. No React provider: the module-level `posthog` singleton is imported directly where needed.
- `apps/cli/templates/stack/nextjs/next.config.ts.hbs`, under `hasLibrary "posthog"`: `rewrites()` maps `/ingest/static/:path*` and `/ingest/array/:path*` to `https://us-assets.i.posthog.com/...` and `/ingest/:path*` to `https://us.i.posthog.com/...`, plus `skipTrailingSlashRedirect: true`. The region is hardcoded to US.
- `apps/cli/templates/stack/nextjs/src/proxy.ts.hbs`: the middleware matcher excludes `ingest` when posthog is selected, so the proxy is not run through middleware (or evlog).
- No server-side capture anywhere: no `posthog-node`, no server helper, no API route. The question's "server capture, if the Next.js library has it" is therefore out of parity scope (see the server-side section for what it would take).
- The `showcase` blueprint (Next.js) overrides `instrumentation-client.ts` to start opted out and gates capture behind the c15t consent banner in `app-providers.tsx`. Blueprints on Start are out of scope for this map.
- Docs page: `apps/www/content/docs/modules/analytics/posthog.mdx`.

Mechanism notes that matter for Start:

- `$when` (`apps/cli/src/lib/when.ts`) is only applied by `package-json-generator.ts`. `env-generator.ts` does not resolve `$when`, and `EnvVar` (`apps/cli/src/types/meta.ts`) is just `{ value, monoScope }`: an env var cannot vary by stack today.
- Even if `$when` were applied to envs, its `stack` key matches when *any* app in the project uses the stack (`ctx.apps.map(a => a.stackName)`), not the app being generated. A mixed Next.js + Start Turborepo with posthog on both would get both names on both apps.
- Library dependencies *can* already vary per app stack: `MetaAddon.stackPackageJson` is merged per app by `generateAppPackageJson` (`package-json-generator.ts`, `library.stackPackageJson?.[app.stackName]`).
- `src/instrumentation-client.ts.hbs` has no stack suffix. Library templates without a suffix are emitted for every supported stack (`resolveTemplatesForLibrary` in `template-resolver.ts` only skips files whose suffix names another stack), so adding `tanstack-start` to `support.stacks` without renaming it to `instrumentation-client.ts.nextjs.hbs` would drop a dead Next.js file into Start apps.

## Answer

**PostHog on TanStack Start needs three things, and the same code runs unchanged on Nitro and on Workers (`@cloudflare/vite-plugin`, no Nitro). All three were built and exercised locally on both runtimes, in a real browser, against real PostHog with a fake token.**

1. **Client: `PostHogProvider` from `@posthog/react` in the root route's shell**, with `api_host: '/ingest'`, `ui_host: 'https://us.posthog.com'`, and the same options as the Next.js template. It is SSR-safe as is: the provider calls `posthog.init` inside a `useEffect` (so never on the server), and `posthog-js` guards its `window` access at import. `defaults: '2026-05-30'` already turns on `capture_pageview: 'history_change'`, so client-side navigations are counted without router wiring.
2. **Proxy: one splat server route, `src/routes/ingest/$.ts`, with an `ANY` handler** that strips the `/ingest` prefix, sends `/static/*` and `/array/*` to `us-assets.i.posthog.com` and the rest to `us.i.posthog.com`, drops `cookie`, `authorization` and `accept-encoding`, sets `x-forwarded-for`, forwards the body as bytes, and returns the response without `content-encoding` / `content-length`. No trailing-slash redirect happens on a splat server route, so nothing like Next.js's `skipTrailingSlashRedirect` is needed. No deployment-specific code: the client IP comes from `cf-connecting-ip` on Workers and from `getRequestIP({ xForwardedFor: true })` on Node.
3. **Env: the token must be `VITE_`-prefixed on Start** (Vite only inlines `VITE_*` into client code, at build time). PostHog's own docs use `VITE_POSTHOG_PROJECT_TOKEN`. create-faster's `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` cannot be reused, and META cannot vary an env var by stack today: that needs a new **generic** operator (see the proposal).

**Server-side capture is out of parity scope**: the Next.js library generates none. If it is ever added, `posthog-node` works on both runtimes (on Workers it resolves its `workerd` export, `index.edge.mjs`), but Workers needs a client per request flushed with `captureImmediate` or `waitUntil(shutdown())`, while PostHog's TanStack Start guide shows a module-level singleton that only fits a long-lived Node process.

## Local verification: Nitro (tested locally, 2026-10-08)

Setup, in a throwaway directory outside the repo:

- `bun run apps/cli/src/index.ts phnitro --app phnitro:tanstack-start --linter biome --no-git --pm bun` from `main` at `f7d2b0b` (`@tanstack/react-start 1.168.60`, `nitro 3.0.260903-beta`, `vite 8`).
- Added `@posthog/react 1.11.3`, `posthog-js 1.438.3`, `posthog-node 5.55.1`; `.env` with `VITE_POSTHOG_PROJECT_TOKEN=phc_fake_experiment_token` (a fake token).
- `src/components/analytics-provider.tsx` (the provider shape in the proposal below) wrapping the shell body in `__root.tsx`.
- `src/routes/ingest/$.ts`, a splat server route with an `ANY` handler (the proxy code in the proposal below), plus a `console.log` of each outgoing request for the experiment, and an experiment-only env override to point the upstream at a local echo server.
- `bun run build`, then `PORT=3911 node .output/server/index.mjs` (the generated `start` script, minus `--env-file`).

Results:

- `vite build` and `tsc --noEmit` pass. `GET /` returns 200 with SSR, and the browser console shows no hydration error: the provider renders on the server without touching `window`.
- **Against a local echo server** (what actually goes on the wire from Node's `fetch`):
  - `POST /ingest/e/?ip=1&_=123&compression=gzip-js` arrives as `POST /e/?ip=1&_=123&compression=gzip-js`: prefix stripped, trailing slash and query kept, body bytes intact. There is no trailing-slash redirect on a splat server route, so the Next.js `skipTrailingSlashRedirect` concern does not exist here.
  - `cookie` and `authorization` are removed. `x-forwarded-for` carries the client-sent value when present, otherwise the socket address from `getRequestIP` (`::ffff:127.0.0.1`).
  - The `Host` header on the wire is the target URL's host, whatever the code sets: Node's fetch (undici) derives it from the URL. Setting `host` is harmless but not what makes it work.
  - Node's fetch re-adds `accept-encoding: gzip, deflate` and transparently decompresses the response, which is why the proxy must drop `content-encoding` and `content-length` from the upstream response (as PostHog's Remix guide does).
  - An upstream `set-cookie` is passed through to the browser. PostHog does not set cookies on these endpoints, so this is only a note.
- **Against real PostHog with the fake token:**
  - `GET /ingest/static/array.js`: 200, `application/javascript`, 330 KB, served from `us-assets.i.posthog.com`.
  - `POST /ingest/flags/?v=2`: 401 `{"type":"authentication_error","code":"authentication_failed",...}`, byte-identical to calling `https://us.i.posthog.com/flags/?v=2` directly. The same direct call with a wrong `Host` gets 404, so the 401 proves the request reached the right PostHog host and was parsed.
  - `POST /ingest/e/` and `POST /ingest/batch/`: 200 `{"status":"Ok"}` (ingestion accepts any token and validates asynchronously).
  - `GET /ingest/array/<token>/config.js`: 404, same as direct, as expected for a fake token.
- **In a real browser (Chrome 154 through DevTools):** after hydration posthog-js loads `/ingest/static/1.438.3/exception-autocapture.js` (200), `/ingest/array/<token>/config.js` and `/config` (404, fake token), `POST /ingest/flags/?v=2` (401, fake token) and `POST /ingest/e/` (200, the `$pageview` and friends). Nothing goes to a `posthog.com` origin from the browser.
  - Under automation posthog-js sent no `/e/` at all until `navigator.webdriver` was overridden to `false`; it filters bot traffic. Worth knowing for Playwright tests of a generated app.

## Local verification: Workers (tested locally in workerd, 2026-10-08)

Setup: a copy of the Nitro app with `nitro` removed, `@cloudflare/vite-plugin 1.63.1` and `wrangler 4.149.0` added, `cloudflare({ viteEnvironment: { name: 'ssr' } })` first in the Vite plugins, and `wrangler.jsonc` with `compatibility_date: "2026-09-01"`, `compatibility_flags: ["nodejs_compat"]`, `main: "@tanstack/react-start/server-entry"`. The provider and the `ingest/$.ts` route were **not changed**. `bun run build`, then `vite preview` (workerd).

Results:

- `vite build` passes; `wrangler deploy --dry-run` passes (889 KiB of Worker modules, 375 KiB gzip total upload, no bindings).
- `posthog-node` was bundled from `posthog-node/dist/entrypoints/index.edge.mjs`: its `exports["."].workerd` condition (`package.json` of `posthog-node 5.55.1`).
- The Cloudflare plugin copies `.env` into `dist/server/.dev.vars` at build ("Using secrets defined in .env"), so `VITE_POSTHOG_PROJECT_TOKEN` also becomes a Worker var for `vite preview`. Harmless: the project token is public by design.
- **Against real PostHog with the fake token**, identical to Nitro: `/ingest/static/array.js` 200 (330 KB JS), `/ingest/flags/?v=2` 401 `authentication_failed`, `/ingest/e/` 200 `{"status":"Ok"}`, `/ingest/array/<token>/config.js` 404.
- **In a real browser**: after hydration, `/ingest/static/1.438.3/exception-autocapture.js` 200, `/ingest/flags/?v=2` 401, `POST /ingest/e/` 200 twice. No hydration error in the console.
- **Against the local echo server** (what workerd's `fetch` puts on the wire): path, query and body intact, `cookie` / `authorization` / `accept-encoding` gone, `Host` derived from the URL. `x-forwarded-for` is the `cf-connecting-ip` value. workerd itself drops the copied `cf-connecting-ip` and `connection` headers from the subrequest and adds `cf-worker`, so setting `x-forwarded-for` explicitly is what carries the client IP (PostHog's Cloudflare proxy guide does the same). `x-forwarded-host` (the app's host) is forwarded on both runtimes; Next.js rewrites forward it too.
- `POST /api/server-capture` (a throwaway route: `new PostHog(token, { flushAt: 1, flushInterval: 0 })`, `await captureImmediate(...)`, `await shutdown()`) returns 200 with no error event in workerd. Delivery cannot be confirmed with a fake token.

## posthog-js on TanStack Start: sources

- PostHog's [TanStack Start guide](https://posthog.com/docs/libraries/tanstack-start) ([markdown](https://posthog.com/docs/libraries/tanstack-start.md)): installs `@posthog/react` and `posthog-node`; wraps `{children}` in `PostHogProvider` inside the root route's `shellComponent` (`src/routes/__root.tsx`), with `api_host`, `defaults: '2026-05-30'`, `capture_exceptions: true`. The token is a literal in that guide. Server capture is a `getPostHogClient()` module singleton with `flushAt: 1, flushInterval: 0`, used in a `createFileRoute('/api/checkout')` server route.
- PostHog's [TanStack Start web analytics install](https://posthog.com/docs/web-analytics/installation/tanstack) ([markdown](https://posthog.com/docs/web-analytics/installation/tanstack.md)): env vars `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST`, read with `import.meta.env`.
- `@posthog/react 1.11.3` (`dist/esm/index.js`, `PostHogProvider`): the client is chosen in a `useMemo` (no side effect), and `defaultInstance.init(apiKey, options)` runs in a `useEffect`, so it never runs during SSR. Without `apiKey` or `client` it logs a warning, hence the "render children only when the token is set" wrapper below. Its peer range is `posthog-js >=1.257.2`.
- [`defaults` option](https://posthog.com/docs/libraries/js/config.md): `'2025-05-24'` and later make `capture_pageview` default to `'history_change'` (SPA navigations); `'2026-01-30'` and later inject external scripts into `head` "to avoid SSR hydration errors"; `'2026-05-30'` adds storage and rage-click defaults.
- [`opt_out_useragent_filter`](https://posthog.com/docs/libraries/js/config.md): by default posthog-js drops events from user agents it classifies as bots. That matches the observation that automated Chrome sent no `/e/` until `navigator.webdriver` was overridden (the `webdriver` link is inferred from that behaviour, not read in source).
- TanStack Start [environment variables](https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables): client code only sees variables with the build tool's public prefix (`VITE_` for Vite), inlined at build time. A runtime value needs a server function returned through a loader.

## `/ingest` reverse proxy: sources

- PostHog [self-hosted proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference.md): `/static/*` and `/array/*` go to `us-assets.i.posthog.com` (EU: `eu-assets`), everything else to `us.i.posthog.com`; the `Host` must be the PostHog domain or PostHog answers 401; allow `GET` and `POST` on all paths; support 64 MB bodies (session recordings); forward `X-Forwarded-For`; set both `api_host` and `ui_host`.
- PostHog's [Remix resource-route proxy](https://posthog.com/docs/advanced/proxy/remix.md) is the closest framework analogue (a splat server route): rewrite the URL, delete `cookie`, `authorization`, `accept-encoding`, strip `content-encoding` and `content-length` from the response. It warns that all PostHog traffic, recordings included, then flows through the app's server, which costs bandwidth and invocations on serverless hosts.
- PostHog's [Cloudflare Workers proxy](https://posthog.com/docs/advanced/proxy/cloudflare.md): sets `X-Forwarded-For` from `CF-Connecting-IP`, buffers the request body with `arrayBuffer()` because forwarding the stream directly broke encoded payloads, and caches `/static/*` and `/array/*` with `caches.default`.
- TanStack Start server routes: `handleServerRoutes` in `@tanstack/start-server-core 1.168.60` (`dist/esm/createStartHandler.js`) picks `handlers[method] ?? handlers.ANY` (`HEAD` falls back to `GET`, then `ANY`), and runs the matched routes' `server.middleware` first. So a root-route request middleware (today evlog's `evlogErrorHandler`) also wraps `/ingest/*`; Next.js avoids that by excluding `ingest` from the middleware matcher. See the open questions.
- Upstream `Host` is derived from the URL by both Node's fetch and workerd (verified on the wire above), so copying the incoming headers does not leak the app's `Host`, and setting `host` by hand is unnecessary.

## Server-side capture: sources

- [PostHog Cloudflare Workers doc](https://posthog.com/docs/libraries/cloudflare-workers.md): `posthog-node` "ships a dedicated `workerd` export that avoids Node.js built-ins" and does not need `nodejs_compat` by itself; use `flushAt: 1`, `flushInterval: 0`; `ctx.waitUntil(posthog.captureImmediate(...))` and `ctx.waitUntil(posthog.shutdown())`, or `import { waitUntil } from 'cloudflare:workers'`; "We recommend creating a new PostHog client per request". It lists per-framework env and `waitUntil` access, without a TanStack Start row; on Start without Nitro, `import { env, waitUntil } from 'cloudflare:workers'` is the framework-agnostic path it gives.
- `posthog-node 5.55.1` `package.json` `exports["."]`: `workerd`, `edge` and `edge-light` map to `dist/entrypoints/index.edge.mjs`, `node` to `index.node.mjs`.
- [Identifying users](https://posthog.com/docs/libraries/tanstack-start.md#identifying-users): `tracing_headers` adds `X-POSTHOG-DISTINCT-ID` / `X-POSTHOG-SESSION-ID` to matching `fetch` calls, which is how backend events would join frontend sessions. Not needed for parity.

## Proposed META and template shape

Parity with today's Next.js library, nothing more (no server capture, US region hardcoded like Next.js):

- **META `posthog`**:
  - `support.stacks: ['nextjs', 'tanstack-start']`; keep `needsServerRuntime: true` (the proxy is a server route; a static Start build would lose it, same rule as Next.js).
  - `packageJson.dependencies`: `posthog-js` (both stacks); `stackPackageJson['tanstack-start'].dependencies`: `'@posthog/react': '^1.11.3'`. Existing operator, no core change.
  - `envs`: Next.js keeps `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, Start needs `VITE_POSTHOG_PROJECT_TOKEN`. **This needs a new generic operator**, because `EnvVar` cannot vary by stack and `$when` is neither applied to envs nor per-app. The smallest generic shape is an optional `stacks?: StackName[]` on `EnvVar`, filtered per app in `env-generator.ts` for library envs (library envs are already collected per app). Documented in `.claude/CLAUDE.md` with the other operators. A literal `if (stack === 'tanstack-start')` in the env generator would violate the Declarative Choice Logic rule.
- **Templates**:
  - Rename `templates/libraries/posthog/src/instrumentation-client.ts.hbs` to `instrumentation-client.ts.nextjs.hbs`.
  - Add `templates/libraries/posthog/src/routes/ingest/$.ts.tanstack-start.hbs`: the proxy below. (A `$` in a template filename is new to the repo; `fast-glob` and the writer should treat it literally, but this was not run through the CLI.)
  - Add a small provider component as a `.tanstack-start.hbs` library template (for example `src/components/analytics-provider.tsx`, as verified), and render it in `templates/stack/tanstack-start/src/routes/___root.tsx.hbs` under `{{#if (hasLibrary "posthog")}}`, the same way evlog is wired there today.
  - `next.config.ts.hbs` and `proxy.ts.hbs` stay as they are.
  - No `deploymentPath` / `deploymentSkip` / `deploymentPackageJson` is needed: the same files work under Nitro and under `cloudflare`.
- **Docs**: `apps/www/content/docs/modules/analytics/posthog.mdx` gains a Start section; the "Requirements" line about `cloudflare-static` holds for both stacks.

The two files as verified (minus the experiment's debug log and upstream override):

```tsx
// src/components/analytics-provider.tsx
import { PostHogProvider } from '@posthog/react'

const POSTHOG_PROJECT_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  if (!POSTHOG_PROJECT_TOKEN) return children

  return (
    <PostHogProvider
      apiKey={POSTHOG_PROJECT_TOKEN}
      options={{
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        defaults: '2026-05-30',
        capture_exceptions: true,
        debug: import.meta.env.DEV,
      }}
    >
      {children}
    </PostHogProvider>
  )
}
```

```ts
// src/routes/ingest/$.ts
import { createFileRoute } from '@tanstack/react-router'
import { getRequestIP } from '@tanstack/react-start/server'

const API_HOST = 'us.i.posthog.com'
const ASSET_HOST = 'us-assets.i.posthog.com'
const PROXY_PREFIX = '/ingest'

async function forwardToPostHog(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice(PROXY_PREFIX.length)
  const host = path.startsWith('/static/') || path.startsWith('/array/') ? ASSET_HOST : API_HOST

  const headers = new Headers(request.headers)
  headers.delete('cookie')
  headers.delete('authorization')
  headers.delete('accept-encoding')
  const clientIp = request.headers.get('cf-connecting-ip') ?? getRequestIP({ xForwardedFor: true })
  if (clientIp) headers.set('x-forwarded-for', clientIp)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const response = await fetch(`https://${host}${path}${url.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  })

  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/ingest/$')({
  server: {
    handlers: {
      ANY: ({ request }) => forwardToPostHog(request),
    },
  },
})
```

The first experiment also called `headers.set('host', host)`; the wire checks show both runtimes ignore it and use the URL's host, so it is left out here. This exact route file was then dropped back into the Nitro app: `vite build` and `tsc --noEmit` pass, and `/ingest/static/array.js` 200, `/ingest/flags/?v=2` 401 `authentication_failed`, `/ingest/e/` 200 against real PostHog, as before. The browser and workerd runs above used the first version.

## Not verified

- A real `wrangler deploy` and a real Nitro deployment; a real PostHog project receiving the events (only a fake token: PostHog's 401 on `/flags` and 200 on `/e/` prove routing, not ingestion).
- `vite dev` for either runtime (only `vite build` + `start` / `vite preview`).
- Large bodies: PostHog asks for 64 MB (recordings). Not tested on Nitro (h3 / srvx limits) or on Workers (Cloudflare's request body limit depends on the plan).
- `getRequestIP` on workerd without Nitro: `cf-connecting-ip` took precedence, so the fallback branch was not exercised there.
- The evlog interaction: whether evlog's root-route middleware logs every `/ingest` request as a wide event (inferred from `handleServerRoutes`, not run).
- The `$` template filename through the CLI.
- Server capture delivery (only that `posthog-node` loads and runs in workerd).

## Open questions for the grilling ticket

1. **Env var naming on Start.** `VITE_POSTHOG_PROJECT_TOKEN` (PostHog's docs) through a new generic `EnvVar.stacks` filter, or another shape (a neutral server-side name returned to the client through a server function at runtime, or Vite `envPrefix` accepting `NEXT_PUBLIC_`)? The first matches PostHog and Vite conventions; the second makes the token a runtime value instead of build-time.
2. **Provider placement.** A library-owned component rendered from `___root.tsx.hbs` under `hasLibrary "posthog"` (the evlog pattern), or inline in the root template?
3. **evlog + `/ingest`.** Should the proxy be kept out of evlog's wide events on Start (Next.js excludes it from middleware)? If so, through which mechanism: a path check in the generated middleware, or evlog's own route options.
4. **Static asset caching on Workers.** PostHog's Cloudflare proxy caches `/static/*` and `/array/*` with `caches.default`; the server route does not. Worth adding under `cloudflare` (a `{{#if (has "deployment" "cloudflare")}}` block in the route template), or keep one identical file for both runtimes?
5. **Region.** Keep US hardcoded like Next.js, or add an EU choice for both stacks (a separate ticket)?
6. **Server-side capture.** Confirm it stays out of Spec 1, since the Next.js library has none.
