# Global Constraints (apply to EVERY task)

These are the rules that make the cloudflare-fullstack blueprint correct. Read them before editing. They come from the plan's Global Constraints section.

- **Turborepo-only.** The blueprint declares 2 apps (`web`, `cron`) ⇒ always turborepo. No single-repo variant; do not add `only: single` files; treat `isMono` as always true. Imports use `@repo/*` directly.
- **D1 per-request, never a singleton.** Wherever the `org-dashboard` blueprint uses the module singleton `auth` (`import { auth } from '@repo/auth/auth'`) or singleton `db`, this blueprint MUST use the per-request factory instead:
  - **Server Components / Route Handlers (web app):** `import { getAuth, getDb } from '@/lib/server'`, then `const auth = await getAuth()` / `const db = await getDb()`. (`src/lib/server.ts` is the merged structural template — already provides `getDb()`/`getAuth()` for d1.)
  - **tRPC procedures:** use `ctx.db` and `ctx.session` (the d1 tRPC context already injects `db` and builds `createAuth(opts.db)`). For permission checks build auth from `ctx.db`: `createAuth(ctx.db).api.userHasPermission(...)`.
  - **Cron Worker (hono app):** `import { createDb } from '@repo/db'`, then `const db = createDb(env.DB)` inside `scheduled(event, env, ctx)`.
- **Blueprint pkg-scoped overrides MUST carry the package name in frontmatter** so they resolve to (and override) the structural destination. Use `mono: { scope: pkg, name: <auth|db|api|ui>, path: <relative> }`. App-scoped overrides use `mono: { scope: app, path: <relative> }` or no frontmatter (default app scope).
- **Handlebars escape gotcha:** JSX containing literal `{{ }}` object literals (e.g. a `permissions={{ document: [...] }}` prop) must be wrapped in `{{{{raw}}}}...{{{{/raw}}}}` or escaped `\{{`. Client component templates copied from org-dashboard already use `{{{{raw}}}}` blocks — preserve them.
- **Versions (reuse org-dashboard's pinned versions verbatim — do not bump or invent):**
  - root deps: `lucide-react@^0.487.0`, `react-error-boundary@^5.0.0`, `sonner@^2.0.7`, `zod@^4.2.1`
  - ui pkg deps: `@tanstack/react-form@^1.23.7`, `react-dom@^19.2.3`, `vaul@^1.1.2`; devDep `@types/react-dom@^19.2.3`
  - root devDep: `@faker-js/faker@^10.4.0`
- **No `DATABASE_URL` anywhere** (D1-everywhere). D1 connection is the `DB` binding only.
- **Test output must be pristine.** Capture and assert any expected errors; never leave stray error logs in passing tests.

## Project rules (from the repo's CLAUDE.md — MANDATORY)

- **Never hardcode choice-specific logic in core code** (resolver, generator, flags, prompts). This blueprint adds ONLY a META entry + templates under `apps/cli/templates/blueprints/cloudflare-fullstack/`. Do NOT edit core algorithms. Blueprint templates override structural templates by destination path — that is the intended mechanism.
- Use **bun** as package manager. Match surrounding code style. Self-documenting code, no noise comments. No `any` without justification.
- The repo's Biome runs on commit (`bun run check`). Keep generated `.hbs` content clean.

## Reference sources (verified in-repo patterns — read the relevant ones for your task)

| What | Path |
|---|---|
| Structural better-auth (d1 `createAuth` factory) | `apps/cli/templates/libraries/better-auth/src/lib/auth/auth.ts.hbs` |
| Structural drizzle schema (sqlite/d1 better-auth tables) | `apps/cli/templates/project/orm/drizzle/src/schema.ts.hbs` |
| Structural drizzle index (`createDb`) | `apps/cli/templates/project/orm/drizzle/src/index.ts.hbs` |
| Structural d1 server seam (`getDb`/`getAuth`) | `apps/cli/templates/project/deployment/cloudflare/src/lib/server.ts.nextjs.hbs` |
| Structural d1 env (`getEnv`/`Env`) | `apps/cli/templates/project/deployment/cloudflare/src/lib/env.ts.nextjs.hbs` |
| Structural web wrangler (nextjs/OpenNext) | `apps/cli/templates/project/deployment/cloudflare/wrangler.jsonc.nextjs.hbs` |
| Structural cron wrangler (hono) | `apps/cli/templates/project/deployment/cloudflare/wrangler.jsonc.hono.hbs` |
| Structural tRPC init (`protectedProcedure`, d1 ctx) | `apps/cli/templates/libraries/trpc/src/trpc/init.ts.hbs` |
| Structural tRPC root router | `apps/cli/templates/libraries/trpc/src/trpc/routers/_app.ts.hbs` |
| org-dashboard auth + admin plugin | `apps/cli/templates/blueprints/org-dashboard/src/lib/auth/auth.ts.hbs` |
| org-dashboard permissions (ac/roles) | `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs` |
| org-dashboard auth-client | `apps/cli/templates/blueprints/org-dashboard/src/lib/auth/auth-client.ts.hbs` |
| org-dashboard `<Can>` + `usePermission` | `.../org-dashboard/src/components/can.tsx.hbs`, `.../src/hooks/use-permission.ts.hbs` |
| org-dashboard rbac middleware | `.../org-dashboard/src/trpc/middleware/rbac.ts.hbs` |
| org-dashboard contact router (CRUD model) | `.../org-dashboard/src/trpc/routers/contact.ts.hbs` |
| org-dashboard (auth)/(dashboard) layouts | `.../org-dashboard/src/app/(auth)/layout.tsx.hbs`, `.../(dashboard)/layout.tsx.hbs` |
| org-dashboard seed | `.../org-dashboard/scripts/seed.ts.hbs` |
| cloudflare-static-site agent docs (format) | `apps/cli/templates/blueprints/cloudflare-static-site/docs/agents/*.md.hbs` |
| kodex cron Worker (scheduled + createDb) | `/home/ttecim/.lab/kodex/apps/alerting-cron/src/index.ts` + `wrangler.jsonc` |
| kodex R2 upload route (FormData → STORAGE.put) | `/home/ttecim/.lab/kodex/apps/web/src/app/api/docs/[docId]/assets/route.ts` |

## Test running — IMPORTANT: the repo uses `bun test` (bun:test), NOT vitest

The plan text says `bun run vitest run` — that is WRONG. This repo's tests import from `'bun:test'` and the `test` script is `bun test`. Ignore every `vitest` mention in the plan/briefs and instead:

- Test files MUST import from `'bun:test'`: `import { describe, expect, test } from 'bun:test';` (use `test`, not `it`).
- Run ONLY the focused blueprint test: `cd apps/cli && bun test tests/blueprints/cloudflare-fullstack.test.ts`
- DO NOT run the full `bun test` suite — it triggers the slow e2e tests (project generation + installs) and takes forever. The blueprint tests are self-contained (they assert template file contents), so the focused run is sufficient per task. The full end-to-end generation check is its own task (Task 12).
- Do NOT add `vitest` as a dependency. Do NOT create vitest config.
- For reading template files in tests, `bun:test` works the same (node:fs `readFileSync`, `import.meta.dir` instead of `__dirname`).
- Lint/format check (repo root): `bun run check`
