# cloudflare-fullstack blueprint — SDD progress ledger

Branch: feat/cloudflare-fullstack-blueprint
Plan: docs/agents/cloudflare/plans/2026-06-19-cloudflare-fullstack-blueprint.md
Mode: subagent-driven, Sonnet 4.6 implementers, no inter-task review (per Pelavo), final = /code-review --fix

Base before Task 1: 9bdc7ed

- [x] Task 1: META blueprint entry + skeleton test (commits 23d1736..edd1d95; fixed vitest→bun:test)
- [x] Task 2: schema override (sqlite + admin cols + documents) (commit 89f1915)
- [x] Task 3: auth factory + admin plugin + permissions + auth-client (commit b80bad5)
- [x] Task 4: documents tRPC router + d1 RBAC middleware + root router (commit c064aad)
- [x] Task 5: R2 web wrangler + env.ts + upload route (commit 6928e1c)
- [x] Task 6: cron worker + cron wrangler (commit d746db0; verified clean eq import)
- [x] Task 7: auth pages + (auth) layout (commit 4672794; signup written from scratch)
- [x] Task 8: dashboard + documents UI + permission gate (commit 986b4e1)
  - MINOR for final review: sign-out uses `<a href="/api/auth/sign-out">` (GET) — better-auth sign-out is POST; likely needs a client signOut button or POST form.
  - tRPC client pattern assumed `useTRPC()` + `trpc.documents.list.queryOptions()` — verify against structural trpc templates in Task 12 generation.
- [x] Task 9: admin users page (commit 6141b96; native HTML table — final review may swap to shadcn)
- [x] Task 10: root layout glue (commit d44640c; root layout.tsx override mounts AppProviders + Toaster, devtools block omitted — blueprint has no tanstack-devtools. HITL: trivial glue, mirrors org-dashboard.)
- [x] Task 11: seed + agent docs (commit 96e1e61; seed via bun:sqlite + drizzle-orm/bun-sqlite — brief's "libsql client + createDb" doesn't work since createDb expects a D1 binding; signUpEmail+set role avoids admin-session. 4 docs accurate to packages/{api,auth,db} layout.)
- [x] Task 12: end-to-end generation test (commits c6fa436 fix(resolver), c8eba5d test). Generation surfaced bug #151: blueprint .hono files routed to apps[0]=web not apps/cron — fixed in resolver (Pelavo approved core edit). Also fixed orphan cron app.ts (index now imports ./app) + doc @/-import false positives. 674 unit+integration tests green; biome clean on touched files (env-generator/apps-www lint errors are pre-existing, not mine).
  - DEFERRED (manual HITL): the smoke run (bun install + tsc --noEmit + OpenNext preview + wrangler dev --test-scheduled) needs real CF local runtime + installs — Pelavo to run. Smoke commands in task-12-brief use the wrong /home/ttecim path; correct base is /home/plv/lab/r/create-faster.
- [x] Task 13: MDX docs page (commit 175c91b; apps/www/content/docs/blueprints/business/cloudflare-fullstack.mdx, auto-listed. Docs-site build NOT run — deps not installed in worktree; MDX validated mechanically for unescaped JSX.)

ALL TASKS 1-13 DONE.

## Post-implementation hardening (dogfood + code-review --fix) — done
Dogfood (real generation → install → tsc → seed) + a high-effort workflow code-review found and fixed:
- A: shuip tanstack-form ui kit was imported by auth forms but never shipped → copied the kit from org-dashboard (commit f092e33)
- B: packages/db/src/types.ts hardcoded postTable (structural) → blueprint types.ts override
- D: dead/broken BETTER_AUTH_* fields in env seam → removed
- #2: documents.delete used app-only @/lib/env in packages/api → getCloudflareContext + @opennextjs/cloudflare api dep
- #1/#5: sign-out GET anchor → client signOut button; guard !session?.user
- #3/#10: cron purge count + batched delete
- #4: wrangler database_name unified to {{projectName}}-db
- #6: seed PRAGMA foreign_keys ON (reset cascade)
- #7: upload streams to R2
- seed wiring (commit 906098d): drizzle-orm root dep, BETTER_AUTH_URL on db:seed, root local-setup. Verified end-to-end on local D1 (3 users/accounts/9 docs).
Skipped with reason: #9 (schema inline = intentional Task 2 fork), #8 (keep userHasPermission; optimizing needs the trpc-init fork we avoid).
Verified: fresh generation → bun install → cf:typegen → tsc --noEmit CLEAN; turbo build OK; `db:generate && local-setup` bootstraps a seeded local D1. 693+ repo tests green.

## Browser + cron dogfood (OpenNext preview + agent-browser) — DONE
Found + fixed: every preview route 500'd because createAuth builds an empty baseURL.allowedHosts without BETTER_AUTH_URL → ship apps/web/.dev.vars (gitignored) (commit 0b1faa5). Validated end-to-end against local D1/R2:
- login via shuip tanstack-form → dashboard (RBAC gates render) → sign out (client POST)
- upload a file → R2 STORAGE.put (stream) → listed; delete → tRPC documents.delete 200, R2+row removed (#2 fix proven live)
- admin/users lists the 3 seeded users with roles + ban
- cron `wrangler dev --test-scheduled --persist-to ../../.wrangler` → "[cron] purged 3 of 3" → D1 9→6 docs (count #3 + batch #10 proven live)
Doc fixed: cron local-test command needs --persist-to to share the D1.

BLUEPRINT FULLY VALIDATED. PR #158 ready to move out of draft after Pelavo's review.
