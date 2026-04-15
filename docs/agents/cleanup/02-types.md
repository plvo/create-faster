# Type Consolidation Analysis — CLI Type Architecture

## Executive Summary

The codebase declares 40+ type/interface definitions across 13 files. Approximately 65% are properly consolidated in `types/meta.ts` and `types/ctx.ts`, but 14 interfaces remain scattered across lib/ and tui/ modules where they serve local concerns. Strategic consolidation would improve maintainability without disrupting separation of concerns.

---

## 1. Current Type Topology

### Central Type Files (Already Consolidated)

#### `types/meta.ts` (24 exports)
- Core metadata schema: `Meta`, `MetaAddon`, `MetaProject`, `MetaStack`, `MetaBlueprint`
- Configuration shapes: `PackageJsonConfig`, `EnvVar`, `EnvScope`, `AddonMono`
- Stack/repo naming: `StackName`, `RepoType`, `MonoScope`
- Runtime shape: `AppUrlContext`, `AddonRuntime`, `AppScriptTransform`
- Support/requirement contracts: `AddonSupport`, `AddonRequire`

#### `types/ctx.ts` (6 exports)
- Template context: `TemplateContext`, `TemplateFile`, `AppContext`, `ProjectContext`
- Package manager: `PackageManager`
- Derived types: `EnrichedTemplateContext`

### Scattered Types (OUT of types/ directory)

| File | Type | Status | Scope | Reason |
|------|------|--------|-------|--------|
| `__meta__.ts` | `ProjectCategoryName` | Exported | Single use | Derived from `META.project` keys |
| `lib/when.ts` | `MatchValue`, `WhenItem` | Private/exported | Conditional resolution | Core to `$when()` macro |
| `lib/env-generator.ts` | `EnvFileOutput`, `EnvGroup`, `CollectedEnv` | Private | File output domain | Tight coupling to env collection logic |
| `lib/package-json-generator.ts` | `PackageJson`, `GeneratedPackageJson` | Exported | Shared output contract | Used by `file-generator.ts` |
| `lib/frontmatter.ts` | `TemplateFrontmatter`, `ParsedTemplate`, `StackSuffixResult` | Exported | YAML frontmatter parsing | Tied to template file processing |
| `lib/template-resolver.ts` | `DestinationParams` | Exported | Path resolution | Configuration for `resolveDestination()` |
| `lib/template-processor.ts` | `ProcessResult` | Private | Single function return | Isolated from other modules |
| `lib/file-generator.ts` | `GenerationOptions`, `GenerationResult`, `ProcessResult` | Private/exported | File generation output | Orchestration concerns |
| `flags.ts` | `ParsedFlags` | Private | CLI argument parsing | Command line validation domain |
| `tui/progress.ts` | `ProgressStep` | Exported | Progress UI | TUI state representation |
| `tui/symbols.ts` | `CommonOptions` | Exported | TUI input/output | From clack library |

---

## 2. Critical Assessment

### Strengths
1. **Clear domain separation**: Core metadata (meta.ts) and template context (ctx.ts) are well-centralized.
2. **Output contracts are explicit**: `PackageJson`, `GeneratedPackageJson`, `GenerationResult` make file generation contracts clear.
3. **Library-local types justified**: WhenItem, EnvGroup, ProcessResult serve narrow, cohesive purposes.

### Weaknesses
1. **ProjectCategoryName is isolated**: Defined in `__meta__.ts` but should co-locate with type definitions.
2. **Duplicate ProcessResult**: Two different `ProcessResult` interfaces (template-processor.ts + file-generator.ts) with nearly identical shapes.
3. **Scattered output contracts**: Three separate modules define "output" shapes (env-generator, package-json-generator, file-generator).
4. **ParsedFlags is undocumented**: Defined in flags.ts but semantically mirrors TemplateContext fields—risk of sync issues.

### Risk Assessment
- **Low risk moves**: ProjectCategoryName, consolidating ProcessResult
- **Medium risk moves**: Creating shared "Output" type hierarchy (env/pkg/file outputs)
- **High risk moves**: Merging ParsedFlags into TemplateContext (would couple CLI validation to template context shape)

---

## 3. Recommendations

### HIGH CONFIDENCE (Implement First)

#### 1. Consolidate `ProcessResult` [CRITICAL]
- **Current state**: Two separate interfaces in `template-processor.ts` (line 7) and `file-generator.ts` (line 22)
- **Proposed location**: `types/ctx.ts`
- **Rationale**: Both describe outcome of processing a single file; identical shape
- **Implementation**: Export from ctx.ts, import into both modules
- **Risk**: None; these are private implementation details
- **Effort**: 10 minutes

```typescript
// types/ctx.ts
export interface ProcessResult {
  success: boolean;
  destination: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}
```

#### 2. Relocate `ProjectCategoryName` [CRITICAL]
- **Current state**: Derived type at end of `__meta__.ts` (line 821)
- **Proposed location**: `types/meta.ts` (after MetaProject)
- **Rationale**: It's a type definition, not data. Belongs with metadata type schema.
- **Implementation**: Move 1-line export; adjust import in __meta__.ts
- **Risk**: None; affects only internal references
- **Effort**: 5 minutes

### MEDIUM CONFIDENCE (Plan for Next Pass)

#### 3. Create Shared Output Envelope [RECOMMENDED]
- **Current state**: Three separate "output" interfaces
  - `EnvFileOutput` (env-generator.ts:6) — {destination, content}
  - `GeneratedPackageJson` (package-json-generator.ts:24) — {path, content}
  - `GenerationResult` (file-generator.ts:15) — {success, generated, failed, skipped}
- **Proposed approach**: Create `types/output.ts` with normalized shape
- **Rationale**: All represent "generated file output" but use different field names (destination/path)
- **Risk**: Medium — requires updating 3 call sites and ensuring backward compat
- **Confidence**: 60% — may over-abstract if shapes diverge in future
- **Recommendation**: **DEFER** until consolidation need is clearer

#### 4. Document `TemplateFrontmatter` in types/meta.ts [RECOMMENDED]
- **Current state**: In `lib/frontmatter.ts` (line 5)
- **Rationale**: Describes metadata structure (mono scoping, conditional rendering)—adjacent to AddonMono, AddonRuntime
- **Risk**: Low; it's already exported and well-used
- **Confidence**: 70%
- **Implementation**: Move to types/meta.ts, keep frontmatter.ts import
- **Effort**: 15 minutes

### LOW CONFIDENCE (Do Not Implement)

#### 5. Do NOT consolidate ParsedFlags
- **Reason**: ParsedFlags is a CLI validation shape; TemplateContext is application state. Mixing these creates coupling.
- **Alternative**: Keep ParsedFlags in flags.ts. Create explicit `parseFlags() -> TemplateContext` transformation (already exists, line 52).

#### 6. Do NOT consolidate WhenItem/MatchValue
- **Reason**: These are core to the `$when()` conditional macro system, which may evolve independently.
- **Keep in**: `lib/when.ts` (tightly bound to resolveConditionals logic)

#### 7. Do NOT consolidate `DestinationParams`
- **Reason**: Tightly coupled to resolveDestination() logic and template resolution algorithm.
- **Keep in**: `lib/template-resolver.ts`

#### 8. Do NOT consolidate TUI types
- **Reason**: `ProgressStep` and `CommonOptions` are UI implementation details, not domain contracts.
- **Keep in**: `tui/progress.ts`, `tui/symbols.ts`

---

## 4. Detailed HIGH Recommendations

### Recommendation 1: Consolidate ProcessResult

**Current locations:**
- `apps/cli/src/lib/template-processor.ts:7`
- `apps/cli/src/lib/file-generator.ts:22`

**Proposed new location:**
- `apps/cli/src/types/ctx.ts` (after line 35)

**Change set:**
1. Add to `types/ctx.ts`:
   ```typescript
   export interface ProcessResult {
     success: boolean;
     destination: string;
     error?: string;
     skipped?: boolean;
     reason?: string;
   }
   ```

2. Remove from `lib/template-processor.ts` (delete lines 7–13)

3. Remove from `lib/file-generator.ts` (delete lines 22–26)

4. Add imports:
   - `lib/template-processor.ts`: `import type { ProcessResult } from '@/types/ctx';`
   - `lib/file-generator.ts`: Already imports from types/ctx, just add ProcessResult to destructure

**Rationale:**
- Both usages are functionally identical
- Part of the file processing pipeline contract
- Belongs alongside TemplateFile in ctx.ts

**Risk assessment:** None. Both are private implementation details; no external API change.

---

### Recommendation 2: Move ProjectCategoryName to types/meta.ts

**Current location:**
- `apps/cli/src/__meta__.ts:821`

**Proposed new location:**
- `apps/cli/src/types/meta.ts` (after MetaProject, line 92)

**Change set:**
1. Add to `types/meta.ts`:
   ```typescript
   export type ProjectCategoryName = keyof typeof META.project;
   ```
   *(Will need to import META from __meta__.ts or use string literal union)*
   
   **Better approach:** Use string literal instead of keyof typeof:
   ```typescript
   export type ProjectCategoryName = 'database' | 'orm' | 'deployment' | 'linter' | 'tooling';
   ```

2. Remove from `__meta__.ts` (delete line 821)

3. Update `__meta__.ts` import:
   - Change: `import type { ... } from '@/types/meta';`
   - Add: `ProjectCategoryName` to the import list (or remove if not used in __meta__.ts after move)

4. Verify all files importing ProjectCategoryName still work:
   - `flags.ts` (line 261): Already imports from '@/__meta__', update to import from '@/types/meta'
   - `lib/package-json-generator.ts` (line 2): Already imports from '@/__meta__', update to import from '@/types/meta'

**Rationale:**
- ProjectCategoryName is a type definition, not data
- Describes the schema of META.project
- Should co-locate with MetaProject interface

**Risk assessment:** None. Only affects internal imports, no public API change.

---

## 5. Types That Should Remain Local

| Type | Module | Justification |
|------|--------|---------------|
| `WhenItem<T>`, `MatchValue` | `lib/when.ts` | Core to conditional evaluation system; tightly coupled to `isWhenItem()` and `resolveConditionals()` |
| `EnvFileOutput`, `EnvGroup`, `CollectedEnv` | `lib/env-generator.ts` | Internal pipeline; not re-exported or used elsewhere |
| `ParsedFlags` | `flags.ts` | CLI validation domain; mixing with TemplateContext would create inappropriate coupling |
| `TemplateFrontmatter`, `ParsedTemplate`, `StackSuffixResult` | `lib/frontmatter.ts` | Tightly bound to gray-matter parsing and YAML processing |
| `DestinationParams` | `lib/template-resolver.ts` | Configuration for single resolution function; not part of public contract |
| `GenerationOptions` | `lib/file-generator.ts` | Internal orchestration option; not exported |
| `ProgressStep` | `tui/progress.ts` | UI implementation detail; part of Progress class internals |
| `CommonOptions` | `tui/symbols.ts` | Wrapped from clack library; represents TUI I/O specifics |

---

## 6. Summary Table

| Action | Type | From | To | Effort | Confidence |
|--------|------|------|-----|--------|-----------|
| **Move** | ProcessResult (merge two) | template-processor.ts + file-generator.ts | types/ctx.ts | 10min | HIGH |
| **Move** | ProjectCategoryName | __meta__.ts | types/meta.ts | 5min | HIGH |
| **Document** | Consider moving TemplateFrontmatter | lib/frontmatter.ts | types/meta.ts | 15min | MEDIUM |
| **Defer** | Create output envelope type | env + pkg + file generators | types/output.ts | 30min | MEDIUM |
| **Keep** | ParsedFlags | flags.ts | — | — | — |
| **Keep** | WhenItem/MatchValue | lib/when.ts | — | — | — |
| **Keep** | TUI types | tui/* | — | — | — |

---

## 7. Implementation Checklist

- [ ] Add ProcessResult to types/ctx.ts
- [ ] Remove ProcessResult from template-processor.ts
- [ ] Remove ProcessResult from file-generator.ts
- [ ] Update imports in both modules
- [ ] Add ProjectCategoryName to types/meta.ts
- [ ] Remove ProjectCategoryName from __meta__.ts
- [ ] Update imports in flags.ts and package-json-generator.ts
- [ ] Run type check: `tsc --noEmit`
- [ ] Verify no import errors in full build

**Estimated total time:** 20 minutes

