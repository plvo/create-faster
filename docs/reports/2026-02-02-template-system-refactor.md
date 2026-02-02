# Template System Refactor Report

**Date:** 2026-02-02
**Branch:** `refactor/template-system`

## Overview

This refactor eliminated ~900 lines of duplicate template code, simplified the magic comment system from 4 types to 1, and introduced programmatic package.json generation.

## Architecture Changes

### Before

```
┌─────────────────────────────────────────────────────────────┐
│                        META                                  │
│                                                              │
│  stacks: {                                                   │
│    nextjs: {                                                 │
│      modules: {           ← modules nested inside stacks     │
│        shadcn: {...}                                         │
│      }                                                       │
│    }                                                         │
│  }                                                           │
│                                                              │
│  No packageJson in META - all deps in Handlebars templates   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   MAGIC COMMENTS (4 types)                   │
│                                                              │
│  @repo:turborepo|single|!single  ← conditional inclusion     │
│  @scope:app|package|root         ← destination override      │
│  @if:key                         ← conditional on context    │
│  @require:key                    ← require context key       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TEMPLATES                                 │
│                                                              │
│  templates/stack/nextjs/package.json.hbs   ← 139 lines       │
│  templates/orm/drizzle/package.json.hbs    ← conditional     │
│  templates/orm/drizzle/src/schema.ts.hbs                     │
│  templates/orm/drizzle/src/lib/db/schema.ts.hbs  ← DUPLICATE │
│                                                              │
│  ~690 duplicated lines across templates                      │
└─────────────────────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────────────────────┐
│                        META                                  │
│                                                              │
│  stacks: {                                                   │
│    nextjs: {                                                 │
│      packageJson: { dependencies, devDeps, scripts }         │
│    }                                                         │
│  }                                                           │
│                                                              │
│  modules: {               ← modules at top level             │
│    shadcn: {                                                 │
│      stacks: ['nextjs', 'tanstack-start'],  ← compatibility  │
│      asPackage: 'ui',     ← extracted to packages/ui/        │
│      singlePath: 'src/components/ui/',                       │
│      packageJson: { dependencies, ... }                      │
│    }                                                         │
│  }                                                           │
│                                                              │
│  orm: {                                                      │
│    asPackage: 'db',                                          │
│    singlePath: 'src/lib/db/',                                │
│    stacks: { drizzle: { packageJson: {...} } }               │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│   PACKAGE-JSON-GENERATOR │    │   MAGIC COMMENTS (1 type)    │
│                          │    │                              │
│  generateAllPackageJsons │    │  @dest:app|pkg|root          │
│    - merges deps         │    │                              │
│    - resolves ports      │    │  Only affects destination,   │
│    - workspace refs      │    │  never skips templates       │
└──────────────────────────┘    └──────────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TEMPLATE RESOLVER                         │
│                                                              │
│  resolveDestination(path, meta, ctx, destOverride)           │
│                                                              │
│  Turborepo:                                                  │
│    stack     → apps/{appName}/                               │
│    module    → packages/{asPackage}/ or apps/{appName}/      │
│    orm       → packages/db/                                  │
│    database  → root                                          │
│    extras    → root                                          │
│    repo      → root                                          │
│                                                              │
│  Single:                                                     │
│    stack     → root                                          │
│    module    → root (templates contain structure)            │
│    orm       → {singlePath} (e.g., src/lib/db/)              │
│    database  → root                                          │
│    extras    → root                                          │
│    repo      → root                                          │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Package JSON Generator (`src/lib/package-json-generator.ts`)

Generates package.json files programmatically from META configuration.

```
┌─────────────────────────────────────────────────────────────┐
│                  generateAllPackageJsons(ctx)                │
│                                                              │
│  For turborepo:                                              │
│    ├── generateRootPackageJson()                             │
│    │     └── { workspaces, turbo scripts }                   │
│    │                                                         │
│    ├── for each app:                                         │
│    │     └── generateAppPackageJson(app, ctx, index)         │
│    │           └── merge: stack + modules + @repo/db ref     │
│    │                                                         │
│    └── for extracted packages:                               │
│          └── generatePackagePackageJson(name, config)        │
│                └── packages/ui/, packages/db/                │
│                                                              │
│  For single:                                                 │
│    └── generateAppPackageJson(app, ctx, 0)                   │
│          └── merge: stack + modules + orm + database         │
└─────────────────────────────────────────────────────────────┘
```

**Merge logic:**

```typescript
mergePackageJsonConfigs(
  stack.packageJson,      // base stack deps
  module.packageJson,     // each module's deps (or @repo/ui ref)
  orm.packageJson,        // ORM deps (or @repo/db ref)
  database.packageJson,   // database driver
  extras.packageJson      // biome, husky, etc.
)
```

### 2. Magic Comments (`src/lib/magic-comments.ts`)

Simplified to only handle destination override.

```
┌─────────────────────────────────────────────────────────────┐
│                    @dest: Magic Comment                      │
│                                                              │
│  Syntax: {{!-- @dest:app|pkg|root --}}                       │
│                                                              │
│  Functions:                                                  │
│    parseMagicComments(firstLine)    → MagicComment[]         │
│    parseDestFromContent(content)    → DestType | null        │
│    removeDestMagicComment(content)  → string                 │
│                                                              │
│  Usage in template-resolver:                                 │
│    1. Read template file                                     │
│    2. parseDestFromContent() to get override                 │
│    3. Pass to resolveDestination() or resolveModuleDestination()
│                                                              │
│  Usage in template-processor:                                │
│    1. removeDestMagicComment() before Handlebars render      │
└─────────────────────────────────────────────────────────────┘
```

### 3. Template Resolver (`src/lib/template-resolver.ts`)

Determines destination paths based on META configuration and `@dest:` overrides.

```
┌─────────────────────────────────────────────────────────────┐
│           resolveDestination(path, meta, ctx, dest)          │
│                                                              │
│  Override handling (if @dest: specified):                    │
│    @dest:root → path (no prefix)                             │
│    @dest:app  → apps/{appName}/ (turborepo) or root (single) │
│    @dest:pkg  → packages/{asPackage}/ (turborepo)            │
│                                                              │
│  Default behavior (no @dest:):                               │
│    ┌────────────┬─────────────────────┬───────────────────┐  │
│    │ meta.type  │ Turborepo           │ Single            │  │
│    ├────────────┼─────────────────────┼───────────────────┤  │
│    │ stack      │ apps/{appName}/     │ root              │  │
│    │ module     │ packages/{pkg}/ *   │ root              │  │
│    │ orm        │ packages/db/        │ {singlePath}/     │  │
│    │ database   │ root                │ root              │  │
│    │ extras     │ root                │ root              │  │
│    │ repo       │ root                │ root              │  │
│    └────────────┴─────────────────────┴───────────────────┘  │
│                                                              │
│  * If module has asPackage; otherwise apps/{appName}/        │
└─────────────────────────────────────────────────────────────┘
```

**ORM special handling for single repo:**

```typescript
case 'orm': {
  if (isTurborepo) {
    return `packages/${meta.asPackage}/${relativePath}`;
  }
  // Strip leading src/ since singlePath handles structure
  const singlePath = relativePath.startsWith('src/')
    ? relativePath.slice(4)
    : relativePath;
  return `${meta.singlePath}${singlePath}`;
}
```

This allows template structure `src/schema.ts` to become:
- Turborepo: `packages/db/src/schema.ts`
- Single: `src/lib/db/schema.ts`

### 4. Handlebars Helpers (`src/lib/handlebars.ts`)

Reduced from 16 helpers to 9 essential ones:

| Helper | Purpose | Example |
|--------|---------|---------|
| `eq` | Equality check | `{{#if (eq orm "drizzle")}}` |
| `ne` | Inequality check | `{{#if (ne repo "single")}}` |
| `and` | Logical AND | `{{#if (and orm database)}}` |
| `or` | Logical OR | `{{#if (or a b)}}` |
| `isTurborepo` | Check repo type | `{{#if (isTurborepo)}}` |
| `has` | Generic check | `{{#if (has "module" "shadcn")}}` |
| `hasContext` | Check context key | `{{#if (hasContext "orm")}}` |
| `appPort` | Get app port | `{{appPort "web"}}` → 3000 |
| `databaseUrl` | Generate DB URL | `{{databaseUrl}}` |

**The `has` helper unifies several old helpers:**

```handlebars
{{!-- Before --}}
{{#if (hasModule "shadcn")}}
{{#if (hasExtra "biome")}}
{{#if (hasAnyStack "nextjs")}}

{{!-- After --}}
{{#if (has "module" "shadcn")}}
{{#if (has "extra" "biome")}}
{{#if (has "stack" "nextjs")}}
```

### 5. File Generator (`src/lib/file-generator.ts`)

Orchestrates the generation process:

```
┌─────────────────────────────────────────────────────────────┐
│              generateProjectFiles(templates, ctx)            │
│                                                              │
│  1. Generate package.json files (programmatic)               │
│     └── generateAllPackageJsons(ctx)                         │
│           └── Write JSON to projectPath                      │
│                                                              │
│  2. Register Handlebars helpers                              │
│     └── registerHandlebarsHelpers()                          │
│                                                              │
│  3. Process templates                                        │
│     └── for each template:                                   │
│           └── processTemplate(template, ctx, projectPath)    │
│                 ├── Copy binary files                        │
│                 ├── Remove @dest: magic comment              │
│                 ├── Enrich context for app templates         │
│                 └── Render with Handlebars                   │
│                                                              │
│  4. Compile results                                          │
│     └── { generated[], failed[], skipped[], success }        │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Complete Generation Flow

```
┌─────────────┐
│  CLI Input  │
│  --app web:nextjs:shadcn
│  --orm drizzle
│  --database postgres
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                      parseFlags()                            │
│                                                              │
│  Validates against META:                                     │
│    - Stack exists in META.stacks                             │
│    - Module exists in META.modules                           │
│    - isModuleCompatible(module, stackName)                   │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    TemplateContext                           │
│                                                              │
│  {                                                           │
│    projectName: "my-app",                                    │
│    repo: "single",                                           │
│    apps: [{ appName: "web", stackName: "nextjs",             │
│             modules: ["shadcn"] }],                          │
│    orm: "drizzle",                                           │
│    database: "postgres"                                      │
│  }                                                           │
└──────┬──────────────────────────────────────────────────────┘
       │
       ├──────────────────────────────┐
       ▼                              ▼
┌────────────────────┐    ┌───────────────────────────────────┐
│ getAllTemplates    │    │  generateAllPackageJsons(ctx)     │
│ ForContext(ctx)    │    │                                   │
│                    │    │  Returns:                         │
│ Returns:           │    │  [{ path: "package.json",         │
│ TemplateFile[]     │    │     content: { name, deps, ... }} │
└────────┬───────────┘    └───────────────┬───────────────────┘
         │                                │
         └──────────────┬─────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  generateProjectFiles()                      │
│                                                              │
│  1. Write package.json files                                 │
│  2. Process templates with Handlebars                        │
└──────┬──────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Generated Project                         │
│                                                              │
│  my-app/                                                     │
│  ├── package.json        ← programmatic                      │
│  ├── src/                                                    │
│  │   ├── app/            ← from stack templates              │
│  │   ├── components/ui/  ← from module templates             │
│  │   └── lib/db/         ← from orm templates                │
│  └── ...                                                     │
└─────────────────────────────────────────────────────────────┘
```

## Files Changed

### New Files
- `src/lib/package-json-generator.ts` - Programmatic package.json generation
- `tests/package-json-generator.test.ts` - 23 tests
- `tests/template-resolver.test.ts` - 13 tests
- `tests/handlebars.test.ts` - 26 tests
- `tests/magic-comments.test.ts` - 12 tests
- `tests/cli-integration.test.ts` - 5 tests
- `tests/helpers.ts` - Test utilities

### Modified Files
- `src/types/meta.ts` - New type structure with PackageJsonConfig
- `src/__meta__.ts` - Restructured with modules at top level
- `src/lib/magic-comments.ts` - Simplified to @dest: only
- `src/lib/template-resolver.ts` - New path resolution logic
- `src/lib/template-processor.ts` - Removed skip logic, added @dest: removal
- `src/lib/handlebars.ts` - Reduced to 9 helpers
- `src/lib/file-generator.ts` - Integrated package.json generator
- `src/flags.ts` - Updated module validation
- `src/prompts/stack-prompts.ts` - Updated for new META structure

### Deleted Files (20 files)
- All `package.json.hbs` templates
- Duplicate ORM templates (`src/lib/db/`)
- Duplicate module templates

## Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Magic comment types | 4 | 1 | -75% |
| Handlebars helpers | 16 | 9 | -44% |
| package.json.hbs files | 10 | 0 | -100% |
| Duplicate template lines | ~690 | 0 | -100% |
| Test count | 0 | 95 | +95 |

## Test Coverage

```
95 tests across 7 files:
├── cli-integration.test.ts     - 5 tests (end-to-end)
├── package-json-generator.test.ts - 23 tests
├── template-resolver.test.ts   - 13 tests
├── handlebars.test.ts          - 26 tests
├── magic-comments.test.ts      - 12 tests
├── meta-types.test.ts          - 7 tests
└── meta-validation.test.ts     - 9 tests
```
