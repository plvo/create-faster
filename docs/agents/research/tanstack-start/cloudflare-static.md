# Static Cloudflare hosting for TanStack Start

Research for [#175](https://github.com/plvo/create-faster/issues/175), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: in progress.

## Question

The parity target is create-faster's `cloudflare-static` deployment: a Next.js static export served from Workers assets, with no Worker code. How is a TanStack Start app hosted the same way? Cover:

- full static prerender (`prerender` with `crawlLinks`) versus an SPA shell;
- the output directory;
- wrangler `assets` config without `main`;
- what stops working (server functions, server routes, libraries that need a server runtime).

What does `cloudflare-static` generate for Next.js today, and how does META restrict it (`require.stacks`, `providesServerRuntime: false`, `isServerRuntimeSatisfied`)?

## Outline

1. What `cloudflare-static` generates for Next.js today
2. How META restricts it
3. TanStack Start static output: prerender versus SPA shell
4. Output directory and wrangler `assets` without `main`
5. What stops working
6. Experiment: build and `wrangler dev` / `wrangler deploy --dry-run`
7. What create-faster would need (generic operators only)
8. Open questions

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
