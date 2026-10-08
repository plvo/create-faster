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
