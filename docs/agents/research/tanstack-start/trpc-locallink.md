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

## 1. `localLink` and the `superjson` transformer

Verified against `@trpc/client` 11.19.0 (installed package source, identical to `main` on GitHub).

**Option name: `transformer`.** `LocalLinkOptions` is `{ router, createContext, onError? } & TransformerOptions<inferClientTypes<TRouter>>` ([localLink.ts](https://github.com/trpc/trpc/blob/main/packages/client/src/links/localLink.ts)). `TransformerOptions` makes `transformer` **required at the type level** when the router was built with a transformer, and a type error otherwise ([transformer.ts](https://github.com/trpc/trpc/blob/main/packages/client/src/internals/transformer.ts)). Because create-faster's `initTRPC` uses `transformer: superjson`, the link must be written `unstable_localLink({ router: appRouter, createContext, transformer: superjson })`.

**What it does with it: nothing, on purpose.** The link never calls `superjson.serialize`/`deserialize` when a transformer is passed:

```ts
const transformChunk = (chunk: unknown) => {
  if (opts.transformer) {
    return chunk;
  }
  // no transformer: JSON round trip through the identity transformer
  ...
};
```

- **Input:** `callProcedure` gets `getRawInput: async () => newInput`, the caller's value as is, in every case.
- **Output and error shapes:** passed through `transformChunk`, so returned unchanged when `transformer` is set.

So the answer to "both directions" is: neither direction is serialized. Values cross by reference, in memory, which is the same result superjson would produce for the types it supports (and more: a `Promise` survives too). tRPC's own test asserts exactly this: with `transformer: superjson`, a query returning `{ foo: Promise.resolve('bar') }` yields a real `Promise` ([localLink.test.ts, "with transformer"](https://github.com/trpc/trpc/blob/main/packages/client/src/links/localLink.test.ts)).

Without a `transformer`, outputs go through `JSON.parse(JSON.stringify(...))` and a `Date` comes back as a string (same file, "json serialization" test). With superjson on the router, that branch is unreachable for us because the option is mandatory.

The [docs page](https://trpc.io/docs/client/links/localLink) only says the option is "optional input/output transformers for serialization/deserialization of data" and that "transformation [is] handled automatically, just like with HTTP-based links". The source is more precise than the docs: passing the transformer tells the link that the caller understands rich types, so it skips the JSON flattening.

Consequences for the plan:

- Pass `transformer: superjson` to `unstable_localLink`; it is required by the types and keeps rich types intact.
- Returned objects are shared references with the procedure's own values. A procedure that returns a module-level cached object hands the caller the same instance. Harmless for the generated `hello.greet`, worth one line in docs.
- The name is `unstable_localLink`; `experimental_localLink` is a deprecated alias of it.

## 2. Memoizing the per-request context

### The problem, confirmed

- `localLink` calls `opts.createContext()` inside `runProcedure`, once per operation, with no argument ([localLink.ts](https://github.com/trpc/trpc/blob/main/packages/client/src/links/localLink.ts), `ctx = await opts.createContext()`). A page whose loaders prefetch three procedures runs the session lookup three times.
- The HTTP adapter behaves differently: `resolveResponse` creates the context once per HTTP request and shares it across every call in a batch (its `create` throws "This should only be called once" on a second call, [resolveResponse.ts](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/http/resolveResponse.ts)). Memoizing per SSR request restores parity with what the browser path already gets.
- `createContext` receives no request. The headers have to come from Start: `getRequestHeaders()` and `getRequest()` are exported by `@tanstack/react-start/server` (re-exported from `start-server-core`'s [request-response.ts](https://github.com/TanStack/router/blob/main/packages/start-server-core/src/request-response.ts)), and read the current request from an `AsyncLocalStorage`. They throw outside the server runtime.

### `getRouter()` is a per-request scope on the server

Verified in `@tanstack/start-server-core` 1.169.39, [createStartHandler.ts](https://github.com/TanStack/router/blob/main/packages/start-server-core/src/createStartHandler.ts): `routerPromise` is a `let` inside the per-request resolver, and `routerPromise ??= ... entries.routerEntry.getRouter()` calls the app's `getRouter()` once per request, memoized for that request (a comment notes it stays memoized for late streamed boundaries and server functions). Anything created inside `getRouter()` on the server is therefore request-scoped: the `QueryClient`, the options proxy, and a closure holding the context.

### Recommended pattern: memoize the promise in a closure built inside `getRouter()`

```ts
// src/trpc/client.ts (sketch, not yet run)
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { createTRPCClient, httpBatchLink, unstable_localLink } from '@trpc/client';
import superjson from 'superjson';
import { appRouter, createTRPCContext } from '...';

export const makeTRPCClient = createIsomorphicFn()
  .server(() => {
    let context: ReturnType<typeof createTRPCContext> | undefined;
    return createTRPCClient<AppRouter>({
      links: [
        unstable_localLink({
          router: appRouter,
          transformer: superjson,
          createContext: () => (context ??= createTRPCContext({ headers: getRequestHeaders() })),
        }),
      ],
    });
  })
  .client(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: '/api/trpc', transformer: superjson })],
    }),
  );
```

`getRouter()` then calls `makeTRPCClient()` and passes the result to `createTRPCOptionsProxy({ client, queryClient })`.

Why `createIsomorphicFn`: `router.tsx` is isomorphic, it runs and ships on both sides (the [execution model guide](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model) says all code is isomorphic unless constrained). Importing `appRouter`, `db` or `auth` there would put them in the client bundle. The Start compiler replaces `createIsomorphicFn()...` with the current environment's function only, then runs dead code elimination ([handleCreateIsomorphicFn.ts](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/start-compiler/handleCreateIsomorphicFn.ts), `deadCodeElimination` in [compiler.ts](https://github.com/TanStack/router/blob/main/packages/start-plugin-core/src/start-compiler/compiler.ts)), so the server-only imports drop out of the client build. Verified in source, not yet by inspecting a built bundle.

Points to settle when implementing:

- **Memoize the promise, not the value**, so concurrent loaders share one in-flight lookup. A rejected promise stays cached for the rest of that request; that is acceptable (the request fails either way) and simpler than retrying.
- **`createTRPCContext` signature.** The Next.js template takes `{ headers }` (plus `db` on D1). The same function serves the `/api/trpc` route (`createContext: () => createTRPCContext({ headers: request.headers })`) and the local link, so no second context builder is needed.
- **Alternative: a `WeakMap<Request, Promise<Context>>` keyed by `getRequest()`.** Same effect, and also reachable from a server function or an API route in the same request. It is only needed if something outside the router must share the memoized session; the better-auth ticket's `getSession` server function is the candidate. Not needed for tRPC alone.
- `React.cache`, which the Next.js template uses for `getQueryClient`, is not an option here: [it is only for use with React Server Components](https://react.dev/reference/react/cache), and Start renders without them by default.

Unverified: that `getRequestHeaders()` still resolves for a query that starts late in a streamed render. AsyncLocalStorage propagates through async continuations, and Start keeps the router memoized for late boundaries, so it should; the acceptance run should include a prefetch that is awaited inside a `Suspense` boundary to confirm.

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
