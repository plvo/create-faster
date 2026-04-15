# B2B CRM Blueprint — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `b2b-crm` blueprint to create-faster — a generic B2B CRM/ERP base with auth, RBAC, admin panel, and example CRUD.

**Architecture:** Turborepo with 2 apps (web:nextjs + batch:node). Flat structure, server components first, better-auth admin plugin for RBAC, tRPC for API layer. All page.tsx are server components; client interactivity via `*.client.tsx` files.

**Tech Stack:** Next.js, better-auth (admin plugin), tRPC, Drizzle + Postgres, shadcn/ui, tanstack-query, tanstack-form, next-themes, sonner

**Design doc:** `docs/plans/2026-03-17-b2b-crm-blueprint-design.md`

**Reference CRMs:**
- `/home/plv/lab/kody/agence-nuisibles-crm` — sidebar pattern, RBAC, admin plugin usage
- `/home/plv/lab/kody/databoond` — flat structure, tanstack-form, RBAC middleware

---

## Prerequisites

Before writing ANY template, the implementor MUST:
1. Read the design doc thoroughly
2. Research docs via context7 for: better-auth admin plugin, tanstack-form, shadcn sidebar primitive
3. Read existing templates that will be overridden (listed in each task)

---

### Task 1: Research library docs via context7

**Purpose:** Verify current APIs before writing templates. This is a HARD GATE.

**Step 1: Research better-auth admin plugin**

Use context7 to query better-auth docs for:
- Admin plugin setup: `admin()` import, options (`defaultRole`, `adminRole`)
- Client-side admin methods: `authClient.admin.createUser()`, `listUsers()`, `banUser()`, `unbanUser()`, `setPassword()`, `setRole()`
- What fields the admin plugin adds to the user table (role, banned, banReason, banExpires)
- Server-side admin API if needed

**Step 2: Research tanstack-form**

Use context7 to query tanstack-form docs for:
- `useForm()` hook API with Zod validation
- Field component pattern (`form.Field`)
- Form submission pattern
- Integration with React (current stable API)

**Step 3: Research shadcn sidebar primitive**

Use context7 to query shadcn/ui docs for:
- Full sidebar.tsx primitive source code (all exported components)
- `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarHeader`, `SidebarFooter`
- `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`
- `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`
- `useSidebar()` hook
- Cookie persistence pattern

Also read the reference implementations:
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/ui/sidebar.tsx` — full primitive
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/app-sidebar.tsx` — application wrapper
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/sidebar-links.tsx` — role-filtered nav
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/nav-user.tsx` — user dropdown
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/app-header.tsx` — header with breadcrumbs

**Step 4: Research better-auth client for Next.js**

Use context7 for:
- `authClient.signIn.email()` — login pattern
- `authClient.updateUser()` — profile update
- `authClient.changePassword()` — password change
- `authClient.useSession()` — client-side session hook
- `authClient.signOut()` — logout

**Step 5: Document findings**

Write down specific API findings that differ from assumptions. These findings inform all subsequent tasks.

---

### Task 2: Add META entry in `__meta__.ts`

**Files:**
- Modify: `apps/cli/src/__meta__.ts` — add to `META.blueprints` section

**Step 1: Read the current META.blueprints section**

Read `apps/cli/src/__meta__.ts` and locate the blueprints object (after `lambda-terraform-aws`).

**Step 2: Add the b2b-crm entry**

Add after the last blueprint entry:

```typescript
'b2b-crm': {
  label: 'B2B CRM',
  hint: 'CRM/ERP base with auth, RBAC, admin panel, and example CRUD',
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
      sonner: 'latest',
    },
  },
},
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/cli && bun run check`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/cli/src/__meta__.ts
git commit -m "feat(blueprints): add b2b-crm META entry"
```

---

### Task 3: Auth override — better-auth with admin plugin

**Files:**
- Create: `templates/blueprints/b2b-crm/src/lib/auth/auth.ts.hbs`

**Reference:** Read first:
- `templates/libraries/better-auth/src/lib/auth/auth.ts.hbs` (the file being overridden)
- `/home/plv/lab/kody/agence-nuisibles-crm/src/lib/auth/auth.ts` (admin plugin reference)

**Step 1: Write the auth override template**

This file MUST:
- Keep the same frontmatter as the original (`mono: { scope: pkg, path: src/auth.ts }`)
- Keep all conditional logic for drizzle/prisma, postgres/mysql (copy from original)
- ADD: `import { admin } from 'better-auth/plugins'`
- ADD: `plugins: [admin({ defaultRole: 'manager' })]` in the auth config
- Keep: nextCookies, emailAndPassword, session config from original

**Step 2: Verify override path matches**

The blueprint file at `src/lib/auth/auth.ts.hbs` with frontmatter `mono: { scope: pkg, path: src/auth.ts }` must resolve to the same destination as the library template. Verify this matches.

**Step 3: Commit**

```bash
git add templates/blueprints/b2b-crm/
git commit -m "feat(b2b-crm): add auth override with admin plugin"
```

---

### Task 4: RBAC middleware + tRPC routers

**Files:**
- Create: `templates/blueprints/b2b-crm/src/trpc/middleware/rbac.ts.hbs`
- Create: `templates/blueprints/b2b-crm/src/trpc/routers/_app.ts.hbs` (override)
- Create: `templates/blueprints/b2b-crm/src/trpc/routers/user.ts.hbs`
- Create: `templates/blueprints/b2b-crm/src/trpc/routers/contact.ts.hbs`

**Reference:** Read first:
- `templates/libraries/trpc/src/trpc/init.ts.hbs` — for protectedProcedure export pattern
- `templates/libraries/trpc/src/trpc/routers/_app.ts.hbs` — to match frontmatter
- `templates/libraries/trpc/src/trpc/routers/hello.ts.hbs` — router pattern
- `/home/plv/lab/kody/agence-nuisibles-crm/src/trpc/trpc.ts` — RBAC reference
- `/home/plv/lab/kody/databoond/src/trpc/middleware/rbac.ts` — RBAC middleware reference

**Step 1: Write RBAC middleware**

`rbac.ts.hbs` — imports `protectedProcedure` from init, creates:
- `adminProcedure`: checks `ctx.session.user.role === 'admin'`, throws FORBIDDEN
- `managerProcedure`: alias for `protectedProcedure` (no extra check)

Frontmatter: needs mono scope resolution. In turborepo, tRPC lives in `packages/api/`. Use:
```yaml
---
mono:
  scope: pkg
  path: src/middleware/rbac.ts
---
```

**Step 2: Write user router**

`user.ts.hbs` — procedures:
- `me`: `protectedProcedure` — returns current user from session (for sidebar, profile)
- `list`: `adminProcedure` — queries all users from db

Frontmatter matching hello.ts pattern:
```yaml
---
mono:
  scope: pkg
  path: src/router/user.ts
---
```

**Step 3: Write contact router**

`contact.ts.hbs` — CRUD with `managerProcedure`:
- `list`: query all contacts ordered by createdAt desc
- `getById`: query by ID with zod input `z.object({ id: z.string() })`
- `create`: insert with createdById from session
- `update`: update by ID
- `delete`: delete by ID

Same frontmatter pattern as user router.

**Step 4: Write _app.ts override**

Must match frontmatter from original: `mono: { scope: pkg, path: src/root.ts }`
Import and compose `userRouter` + `contactRouter`.

**Step 5: Commit**

```bash
git add templates/blueprints/b2b-crm/src/trpc/
git commit -m "feat(b2b-crm): add RBAC middleware and tRPC routers"
```

---

### Task 5: Database schema — contacts table

**Files:**
- Create: `templates/blueprints/b2b-crm/src/lib/db/schema/contacts.ts.hbs`

**Reference:** Read first:
- `templates/project/orm/drizzle/src/schema.ts.hbs` — for schema patterns, conditional pg/mysql
- The drizzle schema in agence-nuisibles for reference

**Step 1: Write contacts schema**

Frontmatter to place in the db package:
```yaml
---
path: src/lib/db/schema/contacts.ts
mono:
  scope: pkg
  path: src/schema/contacts.ts
---
```

Template must:
- Use conditional postgres/mysql table constructors (same pattern as main schema)
- Define contactTable with: id, firstName, lastName, email, phone, company, notes, createdById (FK to user), createdAt, updatedAt
- Export the table and its relations

**Step 2: Commit**

```bash
git add templates/blueprints/b2b-crm/src/lib/db/
git commit -m "feat(b2b-crm): add contacts drizzle schema"
```

---

### Task 6: Navigation constants

**Files:**
- Create: `templates/blueprints/b2b-crm/src/lib/constants.ts.hbs`

**Reference:** Read first:
- `/home/plv/lab/kody/agence-nuisibles-crm/src/lib/constants.ts` — route definition pattern

**Step 1: Write constants template**

Define route arrays:
```typescript
ADMIN_ROUTES: [
  { url: '/', title: 'Dashboard', icon: LayoutDashboard },
  { url: '/contacts', title: 'Contacts', icon: Users },
  { url: '/admin/users', title: 'Users', icon: Shield, category: 'Administration' },
]

MANAGER_ROUTES: [
  { url: '/', title: 'Dashboard', icon: LayoutDashboard },
  { url: '/contacts', title: 'Contacts', icon: Users },
]
```

Export `RouteProps` interface and both route arrays.

**Step 2: Commit**

```bash
git add templates/blueprints/b2b-crm/src/lib/constants.ts.hbs
git commit -m "feat(b2b-crm): add navigation constants"
```

---

### Task 7: Sidebar components

**Files:**
- Create: `templates/blueprints/b2b-crm/src/components/ui/sidebar.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/navigation/app-sidebar.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/navigation/sidebar-links.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/navigation/nav-user.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/navigation/app-header.tsx.hbs`

**Reference:** Read EVERY file from agence-nuisibles first:
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/ui/sidebar.tsx`
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/app-sidebar.tsx`
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/sidebar-links.tsx`
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/nav-user.tsx`
- `/home/plv/lab/kody/agence-nuisibles-crm/src/components/navigation/app-header.tsx`

**Step 1: Write sidebar.tsx primitive**

The shadcn sidebar.tsx is a large primitive (~680 lines). Copy the pattern from agence-nuisibles but:
- Adapt for Handlebars: escape JSX `{{ }}` with `\{{` or `{{{{raw}}}}`
- Use `{{#if (isMono)}}` for import paths where needed (probably not needed for UI primitive)

**Step 2: Write app-sidebar.tsx**

Compose Sidebar primitive:
- SidebarHeader → projectName branding
- SidebarContent → SidebarLinks component
- SidebarFooter → NavUser component
- Accept role prop for RBAC filtering
- Use `{{projectName}}` for branding

**Step 3: Write sidebar-links.tsx**

- Import ADMIN_ROUTES, MANAGER_ROUTES from constants
- Filter by role prop
- Group by category
- Active state via `usePathname()`
- SidebarMenu → SidebarMenuItem → SidebarMenuButton with Link

**Step 4: Write nav-user.tsx**

- User dropdown in sidebar footer
- Avatar + name + email + role
- Links: Profile (/profile), Theme toggle (next-themes)
- Logout with confirmation dialog
- Uses `authClient.signOut()` and `authClient.useSession()`

**Step 5: Write app-header.tsx**

- SidebarTrigger for mobile
- Dynamic breadcrumbs from pathname
- Match segments against routes config

**Step 6: Commit**

```bash
git add templates/blueprints/b2b-crm/src/components/
git commit -m "feat(b2b-crm): add sidebar and navigation components"
```

---

### Task 8: Auth layout + Login page

**Files:**
- Create: `templates/blueprints/b2b-crm/src/app/(auth)/layout.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(auth)/login/page.tsx.hbs`

**Reference:** Read first:
- better-auth client login pattern from context7 research (Task 1)
- `/home/plv/lab/kody/agence-nuisibles-crm/src/app/(auth)/` for pattern

**Step 1: Write auth layout**

Server component. Centered layout, no sidebar. Check if already authenticated → redirect to `/`.

**Step 2: Write login page**

Server component page.tsx that renders a `<LoginForm />` client component.

The login form (can be inline or separate file):
- Email + password inputs
- Submit via `authClient.signIn.email({ email, password })`
- Redirect to `/` on success
- Error display on failure
- Uses `{{projectName}}` for branding

**Step 3: Commit**

```bash
git add templates/blueprints/b2b-crm/src/app/\(auth\)/
git commit -m "feat(b2b-crm): add auth layout and login page"
```

---

### Task 9: Dashboard layout + home page

**Files:**
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/layout.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/page.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/dashboard.client.tsx.hbs`

**Reference:** Read first:
- `templates/blueprints/dashboard/src/app/(dashboard)/layout.tsx.hbs` — existing dashboard layout
- `/home/plv/lab/kody/agence-nuisibles-crm/src/app/(dashboard)/layout.tsx` — session check pattern
- `templates/libraries/trpc/src/trpc/server.tsx.hbs` — prefetch + HydrateClient pattern

**Step 1: Write dashboard layout**

Server component:
- Fetch session server-side via `auth.api.getSession({ headers: await headers() })`
- If no session → `redirect('/login')`
- Wrap in `SidebarProvider` + `AppSidebar` (pass role) + `SidebarInset` with app-header + main content
- Pass session to children via context or props

**Step 2: Write dashboard page (server)**

Server component:
- Prefetch `trpc.contact.list` and `trpc.user.list` (if admin)
- Render `HydrateClient` → `<DashboardClient />`

**Step 3: Write dashboard client**

`'use client'` component:
- Stats cards: total contacts count, active users count
- Simple card grid with real data from tRPC queries
- No recharts — just cards with numbers

**Step 4: Commit**

```bash
git add templates/blueprints/b2b-crm/src/app/\(dashboard\)/layout.tsx.hbs
git add templates/blueprints/b2b-crm/src/app/\(dashboard\)/page.tsx.hbs
git add templates/blueprints/b2b-crm/src/app/\(dashboard\)/dashboard.client.tsx.hbs
git commit -m "feat(b2b-crm): add dashboard layout and home page"
```

---

### Task 10: Profile page

**Files:**
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/profile/page.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/profile/profile.client.tsx.hbs`

**Reference:**
- better-auth client `updateUser()` and `changePassword()` from context7 (Task 1)
- tanstack-form usage from context7 (Task 1)
- next-themes `useTheme()` hook

**Step 1: Write profile page (server)**

Prefetch `trpc.user.me` → HydrateClient → `<ProfileClient />`

**Step 2: Write profile client**

`'use client'` component with sections:
- **Account info**: firstName, lastName, email — tanstack-form + `authClient.updateUser()`
- **Theme**: select/toggle via `useTheme()` from next-themes (light/dark/system)
- **Change password**: currentPassword + newPassword — `authClient.changePassword()`
- Toast notifications via sonner on success/error

**Step 3: Commit**

```bash
git add templates/blueprints/b2b-crm/src/app/\(dashboard\)/profile/
git commit -m "feat(b2b-crm): add profile page"
```

---

### Task 11: Admin users page

**Files:**
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/admin/users/page.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/admin/users/users.client.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/admin/user-table.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/admin/create-user-dialog.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/admin/user-actions.tsx.hbs`

**Reference:**
- `/home/plv/lab/kody/agence-nuisibles-crm/src/domains/technician/` — admin CRUD pattern
- better-auth admin client methods from context7 (Task 1)

**Step 1: Write users page (server)**

Prefetch `trpc.user.list` → HydrateClient → `<UsersClient />`

**Step 2: Write users client**

`'use client'` component:
- Renders `<UserTable />` with `<CreateUserDialog />` button

**Step 3: Write user-table**

Table columns: name, email, role, status (active/banned), actions dropdown.
Data from `trpc.user.list` query.

**Step 4: Write create-user-dialog**

Dialog with tanstack-form:
- Fields: email, password, firstName, lastName, role (select: admin/manager)
- Submit via `authClient.admin.createUser()`
- Invalidate user list on success

**Step 5: Write user-actions**

Dropdown menu per user row:
- Ban / Unban: `authClient.admin.banUser()` / `authClient.admin.unbanUser()`
- Reset password: `authClient.admin.setPassword()` with generated password
- Change role: `authClient.admin.setRole()`
- All actions invalidate user list query on success

**Step 6: Commit**

```bash
git add templates/blueprints/b2b-crm/src/app/\(dashboard\)/admin/
git add templates/blueprints/b2b-crm/src/components/admin/
git commit -m "feat(b2b-crm): add admin users page"
```

---

### Task 12: Contacts pages

**Files:**
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/contacts/page.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/contacts/contacts.client.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/contacts/[id]/page.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/app/(dashboard)/contacts/[id]/contact.client.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/contacts/contact-table.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/contacts/contact-form.tsx.hbs`
- Create: `templates/blueprints/b2b-crm/src/components/contacts/contact-dialog.tsx.hbs`

**Reference:**
- tanstack-form patterns from context7 (Task 1)
- tRPC mutation + query invalidation pattern from reference CRMs

**Step 1: Write contacts list page (server)**

Prefetch `trpc.contact.list` → HydrateClient → `<ContactsClient />`

**Step 2: Write contacts client**

`'use client'` component:
- `<ContactTable />` + "New contact" button → `<ContactDialog />`

**Step 3: Write contact-table**

Table columns: name (firstName + lastName), email, phone, company, actions.
Link to `/contacts/[id]` on row click or name click.

**Step 4: Write contact-form**

Reusable tanstack-form component:
- Fields: firstName, lastName, email, phone, company, notes
- Zod validation schema
- Mode: create (empty) or edit (prefilled with contact data)
- Submit calls `trpc.contact.create` or `trpc.contact.update`

**Step 5: Write contact-dialog**

Dialog wrapper around `<ContactForm />` for create mode.
Opens from contacts list page.

**Step 6: Write contact detail page (server)**

Prefetch `trpc.contact.getById({ id: params.id })` → HydrateClient → `<ContactClient />`

**Step 7: Write contact detail client**

`'use client'` component:
- Display contact info
- Edit via `<ContactForm />` in edit mode
- Delete button with confirmation → `trpc.contact.delete` → redirect to `/contacts`

**Step 8: Commit**

```bash
git add templates/blueprints/b2b-crm/src/app/\(dashboard\)/contacts/
git add templates/blueprints/b2b-crm/src/components/contacts/
git commit -m "feat(b2b-crm): add contacts CRUD pages"
```

---

### Task 13: Batch app override

**Files:**
- Create: `templates/blueprints/b2b-crm/src/index.ts.node.hbs`

**Reference:** Read `templates/stack/node/src/index.ts.hbs` (the file being overridden)

**Step 1: Write batch handler template**

Use `.node.hbs` stack suffix so it only applies to the node app.

Content: BatchEvent interface, switch-based handler, local dev execution via `import.meta.url`.

**Step 2: Commit**

```bash
git add templates/blueprints/b2b-crm/src/index.ts.node.hbs
git commit -m "feat(b2b-crm): add batch handler template"
```

---

### Task 14: Test CLI generation

**Step 1: Build and test with blueprint flag**

```bash
cd /tmp && bunx /home/plv/lab/r/create-faster/apps/cli/src/index.ts test-crm \
  --blueprint b2b-crm \
  --linter biome \
  --git \
  --pm bun
```

Or use dev mode:
```bash
cd apps/cli && bun run dev:cli
```
Then select "Template" → "B2B CRM" interactively.

**Step 2: Verify file tree**

Check that all blueprint files are present:
- `apps/web/src/app/(auth)/login/page.tsx`
- `apps/web/src/app/(dashboard)/layout.tsx`
- `apps/web/src/app/(dashboard)/page.tsx`
- `apps/web/src/app/(dashboard)/profile/`
- `apps/web/src/app/(dashboard)/admin/users/`
- `apps/web/src/app/(dashboard)/contacts/`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/navigation/`
- `apps/web/src/lib/constants.ts`
- `apps/batch/src/index.ts` (batch handler, not default console.log)
- `packages/auth/src/auth.ts` (with admin plugin)
- `packages/api/src/router/` (user + contact routers)
- `packages/api/src/middleware/rbac.ts`

**Step 3: Verify overrides**

- `packages/auth/src/auth.ts` should contain `admin()` plugin import
- `packages/api/src/root.ts` should have user + contact routers (not hello)
- `apps/batch/src/index.ts` should have BatchEvent handler (not console.log)

**Step 4: Verify dependencies**

Check `apps/web/package.json` contains `sonner`.
Check `.env.example` files have `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`.

**Step 5: Install and run**

```bash
cd /tmp/test-crm && bun install && bun run dev
```

Verify the app starts without build errors.

**Step 6: Verify interactive mode**

Run `bun run dev:cli` and verify "B2B CRM" appears in the blueprint selection list under "Business" category.

**Step 7: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix(b2b-crm): address generation issues"
```
