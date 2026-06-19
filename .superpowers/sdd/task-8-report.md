# Task 8 Report: Dashboard + Documents UI

## Status: DONE

## Commit
`986b4e1 feat(blueprint): cloudflare-fullstack dashboard + documents UI`

## Files created
- `src/components/can.tsx.hbs` — copied verbatim from org-dashboard (raw block preserved)
- `src/hooks/use-permission.ts.hbs` — copied verbatim from org-dashboard (raw block preserved)
- `src/app/(dashboard)/layout.tsx.hbs` — adapted from org-dashboard: replaced singleton `auth` with `getAuth()` per-request seam; replaced heavy AppSidebar/AppHeader with minimal top `<header>` (project name, Profile link, sign-out `<a href="/api/auth/sign-out">`)
- `src/app/(dashboard)/page.tsx.hbs` — written from scratch: client component inside `{{{{raw}}}}` block; `useSuspenseQuery(trpc.documents.list)` + FormData upload to `/api/documents/upload` + `trpc.documents.delete` mutation; `<Can permissions={{ document: ['create'] }}>` guards upload form; `<Can permissions={{ document: ['delete'] }}>` guards delete button; sonner toasts
- `src/app/(dashboard)/profile/page.tsx.hbs` — written from scratch: client component, `authClient.useSession()`, shows name/email/role

## Test summary
14/14 pass — 5 new assertions added covering: can.tsx + use-permission.ts existence and key content, dashboard layout getAuth seam, documents page tRPC references and raw block, profile page useSession.

## Concerns / assumptions
- **Sign-out**: used `<a href="/api/auth/sign-out">` (better-auth's built-in GET endpoint) to avoid a `'use client'` component in the server layout. Avoids `authClient.signOut()` at the layout level, which is fine for a starter.
- **tRPC client pattern**: matched org-dashboard exactly — `useTRPC()` from `@/trpc/providers` + `@tanstack/react-query` hooks (`useSuspenseQuery`, `useMutation`, `useQueryClient`, `trpc.documents.list.queryOptions()`, `trpc.documents.list.queryFilter()`).
- **`{{projectName}}` in layout**: placed outside any `{{{{raw}}}}` block (the layout has no JSX `{{ }}` literals), so Handlebars processes it correctly.
- `can.tsx` and `use-permission.ts` are 100% verbatim copies from org-dashboard.
