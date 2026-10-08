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

## Outline

- Answer
- posthog-js on TanStack Start
- `/ingest` reverse proxy as a server route
- Server-side capture
- Local verification (Nitro and workerd)
- Proposed META and template shape
- Open questions
