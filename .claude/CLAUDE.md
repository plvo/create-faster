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
- Modular system (Next.js: 9 modules, Expo: 1 module, Hono: 1 module)
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
1. Parse CLI flags (if provided) → 2. ASCII intro → 3. Interactive prompts (skipped if flags provided) → 4. Validation → 5. Template resolution → 6. Handlebars rendering → 7. File generation → 8. Post-hooks (install deps, git init) → 9. Summary display with auto-generated CLI command

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
├── cli.ts                   # Main CLI flow (interactive mode)
├── flags.ts                 # CLI flags parser & validator
├── __meta__.ts              # Stacks & modules metadata
├── types/
│   ├── meta.ts              # Metadata types (MetaStack, MetaCategory, etc.)
│   └── ctx.ts               # Context types (AppContext, TemplateContext)
├── prompts/
│   ├── base-prompts.ts      # Context-aware prompt wrappers
│   └── stack-prompts.ts     # Custom stack selection with sections
├── lib/
│   ├── constants.ts         # ASCII art, version, paths
│   ├── schema.ts            # Zod validation
│   ├── template-resolver.ts # Template discovery & path mapping
│   ├── template-processor.ts # Template rendering
│   ├── frontmatter.ts       # YAML frontmatter parsing (gray-matter)
│   ├── handlebars-utils.ts  # Custom Handlebars helpers
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
Single source of truth for all stacks and modules:
- `META.stacks`: Unified app and server stacks (Next.js, Expo, Hono) with `type: 'app' | 'server'` field
- Each stack has `label`, `hint`, `type`, `scope`, optional `requires`, and optional `modules`
- `META.database`, `META.orm`, `META.extras`, `META.repo`
- Category-level `requires` (e.g., orm requires database)
- Stack-level `requires` (e.g., husky requires git)

### types/meta.ts
- `MetaStack`: Stack metadata (label, hint, type: 'app' | 'server', scope, requires, modules)
- `MetaModules`: Grouped modules (UI & Styling, Features, etc.)
- `StackName`: Type alias for `keyof Meta['stacks']`
- `Category`: 'orm' | 'database' | 'extras' | 'repo' (no longer includes 'app' | 'server')

### types/ctx.ts
- `AppContext`: { appName, stackName, modules } - Simplified flat structure
- `TemplateContext`: Full context with projectName, repo type, apps[], orm, database, git, pm, extras
- `PackageManager`: 'bun' | 'npm' | 'pnpm' | undefined

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
- `resolveAddonDestination()`: Path resolution using frontmatter + META mono config
- `parseStackSuffix()`: Detects `file.ext.{stack}.hbs` naming convention
- Maps source → destination paths (app/pkg/root scope)

### lib/frontmatter.ts
YAML frontmatter parsing using gray-matter:
- `parseFrontmatter()`: Extracts frontmatter data and content
- `shouldSkipTemplate()`: Checks `only: mono|single` filter
- `removeFrontmatter()`: Strips frontmatter before rendering
- `parseStackSuffix()`: Stack-specific template detection

### lib/handlebars-utils.ts
Custom helpers:
- Logical: `eq`, `ne`, `and`, `or`, `includes`
- Stack: `isAppStack(app)`, `isServerStack(app)` - Check stack type
- Modules: `hasModule(moduleName)`, `moduleEnabled(moduleName)` - Check app modules
- Repo: `isTurborepo()`, `isSingleRepo()`
- Context: `hasContext(key)`, `hasAnyStack(stackName)` - Check if any app uses stack
- Utils: `app(name)`, `appPort(name)`, `kebabCase`, `pascalCase`, `databaseUrl()`

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

### 🚧 In Progress
- More Hono templates & middleware
- More modules (tRPC, i18n, Storybook)
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
---
```

### Scope Mapping
- `app` → `apps/{appName}/` (turborepo) or root (single)
- `package` → `packages/{packageName}/` (turborepo only)
- `root` → project root

### Path Resolution Algorithm
1. Parse frontmatter (if present)
2. Filter by `only` (skip if repo type doesn't match)
3. Single repo: use `frontmatter.path` or file-based path
4. Monorepo: use `frontmatter.mono.scope` or META `mono.scope` or default `app`
   - `app` → `apps/{appName}/`
   - `pkg` → `packages/{META.mono.name}/`
   - `root` → project root

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
  --git \
  --pm bun \
  --extras biome,husky
```

**Multi-app (Turborepo):**
```bash
bunx create-faster mysaas \
  --app web:nextjs:shadcn,tanstack-query \
  --app mobile:expo:nativewind \
  --app api:hono \
  --database postgres \
  --orm drizzle \
  --git \
  --pm bun \
  --extras biome,husky
```

**Mixed mode (partial flags):**
```bash
bunx create-faster myapp \
  --app myapp:nextjs:shadcn \
  --database postgres
# Will prompt for missing options (ORM, git, pm, extras)
```

### Available Flags

- `--app <name:stack:modules>`: Add app (repeatable for multi-app)
  - Format: `name:stack` or `name:stack:module1,module2`
  - Example: `--app web:nextjs:shadcn,mdx`
  - Stacks: `nextjs`, `expo`, `hono`

- `--database <name>`: Database provider
  - Options: `postgres`, `mysql`

- `--orm <name>`: ORM provider (requires database)
  - Options: `prisma`, `drizzle`

- `--git`: Initialize git repository

- `--pm <manager>`: Package manager
  - Options: `bun`, `npm`, `pnpm`

- `--extras <items>`: Comma-separated extras
  - Options: `biome`, `husky` (husky requires git)

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
│    --git \
│    --pm bun \
│    --extras biome,husky
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
