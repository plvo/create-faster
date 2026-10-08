# PostHog on TanStack Start

Research for [#174](https://github.com/plvo/create-faster/issues/174), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: in progress.

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
