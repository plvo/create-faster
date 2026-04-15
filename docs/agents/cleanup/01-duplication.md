# Code Duplication Analysis: create-faster CLI

**Status**: Initial assessment complete  
**Scope**: apps/cli/src  
**Date**: 2026-04-15

---

## Executive Summary

The codebase exhibits **moderate duplication** in three key areas: error handling patterns (7+ instances), file operations (mkdir/writeFile duplicated across two modules), and prompt cancellation logic (8 identical exit patterns). Template resolution functions share a similar structure that could be unified. These are low-risk, high-value consolidation opportunities that would improve maintainability without affecting functionality.

---

## Critical Assessment

### Severity: MODERATE

**Duplication Density**: Approximately 5-8% of code is duplicated logic.

**Key Problem Areas**:

1. **Error handling pattern** (`error instanceof Error` check)
   - Found 12 instances across 7 files
   - Identical or near-identical error extraction pattern
   - Locations: file-writer.ts:38,51,64,75 | template-processor.ts:71 | post-generation.ts:23,40 | file-generator.ts:74,93 | index.ts:78,85 | handlebars.ts:67

2. **Prompt cancellation pattern**
   - Found 8 identical `cancel('👋 Bye'); process.exit(0);` blocks
   - Locations: base-prompts.ts:18-19,43-44,54-55 | stack-prompts.ts:46-47,87-88,130-131,153-154,182-183
   - Simple pattern but repetitive across all prompt wrappers

3. **File write operations (mkdir + writeFile)**
   - Duplicated in file-generator.ts (lines 67-68, 86-87)
   - Also implemented in file-writer.ts with abstraction (writeFileContent)
   - Template processor uses file-writer.ts correctly, but file-generator.ts doesn't
   - This creates inconsistent error handling between modules

4. **Template resolution loop pattern**
   - 5 similar functions in template-resolver.ts (lines 66-82, 84-118, 120-153, 155-186, 199-222)
   - Each creates `const templates: TemplateFile[] = []`, reads files, applies filtering, transforms paths
   - Differ only in directory path, filter logic, and destination resolution
   - Could use a factory pattern or shared utility

5. **Frontmatter reading pattern**
   - template-resolver.ts:57-64 wraps readFrontmatterFile with try-catch
   - Called identically in 5 different template resolution functions
   - Returns same type with same error handling

---

## Ranked Recommendations

### [HIGH CONFIDENCE] 1. Consolidate Error Extraction to Shared Utility

**Files Involved**:
- apps/cli/src/lib/file-writer.ts:38,51,64,75
- apps/cli/src/lib/post-generation.ts:23,40
- apps/cli/src/lib/template-processor.ts:71
- apps/cli/src/lib/file-generator.ts:74,93
- apps/cli/src/index.ts:78,85
- apps/cli/src/lib/handlebars.ts:67

**Current Pattern**:
```typescript
const errorMessage = error instanceof Error ? error.message : String(error);
```

**Proposed Refactor**:
Create `lib/error-utils.ts` with:
```typescript
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

Replace all 12 instances with `getErrorMessage(error)`.

**Risk Assessment**: NEGLIGIBLE. Pure utility extraction, zero behavior change.

---

### [HIGH CONFIDENCE] 2. Extract Prompt Cancellation Handler

**Files Involved**:
- apps/cli/src/prompts/base-prompts.ts (3 occurrences)
- apps/cli/src/prompts/stack-prompts.ts (5 occurrences)

**Current Pattern**:
```typescript
if (isCancel(result)) {
  cancel('👋 Bye');
  process.exit(0);
}
```

**Proposed Refactor**:
Add to `lib/exit-utils.ts` or `prompts/exit-handler.ts`:
```typescript
export function handlePromptCancel(): never {
  cancel('👋 Bye');
  process.exit(0);
}
```

Replace 8 instances with:
```typescript
if (isCancel(result)) {
  handlePromptCancel();
}
```

**Risk Assessment**: NEGLIGIBLE. Centralizes exit behavior.

---

### [HIGH CONFIDENCE] 3. Unify File Write Operations

**Files Involved**:
- apps/cli/src/lib/file-generator.ts:64-77, 82-96
- apps/cli/src/lib/file-writer.ts:45-56 (already has writeFileContent)

**Current Issue**:
file-generator.ts duplicates mkdir + writeFile without abstraction:
```typescript
// In file-generator.ts (lines 67-68, 86-87)
await mkdir(dirname(fullPath), { recursive: true });
await writeFile(fullPath, content);
```

While file-writer.ts provides writeFileContent() which encapsulates this.

**Proposed Refactor**:
Replace both file write blocks in file-generator.ts with existing writeFileContent() from file-writer.ts:
```typescript
// Both JSON and env file writes become:
await writeFileContent(fullPath, contentString);
```

**Risk Assessment**: LOW. Both modules already in same codebase, function exists.

---

### [MEDIUM] 4. Consolidate Template Resolution Factory

**Files Involved**:
- apps/cli/src/lib/template-resolver.ts:
  - resolveTemplatesForStack (66-82)
  - resolveTemplatesForLibrary (84-118)
  - resolveTemplatesForProjectAddon (120-153)
  - resolveStackSpecificAddonTemplatesForApps (155-186)
  - resolveTemplatesForBlueprint (199-222)

**Current Pattern**:
All five functions follow: scan directory → read frontmatter → check filters → transform path → add to array

**Proposed Refactor**:
Create generic `resolveTemplatesFromDirectory()` helper accepting:
- `dirPath: string`
- `filterFn: (file, parsed) => boolean`
- `destinationFn: (file, transformed) => string`

Reduces 5 functions from ~190 lines total to ~80 lines + clear specialization.

**Risk Assessment**: MEDIUM. Requires careful refactoring of conditional logic to ensure stack suffix parsing and library-specific filters remain intact. Moderate testing overhead.

---

### [MEDIUM] 5. Extract Frontmatter Reading with Error Handling

**Files Involved**:
- apps/cli/src/lib/template-resolver.ts:57-64

**Current Pattern**:
```typescript
function readFrontmatter(source: string): { frontmatter: TemplateFrontmatter; only: string | undefined } {
  try {
    const parsed = readFrontmatterFile(source);
    return { frontmatter: parsed.data, only: parsed.data.only };
  } catch {
    return { frontmatter: {}, only: undefined };
  }
}
```

This is called 5 times identically in the same file (lines 73, 103, 138, 173, 213).

**Proposed Refactor**:
Move to lib/frontmatter.ts as public export; call from all 5 sites.

**Risk Assessment**: MEDIUM-LOW. Safe extraction but adds one more public function to frontmatter module.

---

### [LOW] 6. Consolidate Port Resolution Logic

**Files Involved**:
- apps/cli/src/lib/env-generator.ts:23-26
- apps/cli/src/lib/handlebars.ts:50-54

**Current Issue**:
`resolveAppPort()` in env-generator is a private function; `appPort` in handlebars duplicates identical logic as Handlebars helper.

**Proposed Refactor**:
Export `resolveAppPort()` from env-generator.ts and use in handlebars helper registration.

**Risk Assessment**: LOW. Trivial consolidation, zero behavior change.

---

## Do Not Touch

### Intentional Duplication (Safe to Ignore)

1. **Meta lookup patterns** (addon-utils.ts, package-json-generator.ts, flags.ts)
   - Scattered META lookups for validation are contextually different and appropriate
   - Consolidating would create confusing abstractions over simple lookups

2. **Template filtering logic** (shouldSkipTemplate patterns across frontmatter.ts and template-resolver.ts)
   - Different calling contexts; frontmatter provides the filter check, template-resolver applies it
   - Correct separation of concerns

3. **Process.exit calls with different codes**
   - Exit code 1 (errors) vs exit code 0 (user cancel) intentional and distinct
   - Should NOT be unified

4. **Object.entries iteration patterns**
   - file-writer.ts, utils.ts, package-json-generator.ts use similar patterns but operate on different data structures
   - Not worth abstracting further

5. **Binary file detection in file-writer.ts**
   - BINARY_EXTENSIONS set with 27 entries is well-organized
   - Single copy appropriate

---

## Implementation Priority

1. **Do first** (trivial, no risk):
   - Error message extraction
   - Prompt cancellation handler

2. **Do second** (low risk, high impact):
   - Unify file write operations
   - Port resolution consolidation

3. **Do last** (requires testing):
   - Template resolution factory pattern
   - Frontmatter reading extraction

---

## Effort Estimate

- **Error + Cancellation helpers**: 15 minutes (2 new files, 12 + 8 replacements)
- **File write unification**: 10 minutes (delete 4 lines, add 2 imports)
- **Template resolution refactor**: 2-3 hours (careful testing required)
- **Port resolution**: 5 minutes

**Total time to resolve high/medium items**: ~45 minutes

---

## Quality Metrics

**After consolidation**:
- Reduce error handling boilerplate by 12 instances
- Eliminate 8 identical cancellation blocks
- Single source of truth for file operations
- Cleaner template resolution with reduced cognitive load

**No performance impact**: All consolidations are pure refactoring.

