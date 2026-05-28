# org-dashboard Blueprint Improvement — PR2 (Auth tRPC migration + RBAC + Doctor)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `authClient` for data-mutating UI paths (`admin.createUser`, `updateUser`, `changePassword`) by wrapping `auth.api.*` server-side in tRPC procedures, introduce static RBAC via Better Auth admin plugin (`admin`/`manager`/`viewer` roles, resources = `user`/`contact`/`session`), and finish with a `/react-doctor` pass.

**Architecture:** A fresh worktree (`.worktrees/improve-org-api`) is created off the **merged** tip of `feat/blueprint/improve-org` (which by this point contains PR1's UI/forms work). All edits target `packages/auth/`, `packages/api/`, and the 4 form/page files that PR1 left calling `authClient`.

**Tech Stack:** Better Auth (admin plugin + access control), tRPC v11, TanStack Query, Handlebars `.hbs` templates.

**Reference design spec:** `docs/agents/superpowers/specs/2026-05-28-org-dashboard-blueprint-improve-design.md`
**Reference plan (PR1):** `docs/agents/superpowers/plans/2026-05-28-org-dashboard-improve-pr1.md`

---

## File Map (PR2)

### Created

- `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs` — `statement` + `ac` + `admin`/`manager`/`viewer` roles

### Modified

- `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth.ts.hbs` — wire `ac`, `roles`, `defaultRole`, `adminRoles` into `adminPlugin`
- `apps/cli/templates/blueprints/org-dashboard/packages/api/src/middleware/rbac.ts.hbs` — replace `adminProcedure`/`userProcedure` with `permissionProcedure(resource, action)`
- `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs` — add 4 procedures + switch existing ones to permissionProcedure
- `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/contact.ts.hbs` — switch existing procedures to permissionProcedure
- `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/session.ts.hbs` — switch existing procedures to permissionProcedure
- `apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs` — swap `authClient.admin.createUser` → `trpc.user.create.mutate`
- `apps/cli/templates/blueprints/org-dashboard/src/components/profile/account-form.tsx.hbs` — swap `authClient.updateUser` → `trpc.user.updateMe.mutate`
- `apps/cli/templates/blueprints/org-dashboard/src/components/profile/security-form.tsx.hbs` — swap `authClient.changePassword` → `trpc.user.changePassword.mutate`
- `apps/cli/templates/blueprints/org-dashboard/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs` — add Role select bound to `trpc.user.setRole`
- `apps/cli/templates/blueprints/org-dashboard/scripts/seed.ts.hbs` — bootstrap one `admin` user, document `viewer` as default for signup
- `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth-client.ts.hbs` — pass `ac` + `roles` to the admin client plugin too (so client-side role checks compile)

### Out of scope (deferred follow-ups)

- Audit log for `setRole` invocations
- Per-route Next.js middleware gating
- A `multitenant-saas` brother-blueprint alignment pass

---

## Pre-flight

- [ ] **Pre-step 1: Confirm PR1 is merged**

```bash
cd /home/ttecim/.lab/create-faster
git fetch origin
git log --oneline origin/feat/blueprint/improve-org | head -5
```

Expected: the top commit message references PR1 (e.g., "feat(blueprint/org-dashboard): packages/ui + shuip forms migration"). If PR1 is not yet merged, **stop** and wait — PR2 depends on the migrated form structures.

- [ ] **Pre-step 2: Verify Better Auth admin plugin options**

```bash
# Query context7 docs (or read better-auth installed source)
grep -rE "defaultRole|adminRoles" \
  /home/ttecim/.lab/create-faster/node_modules/better-auth/dist/ 2>/dev/null | head -20
```

Expected: both options exist on the admin plugin. If `adminRoles` is not surfaced in this version of Better Auth, fall back to checking `role === 'admin'` inside individual procedures (the change stays internal to `permissionProcedure`).

- [ ] **Pre-step 3: Verify `auth.api.userHasPermission` and `auth.api.setRole` are available server-side**

```bash
node -e "const { auth } = require('/tmp/tests-cf/orgiz/packages/auth/dist/auth.js'); console.log(Object.keys(auth.api).filter(k => /Permission|Role|User|Password/.test(k)));"
```

If the `auth` import fails (no build artifact), do the check from `/tmp/tests-cf/orgiz-wt1/` instead. Confirm at least `userHasPermission`, `setRole`, `createUser`, `updateUser`, `changePassword` exist on `auth.api`.

---

## Task 1: Create the WT-2 worktree

- [ ] **Step 1: Branch off the (now merged) `feat/blueprint/improve-org`**

```bash
cd /home/ttecim/.lab/create-faster
git worktree add /home/ttecim/.lab/create-faster/.worktrees/improve-org-api -b feat/blueprint/improve-org-api feat/blueprint/improve-org
```

Expected output: new worktree at `.worktrees/improve-org-api`, branch `feat/blueprint/improve-org-api` pointing at the merged PR1 tip.

- [ ] **Step 2: Verify and install deps**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-api
git log --oneline -1
bun install
```

Expected: HEAD at the merged PR1 commit; install completes.

All remaining tasks operate inside `/home/ttecim/.lab/create-faster/.worktrees/improve-org-api`.

---

## Task 2: Create `packages/auth/src/permissions.ts.hbs`

**Files:**
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs`

- [ ] **Step 1: Write the file**

Path: `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs`

```hbs
---
mono:
  scope: pkg
  name: auth
  path: src/permissions.ts
only: mono
---
{{{{raw}}}}
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  contact: ['read', 'write', 'delete'],
  session: ['list', 'revoke'],
} as const;

export const ac = createAccessControl(statement);

export const admin = ac.newRole({
  ...adminAc.statements,
  contact: ['read', 'write', 'delete'],
  session: ['list', 'revoke'],
});

export const manager = ac.newRole({
  contact: ['read', 'write'],
  session: ['list'],
});

export const viewer = ac.newRole({
  contact: ['read'],
});

export const roles = { admin, manager, viewer };
export type RoleName = keyof typeof roles;
{{{{/raw}}}}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs
git commit -m "feat(blueprint/org-dashboard): add static access control with admin/manager/viewer roles"
```

---

## Task 3: Wire `ac` + `roles` into `auth.ts.hbs`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth.ts.hbs`

- [ ] **Step 1: Read the current `auth.ts.hbs` to find the `adminPlugin()` invocation**

```bash
grep -nE "adminPlugin|plugins:" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth.ts.hbs
```

- [ ] **Step 2: Add the import block + replace the plugin call**

At the top of the imports (inside the `{{{{raw}}}}` block):

```ts
import { ac, roles } from './permissions';
```

Locate the `adminPlugin()` call and rewrite it:

```ts
plugins: [
  admin({
    ac,
    roles,
    defaultRole: 'viewer',
    adminRoles: ['admin'],
  }),
],
```

Adjust the call shape to match whatever the current file uses for the admin plugin import (the import might be `import { admin } from 'better-auth/plugins'` aliased to `admin` rather than `adminPlugin`). Preserve the alias.

- [ ] **Step 3: If `adminRoles`/`defaultRole` were not surfaced by the Pre-flight check, drop them and rely on `role === 'admin'` checks in `permissionProcedure`**

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth.ts.hbs
git commit -m "feat(blueprint/org-dashboard): wire ac + roles into adminPlugin"
```

---

## Task 4: Mirror `ac` + `roles` in `auth-client.ts.hbs`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth-client.ts.hbs`

Better Auth requires the client-side admin plugin to also receive `ac` + `roles` so that any client-side permission helper compiles. The hosting blueprint already imports `adminClient` somewhere — extend its call.

- [ ] **Step 1: Add import**

Inside `{{{{raw}}}}`, near the existing imports:

```ts
import { ac, roles } from './permissions';
```

- [ ] **Step 2: Pass `ac` + `roles` to `adminClient()`**

```ts
plugins: [
  adminClient({ ac, roles }),
],
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/auth/src/auth-client.ts.hbs
git commit -m "feat(blueprint/org-dashboard): wire ac + roles into auth-client"
```

---

## Task 5: Replace `adminProcedure`/`userProcedure` with `permissionProcedure`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/middleware/rbac.ts.hbs`

- [ ] **Step 1: Read the current middleware**

```bash
cat /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/packages/api/src/middleware/rbac.ts.hbs
```

Note the existing `protectedProcedure`/`adminProcedure`/`userProcedure` exports.

- [ ] **Step 2: Rewrite the file**

Path: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/middleware/rbac.ts.hbs`

```hbs
---
mono:
  scope: pkg
  name: api
  path: src/middleware/rbac.ts
only: mono
---
{{{{raw}}}}
import { TRPCError } from '@trpc/server';
import { auth } from '@repo/auth/auth';
import { protectedProcedure } from '../trpc';

type Resource = 'user' | 'contact' | 'session';

export const permissionProcedure = (resource: Resource, action: string) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const result = await auth.api.userHasPermission({
      body: {
        userId: ctx.session.user.id,
        permissions: { [resource]: [action] },
      },
    });
    if (!result.success) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing permission ${resource}.${action}`,
      });
    }
    return next();
  });
{{{{/raw}}}}
```

- [ ] **Step 3: Confirm callers of `adminProcedure`/`userProcedure` exist**

```bash
grep -rnE "(adminProcedure|userProcedure)" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/
```

These references will be rewritten in Tasks 7–9 below. For now, leave them — the router files still need their own update.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/middleware/rbac.ts.hbs
git commit -m "refactor(blueprint/org-dashboard): replace adminProcedure with permissionProcedure(resource, action)"
```

---

## Task 6: Add `user.create` tRPC procedure

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs`

- [ ] **Step 1: Read the current router**

```bash
cat /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
```

Identify the existing `me`, `list`, `getById`, `edit`, `generatePassword` procedures.

- [ ] **Step 2: Add the `create` procedure (above `list`)**

Inside the router definition, insert:

```ts
create: permissionProcedure('user', 'create')
  .input(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(['admin', 'manager', 'viewer']).default('viewer'),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const result = await auth.api.createUser({
      headers: ctx.headers,
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        role: input.role,
      },
    });
    return result.user;
  }),
```

- [ ] **Step 3: Add required imports to the top of the file (inside `{{{{raw}}}}`)**

```ts
import { permissionProcedure } from '../middleware/rbac';
import { auth } from '@repo/auth/auth';
import { z } from 'zod';
```

(Skip any import that's already present.)

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
git commit -m "feat(blueprint/org-dashboard): add user.create tRPC procedure wrapping auth.api.createUser"
```

---

## Task 7: Add `user.updateMe` tRPC procedure

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs`

- [ ] **Step 1: Insert `updateMe` after `me`**

```ts
updateMe: protectedProcedure
  .input(
    z.object({
      name: z.string().min(1).max(64),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const result = await auth.api.updateUser({
      headers: ctx.headers,
      body: { name: input.name },
    });
    return result;
  }),
```

Note: `updateMe` uses `protectedProcedure` directly — the user is updating their own data, no resource permission check needed.

- [ ] **Step 2: Confirm `protectedProcedure` is imported in this file (it should already be, via `../trpc`).**

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
git commit -m "feat(blueprint/org-dashboard): add user.updateMe tRPC procedure"
```

---

## Task 8: Add `user.changePassword` tRPC procedure

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs`

- [ ] **Step 1: Insert after `updateMe`**

```ts
changePassword: protectedProcedure
  .input(
    z.object({
      currentPassword: z.string().min(8),
      newPassword: z.string().min(8),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const result = await auth.api.changePassword({
      headers: ctx.headers,
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
    });
    return result;
  }),
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
git commit -m "feat(blueprint/org-dashboard): add user.changePassword tRPC procedure"
```

---

## Task 9: Add `user.setRole` tRPC procedure

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs`

- [ ] **Step 1: Insert after `changePassword`**

```ts
setRole: permissionProcedure('user', 'setRole')
  .input(
    z.object({
      userId: z.string(),
      role: z.enum(['admin', 'manager', 'viewer']),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const result = await auth.api.setRole({
      headers: ctx.headers,
      body: { userId: input.userId, role: input.role },
    });
    return result;
  }),
```

- [ ] **Step 2: Update the `statement` in `packages/auth/src/permissions.ts.hbs` to include `setRole`**

Edit the file from Task 2 so the `user` statement covers the new action:

```ts
export const statement = {
  ...defaultStatements,
  user: ['list', 'create', 'update', 'delete', 'ban', 'setRole'],
  contact: ['read', 'write', 'delete'],
  session: ['list', 'revoke'],
} as const;
```

(Use the spread of `defaultStatements` to inherit Better Auth's baseline; the additional `user.setRole` is the custom action we gate.)

- [ ] **Step 3: Commit (both files)**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/auth/src/permissions.ts.hbs \
        apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
git commit -m "feat(blueprint/org-dashboard): add user.setRole tRPC procedure + statement entry"
```

---

## Task 10: Convert existing user procedures to `permissionProcedure`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs`

- [ ] **Step 1: Replace per-procedure middleware**

In the file:

| Procedure | Was | Becomes |
|-----------|-----|---------|
| `me` | `protectedProcedure` | unchanged |
| `list` | `adminProcedure` | `permissionProcedure('user', 'list')` |
| `getById` | `adminProcedure` | `permissionProcedure('user', 'list')` |
| `edit` | `adminProcedure` | `permissionProcedure('user', 'update')` |
| `generatePassword` | `adminProcedure` | `permissionProcedure('user', 'update')` |

- [ ] **Step 2: Remove the now-unused `adminProcedure` / `userProcedure` imports**

```bash
grep -nE "adminProcedure|userProcedure" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
```

Expected after edits: no remaining references.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/user.ts.hbs
git commit -m "refactor(blueprint/org-dashboard): gate user.* procedures via permissionProcedure"
```

---

## Task 11: Convert `contact.*` procedures

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/contact.ts.hbs`

- [ ] **Step 1: Replace per-procedure middleware**

| Procedure | Becomes |
|-----------|---------|
| `list` | `permissionProcedure('contact', 'read')` |
| `count` | `permissionProcedure('contact', 'read')` |
| `create` | `permissionProcedure('contact', 'write')` |
| `update` | `permissionProcedure('contact', 'write')` |
| `delete` | `permissionProcedure('contact', 'delete')` |

- [ ] **Step 2: Replace the import**

```ts
import { permissionProcedure } from '../middleware/rbac';
```

Remove `adminProcedure`/`userProcedure` imports if present.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/contact.ts.hbs
git commit -m "refactor(blueprint/org-dashboard): gate contact.* procedures via permissionProcedure"
```

---

## Task 12: Convert `session.*` procedures

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/session.ts.hbs`

- [ ] **Step 1: Replace per-procedure middleware**

| Procedure | Becomes |
|-----------|---------|
| `list` (own sessions of current user) | `protectedProcedure` (no permission gate — user manages their own sessions) |
| `revoke` (own session) | `protectedProcedure` |
| `adminList` (admin-only view across users — if present) | `permissionProcedure('session', 'list')` |
| `adminRevoke` (admin revoke any session — if present) | `permissionProcedure('session', 'revoke')` |

If the file only has user-self procedures (`list`/`revoke`), Task 12 is essentially a no-op beyond confirming the imports.

- [ ] **Step 2: Update imports**

```ts
import { permissionProcedure } from '../middleware/rbac';
```

Drop `adminProcedure`/`userProcedure` if present.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/api/src/router/session.ts.hbs
git commit -m "refactor(blueprint/org-dashboard): gate session.* procedures via permissionProcedure"
```

---

## Task 13: Swap `authClient.admin.createUser` → `trpc.user.create.mutate` in create-user-dialog

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs`

- [ ] **Step 1: Replace the onSubmit body**

Open the file. Replace this block (introduced by PR1):

```ts
await new Promise<void>((resolve) => {
  startTransition(async () => {
    const result = await authClient.admin.createUser({
      name: value.name,
      email: value.email,
      password: value.password,
      role: value.role,
    });
    if (result.error) {
      toast.error(result.error.message ?? 'Create failed');
      resolve();
      return;
    }
    await queryClient.invalidateQueries(trpc.user.list.queryFilter());
    toast.success('User created');
    onOpenChange(false);
    resolve();
  });
});
```

With:

```ts
await create.mutateAsync({
  name: value.name,
  email: value.email,
  password: value.password,
  role: value.role,
});
```

- [ ] **Step 2: Add `useMutation` + `create` definition above the form declaration**

```ts
const create = useMutation(
  trpc.user.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.user.list.queryFilter());
      toast.success('User created');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error.message ?? 'Create failed');
    },
  }),
);
```

- [ ] **Step 3: Remove the now-unused `useTransition` + `authClient` imports**

```bash
grep -nE "useTransition|authClient" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs
```

Delete the imports + the `useTransition()` call. The submit button's `disabled` state becomes `create.isPending` and the label becomes `create.isPending ? 'Creating...' : 'Create'`.

- [ ] **Step 4: Add `useMutation` to the existing `@tanstack/react-query` import**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
```

- [ ] **Step 5: Extend the role enum to include `manager` and `viewer`**

The form's role select now needs three options. Update the field:

```tsx
<form.AppField
  name='role'
  children={(f) => (
    <f.SelectField
      label='Role'
      options={[
        { value: 'viewer', label: 'Viewer' },
        { value: 'manager', label: 'Manager' },
        { value: 'admin', label: 'Admin' },
      ]}
    />
  )}
/>
```

Also update the Zod schema:

```ts
role: z.enum(['admin', 'manager', 'viewer']),
```

And the default value: `role: 'viewer' as const`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): create user via tRPC, drop authClient.admin"
```

---

## Task 14: Swap `authClient.updateUser` → `trpc.user.updateMe.mutate` in account-form

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/profile/account-form.tsx.hbs`

- [ ] **Step 1: Replace the onSubmit body and remove useTransition**

Replace the existing `useTransition`-wrapped `authClient.updateUser` call with a tRPC mutation hook:

```hbs
---
mono:
  scope: app
  path: src/components/profile/account-form.tsx
---
{{{{raw}}}}
'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { z } from 'zod';
import { useTRPC } from '@/trpc/client';
import { useAppForm } from '@repo/ui/lib/form';

const schema = z.object({
  name: z.string().min(1, 'Display name required').max(64),
});

export function AccountForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const trpc = useTRPC();
  const update = useMutation(
    trpc.user.updateMe.mutationOptions({
      onSuccess: () => {
        toast.success('Profile updated');
        router.refresh();
      },
      onError: (error) => toast.error(error.message ?? 'Update failed'),
    }),
  );

  const form = useAppForm({
    defaultValues: { name: initialName },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await update.mutateAsync({ name: value.name });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className='flex max-w-md flex-col gap-3'
    >
      <form.AppField name='name' children={(f) => <f.InputField label='Display name' />} />
      <form.AppForm>
        <form.SubmitButton disabled={update.isPending}>
          {update.isPending ? 'Saving...' : 'Save'}
        </form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/profile/account-form.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): update profile via tRPC, drop authClient.updateUser"
```

---

## Task 15: Swap `authClient.changePassword` → `trpc.user.changePassword.mutate` in security-form

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/profile/security-form.tsx.hbs`

- [ ] **Step 1: Replace the onSubmit body and remove useTransition**

```hbs
---
mono:
  scope: app
  path: src/components/profile/security-form.tsx
---
{{{{raw}}}}
'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { useTRPC } from '@/trpc/client';
import { useAppForm } from '@repo/ui/lib/form';

const schema = z
  .object({
    currentPassword: z.string().min(8, 'Min. 8 characters'),
    newPassword: z.string().min(8, 'Min. 8 characters'),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current',
    path: ['newPassword'],
  });

export function SecurityForm() {
  const trpc = useTRPC();
  const change = useMutation(
    trpc.user.changePassword.mutationOptions({
      onSuccess: () => toast.success('Password updated — other sessions signed out'),
      onError: (error) => toast.error(error.message ?? 'Password change failed'),
    }),
  );

  const form = useAppForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    validators: { onChange: schema },
    onSubmit: async ({ value, formApi }) => {
      await change.mutateAsync({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
      });
      formApi.reset();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className='flex max-w-md flex-col gap-3'
    >
      <form.AppField name='currentPassword' children={(f) => <f.PasswordField label='Current password' />} />
      <form.AppField name='newPassword' children={(f) => <f.PasswordField label='New password' />} />
      <form.AppForm>
        <form.SubmitButton disabled={change.isPending}>
          {change.isPending ? 'Updating...' : 'Update password'}
        </form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/profile/security-form.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): change password via tRPC, drop authClient.changePassword"
```

---

## Task 16: Add Role select to user-detail page

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs`

- [ ] **Step 1: Read the current file**

```bash
cat /home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/templates/blueprints/org-dashboard/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs
```

There may be pre-existing modifications by Pelavo (see git status check in PR1 plan pre-flight). Preserve unrelated changes.

- [ ] **Step 2: Add a role section with a `useAppForm` driving `trpc.user.setRole`**

Insert (or replace the existing role display block) with:

```tsx
const trpc = useTRPC();
const queryClient = useQueryClient();
const setRole = useMutation(
  trpc.user.setRole.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries(trpc.user.getById.queryFilter({ id: user.id }));
      toast.success('Role updated');
    },
    onError: (error) => toast.error(error.message ?? 'Role change failed'),
  }),
);

const roleForm = useAppForm({
  defaultValues: { role: user.role as 'admin' | 'manager' | 'viewer' },
  onSubmit: async ({ value }) => {
    await setRole.mutateAsync({ userId: user.id, role: value.role });
  },
});
```

And in the JSX:

```tsx
<section className='flex flex-col gap-3'>
  <h3 className='text-sm font-medium'>Role</h3>
  <form
    onSubmit={(e) => {
      e.preventDefault();
      roleForm.handleSubmit();
    }}
    className='flex items-end gap-3'
  >
    <roleForm.AppField
      name='role'
      children={(f) => (
        <f.SelectField
          options={[
            { value: 'viewer', label: 'Viewer' },
            { value: 'manager', label: 'Manager' },
            { value: 'admin', label: 'Admin' },
          ]}
        />
      )}
    />
    <roleForm.AppForm>
      <roleForm.SubmitButton disabled={setRole.isPending}>
        {setRole.isPending ? 'Updating...' : 'Update role'}
      </roleForm.SubmitButton>
    </roleForm.AppForm>
  </form>
</section>
```

- [ ] **Step 3: Add missing imports at top of file**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTRPC } from '@/trpc/client';
import { useAppForm } from '@repo/ui/lib/form';
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs
git commit -m "feat(blueprint/org-dashboard): wire role selection on user-detail page"
```

---

## Task 17: Update `seed.ts.hbs`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/scripts/seed.ts.hbs`

- [ ] **Step 1: Ensure the seeded admin user receives `role: 'admin'`**

Open the file. The existing seed likely creates a user with `role: 'admin'` already — confirm. If the call site uses `auth.api.signUpEmail`, it won't set role; switch it to `auth.api.createUser` with `role: 'admin'`:

```ts
await auth.api.createUser({
  body: {
    name: 'Admin',
    email: 'admin@example.com',
    password: 'changeme1234',
    role: 'admin',
  },
});
```

If the file already does this — no change needed.

- [ ] **Step 2: (Optional) seed one `manager` and one `viewer` for demo purposes**

Add two more `auth.api.createUser` calls with the corresponding roles. Skip if the seed is meant to stay minimal.

- [ ] **Step 3: Commit (if any change)**

```bash
git add apps/cli/templates/blueprints/org-dashboard/scripts/seed.ts.hbs
git commit -m "chore(blueprint/org-dashboard): seed admin role explicitly"
```

---

## Task 18: Regen `/tmp/tests-cf/orgiz-wt2/` and verify

- [ ] **Step 1: Rebuild CLI**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-api
bun run build:cli
```

- [ ] **Step 2: Regen**

```bash
rm -rf /tmp/tests-cf/orgiz-wt2
cd /tmp/tests-cf
/home/ttecim/.lab/create-faster/.worktrees/improve-org-api/apps/cli/create-faster orgiz-wt2 --blueprint org-dashboard --pm bun --git
```

- [ ] **Step 3: Install + typecheck**

```bash
cd /tmp/tests-cf/orgiz-wt2
bun install
bun run check
```

Expected: no type errors. Type errors here usually come from `auth.api.*` mismatches between blueprint code and the installed Better Auth version — fix at the call site, not by `any`-casting.

- [ ] **Step 4: End-to-end browser test**

```bash
cd /tmp/tests-cf/orgiz-wt2
docker compose up -d
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env
cp packages/auth/.env.example packages/auth/.env
cp apps/batch/.env.example apps/batch/.env
bun run db:push
bun run db:seed
bun run dev --filter=web
```

Then:
- Sign in as admin
- Create a user with `role: viewer` — verify they land in DB with that role
- As viewer (new browser/incognito), confirm:
  - GET `/admin/users` → 403 / forbidden
  - GET `/admin/contacts` → list visible (read permission), but "Create contact" returns FORBIDDEN
- As admin, change a user's role to `manager` via user-detail page — confirm DB updated
- Update own profile, change own password — both go through tRPC (open devtools, check Network: `/api/trpc/user.updateMe` etc.)

- [ ] **Step 5: No commit (verification only).**

---

## Task 19: `react-doctor` pass

- [ ] **Step 1: Invoke the skill on the regenerated test project**

```bash
cd /tmp/tests-cf/orgiz-wt2/apps/web
```

Then in the chat: `/react-doctor`

Follow the skill's playbook end-to-end. Capture findings.

- [ ] **Step 2: Apply fixes back into the blueprint templates**

Any fix the doctor pass applies to the *generated* code at `/tmp/tests-cf/orgiz-wt2/apps/web/` must be ported back to the corresponding `.hbs` template under `apps/cli/templates/blueprints/org-dashboard/`. Do not commit the fix in the generated project alone — it would be wiped at the next regen.

For each fix:
1. Identify the `.hbs` template that produced the file.
2. Apply the equivalent edit to the template.
3. Re-regen + re-verify the fix is now present in `/tmp/tests-cf/orgiz-wt2/`.

- [ ] **Step 3: Commit doctor fixes**

```bash
git add apps/cli/templates/blueprints/org-dashboard/
git commit -m "fix(blueprint/org-dashboard): apply react-doctor findings"
```

---

## Task 20: Open PR2

- [ ] **Step 1: Push branch**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-api
git push -u origin feat/blueprint/improve-org-api
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --base feat/blueprint/improve-org \
  --head feat/blueprint/improve-org-api \
  --title "feat(blueprint/org-dashboard): tRPC auth migration + static RBAC" \
  --body "$(cat <<'EOF'
## Summary
- Routes data-mutating auth flows through tRPC mutations wrapping `auth.api.*` server-side:
  - `authClient.admin.createUser` → `trpc.user.create`
  - `authClient.updateUser` → `trpc.user.updateMe`
  - `authClient.changePassword` → `trpc.user.changePassword`
- Adds `trpc.user.setRole` and a Role select on the admin user-detail page.
- Introduces static RBAC via Better Auth admin plugin custom roles (`admin` / `manager` / `viewer`) and a `permissionProcedure(resource, action)` middleware that delegates to `auth.api.userHasPermission`.
- Existing `adminProcedure` / `userProcedure` are removed; `user.*`, `contact.*`, `session.*` procedures are gated by the new middleware.
- React-doctor pass applied with fixes ported back to templates.

## Out of scope
- Multitenant / organization plugin (explicitly non-goal — single-tenant blueprint)
- Runtime role creation UI (admin plugin only supports static roles; deferred)
- Audit log for `setRole` invocations

## Test plan
- [x] `/tmp/tests-cf/orgiz-wt2/` regenerates, installs, and type-checks cleanly
- [x] As viewer, contact creation returns FORBIDDEN; contact list still loads
- [x] As admin, user-detail page lets us change another user's role; DB reflects it
- [x] Profile update + password change go through tRPC (devtools Network tab)
- [x] `react-doctor` clean

Design spec: `docs/agents/superpowers/specs/2026-05-28-org-dashboard-blueprint-improve-design.md`
Plan: `docs/agents/superpowers/plans/2026-05-28-org-dashboard-improve-pr2.md`
EOF
)"
```

- [ ] **Step 3: Once merged, optionally delete both worktrees**

```bash
git worktree remove /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui
git worktree remove /home/ttecim/.lab/create-faster/.worktrees/improve-org-api
```

---

## Self-Review Checklist (run before handing off)

- [ ] Every spec section (4.1, 4.2, 4.3, 4.4, 5, 6, 7) maps to one or more tasks across PR1 + PR2
- [ ] No `useState(false)` left in any form after PR1 (verified by grep in Task 10)
- [ ] No `authClient.*` call sites remain outside `signIn` / `signOut` / `useSession` after PR2 (verify with grep at the end of Task 15)
- [ ] `adminProcedure` / `userProcedure` removed from the codebase after PR2 (Tasks 10–12)
- [ ] All shadcn primitives live under `packages/ui/` after PR1 (Task 6)
- [ ] `packages/ui/src/lib/form.ts` exports `useAppForm` and `withForm` (Task 3)
