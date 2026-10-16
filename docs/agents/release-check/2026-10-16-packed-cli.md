# Release check: the packed CLI against a matrix of real projects

Issue: plvo/create-faster#299. Date: 2026-10-16. Verification only: no source, template or test was changed. Nothing was filed on GitHub; failures are recorded here for triage.

## Summary

- Matrix: 35 runs (25 `--app` runs `R01` to `R24` plus `R20b`, 10 blueprint runs `B01` to `B10`), plus 5 focused reproduction runs (`X01` to `X05`), 26 CLI validation cases, 4 launcher checks and 2 pseudo-terminal checks.
- 21 matrix runs passed every step (warnings aside). 14 runs had at least one failing step or a defect found by an extra check. Every failure belongs to one of 8 distinct defects (`F1` to `F8`), none of them specific to packaging: the packed CLI generated the same files as the source tree would, and no file missing from `files`, no source-relative template path and no workspace-only dependency was found.
- The recreate command printed by the summary regenerated an identical project in all 35 matrix runs (only the randomised Docker database port differs).
- Not run, because it needs an account or a device: `sst deploy`/`sst diff`, `terraform plan`/`apply`, `wrangler deploy`, Expo on a device, Playwright browsers. See Coverage gaps.

## Environment

| Item | Value |
|---|---|
| Host | Ubuntu 26.04.1 LTS, Linux 7.0.0-38-generic x86_64, 16 cores, 30 GiB RAM |
| Node | v24.13.0 |
| npm | 11.6.2 (npm 12 not available) |
| pnpm | 12.14.0 (`npm install pnpm@latest` into the work directory; the globally installed pnpm 10.34.5 was not used) |
| Bun | 1.4.1 |
| Docker | 28.3.3, Compose v2.39.1 |
| Terraform | v1.16.1 |
| git | 2.53.0 |
| Observed generated versions | Next.js 16.4.2, Prisma 7.10.1, eslint-plugin-react-hooks 7.1.1, turbo 2.11.8, expo-doctor 1.21.4 |

Package under test:

| Item | Value |
|---|---|
| Source | `main` at `a314fcd` (`fix(blueprints): answer 404 for an unknown id on detail pages (#333)`), clean worktree |
| Build | `bun run build:cli`, then `npm pack` in `apps/cli` |
| Tarball | `create-faster-1.6.7.tgz`, 1.2 MB, 709 files, 2.7 MB unpacked, sha1 `5f579b573cbe2ec5734177b325db013a67ec9f05` |
| Install | `npm install <tarball>` in an empty directory created with `npm init -y`; the binary is `node_modules/.bin/create-faster`. No workspace, no source tree on the path. |

Isolation:

- Everything lived under `/home/plv/release-check-299/`: the tarball install, the generated projects, `TMPDIR`, the bun, npm and pnpm caches (`BUN_INSTALL_CACHE_DIR`, `NPM_CONFIG_CACHE`, and `XDG_*` for the pnpm store), an empty user `.npmrc`. `/tmp` was not used.
- A wrapper script set that environment for every command and built a minimal `PATH`. For the "no Bun" runs the `PATH` held only `node`, `npm` and `npx` (symlinks to the nvm Node) plus `/usr/local/bin:/usr/bin:/bin` and the pnpm 12 directory, and the wrapper aborted if `command -v bun bunx` succeeded. Runs marked `bun` below used the same `PATH` with `bun` and `bunx` added.
- Every CLI invocation had stdin from `/dev/null`.
- One install or build at a time. Docker databases were started by the generated `docker-compose.yml` and removed with `docker compose down -v` at the end of each run.
- Telemetry off (`NEXT_TELEMETRY_DISABLED`, `WRANGLER_SEND_METRICS`, `DO_NOT_TRACK`, `CHECKPOINT_DISABLE`); after the incident described below `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` pointed to `/dev/null`.

## How a run was checked

Every row below ran, in this order, with the packed binary:

1. `generate`: the CLI exit code (the CLI installs, runs the `postGenerate` steps and `git init` itself when `--pm` and `--git` are given).
2. `recreate`: the command printed by the summary, run in a second directory (`create-faster` replaced by the packed binary, everything else verbatim), then `diff -r` against the first project. Excluded as installed or build artefacts: `node_modules`, `.git`, `.next`, `.turbo`, `dist`, `.open-next`, `.wrangler`, `.output`, `.tanstack`, `.expo`, lockfiles, `*.tsbuildinfo`, `next-env.d.ts`, `cloudflare-env.d.ts`. The diff was taken before any step below touched the project (except R01, the first run, where `.env`, `drizzle/` and `coverage/` were excluded because its steps had already run). Result for all 35 runs: the only differing lines are the randomised database port (`docker-compose.yml`, `.env.example`, and the Hyperdrive `localConnectionString` of `wrangler.jsonc`). Marked "recreate: identical" below when the diff was empty or port-only.
3. The README's own first-run steps (copy `.env*.example`, `docker compose up -d --wait`, `db:generate`/`db:migrate`/`db:push`, or `local-setup` for blueprints), then `db:seed`.
4. The project's `lint` script, `tsc --noEmit` in every app and package (the root `tsconfig.json` of a turborepo only extends the base config and is not a project, so it is not counted), `test` when the choices add one, and `build`.
5. Run-specific extras: `build:cf` and `preview` answering HTTP, `start`, `dev`, `expo export`, `expo-doctor`, `wrangler deploy --dry-run`, `sst install`, `terraform init -backend=false` and `validate`.

A step passes when it exits 0 with no unexpected error output. Warnings that look like defects are listed in the Warnings section.

## Runs

`PM` is the package manager of the run (`npm` and `pnpm` runs had Bun absent from `PATH`). Commands are shown after the binary name; the project name `rcNN` is arbitrary. "Single" and "turbo" mean single repo and turborepo.

| Run | PM | Command | Covers | Result |
|---|---|---|---|---|
| R01 | bun | `rc01 --app web:nextjs:shadcn,next-themes,better-auth,trpc,tanstack-query,tanstack-devtools,react-hook-form,vitest --database postgres --orm drizzle --linter biome --tooling husky --git --pm bun` | single, Next.js, postgres + drizzle, biome, husky, 8 libraries | generate, recreate (identical), docker up, db:generate, db:migrate, db:seed, lint, tsc, test, build: pass. `biome check .` (no fix): FAIL, 2 errors on `drizzle/meta/*.json` (F1). Husky hooks not installed after generation (F6). |
| R02 | npm | `rc02 --app web:nextjs:shadcn,mdx,pwa,tanstack-form,playwright,evlog,posthog --database mysql --orm prisma --linter eslint-prettier --git --pm npm` | single, Next.js, mysql + prisma, eslint-prettier, 7 libraries | generate, recreate (identical), docker up (mysql), db:push, lint, build, format:check: pass. `db:seed` before the first build: FAIL (F2). `tsc --noEmit` before the first build: FAIL, 2 errors (F2). Both pass after `build`. Playwright e2e not run. |
| R03 | pnpm | `rc03 --app web:nextjs:shadcn,next-themes,better-auth,trpc,tanstack-query,vitest --database sqlite --orm drizzle --linter oxc --git --pm pnpm` | single, Next.js, sqlite + drizzle, oxc | generate, recreate (identical), db:generate, db:migrate, db:seed, lint (1 warning, O3), tsc, test, build (Turbopack warning O4): pass. `oxfmt --check .`: FAIL on `drizzle/meta/*.json` (F1). |
| R04 | bun | `rc04 --app web:nextjs:shadcn,better-auth,trpc,tanstack-query --database d1 --orm drizzle --deployment cloudflare --linter eslint --git --pm bun` | single, Next.js on Cloudflare, d1 + drizzle, eslint | generate, recreate (identical), db:generate, db:migrate (local D1), db:seed, lint, tsc, build, `build:cf`: pass. `preview` (OpenNext, port 8787): `/` 200. With the blank `BETTER_AUTH_SECRET` of `.env.example`, `/api/auth/ok` and `/api/auth/get-session` answer 500 (O2). After setting a secret in `.env` and rebuilding: sign-up POST 200 on local D1, `/api/auth/ok` 200. |
| R05 | npm | `rc05 --app web:nextjs:shadcn,mdx --deployment cloudflare-static --linter prettier --git --pm npm` | single, Next.js, cloudflare-static, prettier | generate, recreate (identical), tsc, build (`out/index.html` exists), format:check, `preview` (wrangler dev) `/` 200, `dev` 200: pass. |
| R06 | pnpm | `rc06 --app web:tanstack-start:shadcn,next-themes,mdx,better-auth,trpc,tanstack-query,tanstack-devtools,tanstack-form,react-hook-form,evlog,posthog,vitest,playwright --database postgres --orm prisma --linter biome --git --pm pnpm` | single, TanStack Start (Nitro), postgres + prisma, biome, 13 libraries | generate, recreate (identical), docker up, db:push, db:generate, db:seed (after generate), lint, tsc, test, build, `biome check`, `start` `/` 200: pass. `db:seed` right after `db:push`: FAIL (F2). Server logs `unhandledRejection` BetterAuthError with the blank secret (O2). |
| R07 | bun | `rc07 --app web:tanstack-start:shadcn,better-auth,trpc,tanstack-query --database d1 --orm drizzle --deployment cloudflare --linter oxc --git --pm bun` | single, Start on Cloudflare (vite plugin), d1 + drizzle, oxc | generate, recreate (identical), db:generate, db:migrate, db:seed, lint (1 warning, O3), build, `preview` (vite, 4173) `/` 200, sign-up POST 200 on D1, `/api/auth/ok` 200: pass. `tsc --noEmit`: FAIL, 3 errors (F3). |
| R08 | npm | `rc08 --app web:tanstack-start:shadcn,mdx,tanstack-form --deployment cloudflare-static --linter eslint --git --pm npm` | single, Start, cloudflare-static, eslint | generate, recreate (identical), tsc, build, `preview` `/` 200, `dev` 200: pass. `npm run lint`: FAIL, 1 error (F4). |
| R09 | npm | `rc09 --app web:nextjs:shadcn,vitest --app api:hono:evlog,vitest-node --database mysql --orm drizzle --linter biome --tooling portless --tooling husky --git --pm npm` | turbo, Next.js + Hono (tsx), mysql + drizzle, biome, portless, husky | generate, recreate (identical), docker up, db:generate, db:migrate, db:seed (via turbo), lint, tsc (api, web, db, ui), test, build, api `start` (tsx, port 3001) `/health/1` 200: pass. `biome check` FAIL (F1). Husky inactive (F6). portless dev not run. |
| R10 | pnpm | `rc10 --app web:tanstack-start:shadcn,tanstack-query --app mobile:expo:nativewind,jest-expo --app api:hono:vitest-node --database postgres --orm prisma --linter eslint-prettier --git --pm pnpm` | turbo, Start + Expo + Hono, postgres + prisma in a turborepo, eslint-prettier | generate, recreate (identical), docker up, db:push, db:generate, db:seed, lint, tsc (api, mobile, web, db, ui), test (jest-expo + vitest), build, format:check, `expo export --platform android`, `expo-doctor` 21/21, api `start` `/health/1` 200, web `start` `/` 200: all pass. |
| R11 | bun | `rc11 --app web:nextjs:shadcn,tanstack-query --app mobile:expo:nativewind,jest-expo,tanstack-query --app worker:node:evlog,vitest-node --database sqlite --orm drizzle --linter eslint --tooling husky --git --pm bun` | turbo, Next.js + Expo + Node, sqlite + drizzle in a turborepo, eslint, husky | generate, recreate (identical), db:generate, db:migrate, db:seed, lint, tsc (mobile, web, worker, db, ui), test, build, `expo export`, node worker `bun run src/index.ts`, web `start` 200: pass. `expo-doctor`: 1 check failed (duplicate `expo-constants`, `expo-font`, `expo-linking` under Bun's isolated installs), a documented expectation in AGENTS.md (Expo section), not counted as a defect. Husky inactive (F6). |
| R12 | npm | `rc12 --app mobile:expo:nativewind,jest-expo,tanstack-query --linter biome --git --pm npm` | single, Expo, biome | generate, recreate (identical), lint, tsc, test (jest-expo), `biome check`, `expo export`, `expo-doctor`: pass. |
| R13 | bun | `rc13 --app api:hono:evlog,vitest-node --database d1 --orm drizzle --deployment cloudflare --linter eslint-prettier --git --pm bun` | single, Hono on Cloudflare, d1 + drizzle, eslint-prettier | generate, recreate (identical), db:generate, db:migrate, db:seed, lint, tsc, test, `wrangler deploy --dry-run`, `preview` `/health/1` 200, `dev` 200: pass. `prettier --check`: FAIL on `drizzle/meta/*.json` (F1). Hono has no `build` script. |
| R14 | npm | `rc14 --app api:hono:tanstack-query,vitest-node --database sqlite --orm drizzle --linter oxc --git --pm npm` | single, Hono (tsx), sqlite + drizzle, oxc, a `support: all` library on a server stack | generate, recreate (identical), db:generate, db:migrate, db:seed, lint, tsc, test, `start` `/health/1` 200, `dev` 200: pass. `oxfmt --check`: FAIL (F1). |
| R15 | pnpm | `rc15 --app worker:node:evlog,vitest-node --database postgres --linter biome --git --pm pnpm` | single, Node, a database with no ORM, biome | generate, recreate (identical), docker up, lint, tsc, test, `biome check`, `start` (tsx): all pass. |
| R16 | pnpm | `rc16 --app web:nextjs:shadcn,better-auth,trpc,tanstack-query --app admin:tanstack-start:shadcn,tanstack-query --app api:hono:evlog --database d1 --orm drizzle --deployment cloudflare --linter biome --git --pm pnpm` | turbo, all three Cloudflare stacks at once, d1 + drizzle | generate, recreate (identical), db:generate, db:migrate, db:seed, lint, tsc (admin, api, web, 4 packages), build (turbo), `build:cf` (web), previews: web `/` 200 and `/api/auth/ok` 200, admin `/` 200, api `/health/1` 200 after `wrangler deploy --dry-run`, `pnpm run dev` (3 apps, ports 3000 to 3002) 200: pass. `biome check` FAIL (F1). |
| R17 | npm | `rc17 --app web:nextjs:shadcn,better-auth,trpc --app site:tanstack-start:shadcn --app api:hono:aws-lambda --database postgres --orm drizzle --deployment sst --linter biome --git --pm npm` | turbo, `sst` with Next.js + Start + Hono, postgres secret | generate, recreate (identical), lint, tsc (api, site, web, 4 packages), build, `biome check`, `sst install`, tsc and build after install: pass. `sst diff --stage ci`: could not run, "AWS credentials are not configured" (expected without an account). |
| R18 | pnpm | `rc18 --app web:nextjs:shadcn,next-themes --deployment sst --linter prettier --git --pm pnpm` | single, `sst` (root tsconfig excludes `.sst`), prettier | generate, recreate (identical), tsc, build, format:check, `sst install`, then tsc, build and format:check again: pass. |
| R19 | bun | `rc19 --app web:nextjs:shadcn --app api:hono --deployment terraform-aws --linter biome --git --pm bun` | turbo, `terraform-aws`, biome | generate, recreate (identical), lint, tsc, build, `biome check`, `terraform init -backend=false`, `terraform validate`, `terraform fmt -check`: pass. |
| R20 | npm | `rc20 --app web:nextjs:shadcn --yes` | `--yes`, no TTY | generate (no `node_modules`, no `.git`, no lockfile), recreate (identical), then `npm install`, tsc, build: pass. |
| R20b | npm | `rc20b --app web:nextjs:shadcn` | no flag but `--app`, no TTY | no prompt, no install, no git; the printed recreate command adds `--yes`; recreate (identical): pass. |
| R21 | pnpm | `rc21 --app api:hono --database none --orm none --deployment none --linter none --tooling none --pm pnpm` | `none` for every category, no TTY | generate (installed with pnpm, no `.git`), recreate (identical, printed command is `--app api:hono --pm pnpm --yes`), tsc, `start` `/health/1` 200: pass. |
| R22 | bun | `rc22 --app web:nextjs:shadcn,tanstack-query --app api:hono --database postgres --orm drizzle --deployment cloudflare --linter oxc --git --pm bun` | turbo, Cloudflare with Hyperdrive (postgres), oxc | generate, recreate (identical), docker up, db:generate, db:migrate, db:seed, lint, tsc, build, `build:cf`, web `preview` `/` 200, api `wrangler deploy --dry-run`, api `preview` `/health/1` 200: pass. |
| R23 | npm | `rc23 --app web:tanstack-start:shadcn,tanstack-query --database mysql --orm drizzle --deployment cloudflare --linter prettier --git --pm npm` | single, Start on Cloudflare with Hyperdrive (mysql) | generate, recreate (identical), docker up, db:generate, db:migrate, db:seed, tsc, build, `preview` `/` 200: pass. `prettier --check` FAIL (F1). |
| R24 | npm | `rc24 --app web:nextjs:shadcn --app api:hono --linter oxc --pm npm --no-install --no-git --no-agent-context` | turbo, `--no-install`, `--no-git`, `--no-agent-context` | generate (no `AGENTS.md`/`CLAUDE.md`, no `node_modules`, no `.git`; the summary lists the install and the format step), recreate (identical, keeps `--no-install`), then `npm install`, lint, tsc, build: pass. |
| B01 | pnpm | `rcb01 --blueprint dapp-privy-nextjs --git --pm pnpm` | blueprint, single | generate, recreate (identical), docker up, db:generate, db:migrate, tsc, build, `start` `/` 200: pass. `db:seed`: FAIL (F5). |
| B02 | npm | `rcb02 --blueprint dapp-rainbowkit-nextjs --git --pm npm` | blueprint, single | all pass, including `db:seed`, `start` `/` 200 (build prints BetterAuth lines, O2). |
| B03 | npm | `rcb03 --blueprint lambda-sst-hono --git --pm npm` | blueprint, turbo, `sst` | generate, recreate (identical), tsc (api, cron, worker, shared), build (3 esbuild bundles), bundle loads, `sst install`, tsc and build after, api `start` `/health/1` 200: pass (O10). |
| B04 | pnpm | `rcb04 --blueprint lambda-terraform-aws-hono --git --pm pnpm` | blueprint, turbo, `terraform-aws` | every step exits 0, including `terraform init -backend=false`, `validate`, `fmt -check`, bundle `dist/index.mjs` loads and api `start` 200. But the build prints an esbuild `suspicious-define` warning for each of the 3 apps and the bundle is wrong (F7). |
| B05 | bun | `rcb05 --blueprint org-dashboard-nextjs --git --pm bun` | blueprint, turbo | generate, recreate (identical), `bun run local-setup` (docker, migrate, seed), tsc (batch, web, api, auth, db, ui), build: pass. `start` with the blank secret: `/` and `/login` answer 500 (O2). With `BETTER_AUTH_SECRET` set: `/` 307, `/login` 200. |
| B06 | npm | `rcb06 --blueprint org-dashboard-tanstack-start --git --pm npm` | blueprint, turbo | `local-setup`, tsc x6, build, `start` `/` 307 and `/login` 200 (secret set): pass. |
| B07 | pnpm | `rcb07 --blueprint multitenant-saas-nextjs --git --pm pnpm` | blueprint, turbo | `local-setup`, tsc x6, build, `start` `/` 307 and `/login` 200 (secret set): pass. |
| B08 | bun | `rcb08 --blueprint cloudflare-static-site-nextjs --linter biome --git --pm bun` | blueprint, single, cloudflare-static, `--linter` with a blueprint | lint, tsc, build (`out/index.html`), `biome check`, `preview` 200: pass. |
| B09 | npm | `rcb09 --blueprint cloudflare-fullstack-nextjs --git --pm npm` | blueprint, turbo, d1 + cloudflare | `local-setup` (D1), tsc x6, build, `build:cf`, web `preview` `/` 307, `/login` 200, `/api/auth/ok` 200, cron `wrangler deploy --dry-run` and `preview` `/health/1` 200: pass. |
| B10 | bun | `rcb10 --blueprint showcase-nextjs --linter oxc --git --pm bun` | blueprint, single | lint (1 warning, O3), tsc, build, `oxfmt --check`, `start` 200: pass. |

Focused reproduction runs (each is the smallest command that shows one defect; not counted in the matrix):

| Run | PM | Command | Result |
|---|---|---|---|
| X01 | bun | `rcx01 --app web:tanstack-start:tanstack-query --linter oxc --git --pm bun` | `tsc --noEmit` FAIL (F3). |
| X02 | bun | `rcx02 --blueprint lambda-terraform-aws-hono --git --pm bun` | build correct: `const isDev = false;` (F7 does not occur under Bun). |
| X03 | npm | `rcx03 --blueprint lambda-terraform-aws-hono --git --pm npm` | build warns, bundle has `const isDev = production === "development";` (F7). |
| X04 | npm | `rcx04 --app web:hono --linter biome --tooling husky --git --pm npm` | `git config core.hooksPath` empty after generation; `.husky/_` absent (F6). |
| X05 | npm | `rcx05 --app web:tanstack-start:mdx --linter eslint --pm npm` | `npm run lint` FAIL (F4). |

CLI validation cases (packed binary, no TTY, nothing written in any case):

| Case | Command (after the binary) | Result |
|---|---|---|
| N1 to N10 | `--blueprint <name>` for `dapp-privy`, `dapp-rainbowkit`, `org-dashboard`, `multitenant-saas`, `cloudflare-static-site`, `cloudflare-fullstack`, `showcase`, `lambda-sst`, `lambda-terraform-aws`, `nonexistent` | exit 1, `Invalid blueprint '<name>'` followed by the list of the 10 valid names. All six renamed names (#297) are rejected with no alias. |
| V1 | `--app web:nextjs --database d1 --orm drizzle` | exit 1, `database 'd1' requires deployment: cloudflare` |
| V2 | `--database sqlite --deployment cloudflare` | exit 1, `'sqlite' needs a local filesystem, which 'cloudflare' does not provide` |
| V3 | `--database sqlite --orm prisma` | exit 1, `orm 'prisma' requires database: postgres or mysql` |
| V4 | `--orm drizzle` alone | exit 1, `ORM requires a database` |
| V5 | `--blueprint showcase-nextjs --app web:nextjs` | exit 1, `--blueprint cannot be combined with --app` |
| V6 | `--tooling husky --linter biome --no-git` | exit 1, `tooling 'husky' requires git, a linter` (the message names the linter as unmet although one was given; git is the missing one) |
| V7 | `--tooling none --tooling husky` | exit 1, `--tooling none cannot be combined with another value` |
| V8 | `--app web:nextjs:better-auth` | exit 1, requires a database and an ORM |
| V9 | `--app api:hono --deployment cloudflare-static` | exit 1, `requires an app on stack: nextjs or tanstack-start` |
| V10 | `--database bogus` | exit 1, `Invalid database 'bogus'` plus the valid list |
| V11 | project name `Bad Name` | exit 1, name rules printed |
| V12 | `--app web:nextjs:nativewind` | exit 1, `not compatible with stack 'nextjs'`, compatible: expo |
| V13 | `--app web:nextjs --app web:hono` | exit 1, `App names must be unique` |
| V14 | `--pm yarn` | exit 1, `Available: bun, npm, pnpm` |
| V15, V16 | `--yes` alone, and no flag at all | exit 0, nothing written, an unanswerable prompt is printed (F8) |

Launcher and pseudo-terminal checks:

| Check | Result |
|---|---|
| `create-faster --help` from the installed tarball | pass; lists the 10 blueprint names, all stacks, libraries, databases, ORMs, deployments, linters, tooling. |
| `create-faster --version` | `error: unknown option '--version'` (O1). |
| `npx --yes --package <tarball> create-faster ...` with Bun absent | pass, generated the project. |
| `bunx --package <tarball> create-faster ...` | pass. |
| `pnpm dlx --package=<tarball> create-faster ...` with Bun absent | pass. |
| Pseudo-terminal, no arguments, Ctrl-C at the first prompt | prompt renders, prints `Bye`, exit 0. |
| Pseudo-terminal, Enter on every prompt | completes and writes a default single Next.js project `my-app` (with `AGENTS.md`), exit 0. |

## Coverage

| Issue item | Runs |
|---|---|
| 1. `bun run build:cli`, `npm pack` | Tarball section above |
| 2. Install the tarball in an empty directory, run its binary | Tarball section; every run; launcher checks (`npx`, `bunx`, `pnpm dlx` against the tarball) |
| 3. Package manager `bun` | R01, R04, R07, R11, R13, R19, R22, B05, B08, B10, X01, X02 |
| 3. Package manager `npm`, Bun absent | R02, R05, R08, R09, R12, R14, R17, R20, R20b, R23, R24, B02, B03, B06, B09, X03, X04, X05 |
| 3. Package manager `pnpm` (12.14.0, strict builds), Bun absent | R03, R06, R10, R15, R16, R18, R21, B01, B04, B07 |
| 3. Single repo | R01 to R08, R12 to R15, R18, R20, R21, R23, B01, B02, B08, B10 |
| 3. Turborepo | R09, R10, R11, R16, R17, R19, R22, R24, B03 to B07, B09 |
| 3. Stack Next.js | R01 to R05, R09, R11, R16 to R22, R24, B01, B02, B05, B07 to B10 |
| 3. Stack TanStack Start | R06, R07, R08, R10, R16, R17, R23, B06 |
| 3. Stack Expo | R10, R11, R12 |
| 3. Stack Hono | R09, R10, R13, R14, R16, R17, R19, R21, R22, R24, B03, B04 |
| 3. Stack Node | R11, R15, B03, B04 |
| 3. `cloudflare`: production build and `preview` answering HTTP | Next.js (OpenNext `build:cf` + `preview`): R04, R16, R22, B09. Start (`vite build` + `vite preview`): R07, R16, R23. Hono (`wrangler deploy --dry-run` + `wrangler dev`): R13, R16, R22, B09 (cron). With D1: R04, R07, R13, R16, B09. With Hyperdrive: R22 (postgres), R23 (mysql). |
| 3. `cloudflare-static` built | R05 (Next.js), R08 (Start), B08; previewed with `wrangler dev` in all three. |
| 3. `sst` build and type-check, no deploy | R17 (turbo, three stacks), R18 (single), B03; `sst install` run in all three; `sst diff` could not run without credentials. |
| 3. `terraform-aws` build and type-check, no deploy | R19, B04; `terraform init -backend=false`, `validate`, `fmt -check` pass in both; `plan`/`apply` need an account. |
| 3. Database and ORM pairs | postgres + drizzle: R01, R22, B01, B02, B05 to B07, R17. postgres + prisma: R06, R10. mysql + drizzle: R09, R23. mysql + prisma: R02. sqlite + drizzle: R03, R11, R14. d1 + drizzle: R04, R07, R13, R16, B09. Database without an ORM: R15. |
| 3. `d1` with the README first-run steps | R04, R07, R13 (single: `db:generate`, `db:migrate`, `db:seed`), R16 (turbo), B09 (`local-setup`) |
| 3. Linters | biome R01, R06, R09, R12, R15, R16, R17, R19, B08; oxc R03, R07, R14, R22, R24, B10; eslint-prettier R02, R10, R13; eslint R04, R08, R11; prettier R05, R18, R23. Their `postGenerate` step ran in each. |
| 3. Tooling | husky R01, R09, R11 (F6); portless R09; both `none` in R21 |
| 3. Libraries | all 18 appear at least once (shadcn, next-themes, mdx, pwa, better-auth, trpc, tanstack-query, tanstack-devtools, react-hook-form, tanstack-form, nativewind, aws-lambda, evlog, posthog, vitest, vitest-node, playwright, jest-expo) |
| 3. Every blueprint under its new name | B01 to B10 (the ten names of `--help`) |
| 3. An old blueprint name rejected | N1 to N10 (all six renamed names and an unknown one) |
| 3. Non-interactive: `--yes` | R20 (with `--app`); V15 (`--yes` without `--app`, F8) |
| 3. Non-interactive: `none` per category | R21 |
| 3. Non-interactive: no TTY | every run had stdin from `/dev/null`; R20b, R21, R24 pass no `--yes` |
| 4. Recreate command regenerates the same project | the `recreate` step of all 35 matrix runs |
| Intro: generated scripts without Bun (#294, #296) | `db:seed` (tsx) and `local-setup` under npm and pnpm: R02, R06 (F2), B01 (F5), B02, B05 to B07, B09; Hono Node server: R09, R14, R21; Lambda esbuild builds: B03, B04 (F7) |
| Intro: OpenNext and wrangler ranges on Cloudflare (#295) | install under npm, pnpm 12 strict and bun plus `build:cf` and `preview`: R04, R16, R22, B09 |
| Intro: `postGenerate` and `firstRun` steps | formatter run at generation in every project with a linter; first-run steps in R01 to R04, R06 to R11, R13 to R16, R22, R23, B01, B02, B05 to B07, B09 |

## Failures

One entry per distinct defect. None was fixed. "Expected" cites AGENTS.md of the repository.

### F1. Files written by `db:generate` fail the project's own format check

- Reproduction: `create-faster x --app web:nextjs --database sqlite --orm drizzle --linter biome --pm bun`, `cd x`, `cp .env.example .env`, `bun run db:generate`, `bunx biome check .`
- Observed: exit 1, "Found 2 errors", formatter wants a trailing newline in `drizzle/meta/0000_snapshot.json` and `drizzle/meta/_journal.json`. Same with `oxfmt --check .` (R03, R14), `prettier --check .` (R13, R23), `biome check .` (R01, R09, R16). The `lint` script (`biome lint`, `eslint`, `oxlint`) passes; only `check` without `--fix` and `format:check` fail.
- Expected: a generated project passes its own checks after the README's first-run steps.
- Suspected cause: drizzle-kit writes migration JSON without a final newline and none of the formatter configs (`biome.json` `files.includes`, `oxfmt.config.mts` `ignorePatterns`, `.prettierignore`) excludes `drizzle/`. Low severity: `bun run check` (`--fix`) repairs it.

### F2. Prisma: `db:seed` and `tsc --noEmit` fail until the client is generated, and the README first-run does not generate it

- Reproduction: `create-faster x --app web:nextjs --database mysql --orm prisma --pm npm` (also postgres, also `--pm pnpm`, also TanStack Start), `cp .env.example .env`, `docker compose up -d --wait`, `npm run db:push`, `npm run db:seed`; or `npx tsc --noEmit` straight after install.
- Observed (R02, R06): `db:push` exits 0, then `db:seed` prints `Error: Cannot find module '../../../generated/prisma/client'` (`ERR_MODULE_NOT_FOUND` under pnpm) and exits 1; `tsc` reports `src/lib/db/index.ts(2,30): error TS2307: Cannot find module '../../../generated/prisma/client'`. After `npm run build` (which runs `prebuild`) or `npm run db:generate`, both pass (seed prints `Seeding completed!`).
- Expected: the steps the README prints leave the project seedable and type-checkable.
- Suspected cause: with Prisma 7.10 `prisma db push` does not generate the client (AGENTS.md, "Database first run": generation is deliberately moved to `predev` and `prebuild`); `db:seed` (`prisma db seed`) has no such pre-step and the README first-run for Prisma lists `db:push` only. Medium severity for a user who seeds before running `dev`.

### F3. oxfmt moves the `/// <reference types="vite/client" />` directive of a TanStack Start app below an import, which breaks `tsc`

- Reproduction (X01): `create-faster x --app web:tanstack-start:tanstack-query --linter oxc --pm bun`, `cd x`, `head -3 src/routes/__root.tsx`, `bunx tsc --noEmit`
- Observed: the template has the reference on line 1; after the generation-time `format` step (oxfmt with `sortImports`) line 1 is `import type { QueryClient } from '@tanstack/react-query';` and the reference is on line 2. TypeScript only honours the directive before any statement, so `tsc --noEmit` exits 2: `src/routes/__root.tsx(8,20): error TS2307: Cannot find module '../styles.css?url'`. With `trpc` too (R07): additionally `Property 'env' does not exist on type 'ImportMeta'` in `src/routes/api/trpc/$.ts(32,30)` and `src/trpc/client.ts(28,36)`. `vite build` still passes, so only type-check and the editor break.
- Expected: type-check passes (`tests/e2e/workspace-packages-typecheck` intent).
- Suspected cause: the template adds a type import that the sorter places before the first import, and the leading comment travels with the import it is attached to. Biome (R06) keeps the directive first. Only the oxc linter is affected as far as tested. Other TanStack Start templates that start with a triple-slash directive and are formatted by oxfmt may be affected too.

### F4. `eslint` fails on the generated MDX route of TanStack Start

- Reproduction (X05): `create-faster x --app web:tanstack-start:mdx --linter eslint --pm npm`, `cd x`, `npm run lint`
- Observed: exit 1, `src/routes/mdx/{-$slug}.tsx 29:10 error Error: Cannot create components during render ... react-hooks/static-components` (`const Document = documentComponent(slug);` inside `MdxPage`, then `<Document />`). Seen in R08 and X05 with eslint-plugin-react-hooks 7.1.1. Not seen with biome (R06), eslint-prettier on Next.js with mdx (R02) or oxlint.
- Expected: a generated project passes its own `lint` (AGENTS.md, "Prompts, testing libraries and linters").
- Suspected cause: `src/routes/mdx/{-$slug}.tsx` resolves the document component during render, which the React Compiler-derived rule rejects. Possibly the same with `eslint-prettier` (not run).

### F5. `dapp-privy-nextjs`: `db:seed` does not load `.env` under Node (npm and pnpm)

- Reproduction (B01): `create-faster x --blueprint dapp-privy-nextjs --pm pnpm`, `cd x`, `cp .env.example .env`, `docker compose up -d --wait`, `pnpm run db:generate && pnpm run db:migrate`, `pnpm run db:seed`
- Observed: exit 1, `Seeding failed: Error: DATABASE_URL environment variable is not set` at `src/lib/db/index.ts:46`. The script is `tsx scripts/seed.ts`; `.env` is not read.
- Expected: AGENTS.md ("Scripts that run under every package manager"): a seed reads its environment itself, `import 'dotenv/config'` in the generic Drizzle seed or `--env-file` on the blueprint seeds.
- Suspected cause: the blueprint file `templates/blueprints/dapp-privy-nextjs/scripts/seed.ts.hbs` replaces the generic Drizzle seed (same destination), which imports `dotenv/config`, and the blueprint copy has neither that import nor an `--env-file` in the script. `dapp-rainbowkit-nextjs` has no seed override and passes (B02). Under Bun the seed would load `.env` itself (not run).

### F6. Husky hooks are not installed in a freshly generated project

- Reproduction (X04): `create-faster x --app web:hono --linter biome --tooling husky --git --pm npm`, `cd x`, `git config core.hooksPath; ls -a .husky`
- Observed: `core.hooksPath` is empty and `.husky/_` does not exist; the hooks do not run. Same for `bun` (R01, R11) and `npm` (R09, X04). `npm run prepare` (or `bun run prepare`) then sets `core.hooksPath` to `.husky/_`, and the next commit runs `lint-staged` (verified in R01: `biome check --write` ran on the staged file).
- Expected: with `--tooling husky --git` the pre-commit and commit-msg hooks are active after generation.
- Suspected cause: `prepare` (`husky`) runs during dependency install, before `git init` (AGENTS.md: `runPostGeneration` runs the `postGenerate` steps "after a successful install and before `git init`"); husky finds no `.git` and does nothing.

### F7. `lambda-terraform-aws-hono`: under npm and pnpm the `NODE_ENV` define loses its quotes and the bundle reads an undefined identifier

- Reproduction (X03, B04): `create-faster x --blueprint lambda-terraform-aws-hono --pm npm`, `cd x/apps/api`, `npm run build`, `grep -n "isDev =" dist/index.mjs`
- Observed: esbuild prints `[WARNING] "process.env.NODE_ENV" is defined as an identifier instead of a string (surround "production" with quotes to get a string) [suspicious-define]` for each of `api`, `cron` and `worker`, and the bundle contains `const isDev = production === "development";` (line 2222). Evaluating that line throws `ReferenceError: production is not defined`, so the error handler of the deployed Lambda would throw. Under Bun (X02) the same script produces `const isDev = false;`.
- Expected: the define inlines the string `"production"` under every package manager (AGENTS.md: `--define:process.env.NODE_ENV="production"`).
- Suspected cause: the script in `package.json` is `--define:process.env.NODE_ENV=\"production\"`; `npm run` and `pnpm run` execute it through `sh`, which removes the double quotes, so esbuild receives `production`. Bun's shell keeps them. It needs the quotes to survive the shell (`'"production"'`). The Terraform workflow zips the `npm`/`pnpm` build output, so the defect ships.

### F8. No terminal and no `--app`: the CLI prints an unanswerable prompt and exits 0 with nothing written

- Reproduction: `create-faster x --yes </dev/null; echo $?` (also `create-faster x </dev/null`)
- Observed: the banner, `Using project name: x`, then `How many apps? [ ... ] 1/5` and the process ends with exit 0 and no directory. Same from the source tree (`bun run src/index.ts x --yes </dev/null`), so not specific to the package.
- Expected: AGENTS.md says scripts and agents never block; an unanswered mandatory input without a terminal should fail with a message naming `--app` and a non-zero exit code.
- Suspected cause: the app-count prompt is shown without an `isTTY` guard; on EOF the prompt resolves as a cancel that exits 0.

## Warnings and observations (not counted as failures)

- O1. `create-faster --version` is rejected (`unknown option '--version'`); the version only appears in the banner.
- O2. With the blank `BETTER_AUTH_SECRET` of `.env.example` copied to `.env`: `next build` prints two `[Error [BetterAuthError]: You are using the default secret ...]` lines and still exits 0 (R01, R03, R17, B02); a TanStack Start server logs `unhandledRejection` BetterAuthError on start (R06); a production `next start` answers 500 on `/` and `/login` (B05); an OpenNext preview answers 500 on `/api/auth/*` (R04). Working with a secret set. The README lists the variable but does not say it must be generated before `build` or `start`.
- O3. Generated code triggers oxlint warnings: `src/lib/auth/create-auth.ts:36:15 unicorn(no-useless-spread)` (R03, R07) and `src/components/layout/footer.tsx:70:21 react(purity)` (B10). AGENTS.md asks Biome projects to print no warning; no such rule is stated for oxlint.
- O4. R03 (Next.js + sqlite): `next build` reports a Turbopack warning "Dynamic filesystem access causes tracing of the whole project" at `src/lib/db/index.ts:11:47`.
- O5. On `cloudflare`, `next build` and `dev` print `The "middleware" file convention is deprecated. Please use "proxy" instead.` This follows the documented `deploymentPath` choice (OpenNext does not support the Node `proxy` convention).
- O6. `opennextjs-cloudflare preview` and `wrangler dev` warn `Missing required secrets: BETTER_AUTH_SECRET, BETTER_AUTH_URL` even when `.env` holds them (documented in AGENTS.md).
- O7. Vite/Rolldown build noise on TanStack Start: `MODULE_LEVEL_DIRECTIVE` for `"use client"` in `@tanstack/react-query` and `react-error-boundary`, `SOURCEMAP_BROKEN` from `vite:css-post`, a chunk size warning (R06, R07, R10, R16, B06).
- O8. `lambda-sst-hono` builds `dist/index.js` as an ES module without `"type": "module"`; loading it with Node prints `MODULE_TYPELESS_PACKAGE_JSON` (B03). SST bundles its own copy from `src`, so deployment is unaffected; the Terraform blueprint uses `.mjs`.
- O9. `expo-doctor` reports duplicate `expo-constants`, `expo-font`, `expo-linking` in a Bun turborepo (R11); documented as expected. It reports 21/21 under pnpm (R10) and a single repo (R12).

## Coverage gaps

- Deploy-time steps were not run because they need an account: `sst deploy`/`sst diff`/`sst dev`, `terraform plan`/`apply` (only `init -backend=false`, `validate`, `fmt -check`), `wrangler deploy` and `d1 migrations apply --remote` (only `deploy --dry-run` and local D1).
- Playwright end-to-end (`test:e2e`) was not run: no browser download was attempted. The Vitest and jest-expo suites were run.
- Expo was exported (`expo export --platform android`) and checked with `expo-doctor`, not started on a device or simulator.
- `portless` was installed (R09) but its `dev` and `start:portless` wrappers were not run.
- npm 12 and pnpm 11 default policies could not be checked beyond pnpm 12.14.0 strict builds (no `ERR_PNPM_IGNORED_BUILDS` in any pnpm run); npm 11.6.2 only. Only Bun 1.4.1 and Node 24.13.0 were used; Linux only.
- The interactive prompt flow was only smoke-tested through a pseudo-terminal (cancel, and Enter on every prompt); it was not driven through every library and database choice.
- Each combination of the covering set ran once; the product (for example every library on every stack and package manager) was not run.

## Incidents during the check

- `sst diff --stage ci` in R17 was run once before `AWS_CONFIG_FILE` was neutralised, so the SST binary read the ambient `~/.aws` profile and failed to refresh a cached SSO token (`InvalidGrantException`). No resource was read or created. It was rerun with the AWS configuration pointed to `/dev/null` and failed with "AWS credentials are not configured", and no further SST command was run against AWS.
- Two `npm` commands ran with the default `~/.npm` cache and `~/.npmrc` before the isolated environment wrapper existed (a version query and one failed `npm install pnpm@latest`). Only `~/.npm/_logs` entries were written; they were deleted. The failed install left a stray `apps/pnpm/package.json` in the worktree, deleted before any commit.
- Pre-existing processes unrelated to this check were present throughout and left alone: a `portless proxy`, a headless Chromium, and a `wrangler types` process from `/tmp/create-faster-test-*`, all older than the session. Five pre-existing Docker containers (`postgres-edik`, `postgres-agence-nuisibles-crm`, `kerkouaz-akead`, `bilfrais-explore`, `gondole-akead-test-db`) were not touched.
