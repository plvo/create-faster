# Module-level db on Workers through `cloudflare:workers`

Research for [#171](https://github.com/plvo/create-faster/issues/171), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: draft, research in progress.

## Question

On TanStack Start deployed with `@cloudflare/vite-plugin`, bindings can be imported at module scope (`import { env } from 'cloudflare:workers'`). Can better-auth and tRPC use a module-level Drizzle `db` built from them? Answer separately for D1 and for postgres/mysql through Hyperdrive. Otherwise they stay per-request, like the Next.js D1 wiring (`getDb()` / `getAuth()` in the app's `src/lib/server.ts`).

Cover:

- reuse of I/O objects across requests on Workers;
- connection lifetime for `pg` and `mysql2` behind Hyperdrive;
- what the answer implies for META's `needsSingletonDb`, `serverlessBinding`, `serverlessConsumersWired` and `isSingletonDbSatisfied`.

## Answer

To be written.

## Verified facts

### Workers runtime rules

1. `env` imported from `cloudflare:workers` is readable at module scope, but "Workers do not allow I/O from outside a request context": secrets, variables and stub creation work at top level, calling binding methods (KV, service bindings, Durable Object stub methods) does not. ([Bindings, importing `env` as a global](https://developers.cloudflare.com/workers/runtime-apis/bindings/#importing-env-as-a-global))
2. Global scope forbids more than I/O. workerd throws `Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope.` from `IoContext::current()` when no request is active. ([workerd `io-context.c++`](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/io-context.c%2B%2B))
3. `crypto.getRandomValues()` and `crypto.randomUUID()` both go through `IoContext::current()`, so both throw at global scope. ([workerd `crypto.c++`, `Crypto::getRandomValues` and `Crypto::randomUUID`](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/crypto.c%2B%2B))
4. I/O objects created in one request's handler cannot be used from another request: `Cannot perform I/O on behalf of a different request. I/O objects (such as streams, request/response bodies, and others) created in the context of one request handler cannot be accessed from a different request's handler.` ([Workers errors](https://developers.cloudflare.com/workers/observability/errors/#cannot-perform-io-on-behalf-of-a-different-request), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#do-not-store-request-scoped-state-in-global-scope))
5. A binding-only redeploy may reuse running isolates, so a client built at global scope from `env` can outlive a changed secret or binding; Cloudflare's recommended approach is "to create a new client instance for each request". ([Bindings, making changes to bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/#making-changes-to-bindings))

To be continued: TanStack Start module evaluation timing, D1, Hyperdrive drivers, better-auth construction.

## Inferences

To be written.

## Implications for META

To be written.

## Sources

To be written.
