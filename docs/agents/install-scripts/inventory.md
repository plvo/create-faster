# Dependency install scripts in generated projects (issue #301)

Working notes. Versions checked on 2026-10-16.

## Package manager behavior

| Manager | Version | Unreviewed dependency script |
|---|---|---|
| npm | 11.21.1 (11.6.2 installed locally, which does not know `allowScripts`) | runs, prints a notice listing the packages |
| npm | 12.2.0 | blocked, warning (`strict-allow-scripts` turns it into an error) |
| pnpm | 9.15.9 | runs, silent |
| pnpm | 10.0 to 10.25 | skipped, warning box (`Ignored build scripts`) |
| pnpm | 10.26 to 10.34.5 | skipped, warning box; `allowBuilds` read |
| pnpm | 11.28.2 and 12.11.2 | install fails: `ERR_PNPM_IGNORED_BUILDS` (exit 1) |
| bun | 1.4.1 | blocked unless trusted or in bun's default trusted list; prints `Blocked N postinstalls` |

Configuration surfaces:

- npm: `allowScripts` field of the root `package.json` (`{ "esbuild": true, "core-js": false }`, name or `name@version` keys, `false` is an explicit denial). A workspace `package.json` field is ignored with a warning, so it belongs to the turborepo root. Older npm ignores the unknown package.json field silently.
- pnpm: `allowBuilds` in `pnpm-workspace.yaml` (10.26+, 11, 12). `onlyBuiltDependencies` / `ignoredBuiltDependencies` are removed in 11 (silently ignored in the workspace file); the `pnpm` field of `package.json` is no longer read by pnpm 11+ (it warns). pnpm 10.0 to 10.25 ignore `allowBuilds` and keep the warning; pnpm 9 runs the scripts and ignores the key.
- pnpm 9 rejects a `pnpm-workspace.yaml` with no `packages` field (`packages field missing or empty`); `packages: ['.']` is accepted by 9, 10, 11 and 12, and `pnpm add` in the root keeps working on 10 and 12.
- bun: `trustedDependencies` in the root `package.json` (allow only). Declaring it replaces bun's built-in trusted list: with `["@prisma/engines"]`, bun blocked `prisma` too (`Blocked 2 postinstalls`), which it ran before. Not emitted.

## Inventory (npm lockfile `hasInstallScript`, generated projects, Linux)

| Package | Brought by | Script | Needed |
|---|---|---|---|
| `esbuild` (0.18, 0.25, 0.28) | `drizzle-kit`, Vite (TanStack Start, vitest), `@opennextjs/cloudflare`, wrangler, Hono Lambda build | `postinstall: node install.js` swaps the JS shim for the binary and validates it; the binary comes from the `@esbuild/*` optional dependency | no |
| `workerd` | wrangler, miniflare (`cloudflare`, `cloudflare-static`) | same design as esbuild | no |
| `fsevents` | file watchers (vite, vitest, expo, wrangler) | `install: node-gyp rebuild`, macOS only (optional dependency); ships a prebuilt `.node` | no |
| `@reown/appkit` | `dapp-privy-nextjs` | `postinstall`: version check | no |
| `core-js` | `pwa`, `posthog` | prints a donation notice | no |
| `prisma` | `prisma` ORM | `preinstall`: Node version check | no |
| `@prisma/engines` | `prisma` ORM | `postinstall`: downloads the schema engine binary (`failSilent`) | yes: the schema engine is downloaded lazily at first `migrate` or `db push` when skipped (verified), so a first run offline fails |
| `bufferutil`, `utf-8-validate`, `keccak` | `dapp-rainbowkit-nextjs`, `dapp-privy-nextjs` (wagmi, walletconnect) | `node-gyp-build`, optional native speedups with JS fallbacks | no |

No install script: `sharp`, `@libsql/client` / `libsql`, `better-sqlite3` (not used), `unrs-resolver`, Next.js alone.

Bun (default trusted list): only `core-js` is blocked in a toy project holding all the packages above; `esbuild`, `workerd`, `prisma`, `@prisma/engines`, `keccak`, `bufferutil` and `utf-8-validate` are trusted by default.

## Pre-existing problems found, out of scope

- `tanstack-start` with `evlog` fails `npm install` with ERESOLVE (`evlog@2.32.0` peerOptional `nitro@^3.0.260311-beta`, the project resolves `3.0.260903-beta`).
- `dapp-privy-nextjs` fails `npm install --package-lock-only` with ERESOLVE (issue #311). The npm inventory missed its scripts; a strict `pnpm@12` install lists them (`tests/e2e/install-scripts.test.ts`, which also installs every blueprint).

## Verification (Linux, 2026-10-16)

- npm 12.2.0, Cloudflare Next.js with D1, Drizzle, Better Auth, tRPC, PostHog, Biome: install prints no install-script warning, `npm install-scripts ls` reports none (without `allowScripts` it lists core-js, esbuild x3, workerd), `wrangler types` (runs workerd) in `postinstall`, `build:cf` and `db:generate` (esbuild 0.18) pass with the scripts skipped.
- npm 11.6.2 installs a project carrying `allowScripts` silently.
- pnpm 12.11.2 (strict), turborepo of Next.js, Hono, Expo and TanStack Start with Prisma, Cloudflare, oxc, portless: exit 0, only `@prisma/engines` builds.
- pnpm 11.28.2 single Next.js with MySQL, Prisma, SST: exit 0. pnpm 10.34.5 single TanStack Start with Cloudflare: no warning.
- pnpm 9, 10 and 12 accept `packages: [.]`; `pnpm add` in the root works on 10 and 12.
- bun 1.4.1: unchanged; `core-js` (and `prisma` once `trustedDependencies` exists) is the only package it blocks.
- macOS (`fsevents`) not run here: denial taken from its explicit `node-gyp rebuild` install script and the prebuilt binary it ships.
