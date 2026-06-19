## Task 11: D1 seed + agent docs

**Files:**
- Create: `.../cloudflare-fullstack/scripts/seed.ts.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/auth-rbac.md.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/data-layer.md.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/storage.md.hbs`
- Create: `.../cloudflare-fullstack/docs/agents/cloudflare-deploy.md.hbs`

**Interfaces:**
- Consumes: `createDb` from `@repo/db`, `createAuth` from `@repo/auth/auth`, faker.

- [ ] **Step 1: Write `seed.ts.hbs`** (root-scoped) — seed against the LOCAL D1 sqlite. Adapt org-dashboard's seed (`.../org-dashboard/scripts/seed.ts.hbs`) which uses better-auth's admin API to create users + assign roles. Key adaptations for D1:
  - Resolve the local D1 sqlite file (newest under `.wrangler/.../miniflare-D1DatabaseObject`) the same way `drizzle.config.ts.hbs` does (`getLocalD1DB()` helper — copy that resolution), then `createDb` over a libsql client pointed at that file. (Run after `wrangler d1 migrations apply DB --local`, which `local-setup` already chains.)
  - Create an admin user, a manager, and a user via `createAuth(db).api.signUpEmail` + set roles (`role` column / admin plugin `setRole`).
  - Insert a few `documentTable` rows (faker titles, `r2Key` placeholders, some with `expiresAt` in the past to demo the cron purge).
  - Remove the `#!/usr/bin/env bun` shebang per issue #145 (run via `bun --env-file`).
  - Frontmatter: `mono: { scope: root }`.

  > If the local-D1 seed resolution proves fiddly, fall back to seeding through `wrangler d1 execute web-db --local --file=...` generated SQL. Prefer the `createDb` approach for parity with org-dashboard.

- [ ] **Step 2: Write the 4 agent docs.** Each is a `.md.hbs` with frontmatter `path: docs/agents/<name>.md` + `mono: { scope: root, path: docs/agents/<name>.md }` (mirror `cloudflare-static-site`'s agent docs). Contents:
  - `auth-rbac.md` — admin plugin, the `ac`/`roles` statements (admin/user/manager), `<Can>`/`usePermission`, `permissionProcedure`/`adminProcedure`, how to add a resource/role.
  - `data-layer.md` — D1-everywhere, `createDb(binding)`, web uses `getDb()`/`getAuth()` (per-request), cron uses `createDb(env.DB)`; migrations (`db:generate` + `db:migrate:local|remote`); `local-setup`.
  - `storage.md` — R2 `STORAGE` binding, the upload Route Handler (`STORAGE.put`), delete in the tRPC mutation (`STORAGE.delete`), key scheme `documents/<userId>/<id>`, the 25 MB cap and why (Worker memory).
  - `cloudflare-deploy.md` — `wrangler d1 create web-db` + paste `database_id` into BOTH wrangler.jsonc files; `wrangler r2 bucket create <project>-storage`; secrets via `wrangler secret put BETTER_AUTH_SECRET`; web deploy (`build:cf` + `deploy`/OpenNext) and cron deploy (`wrangler deploy`); `wrangler dev --test-scheduled` to fire the cron locally; build-vs-runtime env split.

- [ ] **Step 3: Add a test** that all four agent docs + seed exist.

```ts
it('ships seed + agent docs', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack');
  for (const f of ['scripts/seed.ts.hbs', 'docs/agents/auth-rbac.md.hbs', 'docs/agents/data-layer.md.hbs', 'docs/agents/storage.md.hbs', 'docs/agents/cloudflare-deploy.md.hbs']) {
    expect(() => readFileSync(join(base, f), 'utf8')).not.toThrow();
  }
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/scripts apps/cli/templates/blueprints/cloudflare-fullstack/docs apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack seed + agent docs"
```

---

