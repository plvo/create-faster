# Multitenant SaaS Blueprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `multitenant-saas` blueprint to create-faster that generates a B2B SaaS dashboard with multi-tenant orgs, custom RBAC (built on `better-auth/organization` plugin with dynamicAccessControl), and link-based invitations (no email).

**Architecture:** Compose existing META libraries (Next.js + shadcn + better-auth + tRPC + tanstack-query/form + Drizzle + Postgres) into a monorepo blueprint. Override the better-auth library templates to enable the `organization` plugin. Add ~46 blueprint-specific files (auth permissions, RBAC middleware, project entity, dashboard with org switcher, settings pages for members/roles, invitation link UI).

**Tech Stack:** TypeScript, Bun, Handlebars, Next.js 15+ App Router, better-auth ≥1.6, drizzle-orm, tRPC, TanStack Query/Form, shadcn/ui, HugeIcons.

**Spec:** `docs/agents/blueprints/2026-05-01-multitenant-saas-design.md`

---

## Conventions used in this plan

- All template paths are relative to `apps/cli/templates/blueprints/multitenant-saas/`
- All test paths are relative to `apps/cli/tests/`
- "Dev CLI" command: `bun run dev:cli -- <args>` from project root, or `bun apps/cli/src/index.ts <args>` directly
- The reference blueprint to mimic is `org-dashboard` (`apps/cli/templates/blueprints/org-dashboard/`)
- Each task ends with a commit. Use the `commit-messages` skill or the `git-commit-push` slash command for proper conventional commits.

## Anti-pattern reminder

If a template generates code that looks identical to `org-dashboard`'s equivalent, **don't copy-paste blindly**. The blueprint exists because of the multi-tenant overlay — every page, layout, and component must respect the active-org scoping pattern. Read the org-dashboard equivalent for **structure**, then adapt.

---

## Task 1 — Bootstrap blueprint folder + META entry

**Goal:** Get the CLI to recognize `multitenant-saas` as a valid blueprint name with its full composition declared, even before any template files exist. Validates the META wiring in isolation.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/.gitkeep`
- Modify: `apps/cli/src/__meta__.ts` (add entry inside `META.blueprints`, after `'org-dashboard'`)

- [ ] **Step 1.1:** Create the empty blueprint directory.

```bash
mkdir -p apps/cli/templates/blueprints/multitenant-saas
touch apps/cli/templates/blueprints/multitenant-saas/.gitkeep
```

- [ ] **Step 1.2:** Add the META entry. Open `apps/cli/src/__meta__.ts` and insert after `'org-dashboard': { ... },` (around line 785):

```ts
'multitenant-saas': {
  label: 'Multitenant SaaS',
  hint: 'B2B SaaS dashboard with orgs, custom RBAC, and link-based invitations',
  category: 'Business',
  context: {
    apps: [
      {
        appName: 'web',
        stackName: 'nextjs',
        libraries: [
          'shadcn',
          'better-auth',
          'trpc',
          'tanstack-query',
          'tanstack-devtools',
          'tanstack-form',
          'next-themes',
        ],
      },
      {
        appName: 'batch',
        stackName: 'node',
        libraries: [],
      },
    ],
    project: {
      database: 'postgres',
      orm: 'drizzle',
    },
  },
  packageJson: {
    dependencies: {
      '@hugeicons/react': '^1.1.6',
      '@hugeicons/core-free-icons': '^4.1.1',
      'react-error-boundary': '^5.0.0',
      sonner: '^2.0.7',
      zod: '^4.2.1',
    },
  },
  rootPackageJson: {
    dependencies: {
      '@repo/auth': '*',
    },
    scripts: {
      'db:push': 'turbo db:push',
      'db:generate': 'turbo db:generate',
      'db:migrate': 'turbo db:migrate',
      'db:studio': 'turbo db:studio',
      'db:seed': 'bun scripts/seed.ts',
      start: 'turbo start',
    },
  },
  envs: [
    {
      value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
      monoScope: ['app'],
    },
  ],
},
```

- [ ] **Step 1.3:** Run typecheck on the CLI package to make sure the META entry typechecks.

```bash
cd apps/cli && bunx tsc --noEmit
```

Expected: PASS (no errors).

- [ ] **Step 1.4:** Smoke test the CLI flag handling — invalid blueprints fail, valid ones list properly.

```bash
bun apps/cli/src/index.ts smoke-test --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
```

Expected: command runs without error, generates a project skeleton in `./smoke-test/` (it'll be mostly the inherited library templates since blueprint is empty). Confirm `smoke-test/package.json` exists.

- [ ] **Step 1.5:** Clean up the smoke output and commit.

```bash
rm -rf smoke-test
git add apps/cli/src/__meta__.ts apps/cli/templates/blueprints/multitenant-saas/.gitkeep
git commit -m "feat(blueprint): scaffold multitenant-saas META entry"
```

---

## Task 2 — Permissions catalog & access control

**Goal:** Define the static `ac` instance and the three built-in roles. This is the spine of RBAC; everything else depends on it.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/permissions.ts.hbs`

- [ ] **Step 2.1:** Create the file with frontmatter targeting the `auth` package.

```hbs
---
mono:
  scope: pkg
  name: auth
  path: src/permissions.ts
---
import { createAccessControl } from 'better-auth/plugins/access';

{{{{raw}}}}
export const statement = {
  organization: ['update', 'delete'],
  member: ['invite', 'update', 'remove'],
  invitation: ['create', 'cancel'],
  role: ['create', 'read', 'update', 'delete'],
  project: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  organization: ['update', 'delete'],
  member: ['invite', 'update', 'remove'],
  invitation: ['create', 'cancel'],
  role: ['create', 'read', 'update', 'delete'],
  project: ['create', 'read', 'update', 'delete'],
});

export const admin = ac.newRole({
  organization: ['update'],
  member: ['invite', 'update', 'remove'],
  invitation: ['create', 'cancel'],
  role: ['create', 'read', 'update', 'delete'],
  project: ['create', 'read', 'update', 'delete'],
});

export const member = ac.newRole({
  project: ['read'],
});

export const ROLES = { owner, admin, member } as const;
{{{{/raw}}}}
```

- [ ] **Step 2.2:** Generate a test project to confirm path resolution works.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
```

Expected: `test-mt/packages/auth/src/permissions.ts` exists. Open it; the `{{{{raw}}}}` block should be unwrapped and the file should be valid TypeScript.

- [ ] **Step 2.3:** Verify the file contents.

```bash
cat test-mt/packages/auth/src/permissions.ts | head -20
```

Expected: starts with `import { createAccessControl }...`, `export const statement = {`, no Handlebars residue.

- [ ] **Step 2.4:** Clean up and commit.

```bash
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/permissions.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): add permissions catalog and built-in roles"
```

---

## Task 3 — Override better-auth server config to enable `organization` plugin

**Goal:** Replace the better-auth library's default `auth.ts` with one that registers the `organization` plugin with `dynamicAccessControl` enabled and a no-op `sendInvitationEmail`.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/auth.ts.hbs` (overrides the better-auth library's same destination)

- [ ] **Step 3.1:** Read the current better-auth library's `auth.ts.hbs` to understand the baseline.

```bash
find apps/cli/templates/libraries/better-auth -name "auth.ts*" -type f
cat apps/cli/templates/libraries/better-auth/packages/auth/src/auth.ts.hbs 2>/dev/null || \
  cat apps/cli/templates/libraries/better-auth/src/lib/auth/auth.ts.hbs 2>/dev/null
```

Identify the exact import paths for the drizzle adapter, the database client, and the schema. The override must keep these intact.

- [ ] **Step 3.2:** Create the override file. Use the same frontmatter as the better-auth library to land at the same destination (so it overrides):

```hbs
---
mono:
  scope: pkg
  name: auth
  path: src/auth.ts
---
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { db } from '@repo/db';
import * as schema from '@repo/db/schema';
import { ac, admin, member, owner } from './permissions';

{{{{raw}}}}
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    organization({
      ac,
      roles: { owner, admin, member },
      dynamicAccessControl: { enabled: true },
      requireEmailVerificationOnInvitation: false,
      cancelPendingInvitationsOnReInvite: true,
      async sendInvitationEmail(data) {
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/accept-invitation/${data.id}`;
        // No-op: invitations are shared via copy-link from the UI.
        // Logged here only for development visibility.
        console.log(`[invite] ${data.email} (${data.role}) → ${inviteLink}`);
      },
    }),
  ],
});
{{{{/raw}}}}
```

- [ ] **Step 3.3:** Verify the override actually replaces the library file (not co-exists).

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
grep -c "organization" test-mt/packages/auth/src/auth.ts
```

Expected: at least `2` matches (import + plugin call).

- [ ] **Step 3.4:** Clean up and commit.

```bash
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/auth.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): override better-auth with organization plugin"
```

---

## Task 4 — Override better-auth client + add session typing

**Goal:** Add the `organizationClient` plugin to the auth client and a typed `Session` export that includes `activeOrganizationId`.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/auth-client.ts.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/types.ts.hbs`

- [ ] **Step 4.1:** Read the current better-auth `auth-client.ts.hbs` for path conventions.

```bash
find apps/cli/templates/libraries/better-auth -name "auth-client*" -type f
```

- [ ] **Step 4.2:** Create the auth-client override:

```hbs
---
mono:
  scope: pkg
  name: auth
  path: src/auth-client.ts
---
import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

{{{{raw}}}}
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  plugins: [
    organizationClient({
      dynamicAccessControl: { enabled: true },
    }),
  ],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  organization,
  useListOrganizations,
  useActiveOrganization,
} = authClient;
{{{{/raw}}}}
```

- [ ] **Step 4.3:** Create the types file:

```hbs
---
mono:
  scope: pkg
  name: auth
  path: src/types.ts
---
import type { auth } from './auth';

{{{{raw}}}}
export type Session = typeof auth.$Infer.Session;
export type Organization = typeof auth.$Infer.Organization;
export type Member = typeof auth.$Infer.Member;
export type Invitation = typeof auth.$Infer.Invitation;
{{{{/raw}}}}
```

- [ ] **Step 4.4:** Generate and verify both files exist with valid content.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
ls test-mt/packages/auth/src/
cat test-mt/packages/auth/src/auth-client.ts | head -10
cat test-mt/packages/auth/src/types.ts
rm -rf test-mt
```

Expected: `auth.ts`, `auth-client.ts`, `permissions.ts`, `types.ts` all present.

- [ ] **Step 4.5:** Commit.

```bash
git add apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/auth-client.ts.hbs \
        apps/cli/templates/blueprints/multitenant-saas/packages/auth/src/types.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): add auth client with organization plugin and session types"
```

---

## Task 5 — Override DB schema to add `project` entity

**Goal:** Override the drizzle schema to add the example `project` table while keeping the auth tables (which will be auto-extended by the better-auth organization plugin during migration).

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/packages/db/src/schema.ts.hbs`

- [ ] **Step 5.1:** Read the org-dashboard schema for reference (it has the auth tables we need to keep).

```bash
cat apps/cli/templates/blueprints/org-dashboard/packages/db/src/schema.ts.hbs 2>/dev/null || \
  find apps/cli/templates/blueprints/org-dashboard -name "schema*"
```

- [ ] **Step 5.2:** Create the schema override. The auth tables come from the `better-auth/cli generate` command at runtime in the user's project — we only need to declare the `project` table here:

```hbs
---
mono:
  scope: pkg
  name: db
  path: src/schema.ts
---
import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

{{{{raw}}}}
// Auth tables (user, session, account, verification, organization, member, invitation, organizationRole)
// are defined by `better-auth` and generated via `bunx @better-auth/cli generate`.
// Re-export them from the generated file once you run the auth migration.

export const project = pgTable('project', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull(),
  createdById: text('created_by_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: ['active', 'archived'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
{{{{/raw}}}}
```

> **Note:** the `organizationId` and `createdById` columns are `text notNull` without explicit `.references(...)` because the org/user tables are managed by better-auth's CLI. Foreign-key consistency is enforced at the application layer via the tRPC middleware in Task 7.

- [ ] **Step 5.3:** Generate and inspect.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/packages/db/src/schema.ts
rm -rf test-mt
```

Expected: Single `project` table definition + types, no Handlebars residue.

- [ ] **Step 5.4:** Commit.

```bash
git add apps/cli/templates/blueprints/multitenant-saas/packages/db/src/schema.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): add project entity to db schema"
```

---

## Task 6 — Permission helpers (server) + `usePermission` hook + `Can` component

**Goal:** Add the three helpers used everywhere downstream: server-side permission check (used by tRPC middleware), client-side `usePermission` hook, and `<Can>` JSX wrapper.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/hooks/use-permission.ts.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/can.tsx.hbs`

- [ ] **Step 6.1:** Create `use-permission.ts.hbs`:

```hbs
---
path: src/hooks/use-permission.ts
mono:
  scope: app
  path: src/hooks/use-permission.ts
---
'use client';

import { authClient } from '@repo/auth/auth-client';
import { useEffect, useState } from 'react';

{{{{raw}}}}
type Permissions = Record<string, string[]>;

export function usePermission(permissions: Permissions): {
  allowed: boolean;
  loading: boolean;
} {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authClient.organization
      .hasPermission({ permissions })
      .then((result) => {
        if (!cancelled) setAllowed(result.data?.success ?? false);
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(permissions)]);

  return { allowed, loading };
}
{{{{/raw}}}}
```

- [ ] **Step 6.2:** Create `can.tsx.hbs`:

```hbs
---
path: src/components/can.tsx
mono:
  scope: app
  path: src/components/can.tsx
---
'use client';

import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

{{{{raw}}}}
type CanProps = {
  permissions: Record<string, string[]>;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  children: ReactNode;
};

export function Can({ permissions, fallback = null, loadingFallback = null, children }: CanProps) {
  const { allowed, loading } = usePermission(permissions);
  if (loading) return <>{loadingFallback}</>;
  return <>{allowed ? children : fallback}</>;
}
{{{{/raw}}}}
```

- [ ] **Step 6.3:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/hooks/use-permission.ts
cat test-mt/apps/web/src/components/can.tsx
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/hooks/use-permission.ts.hbs \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/can.tsx.hbs
git commit -m "feat(blueprint/multitenant-saas): add usePermission hook and Can wrapper"
```

---

## Task 7 — tRPC RBAC middleware (`orgProcedure` + `permissionProcedure`)

**Goal:** Add the two reusable procedures that all data routes inherit from. `orgProcedure` requires an active org; `permissionProcedure(resource, action)` adds a permission check on top.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/middleware/rbac.ts.hbs`

- [ ] **Step 7.1:** Read the org-dashboard rbac middleware for the import conventions.

```bash
cat apps/cli/templates/blueprints/org-dashboard/src/trpc/middleware/rbac.ts.hbs
```

- [ ] **Step 7.2:** Create the middleware file:

```hbs
---
path: src/trpc/middleware/rbac.ts
mono:
  scope: app
  path: src/trpc/middleware/rbac.ts
---
import { TRPCError } from '@trpc/server';
import { auth } from '@repo/auth/auth';
import { protectedProcedure } from '../init';

{{{{raw}}}}
export const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const orgId = ctx.session.session.activeOrganizationId;
  if (!orgId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No active organization. Switch to an organization or create one.',
    });
  }
  return next({ ctx: { ...ctx, orgId } });
});

export const permissionProcedure = (resource: string, action: string) =>
  orgProcedure.use(async ({ ctx, next }) => {
    const result = await auth.api.hasPermission({
      headers: ctx.headers,
      body: { permissions: { [resource]: [action] } },
    });
    if (!result.success) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing permission ${resource}.${action}`,
      });
    }
    return next();
  });

export async function assertInScope<T extends { organizationId: string }>(
  row: T | undefined | null,
  ctx: { orgId: string },
): Promise<asserts row is T> {
  if (!row || row.organizationId !== ctx.orgId) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
}
{{{{/raw}}}}
```

- [ ] **Step 7.3:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/trpc/middleware/rbac.ts
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/middleware/rbac.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): add tRPC orgProcedure and permissionProcedure middleware"
```

---

## Task 8 — tRPC project router (the example entity)

**Goal:** Full CRUD for `project` using `permissionProcedure` and `assertInScope`. Demonstrates the canonical pattern for any future scoped entity.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/routers/project.ts.hbs`

- [ ] **Step 8.1:** Create the router:

```hbs
---
path: src/trpc/routers/project.ts
mono:
  scope: app
  path: src/trpc/routers/project.ts
---
import { db } from '@repo/db';
import { project } from '@repo/db/schema';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { router } from '../init';
import { assertInScope, orgProcedure, permissionProcedure } from '../middleware/rbac';

{{{{raw}}}}
const projectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['active', 'archived']).default('active'),
});

export const projectRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    return db.select().from(project).where(eq(project.organizationId, ctx.orgId)).orderBy(desc(project.createdAt));
  }),

  get: orgProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await db.select().from(project).where(eq(project.id, input.id));
    await assertInScope(row, ctx);
    return row;
  }),

  create: permissionProcedure('project', 'create').input(projectInput).mutation(async ({ ctx, input }) => {
    const [created] = await db
      .insert(project)
      .values({
        ...input,
        organizationId: ctx.orgId,
        createdById: ctx.session.user.id,
      })
      .returning();
    if (!created) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return created;
  }),

  update: permissionProcedure('project', 'update')
    .input(z.object({ id: z.string() }).merge(projectInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(project).where(eq(project.id, input.id));
      await assertInScope(existing, ctx);
      const { id, ...patch } = input;
      const [updated] = await db
        .update(project)
        .set(patch)
        .where(and(eq(project.id, id), eq(project.organizationId, ctx.orgId)))
        .returning();
      return updated;
    }),

  delete: permissionProcedure('project', 'delete')
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db.select().from(project).where(eq(project.id, input.id));
      await assertInScope(existing, ctx);
      await db.delete(project).where(and(eq(project.id, input.id), eq(project.organizationId, ctx.orgId)));
      return { success: true };
    }),
});
{{{{/raw}}}}
```

- [ ] **Step 8.2:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/trpc/routers/project.ts | head -30
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/routers/project.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): add tRPC project router with scoped CRUD"
```

---

## Task 9 — tRPC member, role, invitation routers

**Goal:** Three thin wrapper routers that delegate to `auth.api.*` for organization plugin operations. They exist mostly to surface server validation errors as tRPC errors for the UI.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/routers/member.ts.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/routers/role.ts.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/routers/invitation.ts.hbs`

- [ ] **Step 9.1:** Create `member.ts.hbs`:

```hbs
---
path: src/trpc/routers/member.ts
mono:
  scope: app
  path: src/trpc/routers/member.ts
---
import { auth } from '@repo/auth/auth';
import { z } from 'zod';
import { router } from '../init';
import { orgProcedure, permissionProcedure } from '../middleware/rbac';

{{{{raw}}}}
export const memberRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    const result = await auth.api.listMembers({
      headers: ctx.headers,
      query: { organizationId: ctx.orgId },
    });
    return result?.members ?? [];
  }),

  updateRole: permissionProcedure('member', 'update')
    .input(z.object({ memberId: z.string(), role: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return auth.api.updateMemberRole({
        headers: ctx.headers,
        body: { memberId: input.memberId, role: input.role, organizationId: ctx.orgId },
      });
    }),

  remove: permissionProcedure('member', 'remove')
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return auth.api.removeMember({
        headers: ctx.headers,
        body: { memberIdOrEmail: input.memberId, organizationId: ctx.orgId },
      });
    }),
});
{{{{/raw}}}}
```

- [ ] **Step 9.2:** Create `role.ts.hbs`:

```hbs
---
path: src/trpc/routers/role.ts
mono:
  scope: app
  path: src/trpc/routers/role.ts
---
import { auth } from '@repo/auth/auth';
import { statement } from '@repo/auth/permissions';
import { z } from 'zod';
import { router } from '../init';
import { orgProcedure, permissionProcedure } from '../middleware/rbac';

{{{{raw}}}}
const permissionMap = z.record(z.string(), z.array(z.string()));

export const roleRouter = router({
  catalog: orgProcedure.query(() => statement),

  list: orgProcedure.query(async ({ ctx }) => {
    const result = await auth.api.listOrganizationRoles({
      headers: ctx.headers,
      query: { organizationId: ctx.orgId },
    });
    return result ?? [];
  }),

  create: permissionProcedure('role', 'create')
    .input(z.object({ role: z.string().min(1).max(60), permission: permissionMap }))
    .mutation(async ({ ctx, input }) => {
      return auth.api.createOrganizationRole({
        headers: ctx.headers,
        body: { role: input.role, permission: input.permission, organizationId: ctx.orgId },
      });
    }),

  update: permissionProcedure('role', 'update')
    .input(z.object({ roleName: z.string(), permission: permissionMap }))
    .mutation(async ({ ctx, input }) => {
      return auth.api.updateOrganizationRole({
        headers: ctx.headers,
        body: { roleName: input.roleName, permission: input.permission, organizationId: ctx.orgId },
      });
    }),

  delete: permissionProcedure('role', 'delete')
    .input(z.object({ roleName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return auth.api.deleteOrganizationRole({
        headers: ctx.headers,
        body: { roleName: input.roleName, organizationId: ctx.orgId },
      });
    }),
});
{{{{/raw}}}}
```

> **Implementation note:** the exact better-auth API names (`listOrganizationRoles`, `createOrganizationRole`, etc.) need verification against the installed version. If they differ, query context7 for the precise names: `mcp__plugin_context7_context7__query-docs` with library `/better-auth/better-auth` and query `dynamicAccessControl API endpoints listOrganizationRoles createRole updateRole deleteRole signatures`.

- [ ] **Step 9.3:** Create `invitation.ts.hbs`:

```hbs
---
path: src/trpc/routers/invitation.ts
mono:
  scope: app
  path: src/trpc/routers/invitation.ts
---
import { auth } from '@repo/auth/auth';
import { z } from 'zod';
import { router } from '../init';
import { orgProcedure, permissionProcedure } from '../middleware/rbac';

{{{{raw}}}}
export const invitationRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    const result = await auth.api.listInvitations({
      headers: ctx.headers,
      query: { organizationId: ctx.orgId },
    });
    return result ?? [];
  }),

  create: permissionProcedure('invitation', 'create')
    .input(z.object({ email: z.string().email(), role: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await auth.api.createInvitation({
        headers: ctx.headers,
        body: { email: input.email, role: input.role, organizationId: ctx.orgId },
      });
      const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/accept-invitation/${result.id}`;
      return { ...result, inviteLink };
    }),

  cancel: permissionProcedure('invitation', 'cancel')
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return auth.api.cancelInvitation({
        headers: ctx.headers,
        body: { invitationId: input.invitationId },
      });
    }),
});
{{{{/raw}}}}
```

- [ ] **Step 9.4:** Find and modify the root tRPC router file (typically `src/trpc/router.ts` from the trpc library template) to register these new routers. Locate it:

```bash
find apps/cli/templates/libraries/trpc -name "router*" -type f
```

Override it in the blueprint at `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/router.ts.hbs`:

```hbs
---
path: src/trpc/router.ts
mono:
  scope: app
  path: src/trpc/router.ts
---
import { router } from './init';
import { invitationRouter } from './routers/invitation';
import { memberRouter } from './routers/member';
import { projectRouter } from './routers/project';
import { roleRouter } from './routers/role';

{{{{raw}}}}
export const appRouter = router({
  project: projectRouter,
  member: memberRouter,
  role: roleRouter,
  invitation: invitationRouter,
});

export type AppRouter = typeof appRouter;
{{{{/raw}}}}
```

- [ ] **Step 9.5:** Generate, verify the four routers + root router exist, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
ls test-mt/apps/web/src/trpc/routers/
cat test-mt/apps/web/src/trpc/router.ts
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/trpc/
git commit -m "feat(blueprint/multitenant-saas): add member/role/invitation tRPC routers and register in root"
```

---

## Task 10 — Next.js middleware (onboarding redirect) + onboarding page

**Goal:** Force users with zero orgs to land on `/onboarding` to create their first one.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/middleware.ts.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(onboarding)/onboarding/page.tsx.hbs`

- [ ] **Step 10.1:** Create the middleware:

```hbs
---
path: src/middleware.ts
mono:
  scope: app
  path: src/middleware.ts
---
import { auth } from '@repo/auth/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';

{{{{raw}}}}
const PUBLIC_PATHS = ['/login', '/accept-invitation'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/onboarding')) return NextResponse.next();

  const orgs = await auth.api.listOrganizations({ headers: await headers() });
  if (!orgs || orgs.length === 0) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  if (!session.session.activeOrganizationId) {
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: orgs[0].id },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
{{{{/raw}}}}
```

- [ ] **Step 10.2:** Create the onboarding page:

```hbs
---
path: src/app/(onboarding)/onboarding/page.tsx
mono:
  scope: app
  path: src/app/(onboarding)/onboarding/page.tsx
---
'use client';

import { authClient } from '@repo/auth/auth-client';
import { Button } from '@repo/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/ui/card';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

{{{{raw}}}}
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const result = await authClient.organization.create({
      name,
      slug: slug || slugify(name),
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error.message ?? 'Failed to create organization');
      return;
    }
    if (result.data) {
      await authClient.organization.setActive({ organizationId: result.data.id });
      router.push('/');
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Create your first organization</CardTitle>
          <CardDescription>This is the workspace where your team will collaborate.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='name'>Organization name</Label>
              <Input
                id='name'
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug) setSlug(slugify(e.target.value));
                }}
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='slug'>URL slug</Label>
              <Input id='slug' value={slug} onChange={(e) => setSlug(slugify(e.target.value))} required />
            </div>
            <Button type='submit' className='w-full' disabled={submitting}>
              {submitting ? 'Creating...' : 'Create organization'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 10.3:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/middleware.ts | head -10
ls test-mt/apps/web/src/app/\(onboarding\)/onboarding/
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/middleware.ts.hbs \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(onboarding\)/
git commit -m "feat(blueprint/multitenant-saas): add onboarding redirect middleware and create-org page"
```

---

## Task 11 — Org switcher component

**Goal:** The signature multi-tenant component. shadcn dropdown in sidebar header listing user's orgs with a "+ Create organization" footer.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/org-switcher.tsx.hbs`

- [ ] **Step 11.1:** Create the file:

```hbs
---
path: src/components/navigation/org-switcher.tsx
mono:
  scope: app
  path: src/components/navigation/org-switcher.tsx
---
'use client';

import { authClient, useActiveOrganization, useListOrganizations } from '@repo/auth/auth-client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@repo/ui/components/ui/sidebar';
import { ArrowDown01Icon, Building02Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRouter } from 'next/navigation';

{{{{raw}}}}
export function OrgSwitcher() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const { data: orgs } = useListOrganizations();
  const { data: active } = useActiveOrganization();

  async function handleSwitch(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size='lg' className='data-[state=open]:bg-sidebar-accent'>
              <div className='bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg'>
                <HugeiconsIcon icon={Building02Icon} className='size-4' />
              </div>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>{active?.name ?? 'No organization'}</span>
                <span className='truncate text-xs text-muted-foreground'>{active?.slug ?? '—'}</span>
              </div>
              <HugeiconsIcon icon={ArrowDown01Icon} className='ml-auto size-4' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
            align='start'
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className='text-xs text-muted-foreground'>Organizations</DropdownMenuLabel>
            {orgs?.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className='gap-2'
              >
                <div className='flex size-6 items-center justify-center rounded-sm border'>
                  <HugeiconsIcon icon={Building02Icon} className='size-3.5 shrink-0' />
                </div>
                <span className='truncate'>{org.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/onboarding')} className='gap-2'>
              <div className='flex size-6 items-center justify-center rounded-md border bg-background'>
                <HugeiconsIcon icon={PlusSignIcon} className='size-4' />
              </div>
              <div className='font-medium text-muted-foreground'>Create organization</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 11.2:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/components/navigation/org-switcher.tsx | head -20
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/org-switcher.tsx.hbs
git commit -m "feat(blueprint/multitenant-saas): add OrgSwitcher dropdown component"
```

---

## Task 12 — Sidebar links + AppSidebar override + dashboard layout override

**Goal:** Plug the OrgSwitcher into the sidebar, filter nav links by permissions, and override the dashboard layout to wire it all up.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/sidebar-links.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/app-sidebar.tsx.hbs` (overrides org-dashboard-style header)
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/lib/constants.ts.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/layout.tsx.hbs` (override)

- [ ] **Step 12.1:** Read the org-dashboard equivalents for context.

```bash
cat apps/cli/templates/blueprints/org-dashboard/src/lib/constants.ts.hbs
cat apps/cli/templates/blueprints/org-dashboard/src/components/navigation/app-sidebar.tsx.hbs
cat apps/cli/templates/blueprints/org-dashboard/src/components/navigation/sidebar-links.tsx.hbs
cat apps/cli/templates/blueprints/org-dashboard/src/app/\(dashboard\)/layout.tsx.hbs
```

- [ ] **Step 12.2:** Create `lib/constants.ts.hbs` — defines route metadata with permission requirements.

```hbs
---
path: src/lib/constants.ts
mono:
  scope: app
  path: src/lib/constants.ts
---
import {
  DashboardSquare01Icon,
  FolderLibraryIcon,
  Settings02Icon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';

{{{{raw}}}}
export type RouteProps = {
  url: string;
  title: string;
  icon: typeof DashboardSquare01Icon;
  category?: string;
  permission?: { resource: string; action: string };
};

export const ROUTES: RouteProps[] = [
  { url: '/', title: 'Dashboard', icon: DashboardSquare01Icon },
  { url: '/projects', title: 'Projects', icon: FolderLibraryIcon, permission: { resource: 'project', action: 'read' } },
  {
    url: '/settings/general',
    title: 'General',
    icon: Settings02Icon,
    category: 'Settings',
    permission: { resource: 'organization', action: 'update' },
  },
  {
    url: '/settings/members',
    title: 'Members',
    icon: UserGroupIcon,
    category: 'Settings',
    permission: { resource: 'member', action: 'invite' },
  },
  {
    url: '/settings/roles',
    title: 'Roles',
    icon: UserIcon,
    category: 'Settings',
    permission: { resource: 'role', action: 'read' },
  },
];
{{{{/raw}}}}
```

- [ ] **Step 12.3:** Create `sidebar-links.tsx.hbs` — uses `useActiveOrganization` to get the user's role and `checkRolePermission` (sync) for filtering nav.

```hbs
---
path: src/components/navigation/sidebar-links.tsx
mono:
  scope: app
  path: src/components/navigation/sidebar-links.tsx
---
'use client';

import { authClient, useActiveOrganization } from '@repo/auth/auth-client';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@repo/ui/components/ui/sidebar';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES, type RouteProps } from '@/lib/constants';

{{{{raw}}}}
export function SidebarLinks({ role }: { role: string }) {
  const pathname = usePathname();
  const { data: active } = useActiveOrganization();

  const visible = ROUTES.filter((route) => {
    if (!route.permission) return true;
    const result = authClient.organization.checkRolePermission({
      role,
      permissions: { [route.permission.resource]: [route.permission.action] },
    });
    return result;
  });

  const ungrouped = visible.filter((r) => !r.category);
  const grouped = visible.reduce<Record<string, RouteProps[]>>((acc, r) => {
    if (!r.category) return acc;
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          {ungrouped.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={item.url === '/' ? pathname === '/' : pathname.startsWith(item.url)}
              >
                <Link href={item.url}>
                  <HugeiconsIcon icon={item.icon} />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
      {Object.entries(grouped).map(([category, items]) => (
        <SidebarGroup key={category}>
          <SidebarGroupLabel>{category}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={pathname.startsWith(item.url)}
                >
                  <Link href={item.url}>
                    <HugeiconsIcon icon={item.icon} />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
{{{{/raw}}}}
```

> **Note:** `checkRolePermission` is sync but returns boolean. For dynamic roles created at runtime, the sidebar may need a one-shot async fetch — acceptable trade-off for a blueprint, document for end-users.

- [ ] **Step 12.4:** Create `app-sidebar.tsx.hbs` (drops the static logo, uses OrgSwitcher in header):

```hbs
---
path: src/components/navigation/app-sidebar.tsx
mono:
  scope: app
  path: src/components/navigation/app-sidebar.tsx
---
import type { Session } from '@repo/auth/types';
import type * as React from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@repo/ui/components/ui/sidebar';
import { NavUser } from './nav-user';
import { OrgSwitcher } from './org-switcher';
import { SidebarLinks } from './sidebar-links';

{{{{raw}}}}
type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  session: Session;
  role: string;
};

export function AppSidebar({ session, role, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible='icon' variant='sidebar' {...props}>
      <SidebarHeader>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarLinks role={role} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} />
      </SidebarFooter>
    </Sidebar>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 12.5:** Create the dashboard layout override. It must redirect unauth users, ensure an active org, and look up the user's role for the sidebar:

```hbs
---
path: src/app/(dashboard)/layout.tsx
mono:
  scope: app
  path: src/app/(dashboard)/layout.tsx
---
import { auth } from '@repo/auth/auth';
import { Separator } from '@repo/ui/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@repo/ui/components/ui/sidebar';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/navigation/app-sidebar';

{{{{raw}}}}
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) redirect('/login');
  if (!session.session.activeOrganizationId) redirect('/onboarding');

  const members = await auth.api.listMembers({
    headers: hdrs,
    query: { organizationId: session.session.activeOrganizationId },
  });
  const me = members?.members?.find((m) => m.userId === session.user.id);
  const role = me?.role ?? 'member';

  return (
    <SidebarProvider>
      <AppSidebar session={session} role={role} />
      <SidebarInset>
        <header className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
          <SidebarTrigger />
          <Separator orientation='vertical' className='h-4' />
        </header>
        <main className='flex-1 p-6'>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 12.6:** Reuse the org-dashboard `nav-user.tsx.hbs` — copy it as-is into `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/nav-user.tsx.hbs`. Since it's identical to org-dashboard's, copy verbatim:

```bash
cp apps/cli/templates/blueprints/org-dashboard/src/components/navigation/nav-user.tsx.hbs \
   apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/nav-user.tsx.hbs
```

Then update its frontmatter if needed to use `mono.scope: app`. Inspect:

```bash
head -10 apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/nav-user.tsx.hbs
```

If the frontmatter doesn't match the multitenant-saas pattern (`mono.scope: app, mono.path: src/components/navigation/nav-user.tsx`), edit it.

- [ ] **Step 12.7:** Generate, verify the layout works end-to-end (no missing imports, `role` is plumbed through).

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/app/\(dashboard\)/layout.tsx
cat test-mt/apps/web/src/components/navigation/app-sidebar.tsx
rm -rf test-mt
```

- [ ] **Step 12.8:** Commit.

```bash
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/lib/constants.ts.hbs \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/navigation/ \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/layout.tsx.hbs
git commit -m "feat(blueprint/multitenant-saas): add OrgSwitcher-aware sidebar and dashboard layout"
```

---

## Task 13 — Members management UI (settings/members)

**Goal:** Page that lists members + invitations, with invite dialog showing copy-link and pending invitations table.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/members/members-table.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/members/invite-dialog.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/members/invitation-link-dialog.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/members/pending-invitations-table.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/settings/members/page.tsx.hbs`

**Pattern reference:** all four components use TanStack Query via the tRPC client, render shadcn `Table`, and use HugeIcons. The form uses TanStack Form. Mirror `org-dashboard`'s `apps/web/src/components/admin/user-table.tsx.hbs` for the table pattern.

- [ ] **Step 13.1:** Create `invitation-link-dialog.tsx.hbs` (the simplest piece, the rest depend on it):

```hbs
---
path: src/components/members/invitation-link-dialog.tsx
mono:
  scope: app
  path: src/components/members/invitation-link-dialog.tsx
---
'use client';

import { Button } from '@repo/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/ui/dialog';
import { Input } from '@repo/ui/components/ui/input';
import { CheckmarkSquare01Icon, Copy01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import { toast } from 'sonner';

{{{{raw}}}}
type InvitationLinkDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteLink: string;
  email: string;
  expiresAt?: Date;
};

export function InvitationLinkDialog({ open, onOpenChange, inviteLink, email, expiresAt }: InvitationLinkDialogProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitation created</DialogTitle>
          <DialogDescription>
            Share this link with {email}. They can use it to join your organization.
            {expiresAt ? ` Expires on ${new Date(expiresAt).toLocaleDateString()}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className='flex items-center gap-2'>
          <Input value={inviteLink} readOnly className='font-mono text-sm' />
          <Button onClick={copy} size='icon' variant='outline' aria-label='Copy link'>
            <HugeiconsIcon icon={copied ? CheckmarkSquare01Icon : Copy01Icon} className='size-4' />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 13.2:** Create `invite-dialog.tsx.hbs`:

```hbs
---
path: src/components/members/invite-dialog.tsx
mono:
  scope: app
  path: src/components/members/invite-dialog.tsx
---
'use client';

import { Button } from '@repo/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/ui/dialog';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/ui/select';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';
import { InvitationLinkDialog } from './invitation-link-dialog';

{{{{raw}}}}
const BUILT_IN_ROLES = ['admin', 'member'];

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; link: string; email: string }>({
    open: false,
    link: '',
    email: '',
  });

  const utils = trpc.useUtils();
  const { data: customRoles } = trpc.role.list.useQuery();

  const create = trpc.invitation.create.useMutation({
    onSuccess: (data) => {
      setOpen(false);
      setEmail('');
      setRole('member');
      utils.invitation.list.invalidate();
      setLinkDialog({ open: true, link: data.inviteLink, email: data.email ?? '' });
    },
    onError: (err) => toast.error(err.message),
  });

  const allRoles = [...BUILT_IN_ROLES, ...(customRoles ?? []).map((r: { roleName: string }) => r.roleName)];

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Invite member</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>You'll get a link to share with the invited person.</DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='email'>Email</Label>
              <Input
                id='email'
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='role'>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate({ email, role })} disabled={create.isPending}>
              {create.isPending ? 'Creating...' : 'Create invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <InvitationLinkDialog
        open={linkDialog.open}
        onOpenChange={(o) => setLinkDialog((s) => ({ ...s, open: o }))}
        inviteLink={linkDialog.link}
        email={linkDialog.email}
      />
    </>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 13.3:** Create `members-table.tsx.hbs`:

```hbs
---
path: src/components/members/members-table.tsx
mono:
  scope: app
  path: src/components/members/members-table.tsx
---
'use client';

import { Button } from '@repo/ui/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/ui/table';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';

{{{{raw}}}}
const BUILT_IN_ROLES = ['owner', 'admin', 'member'];

export function MembersTable() {
  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.member.list.useQuery();
  const { data: customRoles } = trpc.role.list.useQuery();

  const updateRole = trpc.member.updateRole.useMutation({
    onSuccess: () => utils.member.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });
  const remove = trpc.member.remove.useMutation({
    onSuccess: () => utils.member.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  const allRoles = [...BUILT_IN_ROLES, ...(customRoles ?? []).map((r: { roleName: string }) => r.roleName)];

  if (isLoading) return <div>Loading...</div>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className='w-[100px]' />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members?.map((m) => (
          <TableRow key={m.id}>
            <TableCell>{m.user?.email ?? m.userId}</TableCell>
            <TableCell>
              <Select
                value={m.role}
                onValueChange={(role) => updateRole.mutate({ memberId: m.id, role })}
                disabled={m.role === 'owner'}
              >
                <SelectTrigger className='w-[160px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              {m.role !== 'owner' ? (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    if (confirm(`Remove ${m.user?.email}?`)) remove.mutate({ memberId: m.id });
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 13.4:** Create `pending-invitations-table.tsx.hbs`:

```hbs
---
path: src/components/members/pending-invitations-table.tsx
mono:
  scope: app
  path: src/components/members/pending-invitations-table.tsx
---
'use client';

import { Button } from '@repo/ui/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/ui/table';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';

{{{{raw}}}}
function buildLink(id: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/accept-invitation/${id}`;
}

export function PendingInvitationsTable() {
  const utils = trpc.useUtils();
  const { data: invitations, isLoading } = trpc.invitation.list.useQuery();
  const cancel = trpc.invitation.cancel.useMutation({
    onSuccess: () => utils.invitation.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <div>Loading...</div>;
  const pending = invitations?.filter((i) => i.status === 'pending') ?? [];
  if (pending.length === 0) return <p className='text-sm text-muted-foreground'>No pending invitations.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {pending.map((i) => (
          <TableRow key={i.id}>
            <TableCell>{i.email}</TableCell>
            <TableCell>{i.role}</TableCell>
            <TableCell>{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : '—'}</TableCell>
            <TableCell className='space-x-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={async () => {
                  await navigator.clipboard.writeText(buildLink(i.id));
                  toast.success('Link copied');
                }}
              >
                Copy link
              </Button>
              <Button variant='ghost' size='sm' onClick={() => cancel.mutate({ invitationId: i.id })}>
                Cancel
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 13.5:** Create the page at `app/(dashboard)/settings/members/page.tsx.hbs`:

```hbs
---
path: src/app/(dashboard)/settings/members/page.tsx
mono:
  scope: app
  path: src/app/(dashboard)/settings/members/page.tsx
---
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/ui/tabs';
import { InviteDialog } from '@/components/members/invite-dialog';
import { MembersTable } from '@/components/members/members-table';
import { PendingInvitationsTable } from '@/components/members/pending-invitations-table';

{{{{raw}}}}
export default function MembersPage() {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-semibold'>Members</h1>
          <p className='text-sm text-muted-foreground'>Manage who can access this organization.</p>
        </div>
        <InviteDialog />
      </div>
      <Tabs defaultValue='active'>
        <TabsList>
          <TabsTrigger value='active'>Active</TabsTrigger>
          <TabsTrigger value='pending'>Pending invitations</TabsTrigger>
        </TabsList>
        <TabsContent value='active' className='pt-4'>
          <MembersTable />
        </TabsContent>
        <TabsContent value='pending' className='pt-4'>
          <PendingInvitationsTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 13.6:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
ls test-mt/apps/web/src/components/members/
ls test-mt/apps/web/src/app/\(dashboard\)/settings/members/
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/members/ \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/settings/members/
git commit -m "feat(blueprint/multitenant-saas): add members management with copy-link invitations"
```

---

## Task 14 — Roles management UI (settings/roles)

**Goal:** Page with roles table (built-in read-only + custom editable), with a permissions grid dialog.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/roles/permissions-grid.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/roles/role-form-dialog.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/roles/roles-table.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/settings/roles/page.tsx.hbs`

- [ ] **Step 14.1:** Create `permissions-grid.tsx.hbs`:

```hbs
---
path: src/components/roles/permissions-grid.tsx
mono:
  scope: app
  path: src/components/roles/permissions-grid.tsx
---
'use client';

import { Checkbox } from '@repo/ui/components/ui/checkbox';
import { Label } from '@repo/ui/components/ui/label';

{{{{raw}}}}
type PermissionsGridProps = {
  catalog: Record<string, readonly string[] | string[]>;
  value: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  disabled?: boolean;
};

export function PermissionsGrid({ catalog, value, onChange, disabled }: PermissionsGridProps) {
  function toggle(resource: string, action: string, checked: boolean) {
    const current = value[resource] ?? [];
    const next = checked ? [...new Set([...current, action])] : current.filter((a) => a !== action);
    const updated = { ...value };
    if (next.length === 0) delete updated[resource];
    else updated[resource] = next;
    onChange(updated);
  }

  return (
    <div className='space-y-4'>
      {Object.entries(catalog).map(([resource, actions]) => (
        <div key={resource} className='rounded-lg border p-4'>
          <div className='mb-3 font-medium capitalize'>{resource}</div>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
            {actions.map((action) => {
              const id = `${resource}.${action}`;
              const checked = (value[resource] ?? []).includes(action);
              return (
                <div key={action} className='flex items-center gap-2'>
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(c) => toggle(resource, action, c === true)}
                    disabled={disabled}
                  />
                  <Label htmlFor={id} className='text-sm font-normal'>
                    {action}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 14.2:** Create `role-form-dialog.tsx.hbs`:

```hbs
---
path: src/components/roles/role-form-dialog.tsx
mono:
  scope: app
  path: src/components/roles/role-form-dialog.tsx
---
'use client';

import { Button } from '@repo/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/ui/dialog';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';
import { PermissionsGrid } from './permissions-grid';

{{{{raw}}}}
type RoleFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { roleName: string; permission: Record<string, string[]> } | null;
};

export function RoleFormDialog({ open, onOpenChange, initial }: RoleFormDialogProps) {
  const utils = trpc.useUtils();
  const { data: catalog } = trpc.role.catalog.useQuery();
  const [roleName, setRoleName] = useState('');
  const [permission, setPermission] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (open) {
      setRoleName(initial?.roleName ?? '');
      setPermission(initial?.permission ?? {});
    }
  }, [open, initial]);

  const create = trpc.role.create.useMutation({
    onSuccess: () => {
      utils.role.list.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const update = trpc.role.update.useMutation({
    onSuccess: () => {
      utils.role.list.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  function submit() {
    if (initial) update.mutate({ roleName: initial.roleName, permission });
    else create.mutate({ role: roleName, permission });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit role' : 'Create role'}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          {!initial && (
            <div className='space-y-2'>
              <Label htmlFor='roleName'>Name</Label>
              <Input id='roleName' value={roleName} onChange={(e) => setRoleName(e.target.value)} />
            </div>
          )}
          {catalog && (
            <PermissionsGrid
              catalog={catalog as Record<string, readonly string[]>}
              value={permission}
              onChange={setPermission}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending}>
            {initial ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 14.3:** Create `roles-table.tsx.hbs`:

```hbs
---
path: src/components/roles/roles-table.tsx
mono:
  scope: app
  path: src/components/roles/roles-table.tsx
---
'use client';

import { Badge } from '@repo/ui/components/ui/badge';
import { Button } from '@repo/ui/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/ui/table';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';
import { RoleFormDialog } from './role-form-dialog';

{{{{raw}}}}
const BUILT_IN = new Set(['owner', 'admin', 'member']);

type Initial = { roleName: string; permission: Record<string, string[]> } | null;

export function RolesTable() {
  const utils = trpc.useUtils();
  const { data: roles, isLoading } = trpc.role.list.useQuery();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<Initial>(null);

  const remove = trpc.role.delete.useMutation({
    onSuccess: () => utils.role.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>Roles</h1>
        <Button
          onClick={() => {
            setInitial(null);
            setOpen(true);
          }}
        >
          Create role
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Permissions</TableHead>
            <TableHead className='w-[160px]' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {['owner', 'admin', 'member'].map((r) => (
            <TableRow key={r}>
              <TableCell className='font-medium'>{r}</TableCell>
              <TableCell>
                <Badge variant='secondary'>built-in</Badge>
              </TableCell>
              <TableCell className='text-muted-foreground'>—</TableCell>
              <TableCell />
            </TableRow>
          ))}
          {roles?.map((role: { roleName: string; permission: Record<string, string[]> }) => {
            if (BUILT_IN.has(role.roleName)) return null;
            return (
              <TableRow key={role.roleName}>
                <TableCell className='font-medium'>{role.roleName}</TableCell>
                <TableCell>
                  <Badge>custom</Badge>
                </TableCell>
                <TableCell className='text-sm text-muted-foreground'>
                  {Object.entries(role.permission)
                    .map(([r, a]) => `${r}: ${a.join(', ')}`)
                    .join(' · ')}
                </TableCell>
                <TableCell className='space-x-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => {
                      setInitial({ roleName: role.roleName, permission: role.permission });
                      setOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => {
                      if (confirm(`Delete role "${role.roleName}"? Members with this role will be reset.`)) {
                        remove.mutate({ roleName: role.roleName });
                      }
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <RoleFormDialog open={open} onOpenChange={setOpen} initial={initial} />
    </>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 14.4:** Create the page:

```hbs
---
path: src/app/(dashboard)/settings/roles/page.tsx
mono:
  scope: app
  path: src/app/(dashboard)/settings/roles/page.tsx
---
import { RolesTable } from '@/components/roles/roles-table';

{{{{raw}}}}
export default function RolesPage() {
  return (
    <div className='space-y-6'>
      <RolesTable />
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 14.5:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
ls test-mt/apps/web/src/components/roles/
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/roles/ \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/settings/roles/
git commit -m "feat(blueprint/multitenant-saas): add roles management with permissions grid"
```

---

## Task 15 — Settings general page (with danger zone)

**Goal:** Page to edit org name/slug/logo + danger zone (delete org + transfer ownership).

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/settings/general/page.tsx.hbs`

- [ ] **Step 15.1:** Create the page (~150 lines, contains 3 sub-sections in one file for simplicity):

```hbs
---
path: src/app/(dashboard)/settings/general/page.tsx
mono:
  scope: app
  path: src/app/(dashboard)/settings/general/page.tsx
---
'use client';

import { authClient, useActiveOrganization } from '@repo/auth/auth-client';
import { Button } from '@repo/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/ui/card';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

{{{{raw}}}}
export default function GeneralSettingsPage() {
  const router = useRouter();
  const { data: active, refetch } = useActiveOrganization();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (active) {
      setName(active.name);
      setSlug(active.slug);
    }
  }, [active]);

  async function save() {
    if (!active) return;
    const result = await authClient.organization.update({
      organizationId: active.id,
      data: { name, slug },
    });
    if (result.error) toast.error(result.error.message ?? 'Failed to update');
    else {
      toast.success('Saved');
      refetch();
    }
  }

  async function deleteOrg() {
    if (!active) return;
    if (confirm !== active.slug) {
      toast.error('Confirmation does not match the organization slug.');
      return;
    }
    const result = await authClient.organization.delete({ organizationId: active.id });
    if (result.error) toast.error(result.error.message ?? 'Failed to delete');
    else {
      toast.success('Organization deleted');
      router.push('/onboarding');
    }
  }

  if (!active) return null;

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Organization name and URL slug.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='name'>Name</Label>
            <Input id='name' value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='slug'>Slug</Label>
            <Input id='slug' value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>

      <Card className='border-destructive'>
        <CardHeader>
          <CardTitle className='text-destructive'>Danger zone</CardTitle>
          <CardDescription>Deleting an organization is permanent.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='confirm'>
              Type the slug <span className='font-mono'>{active.slug}</span> to confirm.
            </Label>
            <Input id='confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button variant='destructive' onClick={deleteOrg}>
            Delete organization
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 15.2:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/app/\(dashboard\)/settings/general/page.tsx | head -20
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/settings/general/
git commit -m "feat(blueprint/multitenant-saas): add general settings with danger zone"
```

> **Deferred:** "transfer ownership" UI is intentionally not in this task. It's an enhancement that can be added later as a separate dialog calling two `updateMemberRole` mutations sequentially.

---

## Task 16 — Projects CRUD UI (the example entity)

**Goal:** Pages and components to demonstrate the scoped-CRUD pattern. Mirrors the structure of org-dashboard's `contacts/`.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/projects/project-form.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/projects/project-table.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/projects/project-create-dialog.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/projects/project-edit-dialog.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/projects/project-delete-dialog.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/projects/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/projects/projects.client.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/projects/[id]/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/projects/[id]/project.client.tsx.hbs`

**Pattern reference:** copy and adapt `org-dashboard/src/components/contacts/*` and `org-dashboard/src/app/(dashboard)/contacts/*`. The structure is identical; only the entity (project vs contact), fields (name/description/status vs first/last/email), and tRPC route prefix (`project.*` vs `contact.*`) change.

- [ ] **Step 16.1:** Inspect the org-dashboard contacts files:

```bash
ls apps/cli/templates/blueprints/org-dashboard/src/components/contacts/
ls apps/cli/templates/blueprints/org-dashboard/src/app/\(dashboard\)/contacts/
```

- [ ] **Step 16.2:** Copy each file to the multitenant-saas blueprint with the equivalent name:

```bash
SRC=apps/cli/templates/blueprints/org-dashboard
DEST=apps/cli/templates/blueprints/multitenant-saas/apps/web

cp $SRC/src/components/contacts/contact-table.tsx.hbs $DEST/src/components/projects/project-table.tsx.hbs
cp $SRC/src/components/contacts/contact-form.tsx.hbs $DEST/src/components/projects/project-form.tsx.hbs
cp $SRC/src/components/contacts/contact-dialog.tsx.hbs $DEST/src/components/projects/project-create-dialog.tsx.hbs

mkdir -p $DEST/src/app/\(dashboard\)/projects/\[id\]
cp $SRC/src/app/\(dashboard\)/contacts/page.tsx.hbs $DEST/src/app/\(dashboard\)/projects/page.tsx.hbs
cp $SRC/src/app/\(dashboard\)/contacts/contacts.client.tsx.hbs $DEST/src/app/\(dashboard\)/projects/projects.client.tsx.hbs
cp $SRC/src/app/\(dashboard\)/contacts/\[id\]/page.tsx.hbs $DEST/src/app/\(dashboard\)/projects/\[id\]/page.tsx.hbs
cp $SRC/src/app/\(dashboard\)/contacts/\[id\]/contact.client.tsx.hbs $DEST/src/app/\(dashboard\)/projects/\[id\]/project.client.tsx.hbs
```

- [ ] **Step 16.3:** Adapt each copied file. Run the substitutions:
  - `contact` → `project` (case-sensitive)
  - `Contact` → `Project`
  - `firstName/lastName/email` fields → `name/description/status` (with status enum select)
  - tRPC client paths `trpc.contact.*` → `trpc.project.*`
  - File frontmatter paths to use `mono.scope: app` and the new path

For each file, the diff is mechanical but must be done by hand for the form and table since the field types differ (status is an enum, description is a textarea). Open each file and replace methodically.

- [ ] **Step 16.4:** Create the dedicated `project-edit-dialog.tsx.hbs` (org-dashboard combined create+edit in `contact-dialog`; we split for clarity):

```hbs
---
path: src/components/projects/project-edit-dialog.tsx
mono:
  scope: app
  path: src/components/projects/project-edit-dialog.tsx
---
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/ui/dialog';
import type { Project } from '@repo/db/schema';
import { ProjectForm } from './project-form';

{{{{raw}}}}
type Props = { open: boolean; onOpenChange: (open: boolean) => void; project: Project };

export function ProjectEditDialog({ open, onOpenChange, project }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <ProjectForm initial={project} onSuccess={() => onOpenChange(false)} mode='edit' />
      </DialogContent>
    </Dialog>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 16.5:** Create the delete confirmation dialog (typing the project name to confirm):

```hbs
---
path: src/components/projects/project-delete-dialog.tsx
mono:
  scope: app
  path: src/components/projects/project-delete-dialog.tsx
---
'use client';

import { Button } from '@repo/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/ui/dialog';
import { Input } from '@repo/ui/components/ui/input';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';

{{{{raw}}}}
type Props = { open: boolean; onOpenChange: (open: boolean) => void; project: { id: string; name: string } };

export function ProjectDeleteDialog({ open, onOpenChange, project }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState('');
  const remove = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      onOpenChange(false);
      router.push('/projects');
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project</DialogTitle>
          <DialogDescription>
            Type <span className='font-mono'>{project.name}</span> to confirm deletion.
          </DialogDescription>
        </DialogHeader>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            disabled={confirm !== project.name || remove.isPending}
            onClick={() => remove.mutate({ id: project.id })}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 16.6:** Update `project-form.tsx.hbs` to fit the new schema (status enum, optional description textarea). The form uses TanStack Form. Verify the existing import paths and adapt the mutation calls (`trpc.project.create` / `trpc.project.update`).

- [ ] **Step 16.7:** Generate, verify each project file is rendered, every reference to `contact` is gone:

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
grep -ri "contact" test-mt/apps/web/src/components/projects/ test-mt/apps/web/src/app/\(dashboard\)/projects/
```

Expected: no matches (if any, fix them in the templates).

- [ ] **Step 16.8:** Commit.

```bash
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/projects/ \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/projects/
git commit -m "feat(blueprint/multitenant-saas): add projects CRUD adapted from org-dashboard contacts"
```

---

## Task 17 — Profile pages (reuse from org-dashboard)

**Goal:** Profile section is identical to org-dashboard. Copy verbatim, adjust frontmatter.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/profile/layout.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/profile/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/profile/account/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/profile/security/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/profile/sessions/page.tsx.hbs`
- Create: components in `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/profile/` (5 files: account-form, security-form, session-list, preferences, tab-nav)

- [ ] **Step 17.1:** Copy all profile files from org-dashboard:

```bash
SRC=apps/cli/templates/blueprints/org-dashboard
DEST=apps/cli/templates/blueprints/multitenant-saas/apps/web

mkdir -p $DEST/src/components/profile
cp -r $SRC/src/components/profile/. $DEST/src/components/profile/
cp -r $SRC/src/app/\(dashboard\)/profile/. $DEST/src/app/\(dashboard\)/profile/
```

- [ ] **Step 17.2:** Inspect the frontmatter of each copied file. If org-dashboard files use a `mono` scope different from `app`, normalize them to `mono.scope: app`.

```bash
head -10 apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/profile/account-form.tsx.hbs
```

If the path needs adjustment, edit it to match the destination layout.

- [ ] **Step 17.3:** Drop the `preferences` file if you don't want a preferences tab, or keep it for parity. Decision: **keep for parity** — gives end-users a place to add per-user settings.

- [ ] **Step 17.4:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
ls test-mt/apps/web/src/app/\(dashboard\)/profile/
ls test-mt/apps/web/src/components/profile/
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/profile/ \
        apps/cli/templates/blueprints/multitenant-saas/apps/web/src/components/profile/
git commit -m "feat(blueprint/multitenant-saas): add profile pages reused from org-dashboard"
```

---

## Task 18 — Auth pages (login override + accept-invitation)

**Goal:** The accept-invitation route is the cornerstone of the share-link flow. Login is reused from better-auth library.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(auth)/accept-invitation/[id]/page.tsx.hbs`

- [ ] **Step 18.1:** Create the accept-invitation page. It handles both authenticated and unauthenticated cases:

```hbs
---
path: src/app/(auth)/accept-invitation/[id]/page.tsx
mono:
  scope: app
  path: src/app/(auth)/accept-invitation/[id]/page.tsx
---
import { auth } from '@repo/auth/auth';
import { Button } from '@repo/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@repo/ui/components/ui/card';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AcceptInvitationButton } from './accept-button';

{{{{raw}}}}
type Params = { id: string };

export default async function AcceptInvitationPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });

  const invitation = await auth.api
    .getInvitation({ headers: hdrs, query: { id } })
    .catch(() => null);

  if (!invitation) {
    return (
      <div className='flex min-h-screen items-center justify-center p-6'>
        <Card className='w-full max-w-md'>
          <CardHeader>
            <CardTitle>Invitation not found</CardTitle>
            <CardDescription>This invitation may have expired or been cancelled.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session) {
    const params = new URLSearchParams({ redirect: `/accept-invitation/${id}` });
    redirect(`/login?${params.toString()}`);
  }

  return (
    <div className='flex min-h-screen items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Join {invitation.organizationName ?? 'this organization'}</CardTitle>
          <CardDescription>
            You've been invited to join as <strong>{invitation.role}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>
            Invited email: <span className='font-mono'>{invitation.email}</span>
          </p>
        </CardContent>
        <CardFooter className='flex justify-end gap-2'>
          <Button variant='outline' asChild>
            <Link href='/'>Cancel</Link>
          </Button>
          <AcceptInvitationButton invitationId={id} />
        </CardFooter>
      </Card>
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 18.2:** Create the accept button (client component for the mutation):

```hbs
---
path: src/app/(auth)/accept-invitation/[id]/accept-button.tsx
mono:
  scope: app
  path: src/app/(auth)/accept-invitation/[id]/accept-button.tsx
---
'use client';

import { authClient } from '@repo/auth/auth-client';
import { Button } from '@repo/ui/components/ui/button';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

{{{{raw}}}}
export function AcceptInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    const result = await authClient.organization.acceptInvitation({ invitationId });
    setPending(false);
    if (result.error) {
      toast.error(result.error.message ?? 'Failed to accept');
      return;
    }
    if (result.data) {
      await authClient.organization.setActive({ organizationId: result.data.organizationId });
      router.push('/');
    }
  }

  return (
    <Button onClick={accept} disabled={pending}>
      {pending ? 'Joining...' : 'Accept invitation'}
    </Button>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 18.3:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
ls test-mt/apps/web/src/app/\(auth\)/accept-invitation/\[id\]/
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(auth\)/
git commit -m "feat(blueprint/multitenant-saas): add accept-invitation page with login redirect"
```

---

## Task 19 — Dashboard home page override

**Goal:** Replace the inherited dashboard page with a multitenant-aware welcome that shows project count + member count.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/(dashboard)/page.tsx.hbs`

- [ ] **Step 19.1:** Create the page:

```hbs
---
path: src/app/(dashboard)/page.tsx
mono:
  scope: app
  path: src/app/(dashboard)/page.tsx
---
'use client';

import { useActiveOrganization } from '@repo/auth/auth-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/ui/card';
import { trpc } from '@/trpc/client';

{{{{raw}}}}
export default function DashboardPage() {
  const { data: active } = useActiveOrganization();
  const { data: projects } = trpc.project.list.useQuery();
  const { data: members } = trpc.member.list.useQuery();

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Welcome to {active?.name ?? 'your dashboard'}</h1>
        <p className='text-sm text-muted-foreground'>Here's what's happening in your organization.</p>
      </div>
      <div className='grid gap-4 md:grid-cols-3'>
        <Card>
          <CardHeader className='pb-2'>
            <CardDescription>Projects</CardDescription>
            <CardTitle className='text-3xl'>{projects?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardDescription>Members</CardDescription>
            <CardTitle className='text-3xl'>{members?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardDescription>Plan</CardDescription>
            <CardTitle className='text-3xl'>Free</CardTitle>
          </CardHeader>
          <CardContent className='text-xs text-muted-foreground'>
            Wire up billing in your fork.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 19.2:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/apps/web/src/app/\(dashboard\)/page.tsx | head -20
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/apps/web/src/app/\(dashboard\)/page.tsx.hbs
git commit -m "feat(blueprint/multitenant-saas): add multitenant-aware dashboard home"
```

---

## Task 20 — Seed script

**Goal:** Bootstrap a working demo: 1 owner user, 1 member user, 1 organization, 2 example projects.

**Files:**
- Create: `apps/cli/templates/blueprints/multitenant-saas/scripts/seed.ts.hbs`

- [ ] **Step 20.1:** Read org-dashboard's seed for the auth user-creation pattern:

```bash
cat apps/cli/templates/blueprints/org-dashboard/scripts/seed.ts.hbs
```

- [ ] **Step 20.2:** Create the seed:

```hbs
---
path: scripts/seed.ts
mono:
  scope: root
  path: scripts/seed.ts
---
import { auth } from '@repo/auth/auth';
import { db } from '@repo/db';
import { project } from '@repo/db/schema';

{{{{raw}}}}
async function main() {
  console.log('Creating users...');

  const owner = await auth.api.signUpEmail({
    body: { email: 'owner@example.com', password: 'owner-password', name: 'Owner Demo' },
  });
  const memberAccount = await auth.api.signUpEmail({
    body: { email: 'member@example.com', password: 'member-password', name: 'Member Demo' },
  });

  console.log('Creating organization...');

  // Sign in as owner to create the org
  const ownerSession = await auth.api.signInEmail({
    body: { email: 'owner@example.com', password: 'owner-password' },
  });

  const org = await auth.api.createOrganization({
    headers: new Headers({ Authorization: `Bearer ${ownerSession.token}` }),
    body: { name: 'Acme Inc.', slug: 'acme' },
  });

  console.log('Inviting member...');

  await auth.api.createInvitation({
    headers: new Headers({ Authorization: `Bearer ${ownerSession.token}` }),
    body: { email: 'member@example.com', role: 'admin', organizationId: org.id },
  });

  console.log('Creating projects...');

  await db.insert(project).values([
    {
      organizationId: org.id,
      createdById: owner.user.id,
      name: 'Onboarding workflow',
      description: 'Set up new customer onboarding',
      status: 'active',
    },
    {
      organizationId: org.id,
      createdById: owner.user.id,
      name: 'Q4 launch',
      description: 'Plan and execute Q4 launch',
      status: 'active',
    },
  ]);

  console.log('Done.');
  console.log('Login as: owner@example.com / owner-password');
  console.log('Or invite-flow: check the latest invitation in database');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
{{{{/raw}}}}
```

> **Note:** the better-auth API names (`signUpEmail`, `signInEmail`, `createOrganization`, `createInvitation`) need verification at impl time. Run a context7 query if any fail with "method not found".

- [ ] **Step 20.3:** Generate, verify, commit.

```bash
bun apps/cli/src/index.ts test-mt --blueprint multitenant-saas --linter biome --no-install --no-git --pm bun
cat test-mt/scripts/seed.ts | head -30
rm -rf test-mt
git add apps/cli/templates/blueprints/multitenant-saas/scripts/seed.ts.hbs
git commit -m "feat(blueprint/multitenant-saas): add seed script with owner/member demo"
```

---

## Task 21 — Add integration test for the blueprint

**Goal:** Wire `multitenant-saas` into the existing test suite to ensure it generates correctly and exposes the expected files.

**Files:**
- Modify: `apps/cli/tests/integration/blueprint.test.ts` (add a new `describe` block)

- [ ] **Step 21.1:** Open `apps/cli/tests/integration/blueprint.test.ts` and append after the `describe('Blueprint generation - org-dashboard', ...)` block:

```ts
describe('Blueprint generation - multitenant-saas', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint multitenant-saas', async () => {
    const result = await runCli(
      ['test-mt', '--blueprint', 'multitenant-saas', '--linter', 'biome', '--no-install', '--git'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);

    const projectPath = join(tempDir, 'test-mt');

    // Auth package
    expect(await fileExists(join(projectPath, 'packages/auth/src/auth.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/auth/src/permissions.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/auth/src/types.ts'))).toBe(true);

    // DB schema with project entity
    const schemaContent = await readTextFile(join(projectPath, 'packages/db/src/schema.ts'));
    expect(schemaContent).toContain('project');
    expect(schemaContent).toContain('organizationId');

    // tRPC routers
    expect(await fileExists(join(projectPath, 'apps/web/src/trpc/routers/project.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/trpc/routers/member.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/trpc/routers/role.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/trpc/routers/invitation.ts'))).toBe(true);

    // RBAC middleware
    const rbacContent = await readTextFile(join(projectPath, 'apps/web/src/trpc/middleware/rbac.ts'));
    expect(rbacContent).toContain('orgProcedure');
    expect(rbacContent).toContain('permissionProcedure');
    expect(rbacContent).toContain('assertInScope');

    // OrgSwitcher
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/org-switcher.tsx'))).toBe(true);

    // Settings pages
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/settings/general/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/settings/members/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/settings/roles/page.tsx'))).toBe(true);

    // Onboarding
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(onboarding)/onboarding/page.tsx'))).toBe(true);

    // Accept invitation
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(auth)/accept-invitation/[id]/page.tsx'))).toBe(true);

    // Project entity UI
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/projects/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/projects/project-table.tsx'))).toBe(true);

    // Hugeicons dependency
    const webPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
      join(projectPath, 'apps/web/package.json'),
    );
    expect(webPkg.dependencies['@hugeicons/react']).toBeDefined();
    expect(webPkg.dependencies['@hugeicons/core-free-icons']).toBeDefined();
  });

  test('env file includes NEXT_PUBLIC_APP_URL', async () => {
    const result = await runCli(
      ['test-mt-env', '--blueprint', 'multitenant-saas', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const envContent = await readTextFile(join(tempDir, 'test-mt-env/apps/web/.env.example'));
    expect(envContent).toContain('NEXT_PUBLIC_APP_URL');
  });

  test('output shows --blueprint multitenant-saas in recreate command', async () => {
    const result = await runCli(
      ['test-mt-cmd', '--blueprint', 'multitenant-saas', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint multitenant-saas');
  });
});
```

- [ ] **Step 21.2:** Run the test.

```bash
cd apps/cli && bun test tests/integration/blueprint.test.ts -v
```

Expected: PASS for the new `multitenant-saas` describe block.

If it fails, the most likely causes are:
- Missing template file (check the file path and frontmatter resolution)
- Frontmatter `mono.scope` mismatched (check the `mono.scope: app` vs `pkg`)
- Handlebars escape issues (look for `\{{` errors)

- [ ] **Step 21.3:** Run the full unit test suite to make sure no regression in `blueprint-imports.test.ts`:

```bash
cd apps/cli && bun test tests/unit/blueprint-imports.test.ts -v
```

Expected: PASS (all imports in your templates have declared dependencies).

If imports test fails, the new package is using a dep not declared in either the META `packageJson` of the blueprint or any of its libraries. Add the missing dep to the blueprint's `packageJson` in Task 1's META entry.

- [ ] **Step 21.4:** Commit.

```bash
git add apps/cli/tests/integration/blueprint.test.ts
git commit -m "test(blueprint/multitenant-saas): add generation integration tests"
```

---

## Task 22 — End-to-end verification: install + build + run

**Goal:** Generate a real project, install deps, run `bun run db:generate` (better-auth migration generation), build, and start the dev server. Confirm there are no compilation errors and the app boots.

- [ ] **Step 22.1:** Generate a fresh project in a real location (outside the repo):

```bash
cd /tmp
rm -rf mt-saas-e2e
bun /home/plv/lab/r/create-faster/apps/cli/src/index.ts mt-saas-e2e \
  --blueprint multitenant-saas \
  --linter biome \
  --tooling husky \
  --git \
  --pm bun
```

Expected: project created in `/tmp/mt-saas-e2e/`.

- [ ] **Step 22.2:** Install deps.

```bash
cd /tmp/mt-saas-e2e
bun install
```

Expected: clean install, no peer-dep warnings about better-auth/drizzle.

- [ ] **Step 22.3:** Generate the better-auth + drizzle migrations.

```bash
cd /tmp/mt-saas-e2e
bunx @better-auth/cli generate --y
```

Expected: generates the auth schema additions in `packages/db/src/schema.ts` (or similar). If errors, check that `packages/auth/src/auth.ts` exports `auth` and that the path is registered.

- [ ] **Step 22.4:** Typecheck.

```bash
cd /tmp/mt-saas-e2e
bunx tsc --noEmit -p apps/web
```

Expected: PASS (no type errors).

If errors, the most common cause is mismatched better-auth API names in routers or seed (Step 9.2 / 9.3 / 20.2). Fix in templates and re-generate.

- [ ] **Step 22.5:** Start a Postgres for the dev DB. If you have docker:

```bash
docker run --name mt-saas-pg -d -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

Update `/tmp/mt-saas-e2e/.env` with `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`.

- [ ] **Step 22.6:** Push schema to DB.

```bash
cd /tmp/mt-saas-e2e
bun run db:push
```

Expected: tables created (organization, member, invitation, organizationRole, project, etc.).

- [ ] **Step 22.7:** Start the dev server.

```bash
cd /tmp/mt-saas-e2e
bun run dev
```

Expected: Next.js starts on port 3000 without errors. Open http://localhost:3000 in browser.

- [ ] **Step 22.8:** Manual smoke test:
  1. Sign up at `/login` (or `/signup`) with a new email
  2. Get redirected to `/onboarding`
  3. Create an org named "Test Co"
  4. Land on `/` dashboard with stats showing 0 projects, 1 member
  5. Go to `/projects`, create a project — appears in list
  6. Go to `/settings/members`, invite `someone@example.com` as `member`
  7. Copy the invite link from the dialog
  8. Open invite link in incognito, sign up with `someone@example.com`, accept invitation
  9. Now you have 2 members in the org
  10. Go to `/settings/roles`, create a custom role `viewer` with `project: read`
  11. Switch the second member's role to `viewer`
  12. Sign in as the second member, verify only `Projects` is visible in sidebar (no Settings)

If any step fails, fix the underlying template and re-generate.

- [ ] **Step 22.9:** Cleanup the test project + container.

```bash
rm -rf /tmp/mt-saas-e2e
docker rm -f mt-saas-pg
```

- [ ] **Step 22.10:** No commit needed for this task (purely verification). If you fixed templates during this task, commit those fixes with descriptive messages.

---

## Task 23 — Documentation page (optional but recommended)

**Goal:** Add a docs page in `apps/www/content/docs/blueprints/` so the blueprint shows up in the website.

**Files:**
- Create: `apps/www/content/docs/blueprints/multitenant-saas.mdx`

- [ ] **Step 23.1:** Inspect the existing pattern.

```bash
ls apps/www/content/docs/blueprints/
cat apps/www/content/docs/blueprints/org-dashboard.mdx 2>/dev/null | head -40
```

- [ ] **Step 23.2:** Use the `documenting-blueprint` skill (if available in the user's environment) or write the doc manually following the same format as `org-dashboard.mdx`. The doc should cover:
  - What the blueprint generates
  - Composition (stacks, libraries, project addons)
  - Multi-tenant architecture explanation
  - RBAC concept
  - Invitation flow (link-based)
  - CLI usage example
  - Extra dependencies (Hugeicons)

- [ ] **Step 23.3:** Commit.

```bash
git add apps/www/content/docs/blueprints/multitenant-saas.mdx
git commit -m "docs(blueprint): document multitenant-saas blueprint"
```

---

## Task 24 — Final integration & cleanup

**Goal:** Run the full test suite + format, ensure everything is clean before merging.

- [ ] **Step 24.1:** Run all CLI tests.

```bash
cd apps/cli && bun test
```

Expected: all tests pass (unit + integration + e2e if reachable).

- [ ] **Step 24.2:** Run biome format and lint.

```bash
cd /home/plv/lab/r/create-faster
bun run format
bun run lint
```

Expected: clean (no errors). If fixes are applied, commit them as `chore: format`.

- [ ] **Step 24.3:** Run the unused-dependency check.

```bash
bun run check:unused
```

Expected: no new unused deps. If knip flags new entries from the blueprint META, those are likely false positives — add to the knip ignore list if needed.

- [ ] **Step 24.4:** Verify the blueprint shows up in interactive mode.

```bash
bun apps/cli/src/index.ts
```

Expected: when prompted "Use a blueprint?", `Multitenant SaaS` appears in the Business category. Cancel without generating.

- [ ] **Step 24.5:** Open a PR. Use `gh pr create` with a body summarizing the blueprint and linking the design + plan docs.

```bash
git push -u origin <current-branch>
gh pr create --title "feat(blueprint): add multitenant-saas" --body "$(cat <<'EOF'
## Summary
- Adds a new `multitenant-saas` blueprint for B2B SaaS dashboards with multi-tenant orgs, custom RBAC, and link-based invitations
- Built on `better-auth/organization` plugin with `dynamicAccessControl` for runtime role creation
- Reuses ~70% of org-dashboard's infrastructure (layout, profile, monorepo packages); adds the multi-tenant overlay (org switcher, scoped data, settings/members, settings/roles)
- ~46 new template files + 1 META entry + 1 integration test block

## Design & plan
- Spec: `docs/agents/blueprints/2026-05-01-multitenant-saas-design.md`
- Plan: `docs/agents/blueprints/2026-05-02-multitenant-saas-plan.md`

## Test plan
- [ ] `bun test apps/cli/tests/integration/blueprint.test.ts` (multitenant-saas describe block) passes
- [ ] `bun test apps/cli/tests/unit/blueprint-imports.test.ts` passes
- [ ] Manual E2E: signup → onboarding → create org → invite via link → second user accepts → switch roles → custom role created via UI gates sidebar correctly
EOF
)"
```

---

## Self-review (run after writing the plan)

### 1. Spec coverage

| Spec section | Implemented in tasks |
|---|---|
| §2 Architecture: organization plugin + dynamicAccessControl | Tasks 3, 4 |
| §2 tRPC `orgProcedure` + `permissionProcedure` | Task 7 |
| §2 `assertInScope` helper | Task 7 |
| §2 Onboarding redirect middleware | Task 10 |
| §2 Org switcher | Task 11 |
| §2 Monorepo packages structure | Task 1 (META) + Tasks 2-5 (auth + db) |
| §3 Permissions catalog (5 resources, 17 actions) | Task 2 |
| §3 Built-in roles (owner/admin/member) | Task 2 |
| §3 Dynamic roles via UI | Tasks 9 (router), 14 (UI) |
| §3 `/settings/general`, `/members`, `/roles` | Tasks 13, 14, 15 |
| §3 Permission helpers (server, hook, Can) | Tasks 6, 7 |
| §4 Route tree (~15 pages) | Tasks 10, 12-19 |
| §4 Project entity CRUD | Tasks 5, 8, 16 |
| §4 Invitation flow (link-based, no email) | Tasks 3 (no-op), 9 (router), 13 (UI), 18 (accept page) |
| §5 META entry + dependencies | Task 1 |
| §5 Hugeicons dependency | Task 1 (in packageJson) |
| §6 Open question: better-auth API names | Flagged in Tasks 9, 20 |
| §6 Open question: accept-invitation auth/unauth | Resolved in Task 18 (single page redirects to login if unauth) |

All spec sections covered. ✓

### 2. Placeholder scan

Searched for "TBD", "TODO", "implement later", "fill in details" — none found in plan tasks.

Two files (project-form, profile components) are marked as "copy from org-dashboard and adapt." This is acceptable because the source is concrete and the substitutions are mechanical — but if executing as a subagent, the executor must actually open and edit, not skim.

### 3. Type consistency

- `orgProcedure` defined Task 7, used in Tasks 8, 9 — name consistent.
- `permissionProcedure` defined Task 7, used in Tasks 8, 9 — consistent.
- `assertInScope` defined Task 7, used in Task 8 — consistent.
- `Session` type defined Task 4, used in Task 12 — consistent (`@repo/auth/types`).
- `Project` type from schema (Task 5), used in Task 16 — consistent.
- `useActiveOrganization` / `useListOrganizations` exports declared in Task 4 — used in Tasks 11, 12, 19, 15.
- `trpc.useUtils()`, `trpc.<router>.<proc>` calls — assume the tRPC library template provides the `@/trpc/client` export. **Verify at Task 8 or before** by inspecting `apps/cli/templates/libraries/trpc/`.

If any inconsistency found at execution time, prefer fixing the earliest task and re-generating downstream.

---

## Done

Plan complete. Spec at `docs/agents/blueprints/2026-05-01-multitenant-saas-design.md`. Plan at this file.

**Recommended execution mode:** `superpowers:subagent-driven-development` — fresh subagent per task with review between tasks. Tasks 13, 14, 16 are the longest (multi-component); they can be split further if a subagent's context budget is tight.
