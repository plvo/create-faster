# tRPC `localLink` on TanStack Start: superjson, per-request context, dehydration

**Date:** 2026-10-08
**Ticket:** #178 (map #170, TanStack Start parity)
**Status:** draft, primary-source verification in progress

## Question

Planned tRPC setup on TanStack Start:

- SSR calls run in memory through `unstable_localLink`;
- browser calls go through `httpBatchLink`;
- one `QueryClient` and one tRPC options proxy per request, created in `getRouter()`;
- `setupRouterSsrQueryIntegration` wires TanStack Query into the router.

To verify:

1. Does `localLink` apply the router's `superjson` transformer in both directions, and under which option name?
2. `createContext` runs once per procedure call. How do we memoize the per-request context (session lookup)?
3. Do superjson-specific types survive dehydration through Start's serializer?
4. What does create-faster's `trpc` library generate for Next.js today?

## Short answer

Pending verification against the tRPC 11, TanStack Router and seroval sources.

## 4. What the `trpc` library generates for Next.js today

Verified by reading the templates on `main` (f7d2b0b).

### META

`apps/cli/src/__meta__.ts` lines 240-274, `trpc`:

- `support: { stacks: ['nextjs'] }`, `needsServerRuntime: true`, `needsSingletonDb: true`;
- turborepo: router and context live in `packages/api` (`mono: { scope: 'pkg', name: 'api' }`);
- package dependencies: `@trpc/server ^11.18.0`, `superjson ^2.2.6`, `zod ^4.5.4`;
- app dependencies (`appPackageJson`): `@trpc/client`, `@trpc/server` and `@trpc/tanstack-react-query` at `^11.18.0`, `server-only`, `superjson`.

### Files

All under `apps/cli/templates/libraries/trpc/`:

| File | Generates |
| --- | --- |
| `src/trpc/init.ts.hbs` | `createTRPCContext` (session via `auth.api.getSession` when better-auth is selected; `db` when an ORM is selected; a `{ headers, db }` argument on D1), `initTRPC.context().create({ transformer: superjson })`, `publicProcedure`, `protectedProcedure` (better-auth) |
| `src/trpc/routers/_app.ts.hbs`, `routers/hello.ts.hbs` | `appRouter` with a `hello.greet` query, `AppRouter`, `RouterInput`, `RouterOutput` |
| `src/app/api/trpc/[trpc]/route.ts.hbs` | `fetchRequestHandler` at `/api/trpc`, `createContext` built from `req.headers` |
| `src/trpc/client.ts.hbs` | a vanilla `createTRPCClient` with `httpBatchLink({ transformer: superjson })` |
| `src/trpc/query-client.ts.hbs` (tanstack-query only) | `makeQueryClient()`: `staleTime` 30 s, dehydrates pending queries too, `serializeData: superjson.serialize`, `deserializeData: superjson.deserialize` |
| `src/trpc/providers.tsx.hbs` (tanstack-query only) | `createTRPCContext<AppRouter>()` from `@trpc/tanstack-react-query` (`TRPCProvider`, `useTRPC`, `useTRPCClient`), a browser singleton query client, `TRPCReactProvider` with `httpBatchLink({ transformer: superjson })` |
| `src/trpc/server.tsx.hbs` | with tanstack-query: `getQueryClient = cache(makeQueryClient)`, `createTRPCOptionsProxy({ ctx, router: appRouter, queryClient: getQueryClient })`, `HydrateClient` (`dehydrate` into `HydrationBoundary`), `prefetch()`; without tanstack-query: `appRouter.createCaller(createTRPCContext)` |
| `src/index.ts.hbs`, `tsconfig.json.hbs` | turborepo only: the `@repo/api` package entry and tsconfig |

`apps/cli/templates/stack/nextjs/src/components/app-providers.tsx.hbs` wraps the app in `TRPCReactProvider` when both `trpc` and `tanstack-query` are selected.

Blueprints (`org-dashboard`, `multitenant-saas`, `cloudflare-fullstack`) use the pattern `void prefetch(trpc.x.queryOptions(...))` then `<HydrateClient>` in a server component page.
