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

1. **Platform vs Framework**
   - Platform: Type of app (`web`, `api`, `mobile`)
   - Framework: Specific stack (`nextjs`, `astro`, `hono`, `express`, `expo`)

2. **Scope System**
   - `app`: Application-level templates → `apps/{name}/`
   - `package`: Shared package templates → `packages/{name}/`
   - `root`: Root-level config → `./`

3. **Auto-detection**
   - Turborepo mode when `apps.length > 1`
   - Single repo mode for single app projects

4. **Backend Choice**
   - `builtin`: Use framework's built-in backend (Next.js API routes)
   - `hono`/`express`: Dedicated backend in `{appName}-api/`
   - `undefined`: No backend (only for frameworks without built-in backend)

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
│   │       ├── web/{framework}/
│   │       ├── api/{framework}/
│   │       ├── mobile/{framework}/
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
**Single source of truth** for all available stacks (85 lines)
- Defines labels, hints, dependencies, and capabilities for each framework/tool
- Types: `StackMeta`, `CategoryMeta`, `Meta`
- To add new framework: add entry here first
- Categories: web, api, mobile, orm, database, extras

### [apps/cli/src/types.ts](apps/cli/src/types.ts)
Core type definitions (44 lines)
- `Platform`: web, api, mobile
- `Category`: web, api, mobile, orm, database, extras
- `Scope`: app, package, root (controls output path)
- `App`: Application configuration
- `Config`: Final user configuration object
- `TemplateContext`: Runtime context for template resolution

### [apps/cli/src/index.ts](apps/cli/src/index.ts)
Main CLI entry point (170 lines)
- Orchestrates interactive prompt flow
- Handles multi-app configuration
- Conditional database/ORM selection
- Extras multi-selection (biome, git, husky)
- Currently ends at `getAllTemplatesForContext()` call

### [apps/cli/src/lib/schema.ts](apps/cli/src/lib/schema.ts)
Zod validation schemas (24 lines)
- Dynamically derives valid values from META
- Validates all user inputs before proceeding
- Type-safe runtime validation

### [apps/cli/src/lib/prompts.ts](apps/cli/src/lib/prompts.ts)
Reusable prompt wrappers (68 lines)
- `promptText()`: Open text input with validation
- `promptSelect()`: Single selection from options
- `promptMultiselect()`: Multiple selection from options
- Unified cancellation/error handling
- Built on @clack/prompts

### [apps/cli/src/lib/template-resolver.ts](apps/cli/src/lib/template-resolver.ts)
Template discovery and path resolution (99 lines)
- Scans template directory using Bun Glob
- Maps source templates → destination paths
- Handles scope-aware paths:
  - `app` scope → `apps/{appName}/{path}`
  - `package` scope → `packages/{packageName}/{path}`
  - `root` scope → `{path}`
- Detects single-file vs. monorepo layout
- Returns `TemplateFile[]` array ready for rendering

### Config Files

- [package.json](package.json) - Root workspace with scripts, shared deps
- [apps/cli/package.json](apps/cli/package.json) - CLI package with bin entry
- [turbo.json](turbo.json) - Build task pipeline definitions
- [biome.json](biome.json) - Linting/formatting rules

## Supported Stacks

### Platforms & Frameworks
- **Web**: Next.js (SSR capable), Astro (static-first)
- **API**: Hono (fast edge), Express (Node.js standard)
- **Mobile**: Expo (React Native)

### Database & ORM
- **Database**: PostgreSQL
- **ORM**: Prisma (type-safe), Drizzle (lightweight SQL-like)

### Extras
- **Biome**: Linter + formatter (replaces Prettier + ESLint)
- **Git**: Configuration files
- **Husky**: Git hooks management

### Repository Configuration
- **Turborepo**: Auto-enabled for multi-app projects

## Current Status

### ✅ Implemented
- Interactive CLI with beautiful prompts (@clack/prompts)
- Multi-app configuration support (unlimited apps)
- Platform/framework/backend selection per app
- Database/ORM conditional selection
- Extras multi-selection
- Template resolution engine (path mapping complete)
- Scope-aware path mapping (app/package/root)
- Zod validation for all inputs
- Meta-driven stack system (easy to extend)
- Auto-detection of single-file vs. monorepo structure

### 🚧 In Progress
- **File generation engine**: Render Handlebars templates to disk
- **Post-generation hooks**: Run `bun install`, `git init`
- **Error handling**: Rollback on failure, duplicate project detection

### 📋 Planned
- Template content (many `.hbs` files are placeholders)
- Root package.json generation with workspaces
- turbo.json generation for multi-app projects
- Non-interactive mode (CLI flags)
- Package manager auto-detection (bun/npm/pnpm)
- Web UI (alternative to CLI via apps/www)
- Custom template directories
- Configuration save/load
- More framework support (Solid, Qwik, Remix)
- Plugin system for third-party templates

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

## Adding New Frameworks

### 1. Add to META
Edit [__meta__.ts](apps/cli/src/__meta__.ts):

```typescript
export const META = {
  web: {
    solid: {
      label: 'Solid',
      hint: 'Fast reactive framework',
      category: 'web',
      platform: 'web',
      hasBackend: false,
    }
  }
} as const satisfies Meta;
```

### 2. Create Template Directory
```bash
mkdir -p apps/cli/templates/web/solid/app
```

### 3. Add Template Files
Create `.hbs` files:
```
templates/web/solid/
└── app/
    ├── package.json.hbs
    ├── tsconfig.json.hbs
    └── src/
        └── index.tsx.hbs
```

### 4. Test
```bash
bun run dev:cli
# Select Web platform → Solid should appear in list
```

Schema validation automatically includes the new stack!

## Code Conventions

### Naming Standards
- **Enums/Values**: lowercase kebab-case (`web`, `nextjs`, `hono`)
- **Types**: PascalCase (`TemplateContext`, `StackMeta`, `App`)
- **Functions**: camelCase (`promptText`, `getTemplatesForContext`)
- **Files**: lowercase (`schema.ts`, `prompts.ts`)
- **Special files**: dunder notation (`__meta__.ts`)
- **Templates**: `feature.extension.hbs` (`package.json.hbs`)
- **App names**: User-provided (becomes folder name)
- **Backend apps**: Auto-named `{appName}-api`
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

### Directory Structure
```
templates/
├── web/{framework}/        # Next.js, Astro
├── api/{framework}/        # Hono, Express
├── mobile/{framework}/     # Expo
├── orm/{provider}/         # Prisma, Drizzle
├── database/{provider}/    # Postgres config
├── extras/{tool}/          # Biome, Git, Husky
└── repo/turborepo/         # Turborepo config
```

### Handlebars Variables
Available in all templates:
- `{{projectName}}` - User's project name
- `{{appName}}` - Current app name
- `{{repo}}` - Repository type (single/monorepo)
- Additional context from `TemplateContext` type

### Template Resolution Flow
1. Scan templates using Bun Glob (`**/*.hbs`)
2. Filter by selected stacks from config
3. Map source path → destination path based on scope
4. Determine single-file vs. monorepo structure
5. Generate `TemplateFile[]` array for rendering

### Scope Mapping
- `app` scope → `apps/{appName}/{path}`
- `package` scope → `packages/{packageName}/{path}`
- `root` scope → `{path}`

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

1. **File Generation Engine** (Critical)
   - Implement Handlebars rendering
   - Write files to disk
   - Handle directory creation

2. **Post-Generation** (High)
   - Run `bun install`
   - Initialize git repository
   - Create initial commit

3. **Error Handling** (High)
   - Check for existing project directory
   - Rollback on failure
   - Better error messages

4. **Template Content** (Medium)
   - Fill in all `.hbs` templates
   - Add working package.json files
   - Create minimal working apps

5. **Testing** (Medium)
   - Unit tests for core logic
   - Integration tests for CLI flow
   - Template validation tests

6. **CLI Enhancements** (Low)
   - Non-interactive mode (flags)
   - Configuration save/load
   - Update command

7. **Documentation** (Low)
   - Complete README.md
   - Add CONTRIBUTING.md
   - Create website content (apps/www)

## License & Contact

**License**: MIT

**Repository**: [GitHub](https://github.com/user/create-faster)
**Issues**: [GitHub Issues](https://github.com/user/create-faster/issues)
**NPM**: [npmjs.com/package/create-faster](https://www.npmjs.com/package/create-faster)
