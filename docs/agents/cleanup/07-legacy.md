# Legacy & Deprecated Code Assessment

## Summary

**Codebase Health: EXCELLENT** — no legacy cruft found.

## Inventory

### 1. Removed Blueprint (Already Cleaned)
- **Location**: Git commit `da83510` (2026-03-19)
- **Status**: ALREADY REMOVED
- Dashboard blueprint replaced by `org-dashboard` (with auth, RBAC, tRPC).
- Canonical path: `apps/cli/src/__meta__.ts:734-785`.
- No remnants in code or tests.

### 2. Composite Addon Pattern (`eslint-prettier`)
- **Location**: `apps/cli/src/__meta__.ts:490-500`; handled by `resolveCompositeAddons()` in `package-json-generator.ts:69-84`
- **Status**: ACTIVE — intentional design pattern, not legacy.

### 3. Workflow Step Comments
- `file-generator.ts:60-116` — phase markers (Step 1-4) are legitimate documentation.
- `file-writer.ts:91,105,113`, `frontmatter.ts:118,121`, `types/meta.ts:18` — design explanations.

### 4. Conditional Resolution (`$when`)
- **Location**: `apps/cli/src/lib/when.ts`, used 20+ times in `__meta__.ts`
- **Status**: ACTIVE canonical system; single entry point, no alternative implementation.

### 5. Handlebars Helpers
- `apps/cli/src/lib/handlebars.ts:4-55` — 10 helpers (`eq`, `ne`, `and`, `or`, `isMono`, `hasLibrary`, `has`, `hasContext`, `camelCase`, `raw`, `appPort`)
- All serve distinct purposes. No duplicates.

## Assessment

- 0 `@deprecated` markers
- 0 backwards-compatibility shims
- 0 commented-out code blocks
- 0 abandoned half-finished features
- 0 parallel implementations of the same capability

## Recommendations

**[HIGH CONFIDENCE]**: None. Codebase is clean.

**[MEDIUM]**: None identified.

**[DO NOT TOUCH]**: Everything inventoried above is intentional.

## Conclusion

The dashboard blueprint removal demonstrates the team practices thorough deprecation — old code is fully removed, not left as fallback. No action needed for this cleanup dimension.
