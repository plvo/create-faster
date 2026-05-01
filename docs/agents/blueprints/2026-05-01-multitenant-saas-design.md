# Blueprint: `multitenant-saas` — Design

**Date:** 2026-05-01
**Status:** Design validated, awaiting implementation plan
**Inspiration source:** Betterboond CRM (`~/lab/kody/betterboond/`)

## 1. Overview & motivation

### What this blueprint produces

A B2B SaaS dashboard scaffold where:

- A user belongs to N organizations (tenants) and switches between them
- Each organization has its own custom roles and permissions (RBAC)
- The org owner is auto-assigned at creation and has full bypass access
- New members are added via shareable invitation links (no email sending)
- Data is strictly scoped to the active organization via tRPC middleware
- One example entity (`project`) demonstrates the CRUD + scoping pattern

### Why a new blueprint (vs extending `org-dashboard`)

`org-dashboard` is mono-tenant: 2 hardcoded roles (`admin` | `user`) on `session.user.role`, no tenant isolation, no membership table. It serves single-tenant SaaS well and stays simple.

`multitenant-saas` is fundamentally different: N:N user↔org relationship, custom roles per org, dynamic permissions catalog editable in UI, data scoped per tenant. Merging both into one blueprint would produce a confusing tool with conditional code paths.

→ **Decision:** keep both. `org-dashboard` for B2C/single-tenant. `multitenant-saas` for B2B/multi-tenant.

### Scope decisions (locked)

- **Option A** (strict multi-tenant) selected over B (with billing) and C (full kit)
- **No email sending** — invitations work via shareable links the admin copies and shares manually
- **No `legalEntity`/sub-tenants** (Betterboond-specific, too niche for a blueprint)
- **No domain-specific entities** (companies, candidates, needs from Betterboond) — replaced with one generic `project` entity

---

## 2. Architecture: multi-tenancy & auth

### Foundation: `better-auth` `organization` plugin

We use the official `better-auth` `organization` plugin rather than a custom schema (à la Betterboond). The plugin natively provides:

- Schema: `organization`, `member`, `invitation`, `organizationRole` tables (auto-migrated)
- API routes: create/list/setActive org, invite/accept/cancel, updateMemberRole, createRole
- Client hooks: `useListOrganizations()`, `useActiveOrganization()`, `hasPermission()`, `checkRolePermission()`
- Session augmentation: `session.activeOrganizationId`
- Owner role with full bypass (built-in)

This eliminates ~300 lines of custom schema/API code we'd otherwise re-implement from Betterboond.

### Tenant resolution

Via the better-auth session, not a custom cookie:

```ts
session.activeOrganizationId
```

Switching: `authClient.organization.setActive({ organizationId })` then `router.refresh()`.

### tRPC middleware

```ts
const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const orgId = ctx.session.activeOrganizationId;
  if (!orgId) throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' });
  return next({ ctx: { ...ctx, orgId } });
});

const permissionProcedure = (resource: string, action: string) =>
  orgProcedure.use(async ({ ctx, next }) => {
    const allowed = await auth.api.hasPermission({
      headers: ctx.headers,
      body: { permissions: { [resource]: [action] } },
    });
    if (!allowed) throw new TRPCError({ code: 'FORBIDDEN' });
    return next();
  });
```

All data routes inherit from `permissionProcedure(resource, action)` — making it impossible to forget the tenant filter.

### `assertInScope` helper

For per-row checks (project detail, update, delete):

```ts
async function assertInScope<T extends { organizationId: string }>(
  row: T | undefined,
  ctx: { orgId: string }
): Promise<asserts row is T> {
  if (!row || row.organizationId !== ctx.orgId) {
    throw new TRPCError({ code: 'NOT_FOUND' }); // 404, not 403, to avoid leaking existence
  }
}
```

### Onboarding flow

The plugin doesn't auto-create a first org. Custom middleware:

- `middleware.ts`: if `session.user` exists and `useListOrganizations()` returns `[]` → redirect `/onboarding`
- `/onboarding` page: form `{ name, slug }` → `authClient.organization.create()` → redirect dashboard

### Org switcher

shadcn dropdown in sidebar header (Vercel-style): lists user's orgs with current marked, "+ Create organization" at bottom. Switch triggers `setActive()` + `router.refresh()`.

### Monorepo architecture

Same pattern as `org-dashboard`:

```
packages/
  auth/  → better-auth config + organization plugin + access control instance
  db/    → drizzle schema (auth schema + project entity)
  ui/    → shared shadcn components
apps/
  web/   → Next.js dashboard
  batch/ → Node.js scripts (seed, future cron jobs like invitation cleanup)
```

The `batch` app is included to:

1. Force monorepo mode (`apps/` + `packages/` structure)
2. Provide a runtime for future cron jobs (cleanup expired invitations, billing reconciliation, etc.)
3. Match `org-dashboard` pattern for consistency

---

## 3. RBAC custom

### Permissions catalog (static, in code)

```ts
// packages/auth/src/permissions.ts
import { createAccessControl } from 'better-auth/plugins/access';

export const statement = {
  organization: ['update', 'delete'],
  member:       ['invite', 'update', 'remove'],
  invitation:   ['create', 'cancel'],
  role:         ['create', 'read', 'update', 'delete'],
  project:      ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);
```

5 resources, ~17 actions. Sufficient to demonstrate the pattern; users extend by editing this single file.

### Default roles (seeded per org)

| Role | Permissions | Properties |
|---|---|---|
| `owner` | All (native bypass) | Auto-assigned to creator. Cannot be deleted. Cannot be reassigned to another member except via "transfer ownership" flow. |
| `admin` | All except `organization.delete` and elevated `member.update` (cannot demote owner) | Day-to-day org management |
| `member` | `project: ['read']`, `member: ['read']` (implicit) | Read-only baseline |

```ts
export const owner = ac.newRole({
  organization: ['update', 'delete'],
  member:       ['invite', 'update', 'remove'],
  invitation:   ['create', 'cancel'],
  role:         ['create', 'read', 'update', 'delete'],
  project:      ['create', 'read', 'update', 'delete'],
});

export const admin = ac.newRole({
  organization: ['update'],
  member:       ['invite', 'update', 'remove'],
  invitation:   ['create', 'cancel'],
  role:         ['create', 'read', 'update', 'delete'],
  project:      ['create', 'read', 'update', 'delete'],
});

export const member = ac.newRole({
  project: ['read'],
});
```

### Dynamic roles (UI-created)

`dynamicAccessControl: { enabled: true }` on both server and client plugins enables runtime role creation:

```ts
authClient.organization.createRole({
  role: 'Sales Manager',
  permission: { project: ['read', 'create'], member: ['invite'] },
});
```

Created roles persist in `organizationRole` table and become assignable via `updateMemberRole`.

### UI: settings pages

```
/settings/general    name/slug/logo + danger zone (delete org, transfer ownership)
/settings/members    members table + role dropdown + invite dialog + pending invitations tab
/settings/roles      roles table (3 built-in read-only + custom editable)
                     + dialog create/edit role with checkbox grid (resource × action)
                     + dialog delete role (with reassignment of impacted members)
```

The `/settings/roles` page is the blueprint's differentiator: a `(resources × actions)` grid of checkboxes — exactly what B2B SaaS users expect.

### Permission helpers

**Server:** `permissionProcedure(resource, action)` (see Section 2)

**Client hook:**

```ts
// hooks/use-permission.ts
export function usePermission(permissions: Record<string, string[]>) {
  return authClient.organization.hasPermission({ permissions });
}
```

**Component wrapper:**

```tsx
// components/can.tsx
<Can permissions={{ project: ['delete'] }}>
  <DeleteButton />
</Can>
```

Both server (procedure) and client (hook + Can) gating prevent UI leaks AND route bypass.

---

## 4. Pages generated & example entity

### Route tree

```
(auth)
  /login                              email/password (better-auth default form)
  /accept-invitation/[id]             token URL — accept or login-then-accept

(onboarding)
  /onboarding                         force first-org creation if user has 0 orgs

(dashboard)
  /                                   home with simple stats
  /projects                           list + filters + create dialog
  /projects/[id]                      detail + edit + delete
  /settings/general                   name/slug/logo/danger zone
  /settings/members                   members + invitations
  /settings/roles                     built-in + custom roles
  /profile/account                    name/email
  /profile/security                   change password
  /profile/sessions                   active sessions + revoke
```

~15 page files.

### Layout `(dashboard)`

- Sidebar with `OrgSwitcher` in header
- Nav links filtered by permissions (e.g., Settings hidden for `member` role)
- Header with breadcrumbs + `NavUser` dropdown (reused from `org-dashboard` pattern)
- Middleware check: `if (!session.activeOrganizationId) redirect('/onboarding')`

### Example entity: `project`

Schema (Drizzle, in `packages/db/src/schema.ts`):

```ts
export const project = pgTable('project', {
  id:             text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdById:    text('created_by_id').notNull().references(() => user.id),
  name:           text('name').notNull(),
  description:    text('description'),
  status:         text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});
```

tRPC router (`projectRouter`):

```ts
list:   permissionProcedure('project', 'read').query(/* where eq(orgId, ctx.orgId) */)
get:    permissionProcedure('project', 'read').input(z.object({ id: z.string() })).query(/* + assertInScope */)
create: permissionProcedure('project', 'create').input(...).mutation(...)
update: permissionProcedure('project', 'update').input(...).mutation(/* + assertInScope */)
delete: permissionProcedure('project', 'delete').input(...).mutation(/* + assertInScope */)
```

UI components:

- `project-table.tsx` — TanStack Table, permission-aware action column
- `project-form.tsx` — TanStack Form + Zod
- `project-create-dialog.tsx`
- `project-edit-dialog.tsx`
- `project-delete-dialog.tsx` — confirmation requires typing the org slug

### Why `project` (not `contact` like org-dashboard)

- Universal across SaaS verticals (every app has "things users create")
- Demonstrates the full pattern: enum status, created_by relation, org scoping
- Differentiated from `org-dashboard`'s CRM-flavored contacts

### Invitation flow (no email)

1. Admin opens `/settings/members` → "Invite member" dialog
2. Form: `email` + `role` (dropdown of org's roles)
3. On submit: `authClient.organization.inviteMember()` returns the invitation with id
4. `sendInvitationEmail` callback is a server-side no-op (logs the link to console for dev)
5. UI shows `<InvitationLinkDialog>` with:
   - Generated link: `${NEXT_PUBLIC_APP_URL}/accept-invitation/${invitationId}`
   - "Copy link" button (clipboard)
   - Expiration date
6. Pending invitations tab on `/settings/members` lists all open invitations with re-copy buttons
7. Invited user opens link → `/accept-invitation/[id]` page → if logged in, calls `acceptInvitation()`; if not, redirects to `/login` then back to `/accept-invitation/[id]` after auth

Plugin config:

```ts
organization({
  ac,
  dynamicAccessControl: { enabled: true },
  roles: { owner, admin, member },
  requireEmailVerificationOnInvitation: false,  // accept without email verify
  cancelPendingInvitationsOnReInvite: true,
  async sendInvitationEmail(data) {
    console.log(`[invite] ${data.email} → /accept-invitation/${data.id}`);
  },
})
```

---

## 5. Stack & dependencies

### META.blueprints entry

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
        libraries: ['shadcn', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form'],
      },
      {
        appName: 'batch',
        stackName: 'node',  // verify exact stackName in META at impl time
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
      '@hugeicons/react':           '^1.1.6',
      '@hugeicons/core-free-icons': '^4.1.1',
      'sonner':                     '^1.x',
      'react-error-boundary':       '^4.x',
    },
  },
  envs: [
    {
      value: 'NEXT_PUBLIC_APP_URL=http://localhost:3000',
      monoScope: ['app'],
    },
  ],
},
```

Zero new libraries to add to META — entire composition uses existing entries.

### Versions to verify via context7 at implementation time

- `better-auth` ≥ 1.6.x (required for `dynamicAccessControl`)
- `@better-auth/drizzle-adapter` aligned with `better-auth`
- Drizzle ≥ 0.44 (compatible with organization plugin schema migrations)

### Template files to write (override semantics)

```
templates/blueprints/multitenant-saas/
├── packages/auth/src/
│   ├── auth.ts.hbs                    OVERRIDE — adds organization plugin + dynamicAccessControl
│   ├── auth-client.ts.hbs             OVERRIDE — adds organizationClient + dynamicAccessControl
│   ├── permissions.ts.hbs             NEW — ac instance + role definitions
│   └── types.ts.hbs                   NEW — Session typing with activeOrganizationId
├── packages/db/src/
│   └── schema.ts.hbs                  OVERRIDE — adds project table (org tables auto-migrated by plugin)
├── apps/web/src/
│   ├── middleware.ts.hbs              NEW — onboarding redirect
│   ├── app/(auth)/accept-invitation/[id]/page.tsx.hbs
│   ├── app/(onboarding)/onboarding/page.tsx.hbs
│   ├── app/(dashboard)/layout.tsx.hbs               OVERRIDE
│   ├── app/(dashboard)/page.tsx.hbs                 OVERRIDE
│   ├── app/(dashboard)/projects/page.tsx.hbs
│   ├── app/(dashboard)/projects/projects.client.tsx.hbs
│   ├── app/(dashboard)/projects/[id]/page.tsx.hbs
│   ├── app/(dashboard)/projects/[id]/project.client.tsx.hbs
│   ├── app/(dashboard)/settings/general/page.tsx.hbs
│   ├── app/(dashboard)/settings/members/page.tsx.hbs
│   ├── app/(dashboard)/settings/roles/page.tsx.hbs
│   ├── app/(dashboard)/profile/{account,security,sessions}/page.tsx.hbs (3 files, mirroring org-dashboard)
│   ├── app/(dashboard)/profile/layout.tsx.hbs
│   ├── components/navigation/org-switcher.tsx.hbs
│   ├── components/navigation/sidebar-links.tsx.hbs  OVERRIDE — permission-filtered
│   ├── components/navigation/nav-user.tsx.hbs       reused pattern
│   ├── components/navigation/app-sidebar.tsx.hbs    OVERRIDE
│   ├── components/navigation/app-header.tsx.hbs     reused pattern
│   ├── components/members/members-table.tsx.hbs
│   ├── components/members/invite-dialog.tsx.hbs
│   ├── components/members/invitation-link-dialog.tsx.hbs
│   ├── components/members/pending-invitations-table.tsx.hbs
│   ├── components/roles/roles-table.tsx.hbs
│   ├── components/roles/role-form-dialog.tsx.hbs
│   ├── components/roles/permissions-grid.tsx.hbs
│   ├── components/projects/project-table.tsx.hbs
│   ├── components/projects/project-form.tsx.hbs
│   ├── components/projects/project-create-dialog.tsx.hbs
│   ├── components/projects/project-edit-dialog.tsx.hbs
│   ├── components/projects/project-delete-dialog.tsx.hbs
│   ├── components/can.tsx.hbs
│   ├── trpc/middleware/rbac.ts.hbs
│   ├── trpc/routers/project.ts.hbs
│   ├── trpc/routers/member.ts.hbs
│   ├── trpc/routers/role.ts.hbs
│   ├── trpc/routers/invitation.ts.hbs
│   └── hooks/use-permission.ts.hbs
└── scripts/seed.ts.hbs                NEW — 1 demo org + 2 users (owner + member)
```

### Volumetric breakdown

| Category | Files |
|---|---:|
| Auth + permissions | 4 |
| DB schema | 1 |
| App router pages | 15 |
| UI components | 14 |
| tRPC | 5 |
| Hooks/middleware | 3 |
| Layouts/onboarding | 3 |
| Seed/scripts | 1 |
| **Total** | **~46** |

---

## 6. Open questions for implementation phase

- Confirm exact stack name for the `batch` app in `META.stacks` (could be `node`, `node-cli`, or similar — verify in `__meta__.ts`)
- Confirm `sonner` and `react-error-boundary` exact stable versions via context7
- Verify the migration story: does `dynamicAccessControl` require manual migration generation, or does drizzle-kit pick up the `organizationRole` table automatically?
- Decide if `accept-invitation/[id]` should support both authenticated (direct accept) and unauthenticated (login-then-accept) flows in a single page, or split into two routes
- Confirm whether `better-auth` exposes a native "transfer ownership" endpoint, or if we implement it as two sequential `updateMemberRole` calls (current owner → admin, new owner → owner) wrapped in a tRPC mutation

## 7. What is explicitly excluded (anti-scope)

To prevent scope creep:

- ❌ Email sending (Resend, SES, etc.)
- ❌ Stripe billing or any subscription management
- ❌ Audit log
- ❌ Teams (sub-orgs within an org)
- ❌ Webhooks
- ❌ API tokens for orgs
- ❌ i18n
- ❌ Domain-specific entities beyond the example `project`
- ❌ `legalEntity`-style sub-tenancy

These belong in a future "B2B SaaS Pro" blueprint or as user-side additions.
