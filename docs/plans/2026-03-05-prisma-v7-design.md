# Prisma v7 Update Design

**Date:** 2026-03-05
**Library:** Prisma ORM
**Current:** ^6.13.0
**Target:** ^7.0.0

## Context

Prisma v7 is a major rewrite: Rust engine replaced by TypeScript-native implementation.
Key breaking changes affect generator config, client initialization, import paths, and
database connectivity.

## Research Findings

### Breaking Changes Affecting create-faster

| Change | Impact |
|--------|--------|
| Generator provider: `prisma-client-js` to `prisma-client` | schema.prisma.hbs |
| `output` field mandatory (no more node_modules generation) | schema.prisma.hbs |
| Driver adapters required for all databases | index.ts.hbs rewrite |
| New `prisma.config.ts` required | New template |
| `datasource` block loses `url = env("DATABASE_URL")` | schema.prisma.hbs |
| `@prisma/client` stays as runtime dep (generated code imports from `@prisma/client/runtime/*`) | META deps |
| `postinstall: prisma generate` no longer auto-runs | META scripts |
| MySQL adapter uses `@prisma/adapter-mariadb` + `mariadb` | META deps |
| New packages: `@prisma/adapter-pg`, `@prisma/adapter-mariadb` | META deps |
| Import from generated path instead of `@prisma/client` | index.ts.hbs, seed.ts.hbs |

### Better-Auth Compatibility

`@better-auth/prisma-adapter@^1.5.3` is compatible with Prisma v7:
- Peer deps allow `^7.0.0`
- Adapter is duck-typed — calls methods on user-provided PrismaClient instance
- Does not import from `@prisma/client` internally
- Known bug #6469 (updateUser/changeEmail silent failures) — not addressable in scaffolding

## Design

### META Changes (`__meta__.ts`)

```
Update:
  prisma (devDep): ^6.13.0 -> ^7.0.0
  @prisma/client (dep): ^6.13.0 -> ^7.0.0  (kept: generated code imports @prisma/client/runtime/*)

Add (conditional):
  @prisma/adapter-pg: ^7.0.0       ($when postgres)
  @prisma/adapter-mariadb: ^7.0.0  ($when mysql)
  mariadb: ^3.0.0                   ($when mysql)

Remove script:
  postinstall: 'prisma generate'
```

### Template Changes

#### 1. `schema.prisma.hbs` — Generator + datasource

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"  // or "mysql"
  // url removed — moves to prisma.config.ts
}
```

Models unchanged (User, Post, better-auth tables).

#### 2. `index.ts.hbs` — Rewrite for driver adapters

- Import PrismaClient from generated path (`../generated/prisma` mono, `../../generated/prisma` single)
- Postgres: `PrismaPg` adapter with `{ connectionString: process.env.DATABASE_URL! }`
- MySQL: parse `DATABASE_URL` with `new URL()`, pass individual params to `PrismaMariaDb`
- Keep singleton pattern
- Keep better-auth type re-exports (`Session`, `Account`, `Verification`)
- Re-export all types from generated path instead of `@prisma/client`

#### 3. NEW `prisma.config.ts.hbs`

```ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "bun run scripts/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

Same scope as schema: pkg in mono, root-level relative to prisma dir in single.

#### 4. `seed.ts.hbs` — Update import path

Update import to use generated path instead of `@prisma/client`.

#### 5. `tsconfig.json.hbs` — No changes

### Other Changes

- Add `generated/` to `.gitignore` template
- No cross-reference changes (auth.ts.hbs imports via index.ts indirection)
- `@better-auth/prisma-adapter` version unchanged (^1.5.3 already compatible)

### Generated Client Output Path

| Repo | Schema location | Output path | Generator output value |
|------|----------------|-------------|----------------------|
| Single | `prisma/schema.prisma` | `generated/prisma/` | `../generated/prisma` |
| Mono | `packages/db/prisma/schema.prisma` | `packages/db/generated/prisma/` | `../generated/prisma` |

Same relative path from schema in both cases.

### MySQL Connection Handling

Parse `DATABASE_URL` at runtime (single env var, consistent with postgres):

```ts
const url = new URL(process.env.DATABASE_URL!);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
});
```

## Verification Matrix

| Combination | Tests |
|-------------|-------|
| Single + postgres + prisma (no better-auth) | install, type-check, build |
| Single + mysql + prisma (no better-auth) | install, type-check, build |
| Turborepo + postgres + prisma + better-auth | install, type-check, build |
| Turborepo + mysql + prisma + better-auth | install, type-check, build |
