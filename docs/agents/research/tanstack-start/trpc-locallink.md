# tRPC `localLink` on TanStack Start: superjson, per-request context, dehydration

**Date:** 2026-10-08
**Ticket:** #178 (map #170, TanStack Start parity)
**Status:** complete. Versions read: `@trpc/client`, `@trpc/server`, `@trpc/tanstack-react-query` 11.19.0; `@tanstack/react-start` 1.168.60 (`start-server-core` 1.169.39, `start-plugin-core` 1.171.49, `router-core` 1.171.34); `@tanstack/router-ssr-query-core` 1.169.3; `@tanstack/query-core` 5.104.1; `seroval` 1.6.8; `superjson` 2.2.6.

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

Verified against `@trpc/client` 11.19.0 (installed package source). `main` on GitHub (2026-10-08) differs only inside the subscription loop; the transformer and context code quoted below is identical.

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

### Why `localLink` and not the `{ router, ctx }` options proxy

`createTRPCOptionsProxy` also accepts `{ router, ctx, queryClient }` and then calls procedures in memory itself; that is what the Next.js `server.tsx` uses. Read in [createOptionsProxy.ts](https://github.com/trpc/trpc/blob/main/packages/tanstack-react-query/src/internals/createOptionsProxy.ts): it resolves `ctx` on every call too (`unwrapLazyArg(opts.ctx)`), passes `signal: undefined`, and returns raw server errors rather than `TRPCClientError`. More decisive for Start: `TRPCProvider` only takes a `trpcClient` ([Context.tsx](https://github.com/trpc/trpc/blob/main/packages/tanstack-react-query/src/internals/Context.tsx)), and the provider also renders during SSR. A `localLink` client is the one object that serves the provider, `useTRPCClient()`, and the router-context options proxy alike on the server, while `httpBatchLink` does the same in the browser. The plan's choice holds.

For comparison, the official TanStack CLI tRPC add-on ([root-provider.tsx.ejs](https://github.com/TanStack/cli/blob/main/packages/create/src/frameworks/react/add-ons/tanstack-query/assets/src/integrations/tanstack-query/root-provider.tsx.ejs)) does not use `localLink`: it builds one module-level client with `httpBatchStreamLink` pointing at `http://localhost:${PORT}/api/trpc` during SSR, so SSR makes an HTTP loopback request and forwards no cookies. It does create a fresh `QueryClient` and options proxy inside `getContext()`, with the same superjson `serializeData`/`deserializeData` pair. That is a weaker design for authenticated data and for Workers, and confirms the planned one is not the beaten path: expect to verify it end to end.

## 3. Do superjson types survive dehydration through Start's serializer?

### How the integration dehydrates

Read in [router-ssr-query-core/src/index.ts](https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts) (installed 1.169.3, identical to `main`):

- On the server it wraps `router.options.dehydrate`. Each query goes through `dehydrateQuery(query, serializeData, shouldRedactErrors)`, where `serializeData` is `dehydrateOptions?.serializeData ?? queryClient.getDefaultOptions().dehydrate?.serializeData`. So **a `QueryClient` built with `defaultOptions.dehydrate.serializeData: superjson.serialize` is honored without passing anything to `setupRouterSsrQueryIntegration`.**
- Same fallback for `shouldDehydrateQuery`, except that the integration's own default is **every query** (`shouldDehydrateAllQueries`), not query-core's success-only default.
- Queries settled before dehydration go in `query.initial`; queries still pending go into a `ReadableStream` and are flushed as they settle. A pending query's `promise` is dehydrated as `query.promise.then(serializeData)` ([query-core hydration.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/hydration.ts)).
- On the client, it calls query-core's `hydrate(queryClient, …, hydrateOptions)`, which falls back to `client.getDefaultOptions().hydrate?.deserializeData`, including for streamed promises (`Promise.resolve(promise).then(deserializeData)`).

The whole dehydrated router state is then written into the HTML by seroval's `crossSerializeStream` with Start's SSR plugins: `ShallowErrorPlugin`, `RawStreamSSRPlugin`, `ReadableStreamPlugin` ([ssr-server.ts](https://github.com/TanStack/router/blob/main/packages/router-core/src/ssr/ssr-server.ts), [seroval-plugins.ssr.ts](https://github.com/TanStack/router/blob/main/packages/router-core/src/ssr/serializer/seroval-plugins.ssr.ts)), plus any `serializationAdapters` the app registers with `createStart`.

### Experiment

A throwaway script (kept outside the repo) used the real pieces: query-core `dehydrate` and `hydrate`, `crossSerializeStream` with Start's `ssrSerovalPlugins` imported from `router-core`, and evaluation of the emitted script in the same realm, as the browser does. It covered a settled query, a query still pending at dehydration time (streamed promise) and a failed query.

Per type, **without** `serializeData` (seroval alone):

| Value | Result |
| --- | --- |
| `Date`, `Map`, `Set`, `bigint`, `RegExp`, `undefined`, `NaN`, `-0` | survive |
| `URL` | **throws** `SerovalUnsupportedTypeError` |
| a class registered with `superjson.registerCustom` | **throws** `SerovalUnsupportedTypeError` |

**With** `serializeData: superjson.serialize` and `deserializeData: superjson.deserialize`: every type above, `URL` and the custom class included, arrives with its original type, for the settled query and for the streamed pending query alike. Seroval then only carries superjson's `{ json, meta }`, which is plain JSON.

A failed query, in both modes, arrives as a bare `Error` with only its `message`: `ShallowErrorPlugin` serializes `new Error(message)` and nothing else ([ShallowErrorPlugin.ts](https://github.com/TanStack/router/blob/main/packages/router-core/src/ssr/serializer/ShallowErrorPlugin.ts)), and `serializeData` never touches errors. A `TRPCClientError` loses its class and `data` (`code`, `httpStatus`, zod issues).

### Answer

Yes, provided the `QueryClient` keeps the superjson `serializeData`/`deserializeData` pair, as the Next.js `makeQueryClient()` already does. Without it, the common types still survive thanks to seroval, but `URL`, superjson custom types and any class seroval does not know break the SSR render instead of degrading.

Two consequences for implementation:

- **Reuse `makeQueryClient()` unchanged**, including its `shouldDehydrateQuery` (success or pending). Since the integration falls back to the client's default, failed queries are then not dehydrated and the browser refetches them, which sidesteps the shallow-error loss. Passing no `shouldDehydrateQuery` anywhere would ship every failed query as a bare `Error`.
- An alternative would be registering superjson as a Start `serializationAdapter`. Not needed: the query data path is fully covered by `serializeData`, and an adapter would only matter for loader return values and server functions, which tRPC does not use.

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
