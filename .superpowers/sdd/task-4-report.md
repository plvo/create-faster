# Task 4 Report: tRPC documents router + d1 RBAC middleware

## Status: COMPLETE

## Commit
`c064aad` — `feat(blueprint): cloudflare-fullstack documents tRPC router + d1 RBAC middleware`

## Files Created
- `apps/cli/templates/blueprints/cloudflare-fullstack/src/trpc/middleware/rbac.ts.hbs`
- `apps/cli/templates/blueprints/cloudflare-fullstack/src/trpc/routers/documents.ts.hbs`
- `apps/cli/templates/blueprints/cloudflare-fullstack/src/trpc/routers/_app.ts.hbs`

## Test Added
`apps/cli/tests/blueprints/cloudflare-fullstack.test.ts` — added `registers a documents router using d1 per-request auth` asserting:
- `_app.ts.hbs` contains `documents: documentsRouter`
- `rbac.ts.hbs` contains `createAuth(opts.ctx.db)` (NOT a singleton import)
- `documents.ts.hbs` contains `STORAGE.delete(doc.r2Key)`

## Test Results
- Focused suite: 5/5 pass
- Blueprint + unit: 453/453 pass
- Integration: 214/214 pass
- No failures, no stray logs

## Self-Review
- `createAuth(opts.ctx.db)` — per-request factory, not singleton. Correct for D1.
- Role-scoped `list`: admin/manager sees all, user sees own via `eq(documentTable.userId, ...)`.
- `_app.ts.hbs` keeps `hello: helloRouter` alongside `documents: documentsRouter`.
- Frontmatter carries `name: api` on all three, resolving to the `api` package in turborepo layout.
- No core code touched — pure template additions.

## Concerns
None. All constraints satisfied.
