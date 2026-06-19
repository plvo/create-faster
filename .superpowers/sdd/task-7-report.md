# Task 7 Report: Auth pages + (auth) layout

## Status
Complete. All tests pass.

## Commit
`4672794` — `feat(blueprint): cloudflare-fullstack auth pages`

## Files created
- `src/app/(auth)/layout.tsx.hbs` — Adapted from org-dashboard; replaces singleton `import { auth }` with per-request `getAuth()` from `@/lib/server`. Redirects to `/` when session exists. Centers children with `min-h-screen` flexbox.
- `src/app/(auth)/login/page.tsx.hbs` — Thin wrapper rendering `LoginForm` inside a shadcn `Card`. Copied from org-dashboard verbatim (db-agnostic).
- `src/app/(auth)/login/login-form.tsx.hbs` — Client form using `authClient.signIn.email`. Copied from org-dashboard verbatim. Uses `useAppForm` + `sonner` toast. `{{{{raw}}}}` block preserves JSX. Frontmatter: `mono: { scope: app, path: src/app/(auth)/login/login-form.tsx }`.
- `src/app/(auth)/signup/page.tsx.hbs` — Thin wrapper rendering `SignupForm` inside a shadcn `Card`. Written from scratch (org-dashboard has no signup page).
- `src/app/(auth)/signup/signup-form.tsx.hbs` — Client form using `authClient.signUp.email({ name, email, password })`. Written from scratch mirroring login-form. `{{{{raw}}}}` block. Frontmatter: `mono: { scope: app, path: src/app/(auth)/signup/signup-form.tsx }`.

## Test summary
10/10 tests pass (cloudflare-fullstack.test.ts). Three new test cases added:
- `(auth) layout uses getAuth per-request seam` — asserts `getAuth` import, no singleton, correct call chain.
- `ships login and signup pages` — asserts both page files exist and export their form components.
- `login-form and signup-form use authClient (db-agnostic)` — asserts `signIn.email`/`signUp.email` and no singleton auth import.

## Concerns
- **Signup page written from scratch**: org-dashboard ships only a `login/` page (no `signup/`). The signup-form was written from scratch mirroring login-form's style and conventions. Logic is minimal and correct per task spec.
- The login-form carries a `redirectTo` query-param redirect (preserved from org-dashboard). The signup-form redirects unconditionally to `/` per the task spec.
