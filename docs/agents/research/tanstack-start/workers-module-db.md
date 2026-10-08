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

To be written.

## Inferences

To be written.

## Implications for META

To be written.

## Sources

To be written.
