## Task 4: tRPC documents router + d1-adapted RBAC middleware + root router

**Files:**
- Create: `.../cloudflare-fullstack/src/trpc/middleware/rbac.ts.hbs`
- Create: `.../cloudflare-fullstack/src/trpc/routers/documents.ts.hbs`
- Create: `.../cloudflare-fullstack/src/trpc/routers/_app.ts.hbs` (override)

**Interfaces:**
- Consumes: `protectedProcedure`, `router` from the structural tRPC init (`ctx.db`, `ctx.session`); `createAuth` from `@repo/auth/auth`; `documentTable` from `@repo/db`; `getEnv` from `@/lib/env` is NOT used here (R2 delete uses the binding via the context — see note).
- Produces: `appRouter` with `documents` + `hello`; `documentsRouter`; `permissionProcedure`/`adminProcedure`.

- [ ] **Step 1: Write `rbac.ts.hbs`** — adapt org-dashboard's middleware to the d1 per-request factory (build auth from `ctx.db`, not a singleton).

```handlebars
---
mono:
  scope: pkg
  name: api
  path: src/middleware/rbac.ts
---
import { createAuth } from '@repo/auth/auth';
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../trpc';

export const adminProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.session.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can access this resource' });
  }
  return opts.next({ ctx: opts.ctx });
});

export const permissionProcedure = (resource: string, action: string) =>
  protectedProcedure.use(async (opts) => {
    const auth = createAuth(opts.ctx.db);
    const result = await auth.api.userHasPermission({
      body: { userId: opts.ctx.session.user.id, permissions: { [resource]: [action] } },
    });
    if (!result.success) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission' });
    }
    return opts.next({ ctx: opts.ctx });
  });
```

> Frontmatter `name: api` — the trpc routers live in the `api` package (see hello/contact routers). The d1 tRPC context already provides `ctx.db` and `ctx.session` (verified in `init.ts.hbs`).

- [ ] **Step 2: Write `documents.ts.hbs`** — model after org-dashboard's contact router, scoped by role. `manager` reads all; `user` reads own; admins implied via `admin` role having all document perms. Deletion removes the R2 object via the `STORAGE` binding obtained from `getEnv()`.

```handlebars
---
mono:
  scope: pkg
  name: api
  path: src/router/documents.ts
---
import { and, desc, documentTable, eq } from '@repo/db';
import { z } from 'zod';
import { router } from '../trpc';
import { permissionProcedure } from '../middleware/rbac';

export const documentsRouter = router({
  list: permissionProcedure('document', 'read').query(async ({ ctx }) => {
    const isPrivileged = ctx.session.user.role === 'admin' || ctx.session.user.role === 'manager';
    return ctx.db
      .select()
      .from(documentTable)
      .where(isPrivileged ? undefined : eq(documentTable.userId, ctx.session.user.id))
      .orderBy(desc(documentTable.createdAt));
  }),

  delete: permissionProcedure('document', 'delete')
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [doc] = await ctx.db
        .select()
        .from(documentTable)
        .where(
          ctx.session.user.role === 'admin'
            ? eq(documentTable.id, input.id)
            : and(eq(documentTable.id, input.id), eq(documentTable.userId, ctx.session.user.id)),
        )
        .limit(1);
      if (!doc) return { deleted: false };

      const { getEnv } = await import('@/lib/env');
      const { STORAGE } = await getEnv();
      await STORAGE.delete(doc.r2Key);
      await ctx.db.delete(documentTable).where(eq(documentTable.id, doc.id));
      return { deleted: true };
    }),
});
```

> R2 delete pattern (`STORAGE.delete(key)`) mirrors kodex, where object deletion lives in the tRPC mutation (kodex has no standalone DELETE route). `getEnv()` is the structural d1 env seam — Task 5 extends it with `STORAGE`. The dynamic `import('@/lib/env')` keeps the api package free of a hard `server-only` dependency at module load.

- [ ] **Step 3: Write `_app.ts.hbs` override** — register `documents` alongside the kept `hello` router. Match the structural frontmatter.

```handlebars
---
path: src/trpc/routers/_app.ts
mono:
  scope: pkg
  name: api
  path: src/root.ts
---
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { router } from './trpc';
import { documentsRouter } from './router/documents';
import { helloRouter } from './router/hello';

export const appRouter = router({
  hello: helloRouter,
  documents: documentsRouter,
});

export type AppRouter = typeof appRouter;
export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;
```

> The override's mono path is `src/root.ts` and it imports `./trpc`, `./router/documents`, `./router/hello` — exactly the turbo layout the structural `_app.ts.hbs` produces (`isMono` branch). The structural `hello.ts` is kept (not overridden).

- [ ] **Step 4: Add a test** asserting the router + middleware shape.

```ts
it('registers a documents router using d1 per-request auth', () => {
  const base = join(__dirname, '../../templates/blueprints/cloudflare-fullstack/src/trpc');
  expect(readFileSync(join(base, 'routers/_app.ts.hbs'), 'utf8')).toContain('documents: documentsRouter');
  expect(readFileSync(join(base, 'middleware/rbac.ts.hbs'), 'utf8')).toContain('createAuth(opts.ctx.db)');
  expect(readFileSync(join(base, 'routers/documents.ts.hbs'), 'utf8')).toContain('STORAGE.delete(doc.r2Key)');
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/trpc apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack documents tRPC router + d1 RBAC middleware"
```

---

