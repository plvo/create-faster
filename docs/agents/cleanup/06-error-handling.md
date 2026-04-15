# Error Handling Analysis - create-faster CLI

**Status:** Initial survey of all try/catch, .catch(), and defensive patterns  
**Scope:** `/apps/cli/src/**/*.ts`  
**Date:** 2026-04-15

---

## Executive Summary

The CLI has a **clear, intentional error handling philosophy** focused on:
- **Immediate failure on validation/config errors** (loud/fast feedback)
- **Graceful degradation on external I/O** (warn and continue where possible)
- **Explicit user cancellation handling** (via @clack/prompts isCancel pattern)

**Overall Assessment:** Error handling is **well-justified across the board**. High confidence that most catches serve real boundaries (I/O, user input, template rendering). No obvious anti-patterns found. Minor QUESTIONABLE cases flagged for clarification.

---

## Inventory by File

### 1. `/apps/cli/src/index.ts`

#### Line 22–81: `try/catch` (main orchestrator)
```typescript
try {
  // ...promptSelect, cli/blueprintCli, generateProjectFiles, runPostGeneration...
} catch (error) {
  log.error(`An error occurred:\n${error instanceof Error ? error.message : String(error)}`);
  outro('👋 Bye');
  process.exit(1);
}
```
**Classification:** JUSTIFIED  
**Rationale:** Top-level catch for any unexpected error during project generation flow. Ensures clean exit with user-facing message. Propagates from nested functions.

#### Line 84–87: `.catch()` on main()
```typescript
main().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```
**Classification:** JUSTIFIED  
**Rationale:** Unhandled promise rejection guard. Standard Node.js pattern to catch errors if main() throws before entering try block or after the top-level catch.

---

### 2. `/apps/cli/src/lib/file-generator.ts`

#### Line 66–76: `try/catch` (package.json write)
```typescript
try {
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, ...);
  allResults.push({ success: true, destination: path });
} catch (error) {
  allResults.push({
    success: false,
    destination: path,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}
```
**Classification:** JUSTIFIED  
**Rationale:** Legitimate file I/O boundary. Catches mkdir/writeFile failures (disk full, permissions, etc.). Results bubbled to caller for reporting.

#### Line 85–95: `try/catch` (env.example write)
**Classification:** JUSTIFIED  
**Rationale:** Same pattern, different file type. Handles env file write failures gracefully.

---

### 3. `/apps/cli/src/lib/handlebars.ts`

#### Line 58–71: `try/catch` (Handlebars compilation)
```typescript
try {
  const template = Handlebars.compile(templateContent, { ... });
  return template(context);
} catch (error) {
  if (error instanceof Error) {
    throw new Error(`Handlebars compilation failed: ${error.message}`);
  }
  throw error;
}
```
**Classification:** JUSTIFIED  
**Rationale:** Template syntax errors (invalid Handlebars) are user-provided input. Wraps error with context ("compilation failed") and re-throws for caller to handle. Prevents silent corruption.

---

### 4. `/apps/cli/src/lib/file-writer.ts`

#### Line 35–42: `try/catch` (ensureDirectory)
```typescript
try {
  await mkdir(dirPath, { recursive: true });
} catch (error) {
  if (error instanceof Error) {
    throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
  }
  throw error;
}
```
**Classification:** JUSTIFIED  
**Rationale:** Wraps mkdir error with path context. Re-throws, doesn't swallow.

#### Line 46–55: `try/catch` (writeFileContent)
**Classification:** JUSTIFIED  
**Rationale:** Wraps file write errors. Re-throws with path context.

#### Line 59–68: `try/catch` (copyBinaryFile)
**Classification:** JUSTIFIED  
**Rationale:** Wraps copy operation. Re-throws with source/dest context.

#### Line 72–79: `try/catch` (readFileContent)
**Classification:** JUSTIFIED  
**Rationale:** Wraps read operation. Re-throws with file path context.

#### Line 82–88: `catch` without `try` (pathExists)
```typescript
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
```
**Classification:** JUSTIFIED  
**Rationale:** Intentional: `access()` throws if file missing. Catch is used to detect absence, not propagate. Pattern is idiomatic for existence checks in Node.js.

#### Line 120–124: `catch` without `try` (scanDirectory)
```typescript
try {
  return globSync('**/*', { cwd: dir, onlyFiles: true, dot: true });
} catch {
  return [];
}
```
**Classification:** UNJUSTIFIED [LOW CONFIDENCE]  
**Rationale:** **Questionable.** Returns empty array on globSync error. If glob fails (bad pattern, unexpected error), caller won't know. Used in template resolution (`template-resolver.ts`), so failing silently could hide misconfiguration. However, glob is unlikely to throw unless directory doesn't exist or permissions denied, both rare after `existsSync` check. Acceptable but could be more explicit.

---

### 5. `/apps/cli/src/lib/post-generation.ts`

#### Line 12–29: `try/catch` (npm install)
```typescript
try {
  s.start(`Installing dependencies with ${ctx.pm}...`);
  await execAsync(installCommand, { cwd: projectPath, timeout: 300000 });
  s.stop(`Dependencies installed successfully!`);
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  s.stop(color.yellow(`⚠ Warning: Failed to install dependencies: ${errorMessage}...`));
}
```
**Classification:** JUSTIFIED  
**Rationale:** Legitimate external process failure. npm/yarn/pnpm/bun install can fail for network, auth, invalid package.json, etc. Continues with warning instead of blocking project creation (user can retry manually).

#### Line 34–44: `try/catch` (git init)
**Classification:** JUSTIFIED  
**Rationale:** Same pattern: git init can fail if git not installed or permissions denied. Warns and continues.

---

### 6. `/apps/cli/src/lib/template-processor.ts`

#### Line 28–77: `try/catch` (processTemplate)
```typescript
try {
  const filename = basename(destination);
  const transformedFilename = transformFilename(filename);
  // ... file operations, Handlebars rendering, writes ...
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    destination,
    error: `Failed to process ${source}: ${errorMessage}`,
  };
}
```
**Classification:** JUSTIFIED  
**Rationale:** Catches errors from entire template processing pipeline (read, render, write). Returns structured error result for aggregation. Allows generation to continue for other templates.

---

### 7. `/apps/cli/src/lib/template-resolver.ts`

#### Line 57–63: `try/catch` (readFrontmatter)
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
**Classification:** QUESTIONABLE [MEDIUM CONFIDENCE]  
**Rationale:** **Graceful fallback.** If frontmatter parsing fails (corrupted template, invalid YAML), returns empty frontmatter. This masks file errors but makes sense for optional metadata. However, **worth confirming:** Should a malformed template file be silently treated as having no frontmatter? Or should it error? Currently enables robust template scanning but could hide bugs in template manifests.

---

## Defensive Patterns: Nullish Coalescing (`??`) & Optional Chaining (`?.`)

### Justified Uses (Safe Fallbacks)
- **`ctx.pm ?? 'npm'`** (cli.ts:88, 160, summary.ts:125, 128, package-json-generator.ts:245)  
  → Default PM if not set. Safe; npm is sensible default.

- **`library.category ?? 'Other'`** (stack-prompts.ts:70)  
  → Groups libraries with missing category as "Other". Safe grouping fallback.

- **`result as string[] ?? []`** (cli.ts:88, 160)  
  → Ensures arrays on tooling. Safe guard after type cast.

- **`selectOptions?.options ?? []`** (base-prompts.ts:29)  
  → Handles undefined options. Safe defensive code.

- **`root.apps?.findIndex(...) ?? -1`** (handlebars.ts:52)  
  → Defaults to -1 if not found. Pattern is safe and idiomatic.

- **`library.support?.stacks === 'all' ? 'all' : (...?.join(', ') ?? 'none')`** (flags.ts:237)  
  → Complex fallback chain for display. Safe.

### Potentially Masking Failures
- **`addon?.mono?.name ?? 'unknown'`** (template-resolver.ts:47)  
  → If addon exists but mono/name missing, defaults to "unknown". Could hide misconfigured addon metadata. **Borderline:** used only for path generation, so impact is low. But worth flagging if addon structure should be strict.

---

## User Cancellation Handling (Legitimate)

All prompt functions in `prompts/base-prompts.ts` and `prompts/stack-prompts.ts` check `isCancel()` and exit cleanly:
```typescript
if (isCancel(result)) {
  cancel('👋 Bye');
  process.exit(0);
}
```
**Classification:** JUSTIFIED  
**Rationale:** @clack/prompts distinguishes user cancellation (Ctrl+C) from errors. Treating cancel as clean exit (0) is correct. Not an error handling anti-pattern.

---

## Validation & Flag Parsing

**File:** `flags.ts`

No try/catch in flag parsing. Instead:
- Early validation with `validateOption()`, `validateContext()`, `validateStackSuffix()`
- Hard exits on invalid input via `process.exit(1)`
- **Philosophy:** Fail fast on bad input, don't hide it.

**Classification:** JUSTIFIED  
**Rationale:** User-provided CLI flags are not "errors to recover from"—they're config validation. Fast failure with clear error message is correct.

---

## Summary of Findings

| Category | Count | Status |
|----------|-------|--------|
| **JUSTIFIED** | 19 | Safe boundaries (I/O, template render, prompts, validation) |
| **QUESTIONABLE** | 2 | `scanDirectory` catch, `readFrontmatter` fallback—warrant clarification |
| **UNJUSTIFIED** | 0 | None found |

---

## Codebase Error Philosophy

### Stated Principles (Inferred from Code)
1. **Fail fast on validation** → Hard exits on bad config/flags (no recovery)
2. **Fail gracefully on I/O** → Warn and continue (user can retry manually)
3. **Fail transparently on templates** → Wrap errors with context, bubble up
4. **Handle user cancellation cleanly** → Exit 0, not an error
5. **Aggregate downstream errors** → Let generation continue for other files, report summary

### Recommendation for Philosophy Documentation
**Add to project docs:**
- Try/catch is for **I/O and template rendering boundaries only**
- CLI validation uses hard exits, not exceptions
- Promise rejections handled at entry point
- File/process errors caught, enriched with context, reported to user
- User cancellation (Ctrl+C) is a clean exit, not an error

---

## Questions for Pelavo (Maintainer)

1. **`scanDirectory` (file-writer.ts:120–124):** Should glob failures be silent (`return []`) or loud (`throw`)? Currently hides potential misconfiguration.

2. **`readFrontmatter` (template-resolver.ts:57–63):** Should malformed frontmatter be silently treated as no frontmatter? Or should it error? Current behavior is lenient; consider if stricter validation is desired.

3. **`addon?.mono?.name ?? 'unknown'`** (template-resolver.ts:47): Should addon metadata be validated at load time instead of defaulting at runtime?

4. **Documentation gap:** Should error handling philosophy be added to CONTRIBUTING.md or similar? (E.g., "Catches are for I/O only. Validation uses process.exit().")

---

## Risk Assessment

**Overall Risk:** **LOW**

- No silent failures masking bugs in core logic
- All I/O boundaries properly caught and reported
- Template errors wrapped with context
- User-facing messages clear
- Exit codes correct (0 for success/cancel, 1 for error)

**Low-Priority Cleanup:**
- Consider making `scanDirectory` errors explicit (log warning instead of silent return)
- Consider validating addon metadata at load time vs. runtime fallbacks
- Document error handling conventions in CONTRIBUTING.md

**No Breaking Changes Required**
