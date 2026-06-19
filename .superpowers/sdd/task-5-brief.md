## Task 5: R2 binding — web wrangler + env.ts overrides + upload Route Handler

**Files:**
- Create: `.../cloudflare-fullstack/wrangler.jsonc.nextjs.hbs` (override web wrangler)
- Create: `.../cloudflare-fullstack/src/lib/env.ts.nextjs.hbs` (override env seam)
- Create: `.../cloudflare-fullstack/src/app/api/documents/upload/route.ts.hbs` (new)

**Interfaces:**
- Consumes: `getAuth`, `getDb` from `@/lib/server`; `documentTable` from `@repo/db`.
- Produces: `Env` with `DB` + `STORAGE` + auth secrets; `getEnv()` returning them; `POST /api/documents/upload`.

- [ ] **Step 1: Write the web wrangler override.** Concrete (d1 + R2). Stack suffix `.nextjs` routes it to the web app; no frontmatter (default app scope, same as the structural file it overrides).

```handlebars
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "{{appName}}",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-06-12",
  // global_fetch_strictly_public routes fetch() through the public internet so OpenNext asset serving avoids Worker subrequest limits
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "{{appName}}-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "../../packages/db/drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "STORAGE",
      "bucket_name": "{{projectName}}-storage",
      "preview_bucket_name": "{{projectName}}-storage-preview"
    }
  ]
}
```

- [ ] **Step 2: Write the env.ts override.** Concrete `Env` with `DB` + `STORAGE` + better-auth secrets and the matching `getEnv()`.

```handlebars
---
path: src/lib/env.ts
mono:
  scope: app
  path: src/lib/env.ts
---
import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export type Env = {
  DB: D1Database;
  STORAGE: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
};

export async function getEnv(): Promise<Env> {
  const { env } = await getCloudflareContext({ async: true });
  return {
    DB: env.DB,
    STORAGE: env.STORAGE,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? '',
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? '',
  };
}
```

> The structural d1 `env.ts.nextjs.hbs` is app-scoped at `src/lib/env.ts`; this override matches that destination. `R2Bucket`/`D1Database` are global Workers types (provided by `wrangler types` / `@cloudflare/workers-types` already pulled by the cloudflare deployment).

- [ ] **Step 3: Write the upload Route Handler.** Simplified from the kodex pattern (session + own-document, FormData → arrayBuffer → `STORAGE.put`).

```handlebars
---
path: src/app/api/documents/upload/route.ts
mono:
  scope: app
  path: src/app/api/documents/upload/route.ts
---
import { documentTable } from '@repo/db';
import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getAuth, getDb } from '@/lib/server';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — safe under the 128 MB Worker memory cap

export async function POST(req: Request) {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse('Invalid multipart body', { status: 400 });
  }
  const file = form.get('file');
  const title = (form.get('title') as string | null)?.trim();
  if (!(file instanceof File)) return new NextResponse('Missing file field', { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return new NextResponse(`File too large (${Math.floor(MAX_BYTES / 1024 / 1024)} MB max)`, { status: 413 });
  }

  const { STORAGE } = await getEnv();
  const id = crypto.randomUUID();
  const key = `documents/${session.user.id}/${id}`;
  const contentType = file.type || 'application/octet-stream';
  await STORAGE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } });

  const db = await getDb();
  const [doc] = await db
    .insert(documentTable)
    .values({ id, userId: session.user.id, title: title || file.name, r2Key: key, size: file.size, mimeType: contentType })
    .returning();

  return NextResponse.json({ document: doc });
}
```

- [ ] **Step 4: Add a test** asserting the R2 wiring.

```ts
it('adds the R2 STORAGE binding, env field, and upload route', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack');
  expect(readFileSync(join(base, 'wrangler.jsonc.nextjs.hbs'), 'utf8')).toContain('"binding": "STORAGE"');
  expect(readFileSync(join(base, 'src/lib/env.ts.nextjs.hbs'), 'utf8')).toContain('STORAGE: R2Bucket');
  expect(readFileSync(join(base, 'src/app/api/documents/upload/route.ts.hbs'), 'utf8')).toContain('STORAGE.put(key');
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/wrangler.jsonc.nextjs.hbs apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/env.ts.nextjs.hbs apps/cli/templates/blueprints/cloudflare-fullstack/src/app/api apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack R2 binding + upload route"
```

---

