# Static Cloudflare hosting for TanStack Start

Research for [#175](https://github.com/plvo/create-faster/issues/175), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: complete (2026-10-08).

## Question

The parity target is create-faster's `cloudflare-static` deployment: a Next.js static export served from Workers assets, with no Worker code. How is a TanStack Start app hosted the same way? Cover:

- full static prerender (`prerender` with `crawlLinks`) versus an SPA shell;
- the output directory;
- wrangler `assets` config without `main`;
- what stops working (server functions, server routes, libraries that need a server runtime).

What does `cloudflare-static` generate for Next.js today, and how does META restrict it (`require.stacks`, `providesServerRuntime: false`, `isServerRuntimeSatisfied`)?

## Answer

**TanStack Start reaches `cloudflare-static` parity with full static prerendering, built by Start alone, without Nitro and without `@cloudflare/vite-plugin`.** The recipe below was verified locally: build, typecheck, `wrangler deploy --dry-run`, and `wrangler dev` with a browser. Nothing was deployed.

- **`vite.config.ts`**: drop `nitro()` and keep `tanstackStart({ prerender: { enabled: true, crawlLinks: true, autoSubfolderIndex: false } })`. Start's post-build step starts its own `vite.preview()` server on the SSR build. It prerenders every static route (`autoStaticPathsDiscovery`, on by default) plus every same-origin `<a href>` it finds (`crawlLinks`, on by default), so dynamic pages linked from other pages are included. `autoSubfolderIndex: false` writes `about.html` instead of `about/index.html`, which avoids the 307 trailing-slash redirect that Workers' default `html_handling` adds for folder indexes.
- **Output directory**: **`dist/client`**, which is Vite's client environment `outDir` (`build.outDir` default `dist` + `client`). With Nitro left in, the same pages land in `.output/public` next to an unused server bundle. `dist/server/server.js` is built because the prerenderer needs it, but it is not deployed.
- **`wrangler.jsonc`**: the Next.js template with only the directory changed: `{ name, compatibility_date, assets: { directory: "dist/client", not_found_handling: "404-page" } }`, with **no `main`**. `wrangler deploy --dry-run` reads only assets.
- **`@cloudflare/vite-plugin` is the wrong tool here.** With no `main`, its preview is assets-only and the prerender fails on `GET /`. With `main`, plain `wrangler deploy` follows the plugin's `.wrangler/deploy/config.json` redirect and ships a full Worker.
- **What stops working** (no server at request time):
  - server routes return 404;
  - server functions return 404 (`/_serverFn/<id>`) and throw `Invariant failed`;
  - a route whose `loader` calls a server function works on a direct load (the build-time result is embedded in the HTML), but on client navigation it re-runs in the browser, fails, and shows the error component;
  - request middleware runs only at build time;
  - dynamic routes that no page links to are not generated;
  - there is no `404.html` unless the app provides one.

  Libraries that need a runtime (better-auth, tRPC, PostHog's proxy) are already excluded by `needsServerRuntime`.
- **SPA shell** (documented upstream, not offered by the CLI, per map #170): it works on Workers with `spa.prerender.outputPath: '/index'` and `not_found_handling: "single-page-application"`. However, every unmatched URL, including `/api/*` and `/_serverFn/*`, then returns **200 with the HTML shell**, so server calls fail silently. Full prerender plus `404-page` fails loudly, which is the safer default.
- **META today**: `cloudflare-static` is `require: { stacks: ['nextjs'] }` + `providesServerRuntime: false`. `isServerRuntimeSatisfied` already excludes runtime-dependent libraries for any stack. Adding Start means data (`require.stacks`, `stackPackageJson['tanstack-start']`), templates (a `wrangler.jsonc.tanstack-start.hbs`, conditionals in `vite.config.ts.hbs`), frontmatter (`deploymentSkip` on `.env.start`), and the `$when` negation operator the map already settled (to drop `nitro` and `start`). No core branch on a choice value is needed.

The one piece with no clean answer is the **404 page**. Start's prerenderer refuses non-2xx responses, so a not-found render cannot be written as `404.html` directly. Both workarounds tried (a `/404` route, or the SPA shell written to `404.html`) render correctly but log React hydration error #418 on unknown URLs (section 6, Experiment 1b). This goes to the HITL ticket [#182](https://github.com/plvo/create-faster/issues/182).

## 1. What `cloudflare-static` generates for Next.js today

Read on `main` at `f7d2b0b`.

- **META entry** (`apps/cli/src/__meta__.ts`, `project.deployment.options['cloudflare-static']`): label "Cloudflare Workers (static)", `require: { stacks: ['nextjs'] }`, `providesServerRuntime: false`, `wrangler ^4.127.1` as a devDependency for every app, and `stackPackageJson.nextjs.scripts`:
  - `deploy`: `next build && wrangler deploy`;
  - `preview`: `wrangler dev`;
  - `cf-typegen`: `wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts`.

  No `mono` key, so it is app-scoped, and no `stackPackageJson` for any other stack (asserted in `apps/cli/tests/unit/lib/cloudflare-static.test.ts`).
- **`apps/cli/templates/project/deployment/cloudflare-static/wrangler.jsonc.nextjs.hbs`**, the only template of the option. The `.nextjs` suffix makes `resolveStackSpecificAddonTemplatesForApps` (`apps/cli/src/lib/template-resolver.ts`) emit it once per Next.js app, into the app directory. Content: `name` (app name in Turborepo, project name in single), `compatibility_date: "2026-06-12"`, and `assets: { directory: "out", not_found_handling: "404-page" }`. There is **no `main`**: an assets-only Worker.
- **`apps/cli/templates/stack/nextjs/next.config.ts.hbs`**: under `{{#if (has "deployment" "cloudflare-static")}}`, `output: 'export'` and `images: { unoptimized: true }`.
- **`apps/cli/templates/stack/nextjs/src/proxy.ts.hbs`**: frontmatter `deploymentSkip: [cloudflare-static]`, so no request interceptor is generated. `deploymentSkip` is honoured by `resolveTemplatesForStack` only.
- **`.gitignore`** (`apps/cli/templates/repo/{single,turborepo}/__gitignore.hbs`): `.wrangler/` and `cloudflare-env.d.ts` under `cloudflare` or `cloudflare-static`. `out/` was already ignored.
- **Blueprint `cloudflare-static-site`**: a single Next.js app with `shadcn` and `mdx` and `deployment: 'cloudflare-static'`. It is the only blueprint on this deployment.
- **Docs**: `apps/www/content/docs/deployment/cloudflare-static.mdx` describes all of the above and states the option is Next.js only.

So the whole Next.js recipe is: one framework switch (`output: 'export'`), one disabled server feature (image optimization), one skipped server file (`proxy.ts`), and an assets-only `wrangler.jsonc` pointed at the framework's static output directory.

## 2. How META restricts it

All three checks are generic and read META data; none names `cloudflare-static`.

- **`require.stacks: ['nextjs']`**: `isRequirementMet` (`apps/cli/src/lib/addon-utils.ts`) passes when **at least one** app is on a listed stack (`ctx.apps.some(...)`). It does not require every app to be Next.js. In a Turborepo with a Next.js app and a TanStack Start app, `cloudflare-static` is accepted today, and the Start app silently gets no `wrangler.jsonc`, no deploy scripts and its default Nitro build. That is a latent gap, independent of this research.
- **`providesServerRuntime: false`** on the deployment, read by **`isServerRuntimeSatisfied(addon, ctx)`**: when the deployment does not provide a runtime, it fails if **any** selected library on **any** app declares `needsServerRuntime: true`. Today that is `better-auth`, `trpc` and `posthog` (posthog because its `/ingest` proxy is a Next.js rewrite). All three are `support.stacks: ['nextjs']` today.
- **Where it is enforced**: `getCategoryOptionUnavailability` renders the option disabled with a reason in the interactive prompt (`requires an app on stack: nextjs`, or a "needs a server runtime" reason naming the blocking library), and `validateContext` in `apps/cli/src/flags.ts` exits with an error for the same two cases in flag mode.

Consequence for TanStack Start: the server-runtime half is already stack-agnostic. Once better-auth or tRPC gain `tanstack-start` support with `needsServerRuntime: true`, they are excluded from `cloudflare-static` with no new code. The stack half is a data change, `require.stacks: ['nextjs', 'tanstack-start']`, plus templates.

## 3. TanStack Start static output: prerender versus SPA shell

Sources: the guides [Static Prerendering](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/static-prerendering.md), [SPA mode](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/spa-mode.md) and [Static Server Functions](https://github.com/TanStack/router/blob/main/docs/start/framework/react/guide/static-server-functions.md); the source of `@tanstack/start-plugin-core` 1.171.49 (the version `@tanstack/react-start` 1.168.60 installs): [`schema.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/schema.ts), [`post-build.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/post-build.ts), [`prerender.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/prerender.ts), [`vite/prerender.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/vite/prerender.ts), [`vite/output-directory.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/vite/output-directory.ts).

**How prerendering runs (Vite).** In the `buildApp` hook after the client and SSR builds, `postServerBuild` calls `postBuild`, which calls `prerenderWithVite`. That function starts `vite.preview({ configFile, preview: { port: 0 } })` on the built SSR environment, `fetch`es each page from it, and writes the HTML into the client environment's `build.outDir`. It does not depend on Nitro or a platform adapter: whatever `vite preview` serves is what gets prerendered. Without an adapter, Start's own `previewServerPlugin` serves the SSR bundle on Node.

**Full prerender options** (`tanstackStart({ prerender: {...}, pages: [...] })`):

- `enabled`. If unset, prerender is on only when some `pages[]` entry enables it (`post-build.ts`).
- `autoStaticPathsDiscovery`, default `true`: adds every static route. Routes with params, pathless layouts and routes without a component (server routes) are excluded.
- `crawlLinks`, default `true`: regex-extracts `<a href>` values that start with `/` or `./` from each rendered page and queues them. This is how linked dynamic pages (`/posts/1`) get generated.
- `autoSubfolderIndex`, default `true`: `/about` is written to `about/index.html`. With `false` it is written to `about.html`.
- `filter`, `concurrency` (defaults to the CPU count), `retryCount`, `retryDelay`, `maxRedirects` (redirects are followed, same origin only), `failOnError` (default `true`), `onSuccess`, and per-request `headers`.
- Any non-2xx response throws (`if (!res.ok) throw new Error('Failed to fetch ...')`). A not-found page therefore cannot be prerendered by asking for an unknown path.
- `sitemap` is written only when a `sitemap` object is configured (`sitemap.host` for absolute URLs).

**SPA mode** (`spa: { enabled, maskPath = '/', prerender }`): `postBuild` forces prerender on and pushes a page `{ path: maskPath }` requested with the `TSS_SHELL` header. The server renders only the root route, with the pending fallback in place of matched routes. SPA prerender defaults are `outputPath: '/_shell'`, `crawlLinks: false`, `retryCount: 0`, and the shell is written as `<outputPath>.html`. Other routes may still be prerendered alongside it, because `autoStaticPathsDiscovery` stays on. The docs' deployment advice is "rewrite all 404s to `/_shell.html`, and allow-list `/_serverFn/*` and `/api/*` to a server", which assumes a server exists.

**Static server functions** (experimental upstream): `staticFunctionMiddleware` from `@tanstack/start-static-server-functions` runs a GET server function at build time and stores its result as a JSON file. Later client calls fetch that file. This is the documented way to keep a loader that calls a server function working on client navigation in a static build. I did not test it.

## 4. Output directory and wrangler `assets` without `main`

- **Output directory.** `getClientOutputDirectory` returns `environments.client.build.outDir`, else `join(build.outDir ?? 'dist', 'client')`. So it is **`dist/client`** for Start alone, `.output/public` with Nitro (Experiment 2), and `dist/client` with the Cloudflare plugin (Experiment 3).
- **Wrangler.** An assets-only Worker is a Wrangler config with `assets.directory` and no `main` ([Static assets](https://developers.cloudflare.com/workers/static-assets/), [SSG routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)). Relevant routing facts from Cloudflare's docs:
  - `html_handling` defaults to `auto-trailing-slash`: `foo.html` is served at `/foo`, and `foo/index.html` at `/foo/`, with a 307 redirect from `/foo`. Matching the router's no-trailing-slash URLs needs `autoSubfolderIndex: false`, or `html_handling: "drop-trailing-slash"` (not tested).
  - `not_found_handling: "404-page"` serves the nearest `404.html` with status 404. If there is none, the response is 404 with an empty body.
  - `not_found_handling: "single-page-application"` serves `/index.html` with status 200 for any unmatched request when there is no Worker script. The `Sec-Fetch-Mode: navigate` distinction applies only when a Worker script exists.
- **Cloudflare's own TanStack Start guide** ([framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), [source](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/framework-guides/web-apps/tanstack-start.mdx)) documents "Static prerendering" only on top of the Worker (`main: "@tanstack/react-start/server-entry"` with the Vite plugin): prerendered pages are served as assets, and the Worker serves everything else. It has no assets-only recipe for Start. Its auto-configuration (`wrangler deploy` with no config) assumes the Nitro output (`main: .output/server/index.mjs`, `assets.directory: .output/public`).

## 5. What stops working

Verified in Experiments 1, 1b and 4 unless noted.

| Feature | Static build on Workers assets |
|---|---|
| Static routes, linked dynamic pages | Prerendered HTML. They hydrate, and client navigation between them works. |
| Dynamic pages not reachable by a link | Not generated. 404 (or the shell, see section 6). |
| Route `loader` with plain client code | Runs at build time for the HTML, then in the browser on client navigation. |
| Route `loader` calling a server function | Direct load works with the build-time value. On client navigation the call goes to `/_serverFn/<id>`, which returns 404, and the route shows its error component. |
| `createServerFn` called from an event handler | 404, `Error: Invariant failed`. In SPA mode, 200 with HTML, failing silently. |
| Server routes (`server.handlers`) | Not prerendered (no component). 404, or the HTML shell in SPA mode. |
| Request and server-function middleware | Runs only during the build-time prerender. |
| `cloudflare:workers` bindings, env secrets at request time | None. No Worker exists. |
| Libraries with `needsServerRuntime: true` (better-auth, tRPC, PostHog's `/ingest` proxy) | Already rejected for `cloudflare-static` by META. Once they support `tanstack-start` they are rejected for it with no extra code. |
| evlog | Builds. It runs only at prerender time, so it is inert, as it is on Next.js `cloudflare-static` today (Experiment 5). |

Development is a trap here, and it is not specific to Start: `vite dev` runs a real SSR server, so server functions and server routes work locally and only fail after the static build. On Next.js, `output: 'export'` makes `next build` fail on unsupported server features. Start has no equivalent guard: the static build succeeds with a server route and a server function present (Experiment 1).

## 6. Experiments (local only, no real deploy)

Setup: `create-faster startstatic --app startstatic:tanstack-start:shadcn,tanstack-query --pm bun` from this branch's CLI (`main` at `f7d2b0b`), installed `@tanstack/react-start 1.168.60` (npm `latest` on 2026-10-08), `@tanstack/start-plugin-core 1.171.49`, `vite 8.3.4`, `wrangler 4.149.0` (npm `latest`, inside the repo's `^4.127.1` range). Added test routes: `/about` (static), `/posts/$id` (dynamic, linked from `/` as `/posts/1`), `/time` (loader that calls a `createServerFn`, plus a button calling it again), `/api/hello` (server route).

### Experiment 1: Start alone, no Nitro, no Cloudflare plugin

`vite.config.ts` with only `tailwindcss()`, `tanstackStart({ prerender: { enabled: true, crawlLinks: true } })`, `viteReact()`. `vite build`:

- Prerendered `/`, `/about`, `/time` (auto-discovered static routes) and `/posts/1` (found by crawling the link from `/`). `/api/hello` is not prerendered (no component).
- Output: `dist/client/index.html`, `dist/client/about/index.html`, `dist/client/time/index.html`, `dist/client/posts/1/index.html`, plus `dist/client/assets/`. `dist/server/server.js` is also built (the prerenderer needs it) but is not deployed.
- No `404.html` and no `sitemap.xml` are produced.

Assets-only `wrangler.jsonc`, no `main`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "startstatic",
  "compatibility_date": "2026-06-12",
  "assets": { "directory": "dist/client", "not_found_handling": "404-page" }
}
```

`wrangler deploy --dry-run`: "Read 17 files from the assets directory .../dist/client", "No bindings found.", exits cleanly.

`wrangler dev --port 8791`, requests with curl:

| Path | Result |
|---|---|
| `/` | 200 |
| `/about` | 307 to `/about/` (then 200) |
| `/posts/1` | 307 to `/posts/1/` |
| `/time` | 307 to `/time/` |
| `/posts/2` (not crawled) | 404, empty body |
| `/api/hello` (server route) | 404, empty body |
| `/nope` | 404, empty body |

In Chrome against `wrangler dev`:

- Direct load of `/time/`: the page hydrates, the loader value baked at build time is shown. Clicking the button calls the server function: `GET /_serverFn/<id>` returns 404 and the call throws `Error: Invariant failed`.
- From `/`, client navigation to `/about` and `/posts/1` works (URL without trailing slash, content rendered).
- From `/`, client navigation to `/time` runs the loader in the browser, which calls `/_serverFn/<id>`, gets 404, and the route renders the default error component "Something went wrong!".

### Experiment 1b: flat HTML files and a 404 page

**`prerender.autoSubfolderIndex: false`** writes `about.html`, `time.html`, `posts/1.html` instead of `<path>/index.html`. With the default Workers assets `html_handling` (`auto-trailing-slash`), `/about` then returns 200 directly and `/about/` redirects 307 to `/about`, which matches the router's URLs. This is the same shape as a Next.js export with the default `trailingSlash: false`.

**A 404 page.** Start's prerenderer throws on any non-2xx response (`if (!res.ok) throw`, [`prerender.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/prerender.ts)), so a not-found render cannot be prerendered directly. Two workarounds were tried:

1. **A `/404` route** (`src/routes/404.tsx`), auto-discovered and written to `404.html`. Workers serves it with status 404 for `/nope`. In the browser the router re-matches `/nope` on hydration: with no root `notFoundComponent` it swaps the page for the router's default "Not Found"; with the same component set as the root `notFoundComponent` the visible result is correct. Both log React hydration error #418. `/404` itself is also reachable with status 200.
2. **The SPA shell as the 404 page.** Set `spa: { enabled: true, maskPath: '/?shell', prerender: { outputPath: '/404' } }` next to `prerender: { enabled: true, crawlLinks: true, autoSubfolderIndex: false }`. The build then writes the full pages (`index.html`, `about.html`, `time.html`, `posts/1.html`) plus a root-only shell at `404.html`. Workers serves the shell with status 404 for any unknown path:
   - `/posts/2`, a dynamic page that was not crawled, renders "Post 2" on the client with no console error. The HTTP status is still 404.
   - `/nope` renders the root `notFoundComponent`, but React still logs #418.
   - `/about` loads and hydrates with no console error.

   The `/?shell` mask path matters. With the default mask `/`, the shell takes the `/` slot in the prerenderer's `seen` set, so `index.html` is never written and nothing is crawled, because SPA prerender options force `crawlLinks: false` ([`schema.ts`](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/schema.ts) `spaSchema`). A mask that matches no route (`/__shell`) fails the build with `Failed to fetch /__shell: Not Found`. `/?shell` is a distinct key that still matches the `/` route. This is a workaround I found by reading the source; it is not documented upstream.

### Experiment 2: today's Nitro template with prerender

The generated `vite.config.ts` (with `nitro()`, preset `node-server`) plus the same `prerender` options: the build writes `.output/server/` and prerenders the same pages into **`.output/public/`** (`index.html`, `about.html`, `time.html`, `posts/1.html`). So an assets-only Worker could point at `.output/public`, but the Nitro server bundle is built for nothing. Nitro 3 ships `static`, `cloudflare-pages-static` and other static presets (`node_modules/nitro/dist/_presets.mjs`), but `cloudflare-pages-static` targets Cloudflare Pages, which create-faster does not use, and Start's own prerenderer already does the work. I did not test Nitro's static presets with Start.

### Experiment 3: `@cloudflare/vite-plugin` with prerender

`cloudflare({ viteEnvironment: { name: 'ssr' } })` added to the Experiment 1b config, `@cloudflare/vite-plugin 1.63.1` (npm `latest`):

- **With the assets-only `wrangler.jsonc` (no `main`)**: the build fails. The plugin's preview server is then assets-only, so the prerenderer's `GET /` returns 404 (`Error: Failed to fetch /: Not Found`).
- **With `main: "@tanstack/react-start/server-entry"`**: the prerender succeeds into `dist/client/`. The plugin also writes `dist/server/index.js`, `dist/server/wrangler.json` (`main: "index.js"`, `assets.directory: "../client"`) and the redirect file `.wrangler/deploy/config.json` → `dist/server/wrangler.json`. A plain `wrangler deploy --dry-run` follows the redirect and would upload a **full Worker** (17 modules, 208 KiB of server code, plus assets), which is not a static deploy. Only `wrangler deploy --config wrangler.static.jsonc`, a second assets-only file, uploads the assets alone (Total Upload 0.31 KiB).

So the Cloudflare plugin adds nothing to a static deploy and needs two Wrangler configs to avoid shipping a Worker. Its one benefit would be prerendering in workerd with local bindings, which a site without a runtime does not need.

### Experiment 4: SPA mode (documented, not offered)

`tanstackStart({ spa: { enabled: true, prerender: { outputPath: '/index' } }, prerender: { autoStaticPathsDiscovery: false, ... } })` writes a single root-only shell at `dist/client/index.html`, and `wrangler.jsonc` uses `not_found_handling: "single-page-application"`. Workers serves `/index.html` with status 200 for any path that does not match a file. Cloudflare's docs say the `Sec-Fetch-Mode: navigate` check only matters when a Worker script is present ([routing diagram](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/), [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)), and there is none here.

- `/posts/7`, `/about` and `/nope` all return 200 with the shell and render on the client. `/posts/7` shows "Post 7".
- **Silent failure**: `/api/hello` and `GET /_serverFn/<id>` (sent with `Sec-Fetch-Mode: cors` and `Accept: application/json`) also return **200 with the HTML shell**. In the browser, client navigation to `/time` calls the server function, gets HTML, and renders an empty loader value **with no error in the console**. In 404-page mode the same call at least fails loudly.
- The shell output path has to be `/index` to match `single-page-application`, which always serves `/index.html`. The default `/_shell.html` would be ignored by Workers.

### Experiment 5: evlog on a static Start app

`create-faster startevlog --app startevlog:tanstack-start:evlog`, `nitro()` removed and prerender enabled: the build and prerender succeed. The root route's `evlogErrorHandler` middleware from `evlog/nitro/v3` runs only during the build-time prerender. The generated `nitro.config.ts` is dead code. A static site has no request-time events, so evlog does nothing useful there. On Next.js, `cloudflare-static` already skips `proxy.ts`, which carries the evlog middleware, so evlog is equally inert there today, and META allows it.

### Cleanup

All builds stayed in this ticket's scratch directory. Each `wrangler dev` was stopped after use. Nothing was deployed.
