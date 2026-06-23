## Task 9 (HITL): Admin users page

**Files:**
- Create: `.../cloudflare-fullstack/src/app/(dashboard)/admin/users/page.tsx.hbs`

**Interfaces:**
- Consumes: `authClient.admin.*` (the admin plugin client methods: `listUsers`, `setRole`, `banUser`/`unbanUser`).

- [ ] **Step 1: Write the admin users page** — a client component gated by `<Can permissions={{`{`}} user: ['list'] {{`}`}}>` (admin-only via the access-control statement). It lists users via `authClient.admin.listUsers`, lets an admin change a user's role (admin/user/manager via `authClient.admin.setRole`) and ban/unban. Use shadcn table + select; `sonner` for feedback. Wrap the body in `{{{{raw}}}}`.

- [ ] **Step 2: Also server-gate the route** in the (dashboard) layout or an `admin/layout.tsx` that calls `getAuth()` and `redirect('/')` if `session.user.role !== 'admin'` (defense in depth; the `<Can>` gate is client-only).

- [ ] **Step 3: Render + flow check** — as admin, change a user's role and observe it persist; as non-admin, the route redirects.

- [ ] **Step 4: HITL — Pelavo reviews the admin UX.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/app/\(dashboard\)/admin
git commit -m "feat(blueprint): cloudflare-fullstack admin users page"
```

---

