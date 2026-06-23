## Task 13: MDX docs page

**Files:**
- Create: the blueprint docs page under the docs site content dir (follow the `documenting-blueprint` skill and mirror the `cloudflare-static-site` / `org-dashboard` docs page location).

- [ ] **Step 1: Invoke the `documenting-blueprint` skill** and write the MDX page: composition, architecture (web + cron, D1/R2, RBAC), application code tour, CLI usage (`--blueprint cloudflare-fullstack`), extra dependencies, and the deploy/local-setup workflow. Link the four agent docs.

- [ ] **Step 2: Verify** the docs site builds (per the docs app's build command) or at least lints.

- [ ] **Step 3: Commit**

```bash
git add <docs page path>
git commit -m "docs(blueprint): cloudflare-fullstack MDX page"
```

---

## Self-Review (run before handing off)

- **Spec coverage:** every spec section maps to a task — composition (T1), RBAC (T3), documents domain schema/router/route (T2/T4/T5), R2 binding + env override (T5), cron (T6), pages/admin (T7–T10, HITL), seed + agent docs (T11), tests (T1–T12), MDX (T13). ✓
- **Acceptance criteria (#134):** generation + install + OpenNext preview (T12), cron `--test-scheduled` (T6/T12), R2 upload on local binding (T5/T8/T12), interactive + `--blueprint` (T1, generic), design review (HITL gates), MDX docs (T13). ✓
- **Type/name consistency:** `createAuth(db)`, `getAuth()`/`getDb()`, `getEnv()` returning `{ DB, STORAGE, ... }`, `documentTable`/`documentsRouter`, `STORAGE.put`/`STORAGE.delete`, `permissionProcedure('document', …)` — used consistently across T2–T8. ✓
- **No DATABASE_URL** anywhere (asserted T12). ✓
- **Known latent bug #151** (stack-specific addon templates discard frontmatter) is avoided: the `.nextjs`/`.hono` blueprint overrides (`wrangler`, `index.ts`, `env.ts`) rely only on default app scope + stack suffix, never on frontmatter `path`/`mono` for the stack-suffixed files. If any stack-suffixed file needs a non-default path, fix #151 first. ✓
- **#145 (Bun coupling):** the blueprint seed omits the `#!/usr/bin/env bun` shebang. The d1 `local-setup`/`db:migrate` scripts inherited from META still reference `bun run` / `wrangler` — out of scope here, tracked in #145. ✓
