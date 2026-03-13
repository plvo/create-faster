# CLI Code Quality Refactoring

**Date**: 2026-03-13
**Scope**: `apps/cli/src/` - eliminate duplication, extract shared logic, improve modularity
**Approach**: Bottom-up (extract foundations first, then refactor consumers)
**Constraint**: No functional changes, no interface changes to public APIs

## 1. Extract utilities (`lib/utils.ts`)

Extract from `package-json-generator.ts`:
- `spreadExtraKeys()` (line 30-34)
- `cleanUndefined()` (line 36-38)
- `sortObjectKeys()` (line 75-81)
- `processScriptPorts()` (line 65-73)

These are general-purpose object manipulation helpers that don't belong in the package.json domain.

## 2. Unify template destination resolution (`template-resolver.ts`)

Replace `resolveLibraryDestination()`, `resolveProjectAddonDestination()`, and `resolveStackDestination()` with a single `resolveDestination()`:

```typescript
interface DestinationParams {
  relativePath: string;
  ctx: TemplateContext;
  frontmatter: TemplateFrontmatter;
  appName?: string;
  addon?: MetaAddon;
  defaultScope: MonoScope;
}

function resolveDestination(params: DestinationParams): string
```

Logic:
1. If not turborepo → return `frontmatter.path ?? relativePath`
2. Determine scope: `frontmatter.mono?.scope ?? addon?.mono?.scope ?? defaultScope`
3. Resolve path based on scope:
   - `root` → filePath
   - `pkg` → `packages/${name}/${filePath}`
   - `app` → `apps/${appName}/${filePath}`

This also replaces the inline destination logic in `resolveTemplatesForBlueprint()`.

Callers pass the appropriate `defaultScope`:
- Libraries → `'app'`
- Project addons → `'root'`
- Stacks → `'app'`
- Blueprints → `'app'`

## 3. Deduplicate `groupEnvsByDestination()` (`env-generator.ts`)

Lines 114-132: the `library` and non-library branches for `scope === 'app'` do the same iteration except the library branch filters by `app.libraries.includes()`. Merge into a single loop with a filter predicate.

## 4. Deduplicate flag validation (`flags.ts`)

Extract a `validateProjectFlag()` helper that validates a single project category flag against META:

```typescript
function validateProjectFlag(
  category: ProjectCategoryName,
  value: string | undefined,
): void
```

Called from both the blueprint and non-blueprint branches, eliminating repeated validation blocks.

## 5. Extract shared CLI prompts (`cli.ts`)

Extract duplicated prompt sequences between `cli()` and `blueprintCli()` into shared functions:

- `promptOrUseProjectName(partial, progress)` - project name prompt + directory existence check
- `promptOrUseGit(partial, progress)` - git confirmation
- `promptOrUsePackageManager(partial, progress, ctx)` - pm selection + skipInstall

Both `cli()` and `blueprintCli()` call these instead of duplicating the logic.

## 6. Clean up dead code

- `file-generator.ts` line 118: empty `if (r.success && r.skipped)` block - remove (the `skipped` property doesn't exist on `ProcessResult`)
- `base-prompts.ts`: remove unused `_category` and `_ctx` params from `promptSelect()`

## Test Strategy

- Every extracted function gets dedicated unit tests
- Existing tests must continue passing (they test the public API)
- Target: >90% coverage on modified files
- New test file: `tests/unit/lib/utils.test.ts`
