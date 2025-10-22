# create-faster - Project Documentation

Modern, type-safe CLI scaffolding tool for quickly creating production-ready projects with multiple framework combinations.

## Overview

**Purpose**: Eliminate repetitive project setup by providing a beautiful interactive CLI that generates production-ready projects with predefined tech stack configurations.

**Installation**: `bunx create-faster`

**Version**: 0.0.1 (Active development)

**License**: MIT

## Architecture

### Monorepo Structure (Turborepo)

```
create-faster/
├── apps/
│   ├── cli/          # Main CLI application (core product)
│   └── www/          # Marketing/docs website (Next.js)
├── packages/
│   ├── config/       # Shared TypeScript configurations
│   └── ui/           # Reusable UI components
└── templates/        # Handlebars template files
```

### Core Concepts

1. **Platform Types** (2025-10-22 Refactored)
   - `app`: Client-side applications (Next.js, Expo, Astro...)
   - `server`: Backend/API servers (Hono, Express...)
   - **No more** `web`/`mobile` distinction - unified as `app`

2. **App Configuration Types** (Discriminated Union)
   - **App only**: `{ app: 'nextjs', modules?: [...] }`
   - **Server only**: `{ server: 'hono', serverModules?: [...] }`
   - **Fullstack**: `{ app: 'nextjs', server: 'hono', modules?: [...], serverModules?: [...] }`
   - Type guards: `hasApp()`, `hasServer()`, `isStandaloneServer()`, `isFullstack()`

3. **Scope System**
   - `app`: Application-level templates → `apps/{name}/`
   - `package`: Shared package templates → `packages/{name}/`
   - `root`: Root-level config → `./`

4. **Auto-detection**
   - Turborepo mode when `apps.length > 1`
   - Single repo mode for single app projects

5. **Server Choice**
   - `builtin`: Use framework's built-in backend (Next.js API routes)
   - `hono`/`express`: Dedicated server in `{appName}-server/`
   - Standalone servers use app name directly

6. **Context-Aware Filtering**
   - Category-level `requires`: Dependencies between categories (e.g., `orm.requires = ['database']`)
   - Stack-level `requires`: Dependencies for specific stacks (e.g., `husky.requires = ['git']`)
   - Progressive context building: Each prompt updates shared context for dynamic filtering
   - Automatic skip: Prompts auto-skip when requirements not met with informative logs

7. **Modules System** (2025-10-21 + Server Support 2025-10-22)
   - **App modules**: shadcn, PWA, tRPC for Next.js | NativeWind for Expo
   - **Server modules**: OpenAPI, JWT for Hono | Passport, Helmet for Express
   - Separate `MODULES` metadata independent from core stacks
   - Module-specific `packageName` for turborepo package placement
   - Context-aware activation based on requirements
   - Per-framework AND per-server module selection

8. **Magic Comments System** (2025-10-21)
   - First-line directives for conditional template rendering
   - `@repo:` - Control rendering based on repo type (single/turborepo)
   - `@scope:` - Override default file placement (app/package/root)
   - `@if:` and `@require:` - Context-based conditions
   - Pre-scan optimization (reads only first line before rendering)
   - Negation support (`@repo:!single`)

### CLI Application Flow

```
User runs CLI
    ↓
Interactive prompts (@clack/prompts)
    ↓
Zod schema validation
    ↓
Template resolution engine
    ↓
Handlebars rendering (🚧 TODO)
    ↓
File generation (🚧 TODO)
```

### Tech Stack

#### Runtime & Tooling
- **Bun** 1.2.23 - Runtime, package manager, bundler
- **TypeScript** 5.9.3 - Type safety
- **Turbo** 2.5.8 - Monorepo orchestration
- **Biome** 2.2.6 - Fast linting + formatting
- **Husky** 9.1.7 - Git hooks

#### CLI Dependencies
- **@clack/prompts** 0.11.0 - Beautiful interactive prompts
- **commander** 14.0.1 - CLI argument parsing
- **handlebars** 4.7.8 - Template rendering
- **Zod** 4.1.12 - Runtime validation

#### Web App (apps/www/)
- **Next.js** 15.5.6 (App Router)
- **React** 19.1.0
- **Tailwind CSS** 4

#### Development Tools
- **Knip** 5.66.1 - Unused dependency analyzer
- **rimraf** 6.0.1 - Cross-platform file deletion

## Project Structure

```
create-faster/
├── apps/
│   ├── cli/                    # Main CLI package
│   │   ├── src/
│   │   │   ├── index.ts       # Entry point + CLI flow
│   │   │   ├── types.ts       # Core type definitions
│   │   │   ├── __meta__.ts    # Framework/stack metadata
│   │   │   └── lib/
│   │   │       ├── prompts.ts          # Reusable prompt helpers
│   │   │       ├── schema.ts           # Zod validation schemas
│   │   │       └── template-resolver.ts # Template discovery logic
│   │   └── templates/         # Handlebars templates
│   │       ├── app/{framework}/        # Next.js, Expo (was web/ + mobile/)
│   │       ├── server/{framework}/     # Hono, Express (was api/)
│   │       ├── modules/{framework}/    # shadcn, PWA, OpenAPI, JWT
│   │       ├── orm/{provider}/
│   │       ├── database/{provider}/
│   │       ├── extras/{tool}/
│   │       └── repo/turborepo/
│   └── www/                   # Documentation site (Next.js)
└── packages/
    └── config/                # Shared tsconfig
```

## Core Files & Responsibilities

### [apps/cli/src/__meta__.ts](apps/cli/src/__meta__.ts)
**Single source of truth** for all available stacks and modules
- **META**: Core stacks (platforms, frameworks, database, ORM, extras)
  - Category-level `requires`: Dependencies between entire categories (e.g., `orm.requires = ['database']`)
  - Stack-level `requires`: Dependencies for individual stacks (e.g., `husky.requires = ['git']`)
  - Types: `StackMeta`, `CategoryMeta`, `Meta`
  - Categories: `app`, `server`, database, orm, extras, repo (no more web/mobile)
- **MODULES**: App + Server modules (2025-10-22 Extended)
  - **App modules**: `MODULES.nextjs.shadcn`, `MODULES.expo.nativewind`
  - **Server modules**: `MODULES.hono.openapi`, `MODULES.express.passport`
  - Optional `packageName` for turborepo package placement
  - Support `requires` for module dependencies
  - Type: `ModuleMeta = Record<string, Record<string, StackMeta & { packageName?: string }>>`

### [apps/cli/src/types.ts](apps/cli/src/types.ts)
Core type definitions (2025-10-22 Refactored with clearer naming)
- **Naming Convention**: All Meta types prefixed with `Meta*` for consistency
- `Category`: `'app' | 'server'` | orm, database, extras, repo
- `Scope`: app, package, root (controls output path)
- **Meta Types**:
  - `MetaStack`: Stack metadata (label, hint, hasBackend, requires)
  - `MetaCategory`: Category metadata (scope, stacks, packageName, requires)
  - `Meta`: Record of all categories → `Record<Category, MetaCategory>`
  - `MetaModule`: Framework + server modules → `Record<string, Record<string, MetaModuleStack>>`
  - `MetaModuleStack`: Module stack metadata with optional `packageName`
- **`AppContext`**: Main app configuration (renamed from `App`)
  ```typescript
  {
    appName: string;
    metaApp?: { name: 'nextjs' | 'expo'; modules: string[] };
    metaServer?: { name: 'hono' | 'express' | 'builtin'; modules: string[] };
  }
  ```
- **Helper types** (local in files):
  - `MetaApp`: keyof `META.app.stacks` (nextjs, expo)
  - `MetaServer`: keyof `META.server.stacks` | 'builtin' (hono, express, builtin)
- `TemplateContext`: Runtime context for template resolution with `apps: AppContext[]`
- `ProcessResult`: Extended with `skipped?: boolean` and `reason?: string`

### [apps/cli/src/index.ts](apps/cli/src/index.ts)
Main CLI entry point (2025-10-22 Refactored with new structure)
- **Types**: Uses `AppContext` (not `App`), local `MetaApp` / `MetaServer` types
- **New flow**: App/Server platform choice → Framework → Modules → Optional server
- **Return structure**:
  ```typescript
  AppContext {
    appName: string,
    metaApp?: { name: 'nextjs', modules: ['shadcn'] },
    metaServer?: { name: 'hono', modules: ['openapi'] }
  }
  ```
- Handles multi-app configuration
- **Per-app module selection**: Filters `MODULES[framework]` and prompts multiselect
- **Per-server module selection**: Filters `MODULES[server]` for dedicated servers
- Context-aware database → ORM selection (ORM requires database)
- Git confirmation with boolean context
- Extras multi-selection with automatic filtering (husky requires git)
- Progressive `ctx` object updated after each prompt for dependency chain
- Generates files with `generateProjectFiles()` and runs post-generation hooks
- **3 use cases**: App only, Server only, Fullstack (app + server)

### [apps/cli/src/lib/schema.ts](apps/cli/src/lib/schema.ts)
Zod validation schemas (24 lines)
- Dynamically derives valid values from META
- Validates all user inputs before proceeding
- Type-safe runtime validation

### [apps/cli/src/lib/prompts.ts](apps/cli/src/lib/prompts.ts)
Context-aware prompt wrappers (124 lines)
- `filterOptionsByContext()`: Central filtering logic for category + stack requires
- `promptText()`: Open text input with validation
- `promptSelect()`: Single selection with auto-skip based on context
- `promptMultiselect()`: Multiple selection with auto-filter based on context
- `promptConfirm()`: Boolean confirmation prompt
- Unified cancellation/error handling
- Built on @clack/prompts

### [apps/cli/src/lib/template-resolver.ts](apps/cli/src/lib/template-resolver.ts)
Template discovery and path resolution with module support (2025-10-22 Extended with new structure)
- Scans template directory using Bun Glob and fast-glob
- **`processModules()`**: Unified module processing for apps AND servers
- **Adapted for `AppContext`**:
  - `app.metaApp?.name` → app framework
  - `app.metaApp.modules` → app modules
  - `app.metaServer?.name` → server framework
  - `app.metaServer.modules` → server modules
- **Module resolution**: `scanModuleTemplates()` for framework + server addons
- **Dynamic scope detection**: Reads first line of module templates for `@scope:` override
- **Server template resolution**: Handles `{appName}-server` for dedicated servers
- Maps source templates → destination paths
- Handles scope-aware paths:
  - `app` scope → `apps/{appName}/{path}` (or root in single mode)
  - `package` scope → `packages/{packageName}/{path}`
  - `root` scope → `{path}`
- **Smart defaults**: Uses `packageName` if turborepo, else app scope
- Detects single-file vs. monorepo layout
- Returns `TemplateFile[]` array ready for rendering

### [apps/cli/src/lib/magic-comments.ts](apps/cli/src/lib/magic-comments.ts)
Magic comments system for conditional template rendering (164 lines)
- **Directive types supported**:
  - `@repo:turborepo|single` - Render only in specific repo type
  - `@scope:app|package|root` - Override default file placement
  - `@if:key` - Render if context key exists and is truthy
  - `@require:key` - Render if context key equals true
  - Negation: `@repo:!single` - All except single
- **Functions**:
  - `parseMagicComments()` - Parse first line directives
  - `shouldSkipTemplate()` - Determine if template should be skipped
  - `validateMagicComments()` - Validate syntax and values
  - `formatMagicComments()` - Format for logging
- **Performance**: Pre-scan first line only, skip rendering if not needed
- **Multi-condition support**: `{{!-- @repo:turborepo @scope:package --}}`

### [apps/cli/src/lib/template-processor.ts](apps/cli/src/lib/template-processor.ts)
Template file processing with magic comments integration (2025-10-22 Extended with new structure)
- Processes binary files, text files, and Handlebars templates
- **Magic comments integration**: Pre-scans first line before rendering
- **Server context enrichment**: Detects `{appName}-server` pattern and injects server context
- **Adapted for `AppContext`**:
  - Detects `parentApp?.metaServer` for dedicated servers
  - Enriches context with `metaServer` object
- Context enrichment: Injects app-specific data for turborepo templates
- **Virtual server app context**: Creates context for dedicated servers with full `metaServer` object
- Returns `ProcessResult` with `skipped` and `reason` for skipped files
- File transformations: `_gitignore.hbs` → `.gitignore`

### [apps/cli/src/lib/handlebars-utils.ts](apps/cli/src/lib/handlebars-utils.ts)
Handlebars custom helpers and configuration (2025-10-22 Refactored with new structure)
- **Uses `AppContext`** instead of `App`
- **Template helpers**:
  - `eq`, `ne`, `and`, `or` - Logical operations
  - `includes` - Array membership
  - **App/Server helpers** (adapted to `AppContext`):
    - `hasApp(app)` - Checks `app.metaApp !== undefined`
    - `hasServer(app)` - Checks `app.metaServer !== undefined`
    - `isStandaloneServer(app)` - Checks `metaServer && !metaApp`
    - `isFullstack(app)` - Checks `metaApp && metaServer`
  - **Module helpers** (adapted to new structure):
    - `hasModule(name)` - Checks `this.metaApp?.modules`
    - `moduleEnabled(name)` - Checks `this.metaApp?.modules`
    - `hasServerModule(name)` - Checks `this.metaServer?.modules`
    - `serverModuleEnabled(name)` - Checks `this.metaServer?.modules`
  - `isTurborepo()` / `isSingleRepo()` - Repo type checks
  - `kebabCase`, `pascalCase` - String transformations
  - `app(name)`, `appIndex(name)`, `appPort(name)` - App lookups
- Configuration: `noEscape: true` for code generation

### Config Files

- [package.json](package.json) - Root workspace with scripts, shared deps
- [apps/cli/package.json](apps/cli/package.json) - CLI package with bin entry
- [turbo.json](turbo.json) - Build task pipeline definitions
- [biome.json](biome.json) - Linting/formatting rules

## Supported Stacks

### Platforms & Frameworks (2025-10-22 Reorganized)
- **App** (web + mobile unified):
  - Next.js - React framework with SSR
  - Expo - React Native framework
- **Server** (backend/API):
  - Hono - Fast web framework
  - Express - Node.js framework
  - `builtin` - Use Next.js API routes (app-specific)

### Database & ORM
- **Database**: PostgreSQL, MySQL
- **ORM**: Prisma (type-safe), Drizzle (lightweight SQL-like)
- **Dependency Chain**: Database → ORM (ORM requires database selection first)

### Extras
- **Biome**: Linter + formatter (replaces Prettier + ESLint)
- **Git**: Configuration files (confirm prompt, boolean in context)
- **Husky**: Git hooks management (requires git = true, auto-filtered)

### Repository Configuration
- **Turborepo**: Auto-enabled for multi-app projects

## Current Status

### ✅ Implemented
- Interactive CLI with beautiful prompts (@clack/prompts)
- Multi-app configuration support (unlimited apps)
- **Platform/App/Server Architecture** (2025-10-22 Refactored):
  - Platform choice: `app` (Next.js, Expo) or `server` (Hono, Express)
  - Discriminated union types for type safety
  - Support for App only, Server only, Fullstack configurations
  - Type guards: `hasApp()`, `hasServer()`, `isStandaloneServer()`, `isFullstack()`
- **Modules System** (2025-10-21 + Server Support 2025-10-22):
  - **App modules**: shadcn, PWA, tRPC for Next.js | NativeWind for Expo
  - **Server modules**: OpenAPI, JWT for Hono | Passport, Helmet for Express
  - Separate `MODULES` metadata with `packageName` support
  - Per-app AND per-server module multiselect
  - Context-aware module requirements
- **Magic Comments System** (2025-10-21):
  - First-line directives: `@repo:`, `@scope:`, `@if:`, `@require:`
  - Pre-scan optimization (skip before rendering)
  - Multi-condition support with AND logic
  - Negation support (`@repo:!single`)
- **Context-aware filtering system**:
  - Category-level `requires` (database → ORM dependency chain)
  - Stack-level `requires` (husky → git filtering)
  - Progressive context building (`ctx` updated after each prompt)
  - Auto-skip prompts with informative logging
  - Central `filterOptionsByContext()` for all filtering logic
- Database → ORM selection with automatic skip
- Git confirmation (boolean) feeding into extras filtering
- Extras multi-selection with auto-filter
- Template resolution engine with module support
- Scope-aware path mapping (app/package/root) with dynamic override
- Unified prompt API (promptText, promptSelect, promptMultiselect, promptConfirm)
- Meta-driven stack system (easy to extend)
- Auto-detection of single-file vs. monorepo structure
- File generation with Handlebars rendering
- Post-generation hooks (install deps, git init)
- Handlebars custom helpers (hasModule, isTurborepo, etc.)

### 🚧 In Progress
- **Template content**: Fill in remaining `.hbs` templates for all stacks
- **Module templates**: Add more modules (PWA, tRPC, auth, etc.)
- **Error handling**: Enhanced rollback on failure

### 📋 Planned
- Non-interactive mode (CLI flags: `--name`, `--framework`, etc.)
- Package manager auto-detection (bun/npm/pnpm)
- Web UI (alternative to CLI via apps/www)
- Custom template directories (user-defined templates)
- Configuration save/load (.create-faster.json)
- More framework support (Solid, Qwik, Remix, SvelteKit)
- More modules (Auth.js, MDX, Storybook, i18n, etc.)
- Plugin system for third-party templates
- Template validation and testing framework
- Update command to refresh existing projects

## Development Workflow

### Setup
```bash
bun install
```

### Development Scripts
```bash
# CLI Development
bun run dev:cli              # Test CLI in watch mode
bun run build:cli            # Build single executable binary

# Web Development
bun run dev:www              # Next.js dev server
bun run build:www            # Next.js production build

# All Apps
bun run dev                  # Dev server for all apps
bun run build                # Build all apps

# Code Quality
bun run check                # Format + check with Biome
bun run lint                 # Lint with Biome (auto-fix)
bun run format               # Format all files
bun run check:unused         # Find unused dependencies (knip)

# Cleanup
bun run clean                # Remove build artifacts

# Git Hooks
bun run prepare              # Setup husky hooks
```

### Building the CLI

CLI build creates a single executable with shebang:
```bash
bun run build:cli
# Output: apps/cli/create-faster (executable)
```

Build command breakdown:
```bash
bun build src/index.ts \
  --outfile create-faster \
  --target bun \
  --production \
  --banner '#!/usr/bin/env node'
```

### Publishing to NPM

```bash
cd apps/cli
npm publish              # Runs prepublishOnly → build + chmod +x
```

Package details:
- Registry: npm public
- Package name: `create-faster`
- Bin: `create-faster` command
- Files included: executable, templates/, package.json

## Adding New Content

### Adding a New Framework

1. **Add to META** in [__meta__.ts](apps/cli/src/__meta__.ts):
```typescript
export const META = {
  web: {
    stacks: {
      solid: {
        label: 'Solid',
        hint: 'Fast reactive framework',
        hasBackend: false,
      }
    }
  }
} as const satisfies Meta;
```

2. **Create Template Directory**:
```bash
mkdir -p apps/cli/templates/web/solid
```

3. **Add Template Files**:
```
templates/web/solid/
├── package.json.hbs
├── tsconfig.json.hbs
└── src/
    └── index.tsx.hbs
```

4. **Test**:
```bash
bun run dev:cli
# Select Web platform → Solid appears
```

### Adding a New Module

1. **Add to MODULES** in [__meta__.ts](apps/cli/src/__meta__.ts):
```typescript
export const MODULES: ModuleMeta = {
  nextjs: {
    analytics: {
      label: 'Vercel Analytics',
      hint: 'Web analytics',
      packageName: 'analytics', // Optional: for turborepo packages/analytics/
      requires: ['database'],   // Optional: dependency
    }
  }
}
```

2. **Create Module Templates**:
```bash
mkdir -p apps/cli/templates/modules/nextjs/analytics
```

3. **Add Template Files with Magic Comments**:
```handlebars
{{!-- package.json.hbs --}}
{{!-- @repo:turborepo @scope:package --}}
{
  "name": "@repo/analytics",
  "dependencies": {
    "@vercel/analytics": "^1.0.0"
  }
}
```

```handlebars
{{!-- config.ts.hbs --}}
{{!-- @scope:app --}}
import { Analytics } from '@vercel/analytics/react'

export const analytics = <Analytics />
```

4. **Test**:
```bash
bun run dev:cli
# Select Next.js → Analytics appears in modules
```

## Code Conventions

### Naming Standards
- **Enums/Values**: lowercase kebab-case (`web`, `nextjs`, `hono`)
- **Types**: PascalCase (`TemplateContext`, `StackMeta`, `App`)
- **Functions**: camelCase (`promptText`, `getTemplatesForContext`)
- **Files**: lowercase (`schema.ts`, `prompts.ts`)
- **Special files**: dunder notation (`__meta__.ts`)
- **Templates**: `feature.extension.hbs` (`package.json.hbs`)
- **App names**: User-provided (becomes folder name)
- **Server apps**: Auto-named `{appName}-server` (was `{appName}-api`)
- **Package names**: Defined in META (e.g., `db` for ORM)

### Type Safety
- Strict TypeScript configuration enabled
- Zod for runtime validation
- Type inference from constants (META)
- No `any` types in critical paths
- `as const satisfies` pattern for type safety

### Import Aliases
- `@/*` → `src/*` (configured in tsconfig.json)

### Error Handling
- Early returns for validation
- Validation-first approach
- Graceful cancellation with helpful messages
- Unified error handling in prompt wrappers

### File Organization
- Templates mirror output structure
- Handlebars files use `.hbs` extension
- Special files: `_gitignore.hbs` → `.gitignore`
- Scope-aware directory mapping

## Template System

### Directory Structure (2025-10-22 Updated)
```
templates/
├── app/{framework}/        # Next.js, Expo (merged web/ + mobile/)
├── server/{framework}/     # Hono, Express (was api/)
├── modules/{framework}/    # App + Server modules
│   ├── nextjs/             # App modules
│   │   ├── shadcn/         # shadcn/ui components
│   │   ├── pwa/            # Progressive Web App
│   │   └── trpc/           # tRPC API layer
│   ├── expo/               # App modules
│   │   └── nativewind/     # Tailwind for React Native
│   ├── hono/               # Server modules
│   │   ├── openapi/        # OpenAPI docs
│   │   └── jwt/            # JWT authentication
│   └── express/            # Server modules
│       ├── passport/       # Passport.js auth
│       └── helmet/         # Security headers
├── orm/{provider}/         # Prisma, Drizzle
├── database/{provider}/    # Postgres config
├── extras/{tool}/          # Biome, Git, Husky
└── repo/turborepo/         # Turborepo config
```

### Handlebars Variables (2025-10-22 Updated with new structure)
Available in all templates:
- `{{projectName}}` - User's project name
- `{{appName}}` - Current app name (auto-injected for app-scoped templates)
- `{{repo}}` - Repository type (single/turborepo)
- **App variables** (if `metaApp` exists):
  - `{{metaApp.name}}` - App framework (nextjs, expo)
  - `{{metaApp.modules}}` - Array of selected app modules
- **Server variables** (if `metaServer` exists):
  - `{{metaServer.name}}` - Server framework (hono, express, builtin)
  - `{{metaServer.modules}}` - Array of selected server modules
- **Helpers for cleaner access**:
  - `{{#if (hasApp this)}}` - Check if app exists
  - `{{#if (hasModule "shadcn")}}` - Check if module enabled
  - `{{#if (hasServerModule "jwt")}}` - Check if server module enabled
- `{{orm}}`, `{{database}}`, `{{git}}`, `{{extras}}` - Context-level selections
- Additional context from `TemplateContext` type

### Magic Comments (First Line Directives)
Control template rendering and file placement:
```handlebars
{{!-- @repo:turborepo --}}              → Only render in turborepo mode
{{!-- @repo:single --}}                 → Only render in single repo mode
{{!-- @scope:app --}}                   → Place in app directory (override default)
{{!-- @scope:package --}}               → Place in package directory
{{!-- @if:database --}}                 → Render if database is selected
{{!-- @require:git --}}                 → Render if git is enabled
{{!-- @repo:!single --}}                → Negation: everything except single
{{!-- @repo:turborepo @scope:package --}} → Multiple conditions (AND logic)
```

**Usage Examples**:
```handlebars
{{!-- package.json for shared UI package in turborepo --}}
{{!-- @repo:turborepo @scope:package --}}
{
  "name": "@repo/ui",
  "version": "0.0.0"
}
```

```handlebars
{{!-- components.json always goes in app, even in turborepo --}}
{{!-- @scope:app --}}
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "aliases": {
    "ui": "@repo/ui"
  }
}
```

### Template Resolution Flow
1. Scan templates using fast-glob (`**/*.hbs`)
2. Filter by selected stacks from config
3. **For modules**: Read first line to detect `@scope:` override
4. Map source path → destination path based on scope (with override if present)
5. Determine single-file vs. monorepo structure
6. Pre-scan magic comments to determine if skip
7. Generate `TemplateFile[]` array for rendering

### Scope Mapping
- `app` scope → `apps/{appName}/{path}` (turborepo) or `{path}` (single)
- `package` scope → `packages/{packageName}/{path}` (turborepo only)
- `root` scope → `{path}` (always at project root)

### Module Scope Resolution Logic
For module templates, scope is determined by:
1. **If `@scope:` magic comment present**: Use that scope explicitly
2. **Else if turborepo + `packageName` defined**: Use `package` scope → `packages/{packageName}/`
3. **Else**: Use `app` scope → `apps/{appName}/` or root in single mode

**Example**:
```
Module: nextjs/shadcn with packageName: "ui"
Turborepo mode:
  - src/lib/utils.ts.hbs → packages/ui/src/lib/utils.ts (default: follows packageName)
  - components.json.hbs → apps/web/components.json (@scope:app override)
  - package.json.hbs → packages/ui/package.json (@scope:package explicit)

Single mode:
  - src/lib/utils.ts.hbs → src/lib/utils.ts (no packageName in single mode)
  - components.json.hbs → components.json (@scope:app)
  - package.json.hbs → SKIPPED (@repo:turborepo)
```

## Design Decisions

### Why no app linking?
Too complex for minimal benefit. Convention-based naming (`{name}-api`) is sufficient and predictable.

### Why `hasBackend` flag?
More flexible than separate fullstack category. Easy to extend with more capability flags in the future.

### Why auto-detection of turborepo?
Reduces prompts. User intent is clear from app count (>1 apps = monorepo needed).

### Why convention-based templates?
No hardcoded paths in code. Directory structure is the source of truth. Easier to maintain and extend.

### Why Bun over Node.js?
- Native Glob support (no dependencies)
- Faster CLI startup time
- Built-in TypeScript support
- Modern runtime with better DX

### Why Handlebars over template literals?
- Industry standard templating language
- Supports partials and helpers
- Better for complex templates
- Familiar to most developers

## Configuration Files Deep Dive

### [biome.json](biome.json)
Strict but pragmatic linting/formatting:
- Line width: 120 characters
- Single quotes, semicolons always
- Auto-organize imports
- Relaxed: console logs, array index keys
- Disabled: unused locals (dev noise)

### [turbo.json](turbo.json)
Task pipeline configuration:
- `build`: Depends on workspace dependencies (`^build`)
- `dev`: Persistent, no cache, watches files
- `start`: Persistent, no cache

### TypeScript Configs
**Base** ([packages/config/ts/base.json](packages/config/ts/base.json)):
- Target: ESNext
- Module: Preserve
- Strict mode enabled
- No emit (build tool handles it)

**CLI extends base** with:
- Path aliases (`@/*` → `src/*`)
- Bun-specific types

## Testing Strategy

### Current State
No test files implemented yet.

### Recommended Coverage
- **Schema validation**: Zod schemas with valid/invalid inputs
- **Template resolution**: Path mapping logic
- **Prompt handling**: Cancellation, validation
- **META integrity**: No duplicate keys, consistent structure
- **Scope mapping**: Single-file vs. monorepo paths

### Tools Available
- Bun native test runner (fast, built-in)
- Consider Vitest for broader compatibility

### Test File Structure
```
apps/cli/src/
├── __tests__/
│   ├── schema.test.ts
│   ├── template-resolver.test.ts
│   ├── prompts.test.ts
│   └── meta.test.ts
```

## Common Development Tasks

### Debug Template Resolution
```typescript
import { getAllTemplatesForContext } from './lib/template-resolver';

const templates = getAllTemplatesForContext(config, context);
console.log(templates); // Array of TemplateFile objects
```

### Add New Prompt
Edit [index.ts](apps/cli/src/index.ts), use helpers from [prompts.ts](apps/cli/src/lib/prompts.ts):
```typescript
const result = await promptSelect({
  message: 'Choose option',
  options: [
    { value: 'a', label: 'Option A', hint: 'Description' },
    { value: 'b', label: 'Option B' },
  ],
});
```

### Update Dependencies
```bash
bun update              # Update all packages
bun run check:unused    # Find unused deps with knip
```

### Clean Build Artifacts
```bash
bun run clean           # Removes dist/, .next/, node_modules/.cache/
```

## Performance Optimizations

### Why Bun Glob?
- 10x faster than Node.js glob packages
- Native implementation
- No external dependencies
- Async by default

### Single Executable Benefits
- Faster startup time (no module resolution)
- Smaller install size
- Simpler distribution
- Self-contained

### Minimal Dependencies
Only 4 runtime dependencies:
1. @clack/prompts - CLI UX
2. commander - Argument parsing
3. handlebars - Template rendering
4. Zod - Runtime validation

No build-time template processing (Handlebars runtime only).

## Troubleshooting

### CLI Not Prompting
- Check `@clack/prompts` is installed
- Ensure stdin is TTY (not piped input)
- Test with `bun run dev:cli`

### Template Not Found
- Verify path matches `category/stack` structure
- Check Glob pattern in [template-resolver.ts](apps/cli/src/lib/template-resolver.ts)
- Ensure `.hbs` extension present
- Check template directory exists

### Build Fails
- Clear cache: `bun run clean`
- Reinstall: `rm -rf node_modules && bun install`
- Check TypeScript errors: `bun run check`
- Verify Bun version: `bun --version` (need 1.2.23+)

### Biome Formatting Issues
- Auto-fix: `bun run lint`
- Check rules: [biome.json](biome.json)
- Ignore file: Add to `.biomeignore`

### Git Hooks Not Running
- Setup hooks: `bun run prepare`
- Check Husky installation: `.husky/` directory exists
- Manual trigger: `.husky/pre-commit`

## Git Workflow

### Current State
- Main branch: `main`
- Status: `.gitignore` modified
- Recent work: Template and CLI core logic (#1)

### Commit Conventions
Follow conventional commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation
- `chore:` - Maintenance
- `refactor:` - Code restructuring

### Hooks (Husky)
Pre-commit runs:
- `bun run check` - Format and lint
- Type checking (via Biome)

## Resources

### Documentation
- [Bun Documentation](https://bun.sh/docs)
- [Handlebars Guide](https://handlebarsjs.com/guide/)
- [Clack Prompts](https://github.com/natemoo-re/clack)
- [Zod Documentation](https://zod.dev/)
- [Turbo Documentation](https://turbo.build/repo/docs)
- [Biome Documentation](https://biomejs.dev/)

### Related Projects
- `create-next-app` - Next.js scaffolding
- `create-vite` - Vite project scaffolding
- `create-t3-app` - Full-stack TypeScript scaffolding
- `create-turbo` - Turborepo scaffolding

### Inspiration
This project combines the best of:
- create-t3-app's opinionated tech choices
- create-turbo's monorepo support
- create-vite's speed and simplicity

## Next Steps (Priority Order)

1. **Template Content** (High)
   - Complete all base framework templates (Next.js, Astro, Hono, Express, Expo)
   - Finish shadcn module templates
   - Add PWA and tRPC module templates
   - Add working package.json files with correct dependencies

2. **Testing** (High)
   - Unit tests for magic-comments.ts
   - Unit tests for template-resolver.ts
   - Integration tests for module resolution
   - E2E tests for CLI flow

3. **More Modules** (Medium)
   - Auth.js / NextAuth integration
   - MDX support for content sites
   - i18n (next-intl, react-i18next)
   - Storybook for component development
   - Testing frameworks (Vitest, Playwright)

4. **Error Handling & UX** (Medium)
   - Better error messages with suggestions
   - Validation of template syntax
   - Graceful degradation on partial failures
   - Progress indicators for long operations

5. **CLI Enhancements** (Low)
   - Non-interactive mode with flags
   - Configuration save/load
   - Update/migrate command for existing projects
   - Dry-run mode (show what would be generated)

6. **Documentation** (Low)
   - Complete README.md with examples
   - Add CONTRIBUTING.md with module creation guide
   - Create website content (apps/www)
   - Video tutorials

## Recent Changes Log

### 2025-10-22 (Later): Type Naming Refactor - Clearer Conventions
**Motivation**: Improve code clarity with consistent `Meta*` prefix for all metadata types

**Type Renamings**:
- `StackMeta` → `MetaStack` (metadata of a stack)
- `CategoryMeta` → `MetaCategory` (metadata of a category)
- `ModuleMeta` → `MetaModule` (metadata of modules)
- `ModuleStackMeta` → `MetaModuleStack` (metadata of module stack)
- `App` → `AppContext` (more explicit, it's a context object)

**Structure Changes**:
```typescript
// Before
{ app: 'nextjs', server: 'hono', modules: [...], serverModules: [...] }

// After (clearer nested structure)
{
  appName: 'web',
  metaApp: { name: 'nextjs', modules: [...] },
  metaServer: { name: 'hono', modules: [...] }
}
```

**Files Modified**:
- `types.ts` - All type renamings, `AppContext` structure
- `__meta__.ts` - Import `MetaModule` (was `ModuleMeta`)
- `index.ts` - `App` → `AppContext`, adapted to new structure
- `lib/template-resolver.ts` - Access `metaApp.name`, `metaServer.name`, nested modules
- `lib/template-processor.ts` - Context enrichment with `metaServer`
- `lib/handlebars-utils.ts` - All helpers adapted to `AppContext` and nested structure
- `lib/post-generation.ts` - Display logic with `metaApp.name`, `metaServer.name`

**Benefits**:
- **Consistent naming**: All metadata types use `Meta*` prefix
- **Clearer structure**: `metaApp` / `metaServer` are explicit and self-documenting
- **Type-safe**: Nested structure prevents property conflicts
- **Better DX**: Auto-complete shows `metaApp.name` and `metaApp.modules` together

### 2025-10-22: Platform Refactor (`api` → `server`) + Server Modules
**Major Refactoring**:
- **Platform system**: `web`/`mobile` unified → `app` | `api` renamed → `server`
- **Type `App`**: Refactored to discriminated union (removed `platform` field)
- **Type guards**: Added `hasApp()`, `hasServer()`, `isStandaloneServer()`, `isFullstack()`
- **Server modules**: Extended `MODULES` to support Hono (OpenAPI, JWT) and Express (Passport, Helmet)
- **CLI flow**: New "Add dedicated server?" prompt for fullstack apps
- **Naming**: Backend apps renamed from `{appName}-api` → `{appName}-server`

**Files Modified**:
- `types.ts` - Discriminated union for `App`, new type guards, `ServerMeta` type
- `__meta__.ts` - `META.api` → `META.server`, added server modules to `MODULES`
- `index.ts` - Refactored prompt flow, added server module selection
- `lib/template-resolver.ts` - Added `processModules()`, server template resolution
- `lib/template-processor.ts` - Server context enrichment for `{appName}-server`
- `lib/handlebars-utils.ts` - Added `hasServer()`, `hasApp()`, `isStandaloneServer()`, `isFullstack()`, `hasServerModule()`, `serverModuleEnabled()`
- `lib/post-generation.ts` - Updated app summary display logic

**Templates Restructured**:
- `templates/web/` + `templates/mobile/` → `templates/app/` (unified)
- `templates/api/` → `templates/server/` (renamed)
- Added `modules/hono/` and `modules/express/` for server modules

**Impact**:
- **Type-safe**: Impossible to have inconsistent state (e.g., server without app in fullstack)
- **3 use cases**: App only, Server only, Fullstack (all fully supported)
- **Extensible**: Easy to add server modules like app modules
- **Clean API**: No redundant `platform` field, type guards clarify intent
- **-318 lines** of templates migrated/consolidated

### 2025-10-21: Framework Modules System + Magic Comments
**Added**:
- Framework modules system (`MODULES` in `__meta__.ts`)
- Magic comments for conditional rendering (`@repo:`, `@scope:`, `@if:`, `@require:`)
- Dynamic scope resolution for module templates
- Per-app module selection in CLI flow
- Handlebars helpers: `hasModule()`, `moduleEnabled()`
- Template processor integration with magic comments pre-scan

**Files Created**:
- `lib/magic-comments.ts` (164 lines) - Magic comment parsing and validation

**Files Modified**:
- `types.ts` - Added `modules` to `App`, `ModuleMeta` type, extended `ProcessResult`
- `__meta__.ts` - Added `MODULES` export with Next.js modules
- `index.ts` - Module selection prompt per app
- `lib/template-resolver.ts` - Module template scanning with scope override detection
- `lib/template-processor.ts` - Magic comments pre-scan integration
- `lib/handlebars-utils.ts` - Added `hasModule` helpers
- `templates/modules/nextjs/shadcn/` - Added magic comments to templates

**Impact**:
- Enables modular, composable project generation
- Supports complex multi-repo scenarios with fine-grained control
- Performance optimized (first-line pre-scan)
- Easy to extend with new modules

## License & Contact

**License**: MIT

**Repository**: [GitHub](https://github.com/user/create-faster)
**Issues**: [GitHub Issues](https://github.com/user/create-faster/issues)
**NPM**: [npmjs.com/package/create-faster](https://www.npmjs.com/package/create-faster)
