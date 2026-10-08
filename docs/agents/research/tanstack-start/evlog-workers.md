# evlog on TanStack Start without Nitro, on Cloudflare Workers

Research for [#176](https://github.com/plvo/create-faster/issues/176), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: draft, research in progress.

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

## Answer

To be written.

## Verified facts

To be written.

## Inferences

To be written.

## Sources

To be written.
