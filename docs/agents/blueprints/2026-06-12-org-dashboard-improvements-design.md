# Blueprint `org-dashboard` — Improvements Design

**Date:** 2026-06-12
**Status:** Design awaiting review
**Branch:** `worktree-feat+org-dashboard-rbac` (worktree at `.claude/worktrees/feat+org-dashboard-rbac`)
**Scope:** `org-dashboard` only (not `multitenant-saas`)

## 1. Motivation

Five issues surfaced from a generated `org-dashboard` project, plus one feature gap:

1. **Native `<dialog>` is ugly and inaccessible** — `create-user-dialog` and `contact-dialog` use the native `<dialog>` element with hand-rolled markup.
2. **Password is entered manually** in the create-user form — it should be generated automatically (server-side), never typed by the admin.
3. **No real RBAC** — only `admin` / `user` via the Better Auth `admin` plugin. Real apps need multiple roles with distinct rights and distinct accessible pages.
4. **`@repo/config` missing from root `devDependencies`** — the root `tsconfig.json` does `extends: "@repo/config/ts/base.json"` but the dependency is never declared.
5. **Login form has no Card** — it renders a bare form, centered, with no visual container.

Reference patterns come from the working CRM at `~/lab/kody/agence-nuisibles-crm` (password flow, responsive dialogs) and the `multitenant-saas` blueprint design (RBAC, minus multi-tenancy).

## 2. RBAC (the main change)

### Decision

`org-dashboard` moves from 2 hardcoded roles to a **full single-tenant RBAC** built on the Better Auth `admin` plugin's native access-control support (`createAccessControl`, `ac.newRole`, `auth.api.userHasPermission`). **No `organization` plugin, no multi-tenancy** — global roles only.

The infrastructure is complete and production-shaped (catalog, roles, server middleware, client gate, permission-filtered nav). The example content is deliberately minimal so a developer or agent can read it and immediately understand how to add a role or a permission.

### Permission catalog — `packages/auth/src/permissions.ts` (new)

```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,            // user, session (admin-plugin built-ins)
  contact: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  admin: ac.newRole({
    ...adminAc.statements,          // full user/session management
    contact: ['create', 'read', 'update', 'delete'],
  }),
  user: ac.newRole({
    contact: ['create', 'read', 'update', 'delete'],
  }),
  manager: ac.newRole({
    contact: ['read'],             // example restricted role: read but not write
  }),
};
```

Three roles with distinct profiles:

| Role | `user`/`session` | `contact` | Accessible pages |
|---|---|---|---|
| `admin` | full | full | dashboard, contacts, **users admin**, profile |
| `user` (default) | — | create/read/update/delete | dashboard, contacts, profile |
| `manager` | — | **read only** | dashboard, contacts (read), profile |

`manager` is the pedagogical role: it can open Contacts and see rows, but the "New contact" button, row edit, and delete are gated off. This shows, in one diff, where a role is declared and where it is enforced (server + UI).

### Auth wiring

- `packages/auth/src/auth.ts` — pass `ac` + `roles` to the `admin` plugin: `admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] })`.
- `packages/auth/src/auth-client.ts` — `adminClient({ ac, roles })` so client-side `hasPermission` / inferred role types match.

### Server enforcement — `packages/api/src/middleware/rbac.ts`

Keep `adminProcedure` (role gate, for the users-admin surface). Add a permission-based procedure factory:

```ts
export const permissionProcedure = (resource: string, action: string) =>
  protectedProcedure.use(async (opts) => {
    const ok = await auth.api.userHasPermission({
      body: { userId: opts.ctx.session.user.id, permissions: { [resource]: [action] } },
    });
    if (!ok.success) throw new TRPCError({ code: 'FORBIDDEN' });
    return opts.next({ ctx: opts.ctx });
  });
```

`contact` router routes move from `protectedProcedure` to `permissionProcedure('contact', <action>)`. This makes it impossible to forget the permission check on a data route.

### Client gate

- `apps/web/src/hooks/use-permission.ts` (new) — wraps `authClient.admin.hasPermission`.
- `apps/web/src/components/can.tsx` (new):

```tsx
<Can permissions={{ contact: ['create'] }}>
  <NewContactButton />
</Can>
```

Used to hide write affordances (new/edit/delete contact, users-admin nav) for roles without the permission. Both server (procedure) and client (`Can`) gate, so there is no UI leak and no route bypass.

### Permission-filtered navigation

`sidebar-links.tsx` + `lib/constants.ts` currently switch on `role === 'admin' ? ADMIN_ROUTES : USER_ROUTES`. Replace the hardcoded split with per-route permission metadata, and filter routes by the session's permissions. The Users-admin link requires `user:['list']` (admin only); Contacts requires `contact:['read']` (everyone). This is what produces "different pages per role".

### Seed

`scripts/seed.ts` seeds one user per role so the demo is legible:

```
admin@example.com    role=admin     (full)
user@example.com     role=user      (contacts CRUD)
manager@example.com  role=manager   (contacts read-only)
```

### Docs

`docs/agents/auth.md` rewritten: document the catalog, the three roles, `permissionProcedure`, `<Can>`, and the recipe "to add a role, edit `permissions.ts`".

## 3. Password — auto-generated (CRM pattern)

The admin never types a password.

- **Create:** add `user.create` (`adminProcedure`) that generates the password server-side via `generatePassword()` (already in `@repo/auth/password`) and calls `auth.api.createUser`. The create-user form loses its `password` field entirely (name, email, role only).
- **Reveal once / reset:** the `user.generatePassword` mutation already exists and returns `{ password }`. Surface it in the user-detail / edit UI exactly like the CRM `edit-dialog.tsx`: a "Generate password" button → result shown once in an `InputGroup` (read-only) with **copy** + **regenerate** buttons and the warning "visible only once — copy it now".

This requires the `input-group` primitive in `packages/ui` (the CRM uses `InputGroup/InputGroupInput/InputGroupAddon/InputGroupButton`). It is already vendored in the blueprint (`packages/ui/.../input-group.tsx.hbs`) — confirm and reuse.

## 4. Dialogs — shuip `responsive-dialog`

Vendor the shuip `responsive-dialog` block into `packages/ui` (consistent with the already-vendored shuip tanstack-form fields under `packages/ui/src/components/ui/shuip/`). Block exports: `ResponsiveDialog`, `ResponsiveDialogTrigger`, `ResponsiveDialogContent`, `ResponsiveDialogHeader`, `ResponsiveDialogTitle`, `ResponsiveDialogDescription`, `ResponsiveDialogBody`, `ResponsiveDialogFooter` (Dialog on desktop, Drawer on mobile).

Migrate both dialogs to it, following the CRM structure (form has an `id`, `SubmitButton` references it via `props={{ form: '<id>' }}`, footer holds the submit). Drop the native `<dialog>`, the `useRef`/`showModal` effect, and the manual close button.

The shuip block pulls `drawer` (and thus `vaul`); add those to the blueprint's vendored primitives / `pkgPackageJson.ui` deps as needed.

## 5. Login Card

Wrap `LoginForm` in a shadcn `Card`: `CardHeader` (title "Sign in" + description), `CardContent` (the form). Add the `card` primitive to `packages/ui` (`card.tsx.hbs`). The `(auth)/layout.tsx` already centers its child, so the Card sits centered with a sensible `max-w`.

## 6. `@repo/config` dependency

Add `"@repo/config": "*"` to `META.blueprints['org-dashboard'].rootPackageJson.devDependencies` in `apps/cli/src/__meta__.ts`, so the workspace resolves `@repo/config/ts/base.json` referenced by the root `tsconfig.json`.

## 7. Files touched (summary)

**META** — `apps/cli/src/__meta__.ts`: `@repo/config` devDep; any new `pkgPackageJson.ui` deps (vaul) for the responsive dialog.

**New blueprint templates**
- `packages/auth/src/permissions.ts.hbs`
- `packages/ui/src/components/ui/card.tsx.hbs`
- `packages/ui/src/components/block/shuip/responsive-dialog.tsx.hbs` (+ `drawer.tsx.hbs` if not present)
- `src/hooks/use-permission.ts.hbs`
- `src/components/can.tsx.hbs`

**Modified blueprint templates**
- `packages/auth/src/auth.ts.hbs`, `auth-client.ts.hbs` — `ac` + `roles`
- `packages/api/src/middleware/rbac.ts.hbs` — `permissionProcedure`
- `src/trpc/routers/contact.ts.hbs` — permission procedures
- `src/trpc/routers/user.ts.hbs` — add `create`
- `src/components/admin/create-user-dialog.tsx.hbs` — responsive dialog, no password, tRPC `user.create`
- `src/components/admin/user-table.tsx.hbs` / `user-actions.tsx.hbs` — 3 roles
- `src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs` — generate-password UI
- `src/components/contacts/contact-dialog.tsx.hbs` — responsive dialog
- `src/components/contacts/contact-table.tsx.hbs` / `contacts.client.tsx.hbs` — `Can`-gated writes
- `src/components/navigation/sidebar-links.tsx.hbs` + `src/lib/constants.ts.hbs` — permission-filtered nav
- `src/app/(auth)/login/login-form.tsx.hbs` — Card
- `scripts/seed.ts.hbs` — manager user
- `docs/agents/auth.md.hbs` — RBAC docs

## 8. Verification

Generate the blueprint into a scratch dir (`bunx`/`bun run dev:cli --blueprint org-dashboard`), then:
- `bun install` resolves (incl. `@repo/config`, `vaul`), `tsc`/`biome check` clean.
- `bun run local-setup` + seed: three demo users created.
- Manual smoke: log in as `manager` → Contacts visible read-only, no New/Edit/Delete, no Users nav; as `admin` → full; create a user → no password field, password revealed once via generate.

## 9. Anti-scope

- ❌ Multi-tenancy / `organization` plugin (that is `multitenant-saas`).
- ❌ Dynamic UI role editor (a `/settings/roles` grid) — roles stay code-defined here; the dynamic editor belongs to `multitenant-saas`.
- ❌ Email sending for password delivery — admin copies the revealed password.
- ❌ No changes to `multitenant-saas`.
