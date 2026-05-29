# Design Spec — `org-dashboard` Blueprint Improvement Pass

- **Date**: 2026-05-28
- **Branch base**: `feat/blueprint/improve-org`
- **Author**: Claude (with Pelavo)
- **Status**: Awaiting Pelavo review

## 1. Context & Motivation

The `org-dashboard` blueprint (`apps/cli/templates/blueprints/org-dashboard/`) ships a working
admin dashboard but lags behind the patterns we are converging on across blueprints
(notably `feat/multitenant-saas-blueprint`):

- Forms use raw HTML inputs instead of `shuip` TanStack Form field components.
- `authClient` is called directly from UI for data-mutating actions (`admin.createUser`,
  `updateUser`, `changePassword`), bypassing tRPC.
- `useState(false)` is used as a loading flag in one form.
- shadcn primitives live inside `apps/web/src/components/ui/` rather than `packages/ui/`.
- RBAC is reduced to a hardcoded `role === 'admin'` check; there is no extensible
  `permission(resource, action)` model — yet the blueprint targets bespoke single-tenant
  admin apps where well-defined roles matter.

This pass aligns `org-dashboard` with our current best practices without turning it into
a multi-tenant SaaS.

## 2. Goals

1. Introduce a `packages/ui` containing both shuip TanStack Form fields and all reusable
   shadcn primitives.
2. Migrate the five existing forms to the `useAppForm` + `<form.AppField>` pattern.
3. Eliminate `useState(false)` loading patterns in favor of `useTransition` or React Query
   `isPending` (which is already idiomatic).
4. Remove `authClient` from data-mutating UI paths; route them through tRPC mutations that
   call `auth.api.*` server-side. Keep `authClient` only for session-bound operations
   (`signIn`, `signOut`, `useSession`).
5. Introduce static custom roles via Better Auth's `admin` plugin access control:
   `admin`, `manager`, `viewer`. Wire a `permissionProcedure(resource, action)` tRPC
   middleware that delegates to `auth.api.userHasPermission`.
6. Provide a minimal UI to assign roles to users (no role *creation* UI).
7. Run a `react-doctor` pass on the result.

## 3. Non-Goals (Explicit)

- **No multitenant features** — no organization plugin, no org switcher, no
  invitation-accept flow.
- **No runtime role creation** — roles are statically declared in
  `packages/auth/src/permissions.ts`. Adding a new role means editing the file.
- **No SSO, no 2FA, no email/password reset rework** — outside scope.
- **No data-model overhaul** — keep existing `contact`, `user`, `session` entities.
- **No new modules added to `__meta__.ts`** beyond what existing libraries already pull in;
  `shuip` field components live in the blueprint package, not as a CLI module.

## 4. Architecture Changes

### 4.1 `packages/ui` restructure

```
packages/ui/
├── package.json                     # exports ./components/ui/*, ./lib/form, ./hooks/*
├── tsconfig.json
└── src/
    ├── components/
    │   └── ui/
    │       ├── button.tsx
    │       ├── input.tsx
    │       ├── label.tsx
    │       ├── select.tsx
    │       ├── textarea.tsx
    │       ├── checkbox.tsx
    │       ├── dialog.tsx
    │       ├── dropdown-menu.tsx
    │       ├── separator.tsx
    │       ├── sheet.tsx
    │       ├── sidebar.tsx
    │       ├── skeleton.tsx
    │       ├── tooltip.tsx
    │       └── shuip/
    │           └── tanstack-form/
    │               ├── form-context.tsx
    │               ├── input-field.tsx
    │               ├── password-field.tsx
    │               ├── select-field.tsx
    │               ├── textarea-field.tsx
    │               ├── checkbox-field.tsx
    │               └── submit-button.tsx
    ├── hooks/
    │   └── use-mobile.ts
    └── lib/
        ├── form.ts                  # exports useAppForm, withForm
        └── utils.ts                 # cn() helper if needed by package
```

All consumers in `apps/web/src/` import via `@repo/ui/components/ui/<name>` (existing
alias). Files at `apps/web/src/components/ui/*` are deleted as part of this pass.

### 4.2 `shuip` field catalog

`packages/ui/src/lib/form.ts`:

```ts
import { createFormHook, createFormHookContexts } from '@tanstack/react-form';
import { InputField } from '../components/ui/shuip/tanstack-form/input-field';
import { PasswordField } from '../components/ui/shuip/tanstack-form/password-field';
import { SelectField } from '../components/ui/shuip/tanstack-form/select-field';
import { TextareaField } from '../components/ui/shuip/tanstack-form/textarea-field';
import { CheckboxField } from '../components/ui/shuip/tanstack-form/checkbox-field';
import { SubmitButton } from '../components/ui/shuip/tanstack-form/submit-button';

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { InputField, PasswordField, SelectField, TextareaField, CheckboxField },
  formComponents: { SubmitButton },
});
```

Each field component pulls from `useFieldContext`, renders the label, the shadcn primitive,
the error message, and consumes the form-level `isSubmitting` from `useFormContext` to
disable inputs during submission.

### 4.3 RBAC via Better Auth admin plugin

`packages/auth/src/permissions.ts` (new file):

```ts
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
```

`packages/auth/src/auth.ts` — wire it:

```ts
import { admin as adminPlugin } from 'better-auth/plugins';
import { ac, admin, manager, viewer } from './permissions';

export const auth = betterAuth({
  // ...
  plugins: [
    adminPlugin({
      ac,
      roles: { admin, manager, viewer },
      defaultRole: 'viewer',     // new users get viewer
      adminRoles: ['admin'],     // who counts as admin
    }),
  ],
});
```

`packages/api/src/middleware/rbac.ts`:

```ts
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../trpc';
import { auth } from '@repo/auth/auth';

type Resource = 'user' | 'contact' | 'session';
type Action = string;

export const permissionProcedure = (resource: Resource, action: Action) =>
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
```

`adminProcedure` is removed. `userProcedure` is renamed to `protectedProcedure` (which is
already the standard tRPC name).

### 4.4 tRPC procedure additions

```
packages/api/src/router/user.ts
  + create        permission('user','create')   wraps auth.api.createUser
  + updateMe      protectedProcedure            wraps auth.api.updateUser (self)
  + changePassword protectedProcedure           wraps auth.api.changePassword (self)
  + setRole       permission('user','setRole')  wraps auth.api.setRole
  + list          permission('user','list')     existing, switched to permissionProcedure
  + getById       permission('user','list')     existing
  + edit          permission('user','update')   existing
  + generatePassword permission('user','update') existing (rename: resetPassword)

packages/api/src/router/contact.ts — all CRUD switched to permissionProcedure('contact', ...)
packages/api/src/router/session.ts — list/revoke switched to permissionProcedure('session', ...)
```

The user-detail edit page (`apps/web/src/app/(dashboard)/admin/users/[id]/user-detail.tsx`)
gains a Role select bound to `user.setRole`.

## 5. Forms Migration Matrix

| Form | File | Fields | Submission target (PR1 → PR2) |
|------|------|--------|--------------------------------|
| Login | `app/(auth)/login/login-form.tsx` | email, password | `authClient.signIn.email` (unchanged — session op) |
| Create user (admin) | `components/admin/create-user-dialog.tsx` | name, email, password, role | `authClient.admin.createUser` → `trpc.user.create.mutate` |
| Contact | `components/contacts/contact-form.tsx` | firstName, lastName, email, phone, company, notes | `trpc.contact.{create,update}.mutate` (already tRPC, just shuip-ify) |
| Account | `components/profile/account-form.tsx` | name | `authClient.updateUser` → `trpc.user.updateMe.mutate` |
| Security | `components/profile/security-form.tsx` | currentPassword, newPassword | `authClient.changePassword` → `trpc.user.changePassword.mutate` |

Each form post-migration follows the same skeleton:

```tsx
const form = useAppForm({
  defaultValues: { /* ... */ },
  validators: { onChange: zodSchema },
  onSubmit: async ({ value }) => { await mutate.mutateAsync(value); },
});

return (
  <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
    <form.AppField name="email" children={(f) => <f.InputField label="Email" />} />
    {/* ... */}
    <form.AppForm><form.SubmitButton>Save</form.SubmitButton></form.AppForm>
  </form>
);
```

## 6. Auth Migration Matrix

| Path | Before (PR1 frozen) | After (PR2) |
|------|---------------------|-------------|
| `signIn.email` | `authClient.signIn.email()` | unchanged — kept |
| `signOut` | `authClient.signOut()` | unchanged — kept |
| `useSession` | `authClient.useSession()` | unchanged — kept |
| `admin.createUser` | `authClient.admin.createUser()` | `trpc.user.create.mutate()` → server `auth.api.createUser` |
| `updateUser` (self) | `authClient.updateUser()` | `trpc.user.updateMe.mutate()` → server `auth.api.updateUser` |
| `changePassword` | `authClient.changePassword()` | `trpc.user.changePassword.mutate()` → server `auth.api.changePassword` |
| Role assignment (new) | n/a | `trpc.user.setRole.mutate()` → server `auth.api.setRole` |

## 7. Loading State Policy

- React Query mutations: use the mutation's own `isPending` — no extra state.
- One-shot client-side async (e.g., the click handler for an `authClient` session op):
  `useTransition`.
- **Forbidden**: `const [loading, setLoading] = useState(false)`.

Affected: `create-user-dialog.tsx` currently violates this and gets the `useTransition`
treatment (or simply `mutation.isPending` once it switches to tRPC in PR2).

## 8. PR Phasing & Worktree Topology

### PR1 — UI infrastructure & forms (`feat/blueprint/improve-org-ui`)

Worktree path: `/home/ttecim/.lab/create-faster/.worktrees/improve-org-ui` (created via
`git worktree add` from `feat/blueprint/improve-org`).

| Subagent | Owns | Depends on | Notes |
|----------|------|------------|-------|
| S1 | Create `packages/ui/{src/lib/form.ts, components/ui/shuip/tanstack-form/*}`, copy shadcn primitives from `apps/web/src/components/ui/` into `packages/ui/src/components/ui/`, delete the originals | — | Updates `packages/ui/package.json` exports; no app code edits. |
| S2 | Migrate the 5 forms to `useAppForm` + `<form.AppField>` skeleton (keeping current submit handlers — still `authClient.*` for the 3 we'll swap in PR2) | S1 | Touches `components/admin/create-user-dialog.tsx`, `components/contacts/contact-form.tsx`, `components/profile/{account-form,security-form}.tsx`, `app/(auth)/login/login-form.tsx`. |
| S3 | Replace `useState(false)` in `create-user-dialog.tsx` with `useTransition` (interim; superseded by mutation.isPending in PR2) | — | Parallel to S2. May get folded into S2 if the diff overlaps. |

Test artifact: regen `/tmp/tests-cf/orgiz-wt1/` via the CLI on the WT-1 branch tip; manually
walk through the 5 forms in the browser.

### PR2 — Auth, RBAC, doctor (`feat/blueprint/improve-org-api`)

Worktree path: `/home/ttecim/.lab/create-faster/.worktrees/improve-org-api`, branched off
`feat/blueprint/improve-org-ui` **after** PR1 lands on `feat/blueprint/improve-org`.

| Subagent | Owns | Depends on | Notes |
|----------|------|------------|-------|
| S4 | Add tRPC procedures: `user.create`, `user.updateMe`, `user.changePassword`, `user.setRole`. Each wraps `auth.api.*` and lives in `packages/api/src/router/user.ts` | — | Parallel to S5. |
| S5 | Wire `permissions.ts` (statement + ac + admin/manager/viewer), update `auth.ts` to pass `ac/roles/defaultRole`. Add `permissionProcedure` middleware. Convert existing `adminProcedure`/`userProcedure` usages to `permissionProcedure(resource, action)` / `protectedProcedure` | — | Parallel to S4. |
| S6 | In the 5 forms, swap `authClient.*` calls to `trpc.*.mutate` for the 3 data-mutating ones. Add the role select in user-detail page. | S4, S5 | Sequential. |
| S7 | `/react-doctor` pass + fix surfaced regressions | S4, S5, S6 | Final. |

Test artifact: regen `/tmp/tests-cf/orgiz-wt2/` via the CLI on WT-2 tip.

### Why this split

- WT-1 and WT-2 share zero edited files at conception. WT-2 only touches form files in S6,
  by which point WT-1's syntax is committed.
- Within each worktree, the parallel subagents (S1 is solo; S2/S3 parallel; S4/S5 parallel)
  don't share files.
- Both PRs target `feat/blueprint/improve-org` and merge into it sequentially. Only PR1 →
  PR2 has a real dependency; the brancing reflects that.

## 9. Testing Strategy

| Stage | Action | Pass criteria |
|-------|--------|---------------|
| PR1 in-WT | `bun run dev:cli` → regen `/tmp/tests-cf/orgiz-wt1/` with same flags as `/tmp/tests-cf/orgiz/` | Project builds, login form renders, all forms display with shuip fields, no `useState(false)` for loading |
| PR1 merge into base | `git merge` to `feat/blueprint/improve-org` | All hbs files Handlebars-render without errors |
| PR2 in-WT | Regen `/tmp/tests-cf/orgiz-wt2/`, run end-to-end auth flow | Sign-in via authClient still works, createUser/updateUser/changePassword/setRole now hit tRPC, permission denial returns FORBIDDEN |
| Final | `/react-doctor` on `feat/blueprint/improve-org` | No new lint/a11y/perf regressions vs main |

CLI command for regen of both test artifacts will be discovered from the existing
`/tmp/tests-cf/orgiz/README.md` (and added to PR descriptions verbatim).

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `auth.api.createUser` server-side may not accept the same shape as `authClient.admin.createUser` | Verify against Better Auth admin-plugin server API in PR2 prep; adjust input schema in `user.create` accordingly |
| `useAppForm` migration breaks Zod validation flow on existing forms | Mirror the validator pattern used in `feat/multitenant-saas-blueprint`; carry over field-level error rendering verbatim |
| `permissionProcedure('user', 'create')` and `auth.api.userHasPermission` may interact awkwardly when the caller is the user themselves (e.g., `updateMe`) | `updateMe` uses `protectedProcedure` (no permission check — it's the user's own data); only admin-bound `user.*` mutations gate on permission |
| Default role = `viewer` means newly seeded users can't log into admin UI; seed/landing page must clearly differentiate | Seed script (`scripts/seed.ts`) creates one bootstrap `admin` user; README documents that newly registered users start at `viewer` |
| shadcn primitives moved out of `apps/web/src/components/ui/` may be imported elsewhere | grep for old import paths during S1, rewrite all consumers — confirm pre-merge there are zero references to `@/components/ui/*` |
| WT-2 may need to rebase on a moving WT-1 | WT-1 lands on `feat/blueprint/improve-org` first; WT-2 then branches off the merged tip — no rebase required if order is respected |

## 11. Open Questions Resolved

- ✅ `authClient` strategy → kept only for session ops (Option 3 in chat)
- ✅ Phasing → 2 PRs (A+B+E then C+D+F)
- ✅ `packages/ui` scope → shuip fields + all reusable shadcn primitives
- ✅ RBAC depth → static via Better Auth admin plugin, no organization plugin
- ✅ Roles catalog → `admin / manager / viewer`, resource = `contact`
- ✅ Test workflow → per-worktree regen at `/tmp/tests-cf/orgiz-wt{1,2}/`

## 12. Out-of-Scope Follow-Ups (Captured for Later)

- Audit log for role changes (`auth.api.setRole` invocations) — separate cycle.
- Per-route Next.js middleware gating (currently relies on tRPC + layout server checks).
- A `multitenant-saas` brother blueprint pass to align its forms on the same `useAppForm`
  pattern — separate cycle.
