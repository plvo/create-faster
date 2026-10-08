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
