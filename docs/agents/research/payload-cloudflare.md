# Payload CMS on Cloudflare Workers research

Findings for a blueprint that ships Payload CMS on Cloudflare Workers (D1 for the database, R2 for media). Sources: the npm registry, the source of the published packages, the Payload and Cloudflare docs and issue trackers, and a production Payload 3.90 site on Workers built from the `cloudflare-fullstack-nextjs` blueprint. Read on 2026-10-21. **[V]** means checked in source, docs or the registry; **[I]** means inferred.

## 1. Next.js or TanStack Start

- **Payload 3.x supports Next.js only.** TanStack Start support exists in Payload 4.0 beta only (`v4.0.0-beta.0`, 2026-10-09; `@payloadcms/tanstack-start@4.0.0-beta.3`, peers `@tanstack/react-start ^1.169.1`, `@vitejs/plugin-rsc ^0.5.21`, `vite >=8`) [V]. Its npm `latest` tag points to that beta, so a plain install of the package does not match `payload@3.x` [V].
- **No Workers path for TanStack Start.** The only TanStack template (`templates/blank-tanstack` on `main`) uses MongoDB and serves on Node with `srvx`; nothing in the Payload repo uses `@cloudflare/vite-plugin` [V]. A maintainer on [payload#16470](https://github.com/payloadcms/payload/issues/16470) (2026-09-09): "My goal is to continue to work on Cloudflare compatibility as we roll through v4 beta. No hard date" [V].
- **The Local API does not build outside the Next.js/OpenNext bundle** ([payload#16646](https://github.com/payloadcms/payload/issues/16646), open: `file-type`'s `fileTypeFromFile`, then `node:tty`) [V]. A TanStack Start frontend could only read Payload over REST (`@payloadcms/sdk`, beta, accepts a custom `fetch`, so a service binding should fit [I]). GraphQL on Workers is not guaranteed ([payload#17771](https://github.com/payloadcms/payload/issues/17771), [workerd#5175](https://github.com/cloudflare/workerd/issues/5175)) [V].
- **vinext does not run the Payload admin** ([vinext#3177](https://github.com/cloudflare/vinext/issues/3177): 500, `drizzle-kit/api` imported at runtime) [V].
- **Cloudflare's own recommendation** is Payload's `with-cloudflare-d1` template on OpenNext ([blog, 2025-09-30](https://blog.cloudflare.com/payload-cms-workers/)); `cloudflare/templates` has no Payload template [V].

**Decision: Next.js through OpenNext, Payload 3.x.** A TanStack Start variant (`extends`) waits for Payload 4 stable with a Workers path.

## 2. Versions (npm, 2026-10-21) [V]

| Package | Version |
|---|---|
| `payload`, `@payloadcms/next`, `@payloadcms/db-d1-sqlite`, `@payloadcms/storage-r2`, `@payloadcms/richtext-lexical`, `@payloadcms/ui`, `@payloadcms/plugin-seo`, `@payloadcms/live-preview-react` | 3.91.0 (2026-10-15); `beta` 4.0.0-beta.3 |
| `@opennextjs/cloudflare` | 1.20.12, peers `next >=15.5.28 <16 \|\| >=16.4.1`, `wrangler ^4.148.0` |
| `next` | 16.4.2 |
| `wrangler` | 4.151.3 |

- `@payloadcms/next@3.91.0` peers `next >=16.3.3 <17` (plus 15.x ranges) and React `^19.0.1 || ^19.1.2 || ^19.2.1`. The `next` range create-faster gives a Next.js app on `cloudflare` (`>=16.4.1`) fits.
- The D1 adapter is still documented as beta (`docs/database/sqlite.mdx`, branches `3.x` and `main`).

## 3. Blocker: login on Workers since Payload 3.90.0

- 3.90.0 raised PBKDF2 to 600,000 iterations for new hashes (`payload/dist/auth/strategies/local/generatePasswordSaltHash.js`, prefix `pbkdf2-sha256-v1:`; legacy hashes stay at 25,000). workerd rejects counts above 100,000: `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)`. A fresh deploy cannot create its first admin ([payload#18274](https://github.com/payloadcms/payload/issues/18274), open) [V].
- Fix PRs, open and awaiting review: [payload#18461](https://github.com/payloadcms/payload/pull/18461) (configurable iterations with a Workers-aware default) and [payload#18276](https://github.com/payloadcms/payload/pull/18276) (cap on Workers) [V].
- A hash created on Node (a `payload run` script) at 600,000 iterations also fails to verify on workerd [I].

**Decision: build against the latest 3.x, release the blueprint once a Payload version that fixes #18274 is published.** No patch is carried.

## 4. The official template (`with-cloudflare-d1`, branch `3.x`)

`create-payload-app` 3.85 to 3.91 downloads templates from `#3.x`; `main` holds the v4 templates [V]. Code copied from `main` onto 3.x packages explains three "defects" reported against the template: `storage: [r2Storage()]` (v4 API, [payload#16596](https://github.com/payloadcms/payload/pull/16596); 3.x uses `plugins`), `generatePayloadViewport` (exists only in 4.0 beta), `payload build` (v4 command; 3.x builds with `next build --webpack`) [V].

What the 3.x template does [V]:
- Bindings: Wrangler `getPlatformProxy` in the CLI and in dev, `getCloudflareContext({ async: true })` at runtime; `isCLI` also matches `next/dist/bin/next`, so `next build` uses the platform proxy. It passes `remoteBindings: true` when `NODE_ENV=production`, so a build reaches the real account.
- JSON console logger in production (`pino-pretty` does not run on workerd).
- `wrangler.jsonc`: `D1` and `R2` bindings with `remote: true`; `NEXT_INC_CACHE_R2_BUCKET` and `WORKER_SELF_REFERENCE` commented out. `open-next.config.ts` is `defineCloudflareConfig({})`.
- Deploy: `payload migrate` (`NODE_ENV=production`), `wrangler d1 execute D1 --command 'PRAGMA optimize' --remote`, `opennextjs-cloudflare build && deploy`. One committed initial migration.

Real problems on 3.x:
- **`drizzle-kit/api` under OpenNext** ([payload#16470](https://github.com/payloadcms/payload/issues/16470), open): `Could not resolve "drizzle-kit-…/api"`. The load is lazy (`createRequire(import.meta.url)('drizzle-kit/api')` in `@payloadcms/drizzle/dist/sqlite/requireDrizzleKit.js`), yet the bundle still fails for some setups. Community workarounds: `serverExternalPackages` with `@payloadcms/drizzle/sqlite`, or `@payloadcms/db-d1-sqlite`, `jose`, `drizzle-kit`. The production site builds on 3.90 with `serverExternalPackages: ['jose', 'pg-cloudflare']` and no stub. To be re-checked on the target version [V].
- **Turbopack fails**: `--webpack` is required [V].
- **Parallel build workers drop the platform proxy connection**: the build died around 110 pages on the production site until `experimental.cpus: 1`, `staticGenerationMaxConcurrency: 1` and `staticGenerationMinPagesPerWorker` were set [V, production site].

What the template does not provide [V]: an incremental or tag cache, revalidation, a safe first admin, draft or live preview, image handling without `sharp` (`next/image` breaks on Workers, [payload#15502](https://github.com/payloadcms/payload/issues/15502)), `versions.maxPerDoc`, backups, CI, a staging environment.

## 5. Platform limits

- **`sharp` cannot run on workerd** (native N-API module). Image sizes, crop, focal point, format conversion and EXIF removal are lost. Crop and focal point still show in the admin and the server drops the value silently (both go through `uploadEdits`, handled only with `sharp`), so `crop: false` and `focalPoint: false` are required. Width, height, filesize and MIME type are still recorded [V, production site]. v4 adds an upload transformer API; a Cloudflare Images transformer is a draft PR ([payload#18647](https://github.com/payloadcms/payload/pull/18647)) [V].
- **`next/image`**: the OpenNext optimizer fetches relative URLs through `env.ASSETS`, while Payload media are served from `/api/media/file/…` out of R2, so every image answered 404 until `images.unoptimized: true` [V, production site]. Resizing moves to delivery (`/cdn-cgi/image/`), which needs a real zone: it answers 404 on `workers.dev` [V, production site].
- **D1 transactions are a no-op**: `beginTransaction` resolves `null` unless `transactionOptions` is passed (`db-d1-sqlite/dist/index.js`) [V]. An array update is DELETE-all then INSERT, auto-committed per statement: data loss on interrupted writes of large arrays ([payload#15219](https://github.com/payloadcms/payload/issues/15219), open; reproduced on the production site with 2,500-row arrays, never at realistic sizes). Keep array fields small.
- **Admin preferences are never saved**: the adapter sets `upsert: updateOne` without `upsert: true` (3.91.0 and 4.0 beta) [V]; [payload#17202](https://github.com/payloadcms/payload/issues/17202) was closed by its author, unfixed.
- **100 bound parameters per D1 query**: the adapter sets `limitedBoundParameters: true`; large updates and bulk publish above about 100 documents still fail ([payload#14766](https://github.com/payloadcms/payload/issues/14766), [payload#17493](https://github.com/payloadcms/payload/issues/17493), open) [V].
- **Worker size**: 64 MiB uncompressed on both plans since 2026-09-04 [V]; the production site uploads about 28 MiB (6 MiB gzip) and starts in 40 ms [V, production site]. The Free plan's 10 ms CPU per request and 50 D1 queries per invocation make the Workers Paid plan necessary in practice [I].
- **After `wrangler deploy`, routes answer 404 for about a minute**: a smoke test needs a retry loop [V, production site].
- **A D1 migration can print errors and end with "Done"**: verify the schema after migrating [V, production site].

## 6. Practices the production site adds

Generic, worth a starter:
- **Bindings**: platform proxy for the CLI and `next build`, `getCloudflareContext` at runtime; remote bindings only behind an explicit variable (`WRANGLER_REMOTE_BINDINGS=true`), never inferred from `NODE_ENV`, because `next build` sets `NODE_ENV=production` and resolves the bindings at module scope; a `persist` path shared with the other Workers of the repo; Wrangler imported so the bundler ignores it.
- **`"type": "module"`** on the app: `payload.config.ts` awaits the Cloudflare context at the top level, and `generate:types` / `generate:importmap` fail in CJS.
- **Caching**: composite incremental cache (static assets first, then R2 under an `incremental-cache/` prefix so it never meets the media at the bucket root), D1 tag cache whose `revalidations` table is created by a Payload migration. Without it every page view is a cache MISS and a D1 read.
- **Revalidation**: `afterChange`/`afterDelete` hooks calling `revalidateTag(tag, { expire: 0 })` (the previous slug too on rename), ignoring only Next's "no active request" error code (Local API writes from migrations and seeds); `generateStaticParams` returning `[]` with `revalidate = false` for slug routes; `force-dynamic` for database pages without a dynamic segment (otherwise `next build` prerenders them before `migrate` and a first deploy fails with `no such table`); a short cache window for a not-found slug so invented URLs do not fill R2.
- **First admin**: Payload lets anyone create a user while the users collection is empty, and a deploy is reachable on a public `workers.dev` URL. A `payload run` script creates the admin from environment variables after migrating and before the Worker is reachable, idempotent.
- **Migrations**: `push: false` on the adapter, committed `.json` snapshots (without them `migrate:create` emitted a 733-line full schema instead of a delta), `payload migrate` against remote bindings (Payload migrations are TypeScript, `wrangler d1 migrations apply` cannot run them).
- **Uploads**: `upload.limits.fileSize`, `abortOnLimit`, `requestSizeLimit` with headroom (3.90 and later), a `beforeChange` size check for Local API uploads that skip busboy. `clientUploads` on `storage-r2`: crashed on 3.89, fixed in 3.90.2, chunk size still not configurable.
- **SEO**: the `plugin-seo` field exports instead of `seoPlugin()`, which registers four unauthenticated `POST /api/plugin-seo/generate-*` endpoints; robots closed outside the production origin, `/admin/` and `/api/` disallowed.
- **Backup**: a cron Worker dumps every table (skipping `_cf_*`, which D1 refuses to read, and `sqlite_*`) as NDJSON plus a manifest to R2, with retention. D1 Time Travel rewinds the whole database and does not cover R2.
- **Versions**: `drafts: true` keeps a full copy of every array row on each save; without `maxPerDoc` one table grew to 53,826 version rows for 32 live rows.

Missing on the production site too, and in the template: draft and live preview, `versions.maxPerDoc`, the D1 preferences fix, EXIF removal.

## 7. Fit in create-faster

- **`database: 'd1'` without an ORM** is valid (only the ORM requires a database). In a turborepo the D1 scripts reach `packages/db` only through an ORM, so without one there is no `packages/db`, no Drizzle config and no `db:*` script: nothing competes with Payload's schema. In a single repo the `d1` `packageJson` merges into the app and writes `db:generate: drizzle-kit generate` (with no `drizzle-kit` installed), the Wrangler `db:migrate*` scripts and a `local-setup` calling a `db:seed` that does not exist: a defect of the option on its own, whatever the blueprint.
- **R2** has no generic mechanism; `cloudflare-fullstack-nextjs` declares its `STORAGE` binding in its own `wrangler.jsonc`.
- **Templates to replace**: `next.config.ts` (`withPayload`), the root `layout.tsx`, `not-found.tsx` and `error.tsx` (Payload uses two route groups with their own `<html>`), the `middleware.ts` the stack emits under `cloudflare`.
- **Tests that assume every blueprint has `src/app/layout.tsx`**: `nextjs-fonts.test.ts`, `nextjs-404-landmark.test.ts`. The D1 provisioning docs gate the remote migration step on `project.orm`.
- **`@payload-config`** (the template's path alias) fails the import checks of `blueprint-imports.test.ts` and `template-deps.test.ts`; import the config through `@/`.

## 8. Decisions

- Next.js through OpenNext, Payload 3.x; TanStack Start later through `extends`.
- Release once a Payload version that fixes #18274 is published; no patch.
- Turborepo: `web` (Next.js, Payload admin and public site) and `cron` (Hono, D1 and R2 backup), `packages/ui`, `database: 'd1'` without ORM, `deployment: 'cloudflare'`.
- Public site: a generic minimal site in the spirit of Payload's `website` template (pages built from blocks, posts, media, users, a site settings global, Lexical, SEO fields, sitemap and robots, draft and live preview, revalidation), adapted to Workers.
