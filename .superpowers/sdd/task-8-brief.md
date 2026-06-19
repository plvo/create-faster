## Task 8 (HITL): Dashboard layout, navigation, documents pages, permission gate

**Files:**
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/layout.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/page.tsx.hbs` (documents list + upload)
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/profile/page.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/components/can.tsx.hbs`
- Create: `.../cloudflare-fullstack/src/hooks/use-permission.ts.hbs`
- Create: navigation components under `.../src/components/navigation/` (sidebar + header) OR a simpler header — see Step 2.

**Interfaces:**
- Consumes: `authClient`, `AppRole` from `@repo/auth/*`; tRPC client (`documents.list`, `documents.delete`); `POST /api/documents/upload`.

- [ ] **Step 1: Copy `can.tsx` and `use-permission.ts` from org-dashboard verbatim** (`.../org-dashboard/src/components/can.tsx.hbs`, `.../src/hooks/use-permission.ts.hbs`). They are db-agnostic (depend on `authClient`/`AppRole`). Keep the `{{{{raw}}}}` blocks.

- [ ] **Step 2: Copy the (dashboard) layout from org-dashboard**, adapting auth to the d1 seam (same edit as Task 7 Step 1: `getAuth()` instead of singleton `auth`). If org-dashboard's sidebar/header navigation components are heavy, replace the `<AppSidebar/>`+`<AppHeader/>` with a minimal top `<header>` containing the app name, a theme toggle, a `/profile` link, and a sign-out button (`authClient.signOut`). Keep it simple — this is a starter.

- [ ] **Step 3: Write the documents page (`(dashboard)/page.tsx`)** — a client component that:
  - lists documents via tRPC `documents.list` + TanStack Query;
  - has an upload form (`<input type="file">` + title) POSTing `FormData` to `/api/documents/upload`, then invalidating the list query;
  - each row shows title/size/created and a delete button calling tRPC `documents.delete`;
  - wraps the upload control in `<Can permissions={{`{`}} document: ['create'] {{`}`}}>` and the delete button in `<Can permissions={{`{`}} document: ['delete'] {{`}`}}>`.
  - Use `sonner` toasts for success/error.

  > Handlebars note: the `permissions={{ document: [...] }}` JSX object literal MUST be inside a `{{{{raw}}}}...{{{{/raw}}}}` block (whole component body), exactly like org-dashboard client components.

- [ ] **Step 4: Write `profile/page.tsx`** — shows the current user (`authClient.useSession`) and role; a minimal read-only profile card.

- [ ] **Step 5: Render + flow check** via the Task 14 harness: upload a file (lands in local R2), it appears in the list, delete removes it (D1 + R2).

- [ ] **Step 6: HITL — Pelavo reviews dashboard/documents UX.**

- [ ] **Step 7: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/\(dashboard\) apps/cli/templates/blueprints/cloudflare-fullstack/src/components apps/cli/templates/blueprints/cloudflare-fullstack/src/hooks
git commit -m "feat(blueprint): cloudflare-fullstack dashboard + documents UI"
```

---

