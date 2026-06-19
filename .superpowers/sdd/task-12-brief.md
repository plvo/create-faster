## Task 12: End-to-end generation + smoke (turborepo)

**Files:**
- Test: extend `apps/cli/tests/blueprints/cloudflare-fullstack.test.ts` with a full generation test (mirror the existing blueprint generation test pattern in the repo).

- [ ] **Step 1: Write a generation test** that runs the generator for `--blueprint cloudflare-fullstack` into a temp dir and asserts the turborepo layout:
  - `apps/web/wrangler.jsonc` contains `"binding": "DB"` AND `"binding": "STORAGE"`;
  - `apps/cron/wrangler.jsonc` contains `"crons"` + `"binding": "STORAGE"`;
  - `apps/cron/src/index.ts` contains `async scheduled(`;
  - `packages/db/src/schema.ts` contains `documents` table + `role` column;
  - `packages/auth/src/auth.ts` contains `createAuth` + `admin(`;
  - `packages/api/src/root.ts` contains `documents: documentsRouter`;
  - `apps/web/src/app/api/documents/upload/route.ts` exists;
  - no file contains `DATABASE_URL`.

- [ ] **Step 2: Run it**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 3: Manual smoke (record results in the PR).**

```bash
cd /tmp && rm -rf cf-fs-smoke && bunx --bun /home/ttecim/.lab/create-faster/apps/cli/src/index.ts cf-fs-smoke --blueprint cloudflare-fullstack --linter biome --pm bun --git
cd cf-fs-smoke && bun install && bunx tsc --noEmit
# DB + preview:
bun run db:generate && bun run local-setup
# web OpenNext preview (auth + CRUD on local D1):
cd apps/web && bun run preview
# cron scheduled handler:
cd ../cron && bunx wrangler dev --test-scheduled
```
Expected: install + typecheck clean; web preview serves login/dashboard against local D1; uploading a file writes to local R2 and lists it; hitting the cron `__scheduled` endpoint purges expired docs.

- [ ] **Step 4: Run the full CLI test + lint**

Run: `cd apps/cli && bun run vitest run && cd /home/ttecim/.lab/create-faster && bun run check`
Expected: all pass; Biome clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "test(blueprint): cloudflare-fullstack end-to-end generation"
```

---

