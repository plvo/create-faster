## Task 6: Cron Worker — hono index ({ fetch, scheduled }) + cron wrangler override

**Files:**
- Create: `.../cloudflare-fullstack/src/index.ts.hono.hbs` (cron app entrypoint override)
- Create: `.../cloudflare-fullstack/wrangler.jsonc.hono.hbs` (cron wrangler override)

**Interfaces:**
- Consumes: `createDb`, `documentTable`, `lt` (or `lte`)/`isNotNull` from `@repo/db`.
- Produces: a Worker that exposes `GET /health` (fetch) and a `scheduled` handler purging expired documents (D1 rows + R2 objects).

- [ ] **Step 1: Write the cron entrypoint.** Hono for `fetch` (health) + `scheduled` for the purge, building the db per-invocation (`createDb(env.DB)`), mirroring kodex's cron pattern.

```handlebars
---
mono:
  scope: app
  path: src/index.ts
---
import { and, createDb, documentTable, isNotNull, lt } from '@repo/db';
import { Hono } from 'hono';

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));

async function purgeExpiredDocuments(env: Env): Promise<number> {
  const db = createDb(env.DB);
  const now = new Date();

  const expired = await db
    .select({ id: documentTable.id, r2Key: documentTable.r2Key })
    .from(documentTable)
    .where(and(isNotNull(documentTable.expiresAt), lt(documentTable.expiresAt, now)));

  for (const doc of expired) {
    try {
      await env.STORAGE.delete(doc.r2Key);
      await db.delete(documentTable).where(eqId(documentTable, doc.id));
    } catch (err) {
      console.error(`[cron] failed to purge document ${doc.id}:`, err);
    }
  }

  console.log(`[cron] purged ${expired.length} expired document(s)`);
  return expired.length;
}

// local helper keeps the import list minimal; `eq` is re-exported from @repo/db
function eqId(table: typeof documentTable, id: string) {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle column typing
  const { eq } = require('@repo/db') as { eq: (...args: any[]) => any };
  return eq(table.id, id);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeExpiredDocuments(env));
  },
};
```

> Simplify the `eqId` helper during implementation by importing `eq` at the top: `import { and, createDb, documentTable, eq, isNotNull, lt } from '@repo/db'` and calling `eq(documentTable.id, doc.id)` directly — the helper above is only to make the dependency explicit. Prefer the direct top-level import. (`eq`, `and`, `lt`, `isNotNull` are all re-exported from `@repo/db` via `export * from 'drizzle-orm'`.)

- [ ] **Step 2: Write the cron wrangler override.** Concrete: DB + STORAGE bindings + `triggers.crons`. Stack suffix `.hono` routes it to the cron app.

```handlebars
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "{{appName}}",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-12",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": {
    "crons": ["0 3 * * *"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "web-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "../../packages/db/drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "STORAGE",
      "bucket_name": "{{projectName}}-storage"
    }
  ]
}
```

> The cron shares the web app's D1 database (`web-db`) and R2 bucket (`{{projectName}}-storage`) — same `database_id`/`bucket_name` the user fills in once. Document this in the agent deploy doc (Task 12). Cron schedule `0 3 * * *` = daily 03:00 UTC.

- [ ] **Step 3: Add a test** asserting the cron wiring.

```ts
it('ships a cron worker with scheduled purge + triggers.crons', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack');
  const idx = readFileSync(join(base, 'src/index.ts.hono.hbs'), 'utf8');
  expect(idx).toContain('async scheduled(');
  expect(idx).toContain('createDb(env.DB)');
  const wr = readFileSync(join(base, 'wrangler.jsonc.hono.hbs'), 'utf8');
  expect(wr).toContain('"crons"');
  expect(wr).toContain('"binding": "STORAGE"');
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/index.ts.hono.hbs apps/cli/templates/blueprints/cloudflare-fullstack/wrangler.jsonc.hono.hbs apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack cron worker (scheduled document purge)"
```

---

