# create-faster - Project Documentation

Modern, type-safe CLI scaffolding tool for quickly creating production-ready projects with multiple framework combinations.

**Version**: 1.1.3
**Installation**: `bunx create-faster`
**License**: MIT

## Overview

CLI tool that generates full-stack projects with:
- Interactive prompts with custom TUI (ASCII art, section headers, grouped multiselect)
- Multi-app support (automatic turborepo for 2+ apps)
- Modular system (Next.js: 9 modules, Expo: 1 module, Hono: 1 module)
- Package manager selection (bun/pnpm/npm + auto-install)
- Template engine with magic comments for conditional rendering

## Architecture

### Monorepo Structure
```
apps/cli/        # Main CLI (TypeScript + Bun)
apps/www/        # Docs website (Next.js - planned)
packages/config/ # Shared tsconfig
templates/       # Handlebars templates
```

### CLI Flow
1. ASCII intro → 2. Prompts (project, apps, database, ORM, extras, git, package manager) → 3. Validation → 4. Template resolution → 5. Handlebars rendering → 6. File generation → 7. Post-hooks (install deps, git init) → 8. Summary display

### Tech Stack
- **Runtime**: Bun 1.2.23
- **CLI**: @clack/prompts, commander, picocolors
- **Templates**: Handlebars
- **Validation**: Zod
- **Tooling**: Turborepo, Biome, TypeScript 5.9.3

## Project Structure

```
apps/cli/src/
├── index.ts                 # Entry point
├── cli.ts                   # Main CLI flow
├── constants.ts             # ASCII art, version, paths
├── __meta__.ts              # Stacks & modules metadata
├── types/
│   ├── meta.ts              # Metadata types (MetaStack, MetaCategory, etc.)
│   └── ctx.ts               # Context types (AppContext, TemplateContext)
├── prompts/
│   ├── base-prompts.ts      # Context-aware prompt wrappers
│   └── stack-prompts.ts     # Custom stack selection with sections
└── lib/
    ├── schema.ts            # Zod validation
    ├── template-resolver.ts # Template discovery & path mapping
    ├── template-processor.ts # Template rendering
    ├── magic-comments.ts    # Conditional rendering directives
    ├── handlebars-utils.ts  # Custom Handlebars helpers
    ├── file-generator.ts    # File generation orchestration
    ├── file-writer.ts       # File writing operations
    ├── post-generation.ts   # Post-gen hooks (install, git)
    └── tui.ts               # Unicode symbols & TUI utilities
```

## Core Files

### __meta__.ts
Single source of truth for all stacks and modules:
- `META.app`: Next.js, Expo (with nested `modules` per framework)
- `META.server`: Hono
- `META.database`, `META.orm`, `META.extras`, `META.repo`
- Category-level `requires` (e.g., orm requires database)
- Stack-level `requires` (e.g., husky requires git)

### types/meta.ts
- `PackageManager`: 'bun' | 'npm' | 'pnpm' | undefined
- `MetaStack`: Stack metadata (label, hint, hasBackend, requires, modules)
- `MetaModules`: Grouped modules (UI & Styling, Features, etc.)

### types/ctx.ts
- `AppContext`: { appName, metaApp?, metaServer? }
- `TemplateContext`: Full context with project name, repo type, apps[], orm, database, git, pm, extras

### cli.ts
Main CLI flow with functions:
- `cli()`: Returns TemplateContext (without repo type)
- `promptAllApps()`: Handles 1 or N apps
- `promptApp()`: Single app config (name, stack, modules, optional server)
- `promptStackConfiguration()`: Custom TUI with sections
- Package manager prompt: 4 options (bun/pnpm/npm/skip)

### index.ts
Entry point:
- Displays ASCII intro
- Calls `cli()`
- Determines repo type (app count > 1 = turborepo)
- Generates files + runs post-hooks
- `displaySummaryNote()`: Shows project summary & next steps with selected package manager

### lib/template-resolver.ts
- Scans templates with fast-glob
- `processModules()`: Unified module processing for apps & servers
- `scanModuleTemplates()`: Dynamic scope detection from magic comments
- Maps source → destination paths (app/package/root scope)

### lib/magic-comments.ts
First-line directives for conditional rendering:
- `@repo:turborepo|single|!single`
- `@scope:app|package|root`
- `@if:key`, `@require:key`
- Multi-condition support

### lib/handlebars-utils.ts
Custom helpers:
- Logical: `eq`, `ne`, `and`, `or`, `includes`
- App/Server: `hasApp()`, `hasServer()`, `isFullstack()`, `isStandaloneServer()`
- Modules: `hasModule()`, `hasServerModule()`
- Repo: `isTurborepo()`, `isSingleRepo()`
- Utils: `app()`, `appPort()`, `kebabCase`, `pascalCase`, `databaseUrl()`

### lib/post-generation.ts
- Dependency installation: Runs `${ctx.pm} install` (5min timeout, graceful errors)
- Git init: Runs `git init` (10sec timeout, graceful errors)
- Uses spinners for feedback

## Supported Stacks

### Frameworks & Modules
- **Next.js**: 9 modules (shadcn/ui, next-themes, mdx, pwa, better-auth, tanstack-query, tanstack-devtools, react-hook-form, tanstack-form)
- **Expo**: 1 module (nativewind)
- **Hono**: 1 module (aws-lambda)

### Data Layer
- **Database**: PostgreSQL, MySQL
- **ORM**: Prisma, Drizzle (both with Better Auth integration)

### Dev Tools
- **Extras**: Biome (linter/formatter), Git, Husky (requires git)
- **Repo**: Single or Turborepo (auto-determined by app count)

## Current Status

### ✅ Implemented
- TUI system (ASCII art, custom prompts, grouped multiselect, Unicode symbols)
- Type system refactor (types/meta.ts, types/ctx.ts with Meta* prefix)
- Package manager selection (bun/pnpm/npm/skip + auto-install + smart command suggestions)
- Platform/App/Server architecture (discriminated unions, type guards)
- Modules system (nested in META, per-app/server selection, context-aware)
- Complete Expo support (full templates + assets)
- Enhanced Next.js templates (error pages, app providers, custom hooks)
- Better Auth integration (user/account/session tables for Prisma & Drizzle)
- Magic comments system (@repo:, @scope:, @if:, @require:, negation, multi-condition)
- Context-aware filtering (category & stack requires, progressive context building)
- Template resolution with module support
- Scope-aware path mapping (app/package/root + dynamic override)
- File generation with Handlebars rendering
- Post-generation hooks with graceful error handling
- Template naming: `__` prefix for special files

### 🚧 In Progress
- More Hono templates & middleware
- More modules (tRPC, i18n, Storybook)
- Enhanced error handling & rollback

### 📋 Planned
- Non-interactive mode (CLI flags)
- Web UI alternative
- Custom template directories
- Config save/load
- More frameworks (Solid, Qwik, Remix, SvelteKit, Astro)
- Testing frameworks modules

## Template System

### Structure
```
templates/
├── app/{framework}/        # Next.js, Expo
├── server/{framework}/     # Hono
├── modules/{framework}/    # Framework-specific modules
├── orm/{provider}/         # Prisma, Drizzle
├── database/{provider}/    # PostgreSQL, MySQL configs
├── extras/{tool}/          # Biome, Husky
└── repo/{type}/            # Single, Turborepo configs
```

### File Naming
- Template files: `filename.extension.hbs`
- Special files: `__gitignore.hbs` → `.gitignore`, `__env.example.hbs` → `.env.example`, `__npmrc.hbs` → `.npmrc`
- Transformation automatic

### Handlebars Context
- `{{projectName}}`, `{{appName}}`, `{{repo}}`
- `{{metaApp.name}}`, `{{metaApp.modules}}`
- `{{metaServer.name}}`, `{{metaServer.modules}}`
- `{{orm}}`, `{{database}}`, `{{git}}`, `{{pm}}`, `{{extras}}`

### Magic Comments
First-line directives:
- `@repo:turborepo|single|!single` - Control rendering by repo type
- `@scope:app|package|root` - Override file placement
- `@if:key` / `@require:key` - Conditional rendering
- Multiple: `{{!-- @repo:turborepo @scope:package --}}`

### Scope Mapping
- `app` → `apps/{appName}/` (turborepo) or root (single)
- `package` → `packages/{packageName}/` (turborepo only)
- `root` → project root

### Module Scope Resolution
1. `@scope:` magic comment → use that
2. Else turborepo + `packageName` → `packages/{packageName}/`
3. Else → app scope

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

## Adding New Content

### Add Stack
1. Add to `META` in `__meta__.ts`
2. Create `templates/{category}/{stack}/` directory
3. Add `.hbs` files with magic comments
4. Test with `bun run dev:cli`

### Add Module
1. Add to `META.{framework}.stacks.{name}.modules` in `__meta__.ts`
2. Create `templates/modules/{framework}/{module}/` directory
3. Add magic comments for scope override if needed
4. Test module selection in CLI
