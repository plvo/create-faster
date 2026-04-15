# Comment Quality Audit — apps/cli/src

**Date:** 2026-04-15  
**Scope:** TypeScript CLI source files  
**Verdict:** Codebase is **relatively clean** but has isolated LARP and one AI marketing phrase.

---

## Summary

- **Total files scanned:** 23 .ts/.tsx files
- **Comment density:** Very low (mostly self-documenting code)
- **Issues found:** 4
- **Overall assessment:** Minimal comment pollution. Code is clear and well-structured. Most functions are self-documenting. The few comments that exist are either helpful or trivial LARP.

---

## [HIGH CONFIDENCE DELETE]

### 1. `apps/cli/src/flags.ts:1` — Biome-ignore directive with weak justification
**Text:**
```typescript
/** biome-ignore-all lint/style/noNonNullAssertion: <We know the project is defined> */
```

**Reason:** This is a blanket ignore for the entire file. The justification "We know the project is defined" is vague and overrides a lint rule across all code. Should be targeted to specific lines or removed if non-assertion patterns are used.

**Action:** Replace with targeted line-level ignores or refactor to eliminate null assertions.

---

### 2. `apps/cli/src/tui/progress.ts:1` — Biome-ignore with generic comment
**Text:**
```typescript
/** biome-ignore-all lint/style/noNonNullAssertion: <progress step status is always defined> */
```

**Reason:** Same issue—blanket ignore with weak generic reasoning. "Always defined" is asserted but not proven by type system.

**Action:** Remove or narrow to specific non-null assertions that can't be eliminated through refactoring.

---

## [REWRITE]

### 1. `apps/cli/src/lib/template-processor.ts:15-20` — LARP JSDoc
**Current:**
```typescript
/**
 * Process a single template file
 * - Binary files without .hbs: direct copy
 * - Files with .hbs: Handlebars rendering
 * - Other files: copy as text
 */
```

**Issue:** This is pure LARP—a multi-line JSDoc that just lists what the code does line-by-line. The logic is already clear from reading the function body. No WHY, no subtlety explained.

**Proposed rewrite:**
```typescript
/**
 * Transforms template files based on type: processes Handlebars, copies binaries as-is.
 */
```

**Rationale:** Keeps the WHY (template transformation logic) without the ceremony.

---

### 2. `apps/cli/src/__meta__.ts:201` — Marketing adjective in hint
**Current:**
```typescript
hint: 'The most comprehensive authentication framework for TypeScript',
```

**Issue:** "most comprehensive" is AI-style marketing language. Should be factual and objective.

**Proposed rewrite:**
```typescript
hint: 'Authentication framework for TypeScript',
```

**Rationale:** The user can evaluate comprehensiveness themselves; hints should be descriptive, not superlative.

---

## [KEEP] — Well-formed comments

### 1. `apps/cli/src/lib/frontmatter.ts:118, 121`
```typescript
// Check if this looks like a stack suffix attempt (has file extension before it)
// Check if the suffix is a partial match for any valid stack (e.g., "next" for "nextjs")
```
**Reason:** These explain non-obvious conditional logic. The WHY behind the checks is clear and necessary for understanding the template naming conventions.

---

### 2. `apps/cli/src/lib/file-writer.ts:91-97` — Thoughtful JSDoc example
```typescript
/**
 * Transforms filenames to their corresponding filenames
 * @example
 * transformFilename('page.tsx.hbs') -> 'page.tsx'
 * transformFilename('__gitignore.hbs') -> '.gitignore'
 * transformFilename('___root.tsx.hbs') -> '__root.tsx'
 */
```
**Reason:** The examples demonstrate the transformation behavior clearly (the unconventional `__` → `.` mapping). This is legitimate JSDoc.

---

### 3. `apps/cli/src/lib/file-writer.ts:113-117` — Another well-placed JSDoc
```typescript
/**
 *  Scans a directory for files
 * @example
 * scanDirectory('apps/my-app/src') -> ['page.tsx', 'api.ts', 'api/route.ts']
 */
```
**Reason:** The example clarifies the output format and glob behavior.

---

### 4. `apps/cli/src/tui/symbols.ts:1-3` — Attribution comment
```typescript
/**
 * Pasted from https://github.com/bombshell-dev/clack/blob/38019c786efc28951a5921f26634cf4c4392367f/packages/prompts/src/common.ts
 */
```
**Reason:** Legitimate attribution for borrowed code. Clear provenance.

---

### 5. `apps/cli/src/types/meta.ts:18`
```typescript
// Mirrors ProjectContext keys but with string[] for "one of these" semantics
```
**Reason:** Explains the relationship between two type definitions—the WHY the interface mirrors another is non-obvious and necessary for maintainers.

---

### 6. `apps/cli/src/lib/file-writer.ts:105`
```typescript
// Double underscore becomes dot (for dotfiles like .gitignore)
```
**Reason:** Explains a non-standard naming convention. The WHY (supporting dotfiles) is useful context.

---

## General Findings

### Strengths
- **Self-documenting code:** Function and variable names are clear (`transformFilename`, `parseStackSuffix`, `isLibraryCompatible`).
- **Minimal ceremony:** No unnecessary explanations of WHAT code does; logic is readable.
- **No temporal comments:** Zero references to "recently", "moved", "legacy", "new", "improved", etc.
- **No instructional comments:** No "you must" or "remember to" directives.

### Weaknesses
- **Two blanket biome-ignore directives** suppress linting without strong justification. These should be narrowed.
- **One LARP JSDoc** (template-processor) that just restates logic.
- **One marketing phrase** in metadata ("most comprehensive").

### Opportunities
- **Target null-assertion ignores:** Instead of file-wide `biome-ignore-all`, use targeted line comments with specific reasons.
- **Remove LARP JSDoc:** Either strip the docblock or condense to one sentence explaining WHY templates need transformation.
- **Neutral language in hints:** Replace adjectives with factual descriptions.

---

## No Evidence Of
- AI-generated slop (improved, enhanced, robust, modern, cutting-edge)
- Stub/TODO/FIXME comments
- Commented-out code blocks
- Notes about in-motion work or refactoring
- Names like "new", "old", "legacy", "wrapper", "unified"
- Emoji in comments (legitimate only)

---

## Conclusion

The codebase demonstrates **good comment discipline**. The few issues found are isolated and easily fixed. The team understands Pelavo's policy: comments explain WHY, not WHAT. The code is well-structured and self-documenting, which means fewer comments are needed in the first place.

**Priority:** Low. These are polish improvements, not critical issues.
