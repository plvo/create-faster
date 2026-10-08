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

## Outline

- Answer
- posthog-js on TanStack Start
- `/ingest` reverse proxy as a server route
- Server-side capture
- Local verification (Nitro and workerd)
- Proposed META and template shape
- Open questions
