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
