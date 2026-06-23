## Task 7 (HITL): Auth pages + (auth) layout

**Files:**
- Create: `.../cloudflare-fullstack/src/app/(auth)/layout.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/app/(auth)/login/page.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/app/(auth)/signup/page.tsx.hbs`

**Interfaces:**
- Consumes: `authClient` from `@repo/auth/auth-client`; `getAuth` from `@/lib/server`.

- [ ] **Step 1: Copy the (auth) layout from org-dashboard**, adapting the singleton `auth` to the d1 seam.
  - Source: `.../org-dashboard/src/app/(auth)/layout.tsx.hbs`.
  - Edit: replace `import { auth } from '@repo/auth/auth'` + `auth.api.getSession({ headers: await headers() })` with:
    ```ts
    import { getAuth } from '@/lib/server';
    // ...
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    ```
  - Keep the redirect-if-session and the centering `<main>`.

- [ ] **Step 2: Write `login/page.tsx`** — a client form using `authClient.signIn.email`. Use shadcn `Card`/`Input`/`Button` (from `@repo/ui/components/ui/*`) and `sonner` for errors. If org-dashboard already ships a login page (`.../org-dashboard/src/app/(auth)/login/page.tsx.hbs`), copy it verbatim (it depends only on `authClient`, which is db-agnostic) and adjust the post-login redirect to `/`.

- [ ] **Step 3: Write `signup/page.tsx`** — client form using `authClient.signUp.email` with `{ email, password, name }` (mapped to `username`). Mirror the login page styling. Redirect to `/` on success.

- [ ] **Step 4: Render check.** Generate the project (Task 14 harness) and confirm `/login` and `/signup` render and round-trip against local D1.

- [ ] **Step 5: HITL — request Pelavo's review of the auth UX.** Do not mark complete until reviewed.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/\(auth\)
git commit -m "feat(blueprint): cloudflare-fullstack auth pages"
```

---

