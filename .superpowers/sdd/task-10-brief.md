## Task 10 (HITL): Root layout glue — app-providers, home redirect, theme

**Files:**
- Create: `.../cloudflare-fullstack/src/components/app-providers.tsx.hbs` (if the base providers need overriding — see MEMORY note)
- Create/override as needed: `.../cloudflare-fullstack/src/app/page.tsx.hbs` (redirect `/` → `/login` or `/` dashboard depending on session) and `layout.tsx` only if the structural one needs blueprint changes.

**Interfaces:**
- Consumes: theme provider (`next-themes`), tanstack-query provider, trpc provider — these come from the libraries; the blueprint only composes them.

- [ ] **Step 1: Check whether `app-providers` needs an override.** Per project MEMORY (`nextjs-app-providers-empty-jsx`): the base `AppProviders` breaks with zero providers; with `next-themes` + `tanstack-query` + `trpc` selected there ARE providers, so the structural app-providers should render fine. Only add an override if generation shows an empty-JSX error. If needed, copy the structural app-providers and ensure it wraps children in the theme + query + trpc providers.

- [ ] **Step 2: Home route.** Add `src/app/page.tsx` that server-checks session via `getAuth()` and redirects: signed-in → render a short welcome / link to dashboard; signed-out → `redirect('/login')`. (Or route group `(dashboard)` owns `/` and `(auth)` owns `/login` — decide during HITL.)

- [ ] **Step 3: Render check** — cold load redirects correctly; theme toggle works.

- [ ] **Step 4: HITL — Pelavo reviews the top-level flow.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/page.tsx.hbs apps/cli/templates/blueprints/cloudflare-fullstack/src/components/app-providers.tsx.hbs
git commit -m "feat(blueprint): cloudflare-fullstack root layout glue"
```

---

