# Org-Dashboard Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `org-dashboard` blueprint with real single-tenant RBAC, auto-generated passwords, shuip responsive dialogs, a login Card, and a fixed root `@repo/config` dependency.

**Architecture:** All work edits blueprint templates under `apps/cli/templates/blueprints/org-dashboard/` (`.hbs` files) and the `org-dashboard` entry in `apps/cli/src/__meta__.ts`. RBAC uses the Better Auth `admin` plugin's native access-control (`createAccessControl` / `ac.newRole` / `userHasPermission`) — global roles, no `organization` plugin. Verification is by generating the blueprint into a scratch dir and running install + typecheck + lint + smoke (there is no unit-test harness for generated template output).

**Tech Stack:** Bun, Handlebars templates, Better Auth (admin plugin + access control), tRPC, TanStack Query/Form, Drizzle + Postgres, shadcn/ui + shuip, vaul.

---

## Conventions (read once before starting)

**Vendored UI component `.hbs`** (under `packages/ui/...`) use this exact frontmatter + raw wrapper:

```
---
mono:
  scope: pkg
  name: ui
  path: src/components/ui/<file>.tsx
only: mono
---
{{{{raw}}}}
<verbatim TSX>
{{{{/raw}}}}
```

- `only: mono` because `packages/ui` exists only in turborepo mode (the blueprint is always mono, but keep the flag for consistency with existing vendored files like `sheet.tsx.hbs`).
- `{{{{raw}}}}` is mandatory whenever the TSX contains `{...}` JSX expressions or `` `${}` `` template literals, otherwise Handlebars tries to interpret them.
- Inside vendored components, rewrite import aliases from the CRM source: `@/lib/utils` → `@repo/ui/lib/utils`, `@/components/ui/...` → `@repo/ui/components/ui/...`.

**App-scoped `.hbs`** (under `src/...`) use `mono: { scope: app, path: <path> }` (see existing files).

**Reference sources** (known-working, local):
- shuip responsive dialog: `~/lab/kody/agence-nuisibles-crm/src/components/block/shuip/responsive-dialog.tsx`
- shuip side dialog: `~/lab/kody/agence-nuisibles-crm/src/components/ui/shuip/side-dialog.tsx`
- drawer: `~/lab/kody/agence-nuisibles-crm/src/components/ui/drawer.tsx`
- password reveal UI: `~/lab/kody/agence-nuisibles-crm/src/domains/technician/components/edit-dialog.tsx`
- create dialog (responsive): `~/lab/kody/agence-nuisibles-crm/src/domains/technician/components/create-dialog.tsx`

**Paths.** `BP` = `apps/cli/templates/blueprints/org-dashboard`. All paths below are relative to repo root unless prefixed with `BP/`.

**Verification harness.** The CLI has real tests — prefer them over ad-hoc typecheck:
- `bun test tests/unit/template-deps.test.ts` — fails if any template `import` lacks a declared dep in META (catches a missing `vaul`). This is the TDD hook for dependency tasks: add the import → test red → declare the dep → test green.
- `bun test tests/unit/blueprint-imports.test.ts` — fails if a blueprint template imports an unresolvable path.
- `bun test tests/integration/blueprint.test.ts tests/integration/blueprint-dx.test.ts` — generate-and-assert on blueprint output.
- Run from `apps/cli/`. Run the whole unit+integration set before the final commit: `bun test tests/unit tests/integration`.

**The "generate command"** referenced in steps below (run from repo root):

```bash
REPO=$(git rev-parse --show-toplevel)
rm -rf /tmp/cf-orgdash && cd /tmp && \
  NODE_ENV=development bun run "$REPO/apps/cli/src/index.ts" cf-orgdash \
  --blueprint org-dashboard --linter biome --pm bun
# generated project: /tmp/cf-orgdash  (--pm bun auto-runs install)
```

For a faster loop without install, drop `--pm bun` and run `bun install` manually only when you need to typecheck.

---

## Task 1: Add `@repo/config` to root devDependencies

**Files:**
- Modify: `apps/cli/src/__meta__.ts` (the `'org-dashboard'` → `rootPackageJson.devDependencies` block, around line 926)

- [ ] **Step 1: Add the dependency**

In `apps/cli/src/__meta__.ts`, find the `org-dashboard` `rootPackageJson.devDependencies` (currently only `'@faker-js/faker': '^10.4.0'`) and change it to:

```ts
        devDependencies: {
          '@repo/config': '*',
          '@faker-js/faker': '^10.4.0',
        },
```

- [ ] **Step 2: Generate and verify the root package.json**

Run the generate command (see Conventions), then:

```bash
grep -A6 '"devDependencies"' /tmp/cf-orgdash/package.json
```

Expected: `"@repo/config": "*"` is present in the generated root `package.json` `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/__meta__.ts
git commit -m "fix(blueprint): declare @repo/config in org-dashboard root devDependencies"
```

---

## Task 2: Vendor UI primitives (card, drawer, side-dialog, responsive-dialog)

**Files:**
- Create: `BP/packages/ui/src/components/ui/card.tsx.hbs`
- Create: `BP/packages/ui/src/components/ui/drawer.tsx.hbs`
- Create: `BP/packages/ui/src/components/ui/shuip/side-dialog.tsx.hbs`
- Create: `BP/packages/ui/src/components/block/shuip/responsive-dialog.tsx.hbs`
- Modify: `apps/cli/src/__meta__.ts` (`org-dashboard` → `pkgPackageJson.ui.dependencies`: add `vaul`)

- [ ] **Step 1: Create `card.tsx.hbs`** (standard shadcn card — NOT the CRM's `font-serif` variant)

`BP/packages/ui/src/components/ui/card.tsx.hbs`:

````
---
mono:
  scope: pkg
  name: ui
  path: src/components/ui/card.tsx
only: mono
---
{{{{raw}}}}
import type * as React from 'react';
import { cn } from '@repo/ui/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card'
      className={cn('bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-header'
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-title' className={cn('leading-none font-semibold', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-description' className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='card-action'
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-content' className={cn('px-6', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='card-footer' className={cn('flex items-center px-6 [.border-t]:pt-6', className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
{{{{/raw}}}}
````

- [ ] **Step 2: Create `drawer.tsx.hbs`**

Copy `~/lab/kody/agence-nuisibles-crm/src/components/ui/drawer.tsx` verbatim into the raw wrapper, rewriting `@/lib/utils` → `@repo/ui/lib/utils`. Keep `import { Drawer as DrawerPrimitive } from 'vaul';` as-is. Frontmatter `path: src/components/ui/drawer.tsx`.

- [ ] **Step 3: Create `side-dialog.tsx.hbs`**

Copy `~/lab/kody/agence-nuisibles-crm/src/components/ui/shuip/side-dialog.tsx` verbatim into the raw wrapper, rewriting `@/lib/utils` → `@repo/ui/lib/utils`. Frontmatter `path: src/components/ui/shuip/side-dialog.tsx`. (Self-contained: only deps are `react`, `react-dom`, `lucide-react`, `cn`.)

- [ ] **Step 4: Create `responsive-dialog.tsx.hbs`**

Copy `~/lab/kody/agence-nuisibles-crm/src/components/block/shuip/responsive-dialog.tsx` verbatim into the raw wrapper, with frontmatter `path: src/components/block/shuip/responsive-dialog.tsx` and these alias rewrites:
- `@/components/ui/drawer` → `@repo/ui/components/ui/drawer`
- `@/components/ui/shuip/side-dialog` → `@repo/ui/components/ui/shuip/side-dialog`
- `@/lib/utils` → `@repo/ui/lib/utils`

- [ ] **Step 5: Add `vaul` to the UI package deps**

In `apps/cli/src/__meta__.ts`, `org-dashboard` → `pkgPackageJson.ui.dependencies`, add `vaul`:

```ts
      pkgPackageJson: {
        ui: {
          dependencies: {
            '@tanstack/react-form': '^1.23.7',
            vaul: '^1.1.2',
          },
        },
      },
```

- [ ] **Step 6: Run the dependency test (TDD), then generate + typecheck**

```bash
cd apps/cli && bun test tests/unit/template-deps.test.ts tests/unit/blueprint-imports.test.ts
```

Expected: green. If you create `drawer.tsx.hbs` (imports `vaul`) BEFORE adding `vaul` to META, `template-deps` goes red first — that is the intended TDD signal; adding `vaul` (Step 5) turns it green.

Then run the generate command and typecheck the UI package:

```bash
cd /tmp/cf-orgdash && bunx tsc -p packages/ui --noEmit
```

Expected: `card.tsx`, `drawer.tsx`, `shuip/side-dialog.tsx`, `block/shuip/responsive-dialog.tsx` exist under `packages/ui/src/components/`, `vaul` resolves, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add BP/packages/ui apps/cli/src/__meta__.ts
git commit -m "feat(blueprint): vendor card + shuip responsive-dialog primitives"
```

---

## Task 3: Wrap the login form in a Card

**Files:**
- Modify: `BP/src/app/(auth)/login/page.tsx.hbs`

- [ ] **Step 1: Replace the page body**

`BP/src/app/(auth)/login/page.tsx.hbs`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/ui/card';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <Card className='w-full max-w-sm'>
      <CardHeader>
        <CardTitle className='text-2xl'>Sign in</CardTitle>
        <CardDescription>Enter your email and password to access your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
```

(The `(auth)/layout.tsx` already centers its child, so the Card sits centered.)

- [ ] **Step 2: Generate and smoke**

Generate; confirm `apps/web/src/app/(auth)/login/page.tsx` imports `Card` and wraps `LoginForm`. Typecheck `apps/web`.

- [ ] **Step 3: Commit**

```bash
git add "BP/src/app/(auth)/login/page.tsx.hbs"
git commit -m "feat(blueprint): wrap login form in a Card"
```

---

## Task 4: Migrate contact dialog to ResponsiveDialog

**Files:**
- Modify: `BP/src/components/contacts/contact-dialog.tsx.hbs`
- Modify: `BP/src/app/(dashboard)/contacts/contacts.client.tsx.hbs`

- [ ] **Step 1: Rewrite `contact-dialog.tsx.hbs`**

Frontmatter unchanged (`mono: scope: app, path: src/components/contacts/contact-dialog.tsx`). Body:

```tsx
{{{{raw}}}}
'use client';

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@repo/ui/components/block/shuip/responsive-dialog';
import { ContactForm } from '@/components/contacts/contact-form';

interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDialog({ open, onOpenChange }: ContactDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Contact</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Add a new contact to your directory.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {open && <ContactForm onDone={() => onOpenChange(false)} />}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
{{{{/raw}}}}
```

> Verify `ContactForm`'s prop is `onDone` (it is in the current `contact-dialog`). No trigger is rendered here — the dialog is controlled by `contacts.client.tsx` via `open`/`onOpenChange`, matching the existing pattern.

- [ ] **Step 2: Update the "New Contact" button in `contacts.client.tsx.hbs`**

Replace the raw `<button>` with the shadcn `Button` for consistency (gating added in Task 7). Keep the controlled-dialog wiring:

```tsx
{{{{raw}}}}
'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@repo/ui/components/ui/button';
import { ContactTable } from '@/components/contacts/contact-table';
import { ContactDialog } from '@/components/contacts/contact-dialog';

export function ContactsClient() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <h1 className='text-3xl font-bold'>Contacts</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className='size-4' />
          New Contact
        </Button>
      </div>
      <ContactTable />
      <ContactDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 3: Generate, typecheck, smoke**

Generate; typecheck `apps/web`. Manually open the app, open the Contacts "New Contact" dialog → renders as centered side-dialog on desktop, drawer on mobile, no native `<dialog>`.

- [ ] **Step 4: Commit**

```bash
git add "BP/src/components/contacts/contact-dialog.tsx.hbs" "BP/src/app/(dashboard)/contacts/contacts.client.tsx.hbs"
git commit -m "feat(blueprint): migrate contact dialog to shuip ResponsiveDialog"
```

---

## Task 5: RBAC core — permissions catalog + auth wiring

**Files:**
- Create: `BP/packages/auth/src/permissions.ts.hbs`
- Modify: `BP/src/lib/auth/auth.ts.hbs`
- Modify: `BP/src/lib/auth/auth-client.ts.hbs`

- [ ] **Step 1: Create `permissions.ts.hbs`**

`BP/packages/auth/src/permissions.ts.hbs`:

```
---
mono:
  scope: pkg
  name: auth
  path: src/permissions.ts
---
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  contact: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  admin: ac.newRole({
    ...adminAc.statements,
    contact: ['create', 'read', 'update', 'delete'],
  }),
  user: ac.newRole({
    contact: ['create', 'read', 'update', 'delete'],
  }),
  manager: ac.newRole({
    contact: ['read'],
  }),
};

export type AppRole = keyof typeof roles;
```

> Verify the import path `better-auth/plugins/admin/access` exposes `adminAc` and `defaultStatements` against the installed `better-auth` version via context7 at implementation time; adjust if the package renamed them.

- [ ] **Step 2: Wire the server `admin` plugin in `auth.ts.hbs`**

In `BP/src/lib/auth/auth.ts.hbs`, add the import near the other plugin imports:

```
import { admin } from 'better-auth/plugins';
import { ac, roles } from './permissions';
```

and change the `plugins` array entry `admin(),` to:

```
    admin({
      ac,
      roles,
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
```

- [ ] **Step 3: Wire the client `adminClient` in `auth-client.ts.hbs`**

`BP/src/lib/auth/auth-client.ts.hbs` body becomes:

```
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { auth } from './auth';
import { ac, roles } from './permissions';

export const authClient = createAuthClient({
  plugins: [
    adminClient({ ac, roles }),
    inferAdditionalFields<typeof auth>(),
  ],
});
```

- [ ] **Step 4: Generate and typecheck**

Generate; confirm `packages/auth/src/permissions.ts` exists and `packages/auth` typechecks (`bunx tsc -p packages/auth --noEmit`). The `role` field on `user` stays a free-form string in the DB schema — no migration needed.

- [ ] **Step 5: Commit**

```bash
git add "BP/packages/auth/src/permissions.ts.hbs" "BP/src/lib/auth/auth.ts.hbs" "BP/src/lib/auth/auth-client.ts.hbs"
git commit -m "feat(blueprint): add access-control catalog and 3 roles to org-dashboard auth"
```

---

## Task 6: Server enforcement — permissionProcedure + routers

**Files:**
- Modify: `BP/src/trpc/middleware/rbac.ts.hbs`
- Modify: `BP/src/trpc/routers/contact.ts.hbs`
- Modify: `BP/src/trpc/routers/user.ts.hbs`

- [ ] **Step 1: Add `permissionProcedure` to `rbac.ts.hbs`**

Replace the body (keep frontmatter) with:

```ts
import { TRPCError } from '@trpc/server';
import { auth } from '@repo/auth/auth';
import { protectedProcedure } from '../trpc';

export const adminProcedure = protectedProcedure.use(async (opts) => {
  if (opts.ctx.session.user.role !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can access this resource',
    });
  }

  return opts.next({ ctx: opts.ctx });
});

export const permissionProcedure = (resource: string, action: string) =>
  protectedProcedure.use(async (opts) => {
    const result = await auth.api.userHasPermission({
      body: {
        userId: opts.ctx.session.user.id,
        permissions: { [resource]: [action] },
      },
    });
    if (!result.success) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission' });
    }
    return opts.next({ ctx: opts.ctx });
  });

export const userProcedure = protectedProcedure;
```

> Verify `auth.api.userHasPermission` returns `{ success: boolean }` for the installed better-auth version (context7). The `@repo/auth` dependency is already available to `packages/api` (the existing `user.ts` router imports `auth` from `@repo/auth/auth`).

- [ ] **Step 2: Gate the contact router by permission**

In `BP/src/trpc/routers/contact.ts.hbs`, change the import to:

```ts
import { permissionProcedure } from '../middleware/rbac';
```

and replace each procedure base:
- `list`, `getById`, `count` → `permissionProcedure('contact', 'read')`
- `create` → `permissionProcedure('contact', 'create')`
- `update` → `permissionProcedure('contact', 'update')`
- `delete` → `permissionProcedure('contact', 'delete')`

(Remove the now-unused `userProcedure` import from this file.)

- [ ] **Step 3: Add `user.create` to `user.ts.hbs`**

In `BP/src/trpc/routers/user.ts.hbs`, add a `create` mutation that generates the password server-side. Insert after the `me` query, before `list`:

```ts
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['admin', 'user', 'manager']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const password = generatePassword();
      const { user } = await auth.api.createUser({
        headers: ctx.headers,
        body: { name: input.name, email: input.email, password, role: input.role },
      });
      return { user, password };
    }),
```

(`generatePassword` and `auth` are already imported in this file. `adminProcedure` too.)

> The `role` enum here must match the `roles` keys in `permissions.ts` (`admin` | `user` | `manager`). If you add a role, update both.

- [ ] **Step 4: Generate and typecheck**

Generate; `bunx tsc -p packages/api --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add "BP/src/trpc/middleware/rbac.ts.hbs" "BP/src/trpc/routers/contact.ts.hbs" "BP/src/trpc/routers/user.ts.hbs"
git commit -m "feat(blueprint): permission-based tRPC procedures + server-side user.create"
```

---

## Task 7: Client permission gate — usePermission + Can

**Files:**
- Create: `BP/src/hooks/use-permission.ts.hbs`
- Create: `BP/src/components/can.tsx.hbs`
- Modify: `BP/src/app/(dashboard)/contacts/contacts.client.tsx.hbs` (gate "New Contact")
- Modify: `BP/src/components/contacts/contact-table.tsx.hbs` (gate row edit/delete)

- [ ] **Step 1: Create `use-permission.ts.hbs`**

`BP/src/hooks/use-permission.ts.hbs` (frontmatter `mono: scope: app, path: src/hooks/use-permission.ts`):

```tsx
{{{{raw}}}}
'use client';

import { authClient } from '@repo/auth/auth-client';

export function usePermission(permissions: Record<string, string[]>): boolean {
  const { data: session } = authClient.useSession();
  const role = session?.user?.role;
  if (!role) return false;
  return authClient.admin.checkRolePermission({
    role: role as 'admin' | 'user' | 'manager',
    permissions: permissions as never,
  });
}
{{{{/raw}}}}
```

> `checkRolePermission` is a synchronous client-side check against the `roles`/`ac` passed to `adminClient` (no network). Verify the method name and signature for the installed better-auth version via context7; if it requires a single `permission` object rather than `permissions`, adjust here and in `Can`.

- [ ] **Step 2: Create `can.tsx.hbs`**

`BP/src/components/can.tsx.hbs` (frontmatter `mono: scope: app, path: src/components/can.tsx`):

```tsx
{{{{raw}}}}
'use client';

import type { ReactNode } from 'react';
import { usePermission } from '@/hooks/use-permission';

export function Can({
  permissions,
  children,
  fallback = null,
}: {
  permissions: Record<string, string[]>;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permissions) ? <>{children}</> : <>{fallback}</>;
}
{{{{/raw}}}}
```

- [ ] **Step 3: Gate "New Contact" in `contacts.client.tsx.hbs`**

Wrap the `Button` from Task 4 Step 2 in `Can`:

```tsx
        <Can permissions={{ contact: ['create'] }}>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className='size-4' />
            New Contact
          </Button>
        </Can>
```

and add `import { Can } from '@/components/can';` to the import block.

- [ ] **Step 4: Gate row actions in `contact-table.tsx.hbs`**

Read `BP/src/components/contacts/contact-table.tsx.hbs` first. Wrap any edit/delete affordance in the row/actions column with `<Can permissions={{ contact: ['update'] }}>` / `<Can permissions={{ contact: ['delete'] }}>` respectively, importing `Can`. (If the table has no inline write actions, skip and note it in the commit.)

- [ ] **Step 5: Generate, typecheck, smoke**

Generate; typecheck `apps/web`. Smoke: as `manager`, the "New Contact" button is absent and the row edit/delete are hidden; as `user`/`admin` they are present.

- [ ] **Step 6: Commit**

```bash
git add "BP/src/hooks/use-permission.ts.hbs" "BP/src/components/can.tsx.hbs" "BP/src/app/(dashboard)/contacts/contacts.client.tsx.hbs" "BP/src/components/contacts/contact-table.tsx.hbs"
git commit -m "feat(blueprint): client permission gate (usePermission + Can) on contacts"
```

---

## Task 8: Permission-filtered navigation

**Files:**
- Modify: `BP/src/lib/constants.ts.hbs`
- Modify: `BP/src/components/navigation/sidebar-links.tsx.hbs`
- Verify: `BP/src/app/(dashboard)/layout.tsx.hbs` and `app-sidebar.tsx.hbs` (how `role` is passed)

- [ ] **Step 1: Add permission metadata to routes in `constants.ts.hbs`**

Replace the `ADMIN_ROUTES`/`USER_ROUTES` split with a single `ROUTES` list carrying required permissions:

```ts
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Users, Shield } from 'lucide-react';

export interface RouteProps {
  url: string;
  title: string;
  icon?: LucideIcon;
  category?: string;
  permissions?: Record<string, string[]>;
}

export const ROUTES: RouteProps[] = [
  { url: '/', title: 'Dashboard', icon: LayoutDashboard },
  { url: '/contacts', title: 'Contacts', icon: Users, permissions: { contact: ['read'] } },
  { url: '/admin/users', title: 'Users', icon: Shield, category: 'Administration', permissions: { user: ['list'] } },
];
```

> Verify `user: ['list']` is a valid action in `defaultStatements` for the admin plugin (it is the standard admin user action); otherwise gate the Users link on `role === 'admin'` directly.

- [ ] **Step 2: Filter routes by permission in `sidebar-links.tsx.hbs`**

Rewrite to consume `ROUTES` and filter with `usePermission`. Body:

```tsx
{{{{raw}}}}
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@repo/ui/components/ui/sidebar';
import { usePermission } from '@/hooks/use-permission';
import { ROUTES, type RouteProps } from '@/lib/constants';

function RouteItem({ item, pathname }: { item: RouteProps; pathname: string }) {
  const allowed = usePermission(item.permissions ?? {});
  if (!allowed) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        tooltip={item.title || item.url}
        isActive={item.url === '/' ? pathname === '/' : pathname.startsWith(item.url)}
      >
        <Link href={item.url}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarLinks() {
  const pathname = usePathname();
  const groupless = ROUTES.filter((i) => !i.category);
  const grouped = ROUTES.reduce<Record<string, RouteProps[]>>((acc, item) => {
    if (!item.category) return acc;
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          {groupless.map((item) => (
            <RouteItem key={item.url} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroup>
      {Object.entries(grouped).map(([category, items]) => (
        <SidebarGroup key={category}>
          <SidebarGroupLabel>{category}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <RouteItem key={item.url} item={item} pathname={pathname} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
{{{{/raw}}}}
```

> `usePermission({})` returns `true` (empty permission set = always allowed) so the Dashboard link always shows. `SidebarLinks` no longer takes a `role` prop.

- [ ] **Step 3: Update the caller**

Read `BP/src/components/navigation/app-sidebar.tsx.hbs` (and `layout.tsx.hbs`). Remove the `role={...}` prop passed to `<SidebarLinks />`. If `role` was fetched server-side solely for this, drop the now-unused plumbing (but keep the layout's auth redirect).

- [ ] **Step 4: Generate, typecheck, smoke**

Generate; typecheck `apps/web`. Smoke: `admin` sees Dashboard + Contacts + Users; `user` sees Dashboard + Contacts; `manager` sees Dashboard + Contacts.

- [ ] **Step 5: Commit**

```bash
git add "BP/src/lib/constants.ts.hbs" "BP/src/components/navigation/sidebar-links.tsx.hbs" "BP/src/components/navigation/app-sidebar.tsx.hbs" "BP/src/app/(dashboard)/layout.tsx.hbs"
git commit -m "feat(blueprint): permission-filtered sidebar navigation"
```

---

## Task 9: Create-user dialog — ResponsiveDialog, no password, tRPC create, 3 roles

**Files:**
- Modify: `BP/src/components/admin/create-user-dialog.tsx.hbs`
- Verify: `BP/src/app/(dashboard)/admin/users/users.client.tsx.hbs` (how the dialog is triggered)

- [ ] **Step 1: Rewrite `create-user-dialog.tsx.hbs`**

Frontmatter unchanged. Body — no password field, calls `trpc.user.create`, role select offers 3 roles, uses ResponsiveDialog:

```tsx
{{{{raw}}}}
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@repo/ui/components/block/shuip/responsive-dialog';
import { useAppForm } from '@repo/ui/lib/form';
import { useTRPC } from '@/trpc/providers';

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'user', 'manager']),
});

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createUser = useMutation(
    trpc.user.create.mutationOptions({
      onSuccess: async ({ password }) => {
        await queryClient.invalidateQueries(trpc.user.list.queryFilter());
        toast.success('User created', {
          description: `Temporary password: ${password} — copy it now, it won't be shown again.`,
          duration: 30000,
        });
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message ?? 'Create failed'),
    }),
  );

  const form = useAppForm({
    defaultValues: { name: '', email: '', role: 'user' as 'admin' | 'user' | 'manager' },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await createUser.mutateAsync(value);
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create user</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>A temporary password is generated automatically.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form
            id='create-user-form'
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className='flex flex-col gap-3'
          >
            <form.AppField name='name'>{(f) => <f.InputField label='Name' />}</form.AppField>
            <form.AppField name='email'>{(f) => <f.InputField label='Email' props={{ type: 'email' }} />}</form.AppField>
            <form.AppField name='role'>
              {(f) => <f.SelectField label='Role' options={{ Admin: 'admin', User: 'user', Manager: 'manager' }} />}
            </form.AppField>
          </form>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <form.AppForm>
            <form.SubmitButton props={{ form: 'create-user-form', className: 'w-full', disabled: createUser.isPending }}>
              {createUser.isPending ? 'Creating...' : 'Create'}
            </form.SubmitButton>
          </form.AppForm>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
{{{{/raw}}}}
```

> Verify `useAppForm`'s `SubmitButton` forwards the `form` prop to the underlying `<button>` (so the footer-placed submit submits the body form). If it does not, move `<form.SubmitButton>` inside the `<form>` and drop the `form` id wiring. Check `BP/packages/ui/src/lib/form.ts.hbs` + `submit-button.tsx.hbs`.

- [ ] **Step 2: Generate, typecheck, smoke**

Generate; typecheck `apps/web`. Smoke: open Create user → only Name/Email/Role fields, no password input; submit → toast shows the generated temporary password.

- [ ] **Step 3: Commit**

```bash
git add "BP/src/components/admin/create-user-dialog.tsx.hbs"
git commit -m "feat(blueprint): create-user dialog with auto password + ResponsiveDialog + 3 roles"
```

---

## Task 10: Reveal/reset password UI + 3-role admin actions

**Files:**
- Modify: `BP/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs`
- Modify: `BP/src/components/admin/user-actions.tsx.hbs`

- [ ] **Step 1: Read both files**

Read `user-detail.tsx.hbs` and `user-actions.tsx.hbs` to see current structure.

- [ ] **Step 2: Add a "Generate password" section to `user-detail.tsx.hbs`**

Mirror the CRM `edit-dialog.tsx` reveal block. Add a client section that calls `trpc.user.generatePassword` (already exists, returns `{ password }`) and shows the result once in an `InputGroup` with copy + regenerate:

```tsx
{{{{raw}}}}
{/* inside the user detail client component */}
const generatePassword = useMutation(
  trpc.user.generatePassword.mutationOptions({
    onSuccess: () => toast.success('Password generated'),
    onError: (error) => toast.error(error.message),
  }),
);
const plaintext = generatePassword.data?.password;

// ...JSX...
<div className='space-y-2'>
  <h3 className='text-base font-semibold'>Password</h3>
  {!plaintext && (
    <p className='text-sm text-muted-foreground'>
      Generating a new password replaces the old one. <b>It is shown only once — copy it.</b>
    </p>
  )}
  {!plaintext ? (
    <Button
      variant='outline'
      size='sm'
      disabled={generatePassword.isPending}
      onClick={() => generatePassword.mutate({ id: user.id })}
    >
      {generatePassword.isPending ? 'Generating...' : 'Generate new password'}
    </Button>
  ) : (
    <InputGroup>
      <InputGroupInput readOnly value={plaintext} />
      <InputGroupAddon align='inline-end'>
        <InputGroupButton
          aria-label='Copy password'
          size='icon-sm'
          onClick={() => {
            navigator.clipboard.writeText(plaintext);
            toast.success('Password copied');
          }}
        >
          <Copy className='size-4' />
        </InputGroupButton>
        <InputGroupButton aria-label='Regenerate' size='icon-sm' onClick={() => generatePassword.mutate({ id: user.id })}>
          <RotateCcw className='size-4' />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )}
</div>
{{{{/raw}}}}
```

Add imports: `Copy, RotateCcw` from `lucide-react`; `Button` from `@repo/ui/components/ui/button`; `InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput` from `@repo/ui/components/ui/input-group`; `useMutation` from `@tanstack/react-query`; `toast` from `sonner`; `useTRPC` from `@/trpc/providers`. Ensure the component is `'use client'` (if `user-detail.tsx` is a server component, extract the password block into a small client child `password-reset.tsx`).

- [ ] **Step 3: Offer all 3 roles in `user-actions.tsx.hbs`**

The current dropdown only toggles admin↔user (and already mislabels "Demote to Manager"). Replace the role section with explicit set-role items for the 3 roles, hiding the current one. `authClient.admin.setRole` accepts the role string. Update the local `User` type / `handleSetRole` signature to `'admin' | 'user' | 'manager'`:

```tsx
{{{{raw}}}}
{(['admin', 'user', 'manager'] as const)
  .filter((r) => r !== user.role)
  .map((r) => (
    <DropdownMenuItem key={r} onClick={() => handleSetRole(r)}>
      Set role: {r}
    </DropdownMenuItem>
  ))}
{{{{/raw}}}}
```

with `const handleSetRole = async (role: 'admin' | 'user' | 'manager') => { ... authClient.admin.setRole({ userId: user.id, role }) ... }`.

> `authClient.admin.setRole`'s `role` type is inferred from the `roles` passed to `adminClient` (Task 5) — confirm it accepts `'manager'` after that change; if the types are strict, cast at the call site with a comment.

- [ ] **Step 4: Generate, typecheck, smoke**

Generate; typecheck `apps/web`. Smoke: user detail → "Generate new password" reveals once with copy/regenerate; user actions dropdown offers the two non-current roles.

- [ ] **Step 5: Commit**

```bash
git add "BP/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs" "BP/src/components/admin/user-actions.tsx.hbs"
git commit -m "feat(blueprint): reveal-once password reset + 3-role admin actions"
```

---

## Task 11: Seed a manager user

**Files:**
- Modify: `BP/scripts/seed.ts.hbs`

- [ ] **Step 1: Add the manager to `seedCore`**

Widen `findOrCreateUser`'s `role` type to `'admin' | 'user' | 'manager'`, add a manager to `CoreRefs` + `seedCore`, and print it:

```ts
interface CoreRefs {
  adminId: string;
  userId: string;
  managerId: string;
}

async function seedCore(): Promise<CoreRefs> {
  const adminId = await findOrCreateUser({ email: 'admin@example.com', name: 'Admin', role: 'admin' });
  const userId = await findOrCreateUser({ email: 'user@example.com', name: 'User', role: 'user' });
  const managerId = await findOrCreateUser({ email: 'manager@example.com', name: 'Manager', role: 'manager' });
  return { adminId, userId, managerId };
}
```

And in `main`'s final log block add:

```ts
  console.log(`  Manager: manager@example.com / ${DEMO_PASSWORD}`);
```

(Update the `findOrCreateUser` signature `role: 'admin' | 'user'` → `role: 'admin' | 'user' | 'manager'`.)

- [ ] **Step 2: Generate, run seed**

Generate; from the generated project run `bun run local-setup` then `bun run db:seed --fixtures` (or the documented flow). Expected: three core users created, no errors.

- [ ] **Step 3: Commit**

```bash
git add "BP/scripts/seed.ts.hbs"
git commit -m "feat(blueprint): seed a manager (read-only) demo user"
```

---

## Task 12: Docs

**Files:**
- Modify: `BP/docs/agents/auth.md.hbs`
- Verify/Modify: `apps/cli/src/__meta__.ts` (`org-dashboard.hint` + `agentArchitecture`)
- Verify: `apps/www/content/docs/blueprints/` (org-dashboard page, if present)

- [ ] **Step 1: Rewrite `auth.md.hbs` RBAC section**

Document: the catalog in `packages/auth/src/permissions.ts` (`statement`, `ac`, `roles`), the three roles and their permissions, `permissionProcedure(resource, action)` for server gating, `usePermission` + `<Can>` for client gating, permission-filtered nav, and the recipe: "To add a role, add a key to `roles` in `permissions.ts` and (optionally) a route's `permissions` in `constants.ts`." Replace the "Two roles (admin/user)" paragraph.

- [ ] **Step 2: Update the blueprint hint/architecture**

In `apps/cli/src/__meta__.ts`, update `org-dashboard.hint` to mention multi-role RBAC, and adjust `agentArchitecture` to say "Better Auth admin plugin with access-control roles (admin/user/manager)".

- [ ] **Step 3: Update the docs site page if it exists**

If `apps/www/content/docs/blueprints/*org-dashboard*` exists, reflect the RBAC/password/dialog changes (use the `documenting-blueprint` skill conventions).

- [ ] **Step 4: Commit**

```bash
git add "BP/docs/agents/auth.md.hbs" apps/cli/src/__meta__.ts apps/www/content/docs/blueprints
git commit -m "docs(blueprint): document org-dashboard RBAC and password flow"
```

---

## Task 13: Full end-to-end verification

- [ ] **Step 1: Run the full CLI test suite**

```bash
cd apps/cli && bun test tests/unit tests/integration
```

Expected: green (this covers `template-deps`, `blueprint-imports`, `blueprint`, `blueprint-dx`, `meta`).

- [ ] **Step 2: Clean generate + typecheck + lint the whole workspace**

Run the generate command (see Conventions) for a fresh `/tmp/cf-orgdash`, then:

```bash
cd /tmp/cf-orgdash && bun run check && bunx turbo typecheck 2>/dev/null || bunx tsc --noEmit -p apps/web && bunx tsc --noEmit -p packages/auth && bunx tsc --noEmit -p packages/api && bunx tsc --noEmit -p packages/ui
```

Expected: clean (resolve any error before proceeding — do not suppress).

- [ ] **Step 3: DB + seed**

Bring up the DB (`docker-compose up -d` if present), `bun run local-setup`, confirm three users (`admin`/`user`/`manager`) exist.

- [ ] **Step 4: Manual smoke matrix**

Run `bun run dev`, then for each seeded user verify:

| As | Nav | Contacts | Create user |
|---|---|---|---|
| admin | Dashboard, Contacts, Users | full CRUD | dialog, no password field, temp password in toast |
| user | Dashboard, Contacts | full CRUD | (no Users page) |
| manager | Dashboard, Contacts | read-only: no New/Edit/Delete | (no Users page) |

Also: both dialogs render as side-dialog (desktop) / drawer (mobile), never native `<dialog>`; login shows a Card; user detail reveals a generated password once with copy.

- [ ] **Step 5: Final review + branch finish**

Run the `superpowers:requesting-code-review` skill on the diff, address findings, then use `superpowers:finishing-a-development-branch` to open the PR.

---

## Self-review notes (coverage map)

- Spec §2 RBAC → Tasks 5, 6, 7, 8, 11 (+ docs Task 12)
- Spec §3 Password → Tasks 6 (create), 10 (reveal/reset), 9 (no password field)
- Spec §4 Dialogs → Tasks 2 (vendor), 4 (contact), 9 (create-user)
- Spec §5 Login Card → Tasks 2 (card), 3 (wrap)
- Spec §6 `@repo/config` → Task 1
- Spec §7 file list → covered across Tasks 1–12
- Spec §9 anti-scope (no org plugin, no dynamic role editor, no email) → honored; roles are code-defined in `permissions.ts`.
