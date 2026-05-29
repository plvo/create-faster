# org-dashboard Blueprint Improvement — PR1 (UI Infra & Forms)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `packages/ui` with shuip TanStack Form fields, migrate the 5 forms of the `org-dashboard` blueprint to `useAppForm`, and remove `useState(false)` loading patterns.

**Architecture:** All changes happen inside a worktree dedicated to PR1 (`.worktrees/improve-org-ui` on branch `feat/blueprint/improve-org-ui`). PR2's worktree branches off the merged tip of PR1 — see `2026-05-28-org-dashboard-improve-pr2.md`.

**Tech Stack:** Handlebars `.hbs` templates rendered by the create-faster CLI, Bun, TypeScript, Next.js 15, TanStack Form (via shuip), shadcn/ui (new-york-v4, Tailwind v4).

**Reference design spec:** `docs/agents/superpowers/specs/2026-05-28-org-dashboard-blueprint-improve-design.md`

**Reference blueprint for shuip pattern:** `/home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/` (sibling git worktree on `feat/multitenant-saas-blueprint`).

---

## File Map (PR1)

### Created (in `apps/cli/templates/blueprints/org-dashboard/`)

- `packages/ui/package.json.hbs` — workspace package metadata
- `packages/ui/tsconfig.json.hbs` — TS config inheriting from `@repo/config`
- `packages/ui/src/lib/utils.ts.hbs` — `cn()` helper
- `packages/ui/src/lib/form.ts.hbs` — `useAppForm` factory wiring the field components
- `packages/ui/src/components/ui/shuip/tanstack-form/form-context.tsx.hbs` — TanStack Form contexts
- `packages/ui/src/components/ui/shuip/tanstack-form/input-field.tsx.hbs`
- `packages/ui/src/components/ui/shuip/tanstack-form/password-field.tsx.hbs`
- `packages/ui/src/components/ui/shuip/tanstack-form/select-field.tsx.hbs`
- `packages/ui/src/components/ui/shuip/tanstack-form/textarea-field.tsx.hbs`
- `packages/ui/src/components/ui/shuip/tanstack-form/checkbox-field.tsx.hbs`
- `packages/ui/src/components/ui/shuip/tanstack-form/submit-button.tsx.hbs`
- `packages/ui/src/components/ui/field.tsx.hbs` — shadcn primitive consumed by shuip fields
- `packages/ui/src/components/ui/input-group.tsx.hbs` — shadcn primitive consumed by shuip InputField
- `packages/ui/src/components/ui/label.tsx.hbs` — shadcn primitive used by Field
- `packages/ui/src/hooks/use-mobile.ts.hbs` — moved from `apps/web/src/hooks/`

### Modified (existing `.hbs` paths in the blueprint)

- `src/components/ui/dropdown-menu.tsx.hbs` — frontmatter rewritten to live at `packages/ui/src/components/ui/dropdown-menu.tsx`
- `src/components/ui/input.tsx.hbs` — moved into `packages/ui`
- `src/components/ui/separator.tsx.hbs` — moved into `packages/ui`
- `src/components/ui/sheet.tsx.hbs` — moved into `packages/ui`
- `src/components/ui/sidebar.tsx.hbs` — moved into `packages/ui`
- `src/components/ui/skeleton.tsx.hbs` — moved into `packages/ui`
- `src/components/ui/tooltip.tsx.hbs` — moved into `packages/ui`
- `src/hooks/use-mobile.ts.hbs` — frontmatter rewritten to live at `packages/ui/src/hooks/use-mobile.ts`
- `src/app/(auth)/login/login-form.tsx.hbs` — JSX rewritten to `useAppForm` (auth call unchanged)
- `src/components/admin/create-user-dialog.tsx.hbs` — JSX rewritten to `useAppForm` + `useTransition`
- `src/components/contacts/contact-form.tsx.hbs` — JSX rewritten to `useAppForm`
- `src/components/profile/account-form.tsx.hbs` — JSX rewritten to `useAppForm`
- `src/components/profile/security-form.tsx.hbs` — JSX rewritten to `useAppForm`
- `apps/cli/src/__meta__.ts` — adds `field` and `input-group` to shadcn registry if not already wired

### Out of scope for PR1

- Any change to `authClient.*` call sites (PR2)
- Any change to tRPC routers (PR2)
- Any RBAC / permissions wiring (PR2)

---

## Pre-flight

- [ ] **Pre-step 1: Confirm baseline regen command for the test artifact**

Read `/tmp/tests-cf/orgiz/README.md`. The README does not embed a "Recreate this project" command (verified during planning). Reconstruct the command from the blueprint's META and from the existing project layout (2 apps, postgres, drizzle, husky, biome, bun, git). The canonical regen command is:

```bash
bunx create-faster orgiz-wt1 --blueprint org-dashboard --pm bun --git
```

If a flag is missing the CLI will prompt — answer them to mirror `/tmp/tests-cf/orgiz/` (biome linter, husky tooling). Record the exact final command at the top of the PR1 description.

- [ ] **Pre-step 2: Confirm worktree base is up-to-date**

Run inside `/home/ttecim/.lab/create-faster/.worktrees/main`:

```bash
git status
git log --oneline -1
```

Expected: branch `feat/blueprint/improve-org` at commit `0d8a2f1` (the design spec commit). If there are uncommitted changes outside `apps/cli/templates/blueprints/org-dashboard/src/app/(dashboard)/admin/users/[id]/user-detail.tsx.hbs` (a pre-existing user modification), stop and ask Pelavo.

---

## Task 1: Create the WT-1 worktree

**Files:**
- Create: `.worktrees/improve-org-ui/` (new git worktree)

- [ ] **Step 1: Create worktree from `feat/blueprint/improve-org` tip**

```bash
cd /home/ttecim/.lab/create-faster
git worktree add /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui -b feat/blueprint/improve-org-ui feat/blueprint/improve-org
```

Expected output: `Preparing worktree (new branch 'feat/blueprint/improve-org-ui')` then `HEAD is now at 0d8a2f1`.

- [ ] **Step 2: Verify worktree state**

```bash
git -C /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui status
git -C /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui log --oneline -1
```

Expected: clean status, on `feat/blueprint/improve-org-ui`, HEAD at `0d8a2f1`.

- [ ] **Step 3: Install deps in worktree (links to root node_modules via Bun workspace; usually fast)**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui
bun install
```

Expected: no errors.

- [ ] **Step 4: No commit yet — worktree creation is not a code change.**

All remaining tasks operate inside `/home/ttecim/.lab/create-faster/.worktrees/improve-org-ui`. Use absolute paths.

---

## Task 2: Create `packages/ui` workspace skeleton

**Files:**
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/package.json.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/tsconfig.json.hbs`

- [ ] **Step 1: Verify reference exists**

```bash
ls /home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/
```

Expected output includes `package.json.hbs`, `tsconfig.json.hbs`, `src/`.

- [ ] **Step 2: Read the reference `package.json.hbs` to copy exports/deps verbatim**

```bash
cat /home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/package.json.hbs
```

Note the exports map, the dependencies (`@tanstack/react-form`, `lucide-react`, `tailwind-variants`, `class-variance-authority`, `clsx`, `tailwind-merge`, etc.), and the frontmatter.

- [ ] **Step 3: Write the new file**

Path: `apps/cli/templates/blueprints/org-dashboard/packages/ui/package.json.hbs`

Use the *exact* content of `multitenant-saas/packages/ui/package.json.hbs`. Do not edit (the package is named `@repo/ui` in both blueprints; the deps required are the same).

- [ ] **Step 4: Same for `tsconfig.json.hbs`**

```bash
cat /home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/tsconfig.json.hbs
```

Copy verbatim into `apps/cli/templates/blueprints/org-dashboard/packages/ui/tsconfig.json.hbs`.

- [ ] **Step 5: Commit**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui
git add apps/cli/templates/blueprints/org-dashboard/packages/ui/package.json.hbs apps/cli/templates/blueprints/org-dashboard/packages/ui/tsconfig.json.hbs
git commit -m "feat(blueprint/org-dashboard): scaffold packages/ui workspace"
```

---

## Task 3: Create `packages/ui/src/lib/utils.ts` and `lib/form.ts`

**Files:**
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/lib/utils.ts.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/lib/form.ts.hbs`

- [ ] **Step 1: Copy `utils.ts.hbs` verbatim from reference**

```bash
cp /home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/src/lib/utils.ts.hbs \
   /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/lib/utils.ts.hbs
```

The reference defines the standard `cn(...inputs)` shadcn helper (clsx + tailwind-merge).

- [ ] **Step 2: Copy `form.ts.hbs` verbatim from reference**

Reference content:

```hbs
---
mono:
  scope: pkg
  name: ui
  path: src/lib/form.ts
---
{{{{raw}}}}
import { createFormHook } from '@tanstack/react-form';
import { CheckboxField } from '@repo/ui/components/ui/shuip/tanstack-form/checkbox-field';
import { fieldContext, formContext } from '@repo/ui/components/ui/shuip/tanstack-form/form-context';
import { InputField } from '@repo/ui/components/ui/shuip/tanstack-form/input-field';
import { PasswordField } from '@repo/ui/components/ui/shuip/tanstack-form/password-field';
import { SelectField } from '@repo/ui/components/ui/shuip/tanstack-form/select-field';
import { SubmitButton } from '@repo/ui/components/ui/shuip/tanstack-form/submit-button';
import { TextareaField } from '@repo/ui/components/ui/shuip/tanstack-form/textarea-field';

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { InputField, PasswordField, SelectField, TextareaField, CheckboxField },
  formComponents: { SubmitButton },
});
{{{{/raw}}}}
```

Write this content into `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/lib/form.ts.hbs`.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/ui/src/lib/
git commit -m "feat(blueprint/org-dashboard): add packages/ui useAppForm factory"
```

---

## Task 4: Create shuip TanStack Form field components

**Files:**
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/form-context.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/input-field.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/password-field.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/select-field.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/textarea-field.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/checkbox-field.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/submit-button.tsx.hbs`

- [ ] **Step 1: Bulk copy all 7 shuip files from the reference**

```bash
mkdir -p /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form
cp /home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/src/components/ui/shuip/tanstack-form/*.hbs \
   /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/
```

- [ ] **Step 2: Sanity check the copied set**

```bash
ls /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/
```

Expected output: `checkbox-field.tsx.hbs  form-context.tsx.hbs  input-field.tsx.hbs  password-field.tsx.hbs  select-field.tsx.hbs  submit-button.tsx.hbs  textarea-field.tsx.hbs`.

- [ ] **Step 3: Verify imports inside each file point to `@repo/ui/components/ui/...`**

```bash
grep -rE "@repo/ui|from '@/" /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/tanstack-form/
```

Expected: every import begins with `@repo/ui/...`. None should reference `@/components/ui` (which is the app alias). If any references slip through, edit those lines manually so they remain in the package alias.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/shuip/
git commit -m "feat(blueprint/org-dashboard): add shuip TanStack Form field components"
```

---

## Task 5: Add base shadcn primitives that shuip fields depend on

The shuip input-field imports `field`, `input-group`, and `tooltip`. `tooltip` already exists in the org-dashboard blueprint (in `src/components/ui/tooltip.tsx.hbs`); `field` and `input-group` do not. They must be brought into `packages/ui` from the reference.

**Files:**
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/field.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/input-group.tsx.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/label.tsx.hbs`

- [ ] **Step 1: Discover which primitive files exist in the reference under `packages/ui/src/components/ui/`**

```bash
ls /home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/src/components/ui/
```

Confirm `field.tsx.hbs`, `input-group.tsx.hbs`, `label.tsx.hbs` exist (they should).

- [ ] **Step 2: Copy the three primitives into the WT-1 package**

```bash
for f in field.tsx.hbs input-group.tsx.hbs label.tsx.hbs; do
  cp "/home/ttecim/.lab/create-faster/apps/cli/templates/blueprints/multitenant-saas/packages/ui/src/components/ui/$f" \
     "/home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/$f"
done
```

- [ ] **Step 3: Verify each file has the correct monorepo frontmatter mapping**

```bash
head -6 /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/{field,input-group,label}.tsx.hbs
```

Each file's frontmatter should resolve to `packages/ui/src/components/ui/<name>.tsx` via `mono: { scope: pkg, name: ui, path: src/components/ui/<name>.tsx }`. The reference files already declare this; the copy is verbatim, no edits required.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui/{field,input-group,label}.tsx.hbs
git commit -m "feat(blueprint/org-dashboard): add field/input-group/label primitives to packages/ui"
```

---

## Task 6: Move existing shadcn primitives into `packages/ui`

The blueprint currently has shadcn primitives under `src/components/ui/`. The frontmatter of each redirects to `apps/web/src/components/ui/<name>.tsx` (app scope). We rewrite frontmatter and physically relocate the `.hbs` files into the `packages/ui/` blueprint subtree.

**Files (rewrite frontmatter + move):**
- `src/components/ui/dropdown-menu.tsx.hbs` → `packages/ui/src/components/ui/dropdown-menu.tsx.hbs`
- `src/components/ui/input.tsx.hbs` → `packages/ui/src/components/ui/input.tsx.hbs`
- `src/components/ui/separator.tsx.hbs` → `packages/ui/src/components/ui/separator.tsx.hbs`
- `src/components/ui/sheet.tsx.hbs` → `packages/ui/src/components/ui/sheet.tsx.hbs`
- `src/components/ui/sidebar.tsx.hbs` → `packages/ui/src/components/ui/sidebar.tsx.hbs`
- `src/components/ui/skeleton.tsx.hbs` → `packages/ui/src/components/ui/skeleton.tsx.hbs`
- `src/components/ui/tooltip.tsx.hbs` → `packages/ui/src/components/ui/tooltip.tsx.hbs`

- [ ] **Step 1: For each file, replace the frontmatter block**

The current frontmatter looks roughly like:

```yaml
---
path: src/components/ui/<name>.tsx
mono:
  scope: app
  path: src/components/ui/<name>.tsx
---
```

Rewrite it to:

```yaml
---
mono:
  scope: pkg
  name: ui
  path: src/components/ui/<name>.tsx
only: mono
---
```

The `only: mono` directive opts the file out of single-repo generations (the blueprint is mono-only anyway, but explicit is better).

- [ ] **Step 2: Move each file physically (git mv keeps history)**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard
for f in dropdown-menu input separator sheet sidebar skeleton tooltip; do
  git mv "src/components/ui/$f.tsx.hbs" "packages/ui/src/components/ui/$f.tsx.hbs"
done
```

- [ ] **Step 3: Replace `path:` / `mono.scope: app` headers**

After the move, each file still has the old frontmatter. Edit each to match the canonical form shown in Step 1.

- [ ] **Step 4: Audit consumer imports inside the blueprint**

The shuip InputField imports `@repo/ui/components/ui/tooltip` — already correct. But the *app* components (sidebar, navigation, dialogs) might import these primitives via `@/components/ui/<name>` (app alias) instead of `@repo/ui/components/ui/<name>`. Find any remaining occurrences:

```bash
grep -rE "@/components/ui/(dropdown-menu|input|separator|sheet|sidebar|skeleton|tooltip)" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/
```

For every match, change `@/components/ui/...` → `@repo/ui/components/ui/...`.

- [ ] **Step 5: Verify nothing else references the moved files**

```bash
grep -rE "from ['\"]@/components/ui/" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/
```

Expected: no output (every UI primitive import now lives in `@repo/ui`).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/packages/ui/src/components/ui apps/cli/templates/blueprints/org-dashboard/src/
git commit -m "refactor(blueprint/org-dashboard): move shadcn primitives into packages/ui"
```

---

## Task 7: Move `use-mobile` hook into `packages/ui`

**Files:**
- Move: `src/hooks/use-mobile.ts.hbs` → `packages/ui/src/hooks/use-mobile.ts.hbs`

- [ ] **Step 1: Move the file**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard
git mv src/hooks/use-mobile.ts.hbs packages/ui/src/hooks/use-mobile.ts.hbs
```

- [ ] **Step 2: Rewrite frontmatter**

Old:
```yaml
---
mono:
  scope: app
  path: src/hooks/use-mobile.ts
---
```

New:
```yaml
---
mono:
  scope: pkg
  name: ui
  path: src/hooks/use-mobile.ts
only: mono
---
```

- [ ] **Step 3: Update consumers**

```bash
grep -rE "from ['\"]@/hooks/use-mobile" \
  /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/
```

Replace each match with `from '@repo/ui/hooks/use-mobile'`. The `sidebar.tsx` from the moved primitives may also reference it — confirm those imports are correct after the move.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/
git commit -m "refactor(blueprint/org-dashboard): relocate use-mobile to packages/ui"
```

---

## Task 8: Mid-PR1 regen sanity check (no form changes yet)

Validate that the structural shifts (packages/ui scaffold + primitives moves) still produce a buildable project before tackling form migrations.

- [ ] **Step 1: Build the CLI from the worktree**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui
bun run build:cli
```

Expected: emits `create-faster` executable in `apps/cli/` with no errors.

- [ ] **Step 2: Regen the test project**

```bash
rm -rf /tmp/tests-cf/orgiz-wt1
cd /tmp/tests-cf
/home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/create-faster orgiz-wt1 --blueprint org-dashboard --pm bun --git
```

Answer any remaining prompts to match `orgiz/` (biome + husky if asked).

- [ ] **Step 3: Verify project structure**

```bash
ls /tmp/tests-cf/orgiz-wt1/packages/
ls /tmp/tests-cf/orgiz-wt1/packages/ui/src/components/ui/shuip/tanstack-form/
ls /tmp/tests-cf/orgiz-wt1/apps/web/src/components/ui/ 2>/dev/null || echo "OK: ui/ moved out of apps/web"
```

Expected: `packages/ui/` contains the 7 shuip files + the primitives. `apps/web/src/components/ui/` is gone (or empty).

- [ ] **Step 4: Confirm typecheck still passes**

```bash
cd /tmp/tests-cf/orgiz-wt1
bun install
bun run check
```

Expected: no errors. If lint fails on the moved primitives, the issue is usually import-alias drift caught in earlier tasks — go back and re-run the `grep` checks in Task 6 Step 4.

- [ ] **Step 5: No commit (sanity-check task, no template changes here).**

---

## Task 9: Migrate `login-form.tsx.hbs` to `useAppForm`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/app/(auth)/login/login-form.tsx.hbs`

**Important:** This task ONLY refactors the JSX/state to `useAppForm`. The `authClient.signIn.email` call inside `onSubmit` stays — sign-in is a session op and kept on `authClient` per design spec §6.

- [ ] **Step 1: Read the current file**

```bash
cat /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/app/(auth)/login/login-form.tsx.hbs
```

Note the existing schema, the `authClient.signIn.email({ email, password })` call, and the error toasts. Preserve these.

- [ ] **Step 2: Rewrite the file**

Path: `apps/cli/templates/blueprints/org-dashboard/src/app/(auth)/login/login-form.tsx.hbs`

```hbs
---
mono:
  scope: app
  path: src/app/(auth)/login/login-form.tsx
---
{{{{raw}}}}
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { z } from 'zod';
import { authClient } from '@/lib/auth/auth-client';
import { useAppForm } from '@repo/ui/lib/form';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Min. 8 characters'),
});

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('redirectTo') ?? '/';

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const result = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });
      if (result.error) {
        toast.error(result.error.message ?? 'Sign-in failed');
        return;
      }
      router.push(redirectTo);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className='flex flex-col gap-4'
    >
      <form.AppField
        name='email'
        children={(f) => <f.InputField label='Email' props={{ type: 'email', autoComplete: 'email' }} />}
      />
      <form.AppField
        name='password'
        children={(f) => <f.PasswordField label='Password' props={{ autoComplete: 'current-password' }} />}
      />
      <form.AppForm>
        <form.SubmitButton className='w-full'>Sign in</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/app/(auth)/login/login-form.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): migrate login-form to useAppForm"
```

---

## Task 10: Migrate `create-user-dialog.tsx.hbs` to `useAppForm` + `useTransition`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs`

**Important:** The `authClient.admin.createUser(...)` call is preserved — PR2 swaps it for a tRPC mutation. The `useState(false)` loading flag is replaced with `useTransition`.

- [ ] **Step 1: Read the current file to capture the schema and call shape**

```bash
cat /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs
```

Note: the dialog uses native `<dialog>`. Keep it (or migrate to `@repo/ui/components/ui/dialog` if the existing dialog primitive exists — verify with `ls`).

- [ ] **Step 2: Rewrite the file**

Path: `apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs`

```hbs
---
mono:
  scope: app
  path: src/components/admin/create-user-dialog.tsx
---
{{{{raw}}}}
'use client';

import { useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { authClient } from '@/lib/auth/auth-client';
import { useTRPC } from '@/trpc/client';
import { Button } from '@repo/ui/components/ui/button';
import { useAppForm } from '@repo/ui/lib/form';

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Min. 8 characters'),
  role: z.enum(['admin', 'user']),
});

export function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '', role: 'user' as const },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
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
    },
  });

  if (!open) return null;

  return (
    <dialog open className='fixed inset-0 z-50 m-auto rounded-md border bg-background p-6 shadow-lg'>
      <h2 className='mb-4 text-lg font-semibold'>Create user</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className='flex flex-col gap-3'
      >
        <form.AppField name='name' children={(f) => <f.InputField label='Name' />} />
        <form.AppField name='email' children={(f) => <f.InputField label='Email' props={{ type: 'email' }} />} />
        <form.AppField name='password' children={(f) => <f.PasswordField label='Password' />} />
        <form.AppField
          name='role'
          children={(f) => (
            <f.SelectField
              label='Role'
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
          )}
        />
        <div className='mt-2 flex justify-end gap-2'>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton disabled={isPending}>{isPending ? 'Creating...' : 'Create'}</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </dialog>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 3: Confirm the file no longer contains any `useState`**

```bash
grep -n "useState" /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs || echo "OK: no useState"
```

Expected: `OK: no useState`.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/admin/create-user-dialog.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): migrate create-user-dialog to useAppForm + useTransition"
```

---

## Task 11: Migrate `contact-form.tsx.hbs` to `useAppForm`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/contacts/contact-form.tsx.hbs`

**Important:** This form already calls `trpc.contact.{create,update}.mutate` (no `authClient`). Migration is JSX-only. React Query's `isPending` already drives the submit button — no `useState` to remove.

- [ ] **Step 1: Read the current file**

```bash
cat /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/templates/blueprints/org-dashboard/src/components/contacts/contact-form.tsx.hbs
```

Note: the form has both create and edit modes (likely a `contact?: Contact` prop). Preserve the discriminator.

- [ ] **Step 2: Rewrite**

Path: `apps/cli/templates/blueprints/org-dashboard/src/components/contacts/contact-form.tsx.hbs`

```hbs
---
mono:
  scope: app
  path: src/components/contacts/contact-form.tsx
---
{{{{raw}}}}
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { useTRPC } from '@/trpc/client';
import { useAppForm } from '@repo/ui/lib/form';
import type { RouterOutput } from '@repo/api';

type Contact = RouterOutput['contact']['list'][number];

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email').or(z.literal('')),
  phone: z.string().or(z.literal('')),
  company: z.string().or(z.literal('')),
  notes: z.string().or(z.literal('')),
});

export function ContactForm({ contact, onDone }: { contact?: Contact; onDone?: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const create = useMutation(
    trpc.contact.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.contact.list.queryFilter());
        queryClient.invalidateQueries(trpc.contact.count.queryFilter());
        toast.success('Contact created');
        onDone?.();
      },
    }),
  );
  const update = useMutation(
    trpc.contact.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.contact.list.queryFilter());
        toast.success('Contact updated');
        onDone?.();
      },
    }),
  );
  const mutation = contact ? update : create;

  const form = useAppForm({
    defaultValues: {
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      company: contact?.company ?? '',
      notes: contact?.notes ?? '',
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      if (contact) {
        await update.mutateAsync({ id: contact.id, ...value });
      } else {
        await create.mutateAsync(value);
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className='flex flex-col gap-3'
    >
      <div className='grid grid-cols-2 gap-3'>
        <form.AppField name='firstName' children={(f) => <f.InputField label='First name' />} />
        <form.AppField name='lastName' children={(f) => <f.InputField label='Last name' />} />
      </div>
      <form.AppField name='email' children={(f) => <f.InputField label='Email' props={{ type: 'email' }} />} />
      <form.AppField name='phone' children={(f) => <f.InputField label='Phone' />} />
      <form.AppField name='company' children={(f) => <f.InputField label='Company' />} />
      <form.AppField name='notes' children={(f) => <f.TextareaField label='Notes' />} />
      <form.AppForm>
        <form.SubmitButton disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving...' : contact ? 'Save changes' : 'Create contact'}
        </form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
{{{{/raw}}}}
```

> **Note about `useMutation` import**: the existing file imports it from `@tanstack/react-query`. Preserve that import — add `import { useMutation } from '@tanstack/react-query';` at the top of the imports block.

- [ ] **Step 3: Re-add the missing `useMutation` import to the imports block**

The skeleton above intentionally omits the import to highlight the dependency. Edit the top of the file so the final import block reads:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { useTRPC } from '@/trpc/client';
import { useAppForm } from '@repo/ui/lib/form';
import type { RouterOutput } from '@repo/api';
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/contacts/contact-form.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): migrate contact-form to useAppForm"
```

---

## Task 12: Migrate `account-form.tsx.hbs` to `useAppForm`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/profile/account-form.tsx.hbs`

**Important:** Preserve the existing `authClient.updateUser` call — PR2 swaps it.

- [ ] **Step 1: Rewrite**

Path: `apps/cli/templates/blueprints/org-dashboard/src/components/profile/account-form.tsx.hbs`

```hbs
---
mono:
  scope: app
  path: src/components/profile/account-form.tsx
---
{{{{raw}}}}
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { z } from 'zod';
import { authClient } from '@/lib/auth/auth-client';
import { useAppForm } from '@repo/ui/lib/form';

const schema = z.object({
  name: z.string().min(1, 'Display name required').max(64),
});

export function AccountForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useAppForm({
    defaultValues: { name: initialName },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await new Promise<void>((resolve) => {
        startTransition(async () => {
          const result = await authClient.updateUser({ name: value.name });
          if (result.error) {
            toast.error(result.error.message ?? 'Update failed');
            resolve();
            return;
          }
          toast.success('Profile updated');
          router.refresh();
          resolve();
        });
      });
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
        <form.SubmitButton disabled={isPending}>{isPending ? 'Saving...' : 'Save'}</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/profile/account-form.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): migrate account-form to useAppForm"
```

---

## Task 13: Migrate `security-form.tsx.hbs` to `useAppForm`

**Files:**
- Modify: `apps/cli/templates/blueprints/org-dashboard/src/components/profile/security-form.tsx.hbs`

**Important:** Preserve the `authClient.changePassword` call — PR2 swaps it.

- [ ] **Step 1: Rewrite**

Path: `apps/cli/templates/blueprints/org-dashboard/src/components/profile/security-form.tsx.hbs`

```hbs
---
mono:
  scope: app
  path: src/components/profile/security-form.tsx
---
{{{{raw}}}}
'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { authClient } from '@/lib/auth/auth-client';
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
  const [isPending, startTransition] = useTransition();

  const form = useAppForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    validators: { onChange: schema },
    onSubmit: async ({ value, formApi }) => {
      await new Promise<void>((resolve) => {
        startTransition(async () => {
          const result = await authClient.changePassword({
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
            revokeOtherSessions: true,
          });
          if (result.error) {
            toast.error(result.error.message ?? 'Password change failed');
            resolve();
            return;
          }
          toast.success('Password updated — other sessions signed out');
          formApi.reset();
          resolve();
        });
      });
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
        <form.SubmitButton disabled={isPending}>{isPending ? 'Updating...' : 'Update password'}</form.SubmitButton>
      </form.AppForm>
    </form>
  );
}
{{{{/raw}}}}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/org-dashboard/src/components/profile/security-form.tsx.hbs
git commit -m "refactor(blueprint/org-dashboard): migrate security-form to useAppForm"
```

---

## Task 14: Final regen + integration check

- [ ] **Step 1: Rebuild the CLI**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui
bun run build:cli
```

- [ ] **Step 2: Regen the test project from scratch**

```bash
rm -rf /tmp/tests-cf/orgiz-wt1
cd /tmp/tests-cf
/home/ttecim/.lab/create-faster/.worktrees/improve-org-ui/apps/cli/create-faster orgiz-wt1 --blueprint org-dashboard --pm bun --git
```

- [ ] **Step 3: Install + typecheck + lint**

```bash
cd /tmp/tests-cf/orgiz-wt1
bun install
bun run check
```

Expected: no type errors, no lint errors. If a Better Auth or Zod type bumps because the migrated forms changed their inferred types, accept the trade-off and verify the runtime still works in Step 4.

- [ ] **Step 4: Smoke test in the browser**

```bash
cd /tmp/tests-cf/orgiz-wt1
docker compose up -d   # Postgres
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env
cp packages/auth/.env.example packages/auth/.env
cp apps/batch/.env.example apps/batch/.env
bun run db:push
bun run db:seed
bun run dev --filter=web
```

Then in the browser at http://localhost:3000:
- `/login` — submit valid / invalid creds, verify errors render via FieldError
- Sign in as the seeded admin
- `/admin/users` — open "Create user" dialog, validation messages appear, button shows "Creating..." during transition
- `/admin/contacts` — open new contact, edit existing contact, both submit through tRPC mutations and invalidate the list
- `/profile/account` — change name, toast confirms
- `/profile/security` — change password, toast confirms, other sessions logged out

If any of these fail, fix the underlying issue in the appropriate task before opening the PR.

- [ ] **Step 5: No commit (verification only).**

---

## Task 15: Open PR1

- [ ] **Step 1: Push branch**

```bash
cd /home/ttecim/.lab/create-faster/.worktrees/improve-org-ui
git push -u origin feat/blueprint/improve-org-ui
```

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create \
  --base feat/blueprint/improve-org \
  --head feat/blueprint/improve-org-ui \
  --title "feat(blueprint/org-dashboard): packages/ui + shuip forms migration" \
  --body "$(cat <<'EOF'
## Summary
- Introduces `packages/ui` with shuip TanStack Form field components (input, password, select, textarea, checkbox, submit button) and the `useAppForm` factory.
- Moves all reusable shadcn primitives (button, input, dropdown-menu, separator, sheet, sidebar, skeleton, tooltip, field, input-group, label) out of `apps/web/src/components/ui/` and into `packages/ui/src/components/ui/`.
- Migrates the 5 forms (login, create-user-dialog, contact, account, security) to `useAppForm` + `<form.AppField>` patterns.
- Replaces the lone `useState(false)` loading flag in create-user-dialog with `useTransition`.

## Out of scope (handled in PR2)
- `authClient.admin.createUser` / `authClient.updateUser` / `authClient.changePassword` → tRPC mutations
- RBAC via Better Auth admin plugin custom roles
- react-doctor pass

## Test plan
- [x] Regen `/tmp/tests-cf/orgiz-wt1/` via `bunx create-faster orgiz-wt1 --blueprint org-dashboard --pm bun --git`
- [x] `bun install && bun run check` passes in the generated project
- [x] Browser smoke: login, create user, contact CRUD, account update, password change

Design spec: `docs/agents/superpowers/specs/2026-05-28-org-dashboard-blueprint-improve-design.md`
Plan: `docs/agents/superpowers/plans/2026-05-28-org-dashboard-improve-pr1.md`
EOF
)"
```

- [ ] **Step 3: Wait for review + merge.** Once merged into `feat/blueprint/improve-org`, hand off to PR2 plan (`2026-05-28-org-dashboard-improve-pr2.md`).
