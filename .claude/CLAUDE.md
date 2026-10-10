# create-faster - Project Documentation

Modern, type-safe CLI scaffolding tool for quickly creating production-ready projects with multiple framework combinations.

**Version**: 1.2.0
**Installation**: `bunx create-faster`
**License**: MIT

## Overview

CLI tool that generates full-stack projects with:
- **Interactive & Non-interactive modes**: Full interactive prompts or CLI flags for automation
- Interactive prompts with custom TUI (ASCII art, section headers, grouped multiselect)
- Multi-app support (automatic turborepo for 2+ apps)
- Modular system (Next.js: 10 modules, Expo: 1 module, Hono: 1 module)
- Package manager selection (bun/pnpm/npm + auto-install)
- Template engine with YAML frontmatter for path resolution and filtering
- **Auto-generated CLI command**: Copy-paste ready command to recreate projects

## Architecture

### Monorepo Structure
```
apps/cli/        # Main CLI (TypeScript + Bun)
apps/www/        # Docs website (Next.js - planned)
packages/config/ # Shared tsconfig
templates/       # Handlebars templates
```

### CLI Flow
1. Parse CLI flags (if provided) → 2. ASCII intro → 3. Interactive prompts (skipped if flags provided) → 4. Validation → 5. Template resolution → 6. File generation (package.json + .env.example + Handlebars templates) → 7. Post-hooks (install deps, git init) → 8. Summary display with auto-generated CLI command

### Tech Stack
- **Runtime**: Bun 1.2.23
- **CLI**: @clack/prompts, commander, picocolors
- **Templates**: Handlebars
- **Validation**: Zod
- **Tooling**: Turborepo, Biome, TypeScript 5.9.3

## Declarative Choice Logic — NEVER hardcode (MANDATORY)

**Every agent MUST follow this. No exceptions without explicit approval from Pelavo.**

NEVER hardcode logic tied to a specific choice value (a stack, library, deployment, database, ORM, linter, blueprint, etc.) inside core/base logic — the resolver, file generator, flags parser, prompts engine, or any shared algorithm. Core code MUST stay agnostic to which specific choices exist.

Forbidden:
- A literal branch on a choice value in core logic: `if (deployment === 'cloudflare-static')`, `if (stack === 'nextjs')`, `if (library === 'better-auth')`.
- An incompatibility/compatibility/support list hardcoded in a `.ts` core file (e.g. `const CLOUDFLARE_STATIC_INCOMPATIBLE_LIBRARIES = [...]`). That data belongs in `META` (`__meta__.ts`), read generically.
- Choice-specific output paths, filtering, or skipping written as special cases in the resolver.

Required: choice-specific behavior is expressed through **reusable, documented operators** that the core logic applies generically:

- **Handlebars helpers** (`apps/cli/src/lib/handlebars.ts`): `eq`, `ne`, `and`, `or`, `isMono`, `hasLibrary(name)`, `has(category, value)`, `hasContext(key)`, `camelCase`, `raw`, `appPort(name)`. Express conditionals INSIDE templates: `{{#if (has "deployment" "cloudflare")}}…{{/if}}`.
- **Frontmatter keys** (`TemplateFrontmatter` in `apps/cli/src/types/meta.ts`, applied generically in `template-resolver.ts`): `path`, `mono` (`scope`/`name`/`path`), `only` (`mono|single|no-blueprint`), `deploymentPath` (`Record<deployment, path>` — output path override keyed by deployment, NOT a hardcoded resolver branch), `deploymentSkip` (`deployment[]` — the file is not generated under a listed deployment), `blueprintSkip` (`blueprint[]` — the file is not generated for a listed blueprint). `only` and the deployment/blueprint skip keys are honored for every template kind (stack, library, project addon, stack-suffixed addon, repo, blueprint). These are the model: a generic key the resolver honors for ANY value.
- **META data** (`__meta__.ts`): `support`, `require`, `mono`, `packageJson`, `stackPackageJson`, `deploymentPackageJson` (`Record<deployment, PackageJsonConfig>` — package.json contribution merged generically by `package-json-generator` when `ctx.project.deployment` matches a key; e.g. `postgres` adds `pg-cloudflare` under `cloudflare`), `envs` (`EnvVar`: `value`, `monoScope`, optional `stacks: StackName[]` — when set, the variable is emitted only for apps whose stack is listed; evaluated per app by `env-generator`, so one project can carry `NEXT_PUBLIC_X` on Next.js apps and `VITE_X` on TanStack Start apps; a root/pkg-scoped variable with `stacks` is emitted when at least one app (with the library, for library envs) has a listed stack), category-level and addon-level `require`. Compatibility/dependency rules live here as data, validated generically.
- **`$when` conditions** (`apps/cli/src/lib/when.ts`, wrap package.json values/array items in `__meta__.ts`): keys `repo`, `stack`, `library` and any `ProjectContext` category (`database`, `orm`, `deployment`, `linter`, `tooling`); value is a string, a list (any-of) or `true` (category has a selection). Every key accepts a negation, `{ not: <value> }`, true when the positive match is false: `$when({ deployment: { not: 'cloudflare' } }, …)` or `$when({ deployment: { not: ['cloudflare', 'cloudflare-static'] } }, …)`. An unselected category satisfies any `not` (`{ not: 'cloudflare' }` is true when no deployment is chosen; `{ not: true }` is true only when the category is unselected); `stack`/`library` follow their any-app semantics (`{ not: 'nextjs' }` is true only when no app uses nextjs). All keys of one `$when` must hold.
- **package.json script placeholders** (resolved generically by `resolveScriptPlaceholders` in `addon-utils.ts`, applied to every generated package.json's scripts): `{{workspaceRoot}}` (repo-relative path to the monorepo root — `.` single, `../..` turbo) and `{{deployAppDir}}` (directory name of the app that consumes the deployment binding — the deployment's `stackPackageJson` stacks, preferring an app with a `needsSingletonDb` library; resolved by `resolveDeployAppDir`). Author topology-dependent script strings with these tokens in META; combine with `deploymentPackageJson` + `$when` for repo/deployment splits — never compute app paths in the generator. e.g. the d1 turbo migrate script is `wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --local --persist-to {{workspaceRoot}}/.wrangler`.

When you need choice-conditional behavior and no operator covers it, the correct move is to **add a new generic operator** (a Handlebars helper or a frontmatter key handled generically by the resolver) and **document it in this file under Template System** — never to special-case a value in core code. Generalize first, then use it.

This is what keeps the tool extensible: adding the next stack/library/deployment must require only a META entry + templates, never edits to core algorithms.

## Project Structure

```
apps/cli/src/
├── index.ts                 # Entry point
├── cli.ts                   # Main CLI flow (interactive mode)
├── flags.ts                 # CLI flags parser & validator
├── __meta__.ts              # Stacks & modules metadata
├── types/
│   ├── meta.ts              # Metadata types (MetaStack, MetaCategory, etc.)
│   └── ctx.ts               # Context types (AppContext, TemplateContext)
├── prompts/
│   ├── base-prompts.ts      # Context-aware prompt wrappers
│   └── stack-prompts.ts     # Custom stack selection with sections, library category grouping
├── lib/
│   ├── constants.ts         # ASCII art, version, paths
│   ├── schema.ts            # Zod validation
│   ├── template-resolver.ts # Template discovery & path mapping
│   ├── template-processor.ts # Template rendering
│   ├── frontmatter.ts       # YAML frontmatter parsing (gray-matter)
│   ├── handlebars.ts        # Custom Handlebars helpers
│   ├── env-generator.ts     # Programmatic .env.example generation
│   ├── addon-utils.ts       # Library/addon compatibility helpers
│   ├── package-json-generator.ts # Programmatic package.json generation
│   ├── file-generator.ts    # File generation orchestration
│   ├── file-writer.ts       # File writing operations
│   └── post-generation.ts   # Post-gen hooks (install, git)
└── tui/
    ├── symbols.ts           # Unicode symbols
    ├── progress.ts          # Progress indicator
    └── summary.ts           # Summary display & CLI command generation
```

## Core Files

### __meta__.ts
Single source of truth for all stacks, libraries, and project addons:
- `META.stacks`: App and server stacks (Next.js, Expo, Hono, TanStack Start) with `type: 'app' | 'server'` field
- `META.libraries`: Per-app addons (shadcn, better-auth, etc.) with category/support/require/mono/packageJson/envs
- `META.project`: Project-level categories (database, orm, linter, tooling) with prompt config and options
- `META.repo`: Repository types (single, turborepo)
- `META.blueprints`: Pre-composed project templates with preset context, deps, and envs
- Addons declare `packageJson` for dependencies and `envs` for environment variables
- Category-level `require` (e.g., orm requires database)
- Addon-level `require` (e.g., husky requires git, better-auth requires orm); `require.stacks` requires at least one app on a listed stack (e.g. `cloudflare-static` requires a nextjs app)
- Server-runtime capability: a library declares `needsServerRuntime: true` (e.g. better-auth, trpc); a deployment declares `providesServerRuntime: false` for static-only targets. Read generically by `isServerRuntimeSatisfied` — a server-less deployment is unavailable when any selected library needs a runtime
- Singleton-db capability: a database declares `serverlessBinding` (it is accessed per-request through a Cloudflare binding, no module singleton — `d1`, and `postgres`/`mysql` via Hyperdrive); a deployment declares `providesDbBindings: true` (Cloudflare); a library declares `needsSingletonDb: true` (better-auth, trpc — they consume a module-singleton `db`). A binding database whose server-side consumers are wired per-request declares `serverlessConsumersWired: true` (`d1`). Read generically by `isSingletonDbSatisfied` — a binding-based database (under a binding-providing deployment) is unavailable when any selected library needs a singleton db, UNLESS the database has its consumers wired. `d1` is wired (better-auth/trpc build per-request via `getDb()`/`getAuth()` from the app-side `src/lib/server.ts`, gated by `{{#if (has "database" "d1")}}` in `auth.ts`/`trpc` templates); `postgres`/`mysql` on Cloudflare remain disabled with better-auth/trpc until their consumers are wired too
- Single-select project prompts surface incompatibility instead of hiding it: `getCategoryOptionUnavailability` (addon-utils) returns a generic, META-derived reason (from `require`/`isServerRuntimeSatisfied`/library constraints) for any option, and `promptProjectCategorySingle` renders unavailable options disabled (dim, non-selectable) with that reason — no hardcoded choice value

### types/meta.ts
- `StackName`: `'nextjs' | 'expo' | 'hono' | 'tanstack-start'`
- `MonoScope`: `'app' | 'pkg' | 'root'`
- `EnvScope`: `'app' | 'root' | { pkg: string }` — env var target location
- `EnvVar`: `{ value: string; monoScope: EnvScope[]; stacks?: StackName[] }` — env variable declaration; `stacks` limits it to apps on a listed stack
- `MetaAddon`: Addon metadata (label, hint, category, support, require, mono, packageJson, envs)
- `MetaProjectCategory`: Project category with prompt config and options
- `MetaBlueprint`: Blueprint metadata (label, hint, category, context, packageJson, envs)
- `MetaStack`: Stack metadata (type, label, hint, packageJson)

### types/ctx.ts
- `AppContext`: `{ appName, stackName, libraries }`
- `ProjectContext`: `{ database?, orm?, deployment?, linter?, tooling[] }`
- `TemplateContext`: Full context with projectName, repo, apps[], project, git, pm, blueprint?
- `PackageManager`: `'bun' | 'npm' | 'pnpm' | undefined`

### flags.ts
CLI flags parser using Commander:
- `parseFlags()`: Parses CLI arguments and returns `Partial<TemplateContext>`
- `parseAppFlag()`: Parses `--app name:stack:modules` format
- `validateContext()`: Validates dependencies (orm requires database, husky requires git, etc.)
- **Format**: `--app <name:stack:modules>` (unified format for all apps)
- Validation against META with helpful error messages showing available options
- Auto-generated help with examples

### cli.ts
Main CLI flow with functions:
- `cli(partial?: Partial<TemplateContext>)`: Returns TemplateContext (without repo type)
- Accepts optional partial context from flags - skips prompts if values provided
- `promptAllApps()`: Handles 1 or N apps
- `promptApp()`: Single app config (name, stack, modules) - Simplified, no server prompt
- `promptStackConfiguration()`: Custom TUI with sections for unified stack selection
- Package manager prompt: 4 options (bun/pnpm/npm/skip)

### index.ts
Entry point:
- Parses CLI flags via `parseFlags()`
- Displays ASCII intro (skipped if flags provided)
- Calls `cli(partial)` with pre-filled context
- Determines repo type (app count > 1 = turborepo)
- Generates files + runs post-hooks
- Displays project structure, auto-generated CLI command, and next steps

### tui/summary.ts
Summary and CLI command generation:
- `buildCliCommand(ctx)`: Generates copy-paste ready CLI command from context
- `displayCliCommand(ctx)`: Displays command in styled note box
- `displayProjectStructure(ctx)`: Shows project structure tree
- `displayStepsNote(ctx)`: Shows next steps with package manager-specific commands

### lib/template-resolver.ts
- Scans templates with fast-glob
- `resolveDestination()`: Path resolution using frontmatter + META mono config
- `parseStackSuffix()`: Detects `file.ext.{stack}.hbs` naming convention
- `resolveDestination()` applies the generic frontmatter `deploymentPath` override (e.g. Next.js proxy.ts → middleware.ts on Cloudflare) for every template kind; `isSkippedForDeployment()` applies `deploymentSkip` likewise
- Maps source → destination paths (app/pkg/root scope)

### lib/frontmatter.ts
YAML frontmatter parsing using gray-matter:
- `parseFrontmatter()`: Extracts frontmatter data and content
- `shouldSkipTemplate()`: Checks `only: mono|single` filter
- `removeFrontmatter()`: Strips frontmatter before rendering
- `parseStackSuffix()`: Stack-specific template detection

### lib/handlebars.ts
Custom helpers:
- Logical: `eq`, `ne`, `and`, `or`
- Repo: `isMono()` - Check if turborepo
- Libraries: `hasLibrary(name)` - Check if current app has library
- Project: `has(category, value)` - Check database/orm/linter/tooling/stack
- Context: `hasContext(key)` - Check if key exists in context
- Utils: `appPort(name)` - Get port for app (3000 + index)

### lib/env-generator.ts
Programmatic `.env.example` file generation:
- `collectEnvFiles(ctx)`: Collects envs from META, resolves scopes to paths, returns `{ destination, content }[]`
- `collectEnvGroups(ctx)`: Returns `{ path, vars[] }[]` for README rendering
- Resolves `{{projectName}}` and `{{appPort}}` placeholders in env values
- Scope resolution: `{ pkg: 'db' }` → `packages/db/.env.example`, `'app'` → `apps/{appName}/.env.example`
- Library envs: only apps with that library. Project addon envs: all apps. An env with `stacks` is further limited to apps on a listed stack (root/pkg-scoped: emitted when at least one app, with the library for library envs, qualifies).
- Single repos: all scopes collapse to root `.env.example`, deduped by key

### lib/post-generation.ts
- Dependency installation: Runs `${ctx.pm} install` (5min timeout, graceful errors)
- Git init: Runs `git init` (10sec timeout, graceful errors)
- Uses spinners for feedback

## Supported Stacks

### Frameworks & Modules
- **Next.js**: shadcn/ui, next-themes, mdx, pwa, better-auth, trpc, tanstack-query, tanstack-devtools, react-hook-form, tanstack-form, evlog, posthog, vitest, playwright
- **Expo**: nativewind, jest-expo
- **Hono**: aws-lambda, vitest-node, evlog
- **TanStack Start**: shadcn/ui, next-themes, react-hook-form, tanstack-query, tanstack-devtools, evlog, vitest, playwright

### Deployment
- **Cloudflare Workers** (`cloudflare`): Hono (Wrangler), Next.js (OpenNext), TanStack Start (`@cloudflare/vite-plugin`, no Nitro). A Start app drops `nitro` and the Nitro `start` script through `$when({ deployment: { not: 'cloudflare' } })`, `vite.config.ts.hbs` swaps `nitro()` for `cloudflare()` under `has "deployment" "cloudflare"`, and `.env.start` carries `deploymentSkip: [cloudflare]`. With D1, `src/lib/server.ts.tanstack-start.hbs` builds `db` once at module scope from `cloudflare:workers` (the db package factory stays `createDb(d1)`); with Hyperdrive, consumers call `await createDb(env.HYPERDRIVE)` per request.

Libraries are grouped by category in the interactive prompt (UI, Content, Auth, API, Data Fetching, Forms, Deploy, Observability, Analytics, Testing).

### Testing
- **Vitest**: unit/component runner — `vitest` (React: Next.js, TanStack Start; with jsdom + Testing Library) and `vitest-node` (node env: Hono, Node). Scripts: `test`, `test:watch`, `test:coverage`.
- **Playwright**: end-to-end for web apps (Next.js, TanStack Start). App-scoped config; scripts `test:e2e`, `test:e2e:ui`.
- **Jest (Expo)**: `jest-expo` preset + React Native Testing Library for Expo apps.

### Data Layer
- **Database**: PostgreSQL, MySQL
- **ORM**: Prisma, Drizzle (both with Better Auth integration)

### Dev Tools
- **Linter**: Biome, Oxlint + Oxfmt (`oxc`), ESLint + Prettier, ESLint, Prettier (single selection). `oxc` generates root `oxlint.config.mts` + `oxfmt.config.mts` with one override per app (native plugins by stack/library, `@shadcn/lint` JS plugin when the app uses shadcn)
- **Extras**: Husky (requires git)
- **Repo**: Single or Turborepo (auto-determined by app count)

## Current Status

### ✅ Implemented
- TUI system (ASCII art, custom prompts, grouped multiselect, Unicode symbols)
- Type system refactor (types/meta.ts, types/ctx.ts with Meta* prefix)
- Package manager selection (bun/pnpm/npm/skip + auto-install + smart command suggestions)
- **CLI Flags Support**: Non-interactive mode with Commander.js
  - Unified `--app name:stack:modules` format for all apps
  - Full validation against META with helpful error messages
  - Mix of interactive and flag-based configuration
  - Auto-generated CLI command for project recreation
- **Unified Stack Architecture**: Merged `META.app` and `META.server` into single `META.stacks` with `type` field
- **Simplified AppContext**: From `{appName, metaApp?, metaServer?}` to `{appName, stackName, modules}`
- Modules system (nested in stacks, per-app selection, context-aware)
- Complete Expo support (full templates + assets)
- Enhanced Next.js templates (error pages, app providers, custom hooks)
- Better Auth integration (user/account/session tables for Prisma & Drizzle)
- Frontmatter system (YAML-based path resolution, repo filtering, stack suffixes)
- Context-aware filtering (category & stack requires, progressive context building)
- Template resolution with module support
- Scope-aware path mapping (app/package/root + dynamic override)
- File generation with Handlebars rendering
- Post-generation hooks with graceful error handling
- Template naming: `__` prefix for special files
- **Programmatic env generation**: Env vars declared in META, `.env.example` files generated per scope (pkg/app/root)
- **Blueprints**: Pre-composed project templates with preset stacks/libs/addons + application code
  - `--blueprint` CLI flag with mutual exclusion against composition flags
  - Interactive "template vs custom" prompt when blueprints exist
  - Blueprint template resolution with override semantics (blueprint files win over structural)
  - Dashboard blueprint: Next.js + shadcn + better-auth + tanstack-query + drizzle + postgres

### 🚧 In Progress
- More Hono templates & middleware
- More modules (i18n, Storybook)
- Enhanced error handling & rollback

### 📋 Planned
- Web UI alternative
- Custom template directories
- Config save/load
- More frameworks (Solid, Qwik, Remix, SvelteKit, Astro)
- Testing frameworks modules

## Template System

### Structure
```
templates/
├── stack/{framework}/       # Next.js, Expo, Hono, TanStack Start
├── libraries/{library}/     # Per-app library templates
├── project/orm/{provider}/  # Prisma, Drizzle
├── project/linter/{linter}/ # Biome, Oxc, ESLint, Prettier
├── project/tooling/{tool}/  # Husky
├── blueprints/{blueprint}/   # Blueprint application code (override semantics)
└── repo/{type}/             # Single, Turborepo configs
```

### File Naming
- Template files: `filename.extension.hbs`
- Special files: `__gitignore.hbs` → `.gitignore`, `__npmrc.hbs` → `.npmrc`
- Stack-specific: `file.ext.{stack}.hbs` (e.g., `tailwind.config.ts.nextjs.hbs`)
- `.env.example` files are generated programmatically (not templates)

### Handlebars Context
- `{{projectName}}`, `{{appName}}`, `{{repo}}`
- `{{stackName}}`, `{{modules}}` - Simplified app context
- `{{orm}}`, `{{database}}`, `{{git}}`, `{{pm}}`, `{{extras}}`
- Access stack metadata: `{{#with (app "myapp")}}{{stackName}}{{/with}}`

### Frontmatter
YAML frontmatter for per-file configuration:
```yaml
---
path: src/lib/db/schema.ts    # Output path for single repo
mono:
  scope: app | pkg | root     # Monorepo scope (overrides META)
  path: schema.ts             # Monorepo path (relative to scope)
only: mono | single           # Repo type filter
deploymentPath:               # Output path override keyed by deployment platform
  cloudflare: src/middleware.ts
deploymentSkip:               # Deployment platforms that do not get this file
  - cloudflare-static
blueprintSkip:                # Blueprints that do not get this file
  - org-dashboard
---
```

#### `deploymentPath` (deployment-specific output path)
`deploymentPath` is a generic map of `{ <deployment platform>: <relative path> }`. When `ctx.project.deployment` matches a key, that path replaces the file's default output path (applied by `resolveDestination()` in `template-resolver.ts`, honored for **every template kind**: stack, library, project addon, repo, blueprint). It takes precedence over `path` / `mono.path`. The replacement is the pre-scope relative path, so monorepo scoping still applies on top (`apps/{appName}/`, `packages/{name}/`, or root depending on the kind).

#### `deploymentSkip` (deployment-specific exclusion)
`deploymentSkip` is a list of deployment platforms. When `ctx.project.deployment` is in the list, the template is not generated (checked by `isSkippedForDeployment()` in `template-resolver.ts` for every template kind). Use it instead of wrapping a whole file in `{{#if (has "deployment" …)}}`, which would emit an empty file.

#### `blueprintSkip` (blueprint-specific exclusion)
`blueprintSkip` is a list of blueprint names. When `ctx.blueprint` is in the list, the template is not generated (checked by `isSkippedForBlueprint()` in `template-resolver.ts` for every template kind). Use it only when a blueprint ships its own version of a file at a DIFFERENT destination than the generic template it supersedes, so the blueprint override-by-destination rule cannot replace it; when both land on the same destination, the blueprint file already wins and no entry is needed. Example: the drizzle `scripts/seed.ts.hbs` lands in `packages/db/scripts/` in a turborepo, while `org-dashboard`, `multitenant-saas` and `cloudflare-fullstack` keep their own root `scripts/seed.ts` there, so they list themselves (`dapp-privy` is single-repo, its seed shares the generic destination, so it does not).

**Why `deploymentPath` exists** — `templates/stack/nextjs/src/proxy.ts.hbs` declares `deploymentPath.cloudflare: src/middleware.ts`. Next.js 16's `proxy.ts` convention runs middleware on the **Node.js runtime**, which OpenNext (Cloudflare) does not support (`ERROR Node.js middleware is not currently supported`). The legacy `middleware.ts` convention compiles to the **Edge runtime** that OpenNext supports. So a Next.js app deployed to Cloudflare emits `src/middleware.ts` instead of `src/proxy.ts` (the template also renders the exported function name + log label as `middleware`/`MIDDLEWARE` vs `proxy`/`PROXY` via `{{#if (has "deployment" "cloudflare")}}`). Keep this declarative in frontmatter — do not special-case deployment/stack/filename in the core resolver.

### Scope Mapping
- `app` → `apps/{appName}/` (turborepo) or root (single)
- `package` → `packages/{packageName}/` (turborepo only)
- `root` → project root

### Path Resolution Algorithm
1. Parse frontmatter (if present)
2. Filter by `only` (skip if repo type doesn't match)
3. Skip the file if `ctx.project.deployment` is listed in `deploymentSkip`, or `ctx.blueprint` in `blueprintSkip`
4. Apply `deploymentPath` override if `ctx.project.deployment` matches a key (overrides `path` / `mono.path`)
5. Single repo: use `frontmatter.path` or file-based path
6. Monorepo: use `frontmatter.mono.scope` or META `mono.scope` or default `app`
   - `app` → `apps/{appName}/`
   - `pkg` → `packages/{META.mono.name}/`
   - `root` → project root

## Agent-Generated Documentation

All documentation produced by AI agents (research reports, plans, audits, cleanup assessments, etc.) MUST be written under `docs/agents/`, organized by topic (e.g., `docs/agents/cleanup/`, `docs/agents/superpowers/plans/`). Never write agent-generated docs to `docs/` root or other locations.

## Code Conventions

### Naming
- **Enums/Values**: lowercase kebab-case (`nextjs`, `hono`, `better-auth`)
- **Types**: PascalCase (`MetaStack`, `AppContext`)
- **Functions**: camelCase (`promptText`, `getAllTemplatesForContext`)
- **Files**: lowercase (`schema.ts`, `prompts.ts`)
- **Special files**: dunder (`__meta__.ts`)
- **Templates**: `feature.extension.hbs`
- **App names**: User-provided
- **Server apps**: `{appName}-server`
- **Package names**: Defined in META (e.g., `db` for ORM)

### Type Safety
- Strict TypeScript
- Zod for runtime validation
- Type inference from constants (META)
- No `any` types
- `as const satisfies` pattern

### Import Aliases
- `@/*` → `src/*`

### Error Handling
- Early returns
- Validation-first
- Graceful cancellation
- Unified error handling in prompt wrappers

## Development Workflow

### Scripts
```bash
bun install                  # Setup
bun run dev:cli              # Test CLI in watch mode
bun run build:cli            # Build single executable
bun run check                # Format + check (Biome)
bun run lint                 # Lint with auto-fix
bun run format               # Format all files
bun run check:unused         # Find unused deps (knip)
bun run clean                # Remove build artifacts
```

### Building CLI
```bash
bun build src/index.ts --outfile create-faster --target bun --production --banner '#!/usr/bin/env node'
```
Creates single executable with shebang.

### Publishing
```bash
cd apps/cli && npm publish   # Runs prepublishOnly → build + chmod +x
```

## CLI Flags Usage

### Interactive Mode (Default)
```bash
bunx create-faster
# Guided prompts for all options
```

### Non-Interactive Mode (Flags)

**Single app:**
```bash
bunx create-faster myapp \
  --app myapp:nextjs:shadcn,mdx \
  --database postgres \
  --orm drizzle \
  --linter biome \
  --tooling husky \
  --git \
  --pm bun
```

**Multi-app (Turborepo):**
```bash
bunx create-faster mysaas \
  --app web:nextjs:shadcn,tanstack-query \
  --app mobile:expo:nativewind \
  --app api:hono \
  --database postgres \
  --orm drizzle \
  --linter eslint \
  --tooling husky \
  --git \
  --pm bun
```

**Mixed mode (partial flags):**
```bash
bunx create-faster myapp \
  --app myapp:nextjs:shadcn \
  --database postgres
# Will prompt for missing options (ORM, linter, git, pm, tooling)
```

### Available Flags

- `--blueprint <name>`: Use a blueprint template (mutually exclusive with --app/--database/--orm; can combine with --linter/--tooling)
  - Example: `--blueprint dashboard`
  - Blueprints define apps, libraries, database, and ORM; linter/tooling are user-chosen

- `--app <name:stack:modules>`: Add app (repeatable for multi-app)
  - Format: `name:stack` or `name:stack:module1,module2`
  - Example: `--app web:nextjs:shadcn,mdx`
  - Stacks: `nextjs`, `expo`, `hono`

- `--database <name>`: Database provider
  - Options: `postgres`, `mysql`

- `--orm <name>`: ORM provider (requires database)
  - Options: `prisma`, `drizzle`

- `--linter <name>`: Linter
  - Options: `biome`, `oxc`, `eslint-prettier`, `eslint`, `prettier`

- `--tooling <name>`: Add tooling (repeatable)
  - Options: `husky` (requires git)

- `--git`: Initialize git repository

- `--pm <manager>`: Package manager
  - Options: `bun`, `npm`, `pnpm`

### Auto-Generated Command

After project creation, a copy-paste ready command is displayed:

```
┌  🔁 Recreate this project
│
│  create-faster mysaas \
│    --app web:nextjs:shadcn,mdx \
│    --app mobile:expo:nativewind \
│    --database postgres \
│    --orm drizzle \
│    --linter biome \
│    --tooling husky \
│    --git \
│    --pm bun
│
└
```

This allows easy reproduction of the exact same project setup.

## Adding New Content

### Add Stack
1. Add to `META` in `__meta__.ts`
2. Create `templates/{category}/{stack}/` directory
3. Add `.hbs` files with frontmatter if needed
4. Test with `bun run dev:cli`

### Add Module
1. Add to `META.{framework}.stacks.{name}.modules` in `__meta__.ts`
2. Create `templates/modules/{framework}/{module}/` directory
3. Add frontmatter for path/scope override if needed
4. Test module selection in CLI

### Add Blueprint
1. Add entry to `META.blueprints` in `__meta__.ts` with label, hint, category, context (apps + project with database/orm only), optional packageJson and envs
2. Create `templates/blueprints/{blueprint-name}/` directory with `.hbs` template files
3. Blueprint templates override structural templates with the same destination path
4. Use frontmatter for path/scope configuration (same as libraries)
5. Test with `bun run dev:cli` and `--blueprint {name}` flag
