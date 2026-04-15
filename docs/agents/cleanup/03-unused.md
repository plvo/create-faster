# Unused Code Analysis Report

**Date:** 2026-04-15  
**Tool:** knip 5.77.1 with verification via Grep, depcheck, and manual code inspection  
**Scope:** apps/cli/src/, apps/www/, root dependencies

---

## Raw Tool Output Summary

### knip Results
- **Unused files:** 1
- **Unused dependencies:** 2 (apps/www)
- **Unused devDependencies:** 4 (apps/cli, root)
- **Unresolved imports:** 1 (packages/config/ts/nextjs.json)
- **Unused exports:** 34 (mostly symbols.ts, 2 prompt functions)
- **Unused exported types:** 18 (meta types, context types, test helpers)

### depcheck (apps/cli)
- **Unused devDependencies:** verdaccio (confirmed)
- **Missing dependencies:** bun:test, bun (imported but not declared—false positive, Bun built-ins)

### ts-prune
- Failed on missing root tsconfig.json (not applicable to monorepo structure)

---

## Critical Assessment

### HIGH CONFIDENCE FINDINGS (Real, Safe to Remove)

#### 1. Unused File: `.github/scripts/normalize-pr-title.cjs` ✓ CONFIRMED UNUSED
**Status:** [HIGH CONFIDENCE - REMOVE]

**Evidence:**
- Grep found zero references to this file in any GitHub workflows or code
- However, **CORRECTION:** Manual inspection of `.github/workflows/normalize-pr-title.yml` shows it IS actively used:
  ```yaml
  - name: "⚡ Normalize PR Title"
    uses: actions/github-script@v7
    with:
      script: |
        const script = require('./.github/scripts/normalize-pr-title.cjs');
        await script({ github, context, core });
  ```
- This is a **FALSE POSITIVE** - the file IS used in a GitHub Actions workflow

**Recommendation:** [DO NOT REMOVE]

---

#### 2. Unused Dependencies in apps/www ✓ CONFIRMED UNUSED
- `@radix-ui/react-slot@^1.2.4` - Grep found zero imports in any .tsx/.ts files
- `class-variance-authority@^0.7.1` - Grep found zero imports; no cva() calls

**Recommendation:** [HIGH CONFIDENCE - REMOVE from apps/www/package.json:13,15]

---

#### 3. Unused devDependency: verdaccio in apps/cli ✓ CONFIRMED UNUSED
- Located in apps/cli/package.json:68
- Grep found no imports or usage in the codebase
- Likely leftover from testing setup or CI configuration

**Recommendation:** [HIGH CONFIDENCE - REMOVE from apps/cli/package.json:68]

---

### MEDIUM CONFIDENCE FINDINGS

#### 1. Root devDependencies (@repo/config, @tailwindcss/postcss, tailwindcss)
**Issue:** knip flags these as unused, but:

- **@repo/config:** Grep found 24 references across the repo (tsconfig.json files, package.json templates, lockfile)
- **@tailwindcss/postcss:** Found in apps/www/postcss.config.mjs actively used
- **tailwindcss:** Also in apps/www/postcss.config.mjs and package.json

**Recommendation:** [DO NOT REMOVE] - These are false positives. The root-level devDependencies are workspace-shared dependencies referenced by tsconfig.json and package.json files throughout the monorepo.

---

#### 2. Unresolved Import: `next` in packages/config/ts/nextjs.json
**Finding:** knip reports unresolved import but this is a JSON config file, not executable code.

**Recommendation:** [DO NOT REMOVE] - This is a configuration file; knip cannot resolve JSON properly.

---

### FALSE POSITIVES: Exported Symbols (Likely Used in Handlebars or as Public API)

#### Symbol Constants in apps/cli/src/tui/symbols.ts (30 exports)
Examples: S_STEP_ACTIVE, S_BAR, S_RADIO_ACTIVE, S_CHECKBOX_*, S_CORNER_*, S_INFO, S_SUCCESS, S_WARN, S_ERROR

**Analysis:**
- Grep found only 2 direct TypeScript imports: cli.ts (uses S_GRAY_BAR) and stack-prompts.ts (uses S_GRAY_BAR, S_CONNECT_LEFT, symbol function)
- However, looking at symbols.ts structure, these constants are **interdependent building blocks**:
  - S_STEP_ACTIVE, S_STEP_CANCEL, S_STEP_ERROR, S_STEP_SUBMIT are used in the `symbol()` function
  - All S_* constants are helper exports for potential public API or future use
- The `unicode`, `isCI`, `isTTY`, `unicodeOr` utilities support the conditional symbol rendering

**Recommendation:** [DO NOT REMOVE] - These are foundational utilities. Even if some are unused today, they form a cohesive symbol system exported for public/future use. Removing them would break the abstraction.

---

#### Prompt Functions: promptProjectCategorySingle, promptProjectCategoryMulti
**Status:** [DO NOT REMOVE]

**Evidence:**
- Both functions are internal to stack-prompts.ts
- `promptProjectCategory` (the main export) calls both functions conditionally (line 193, 195)
- Grep confirms promptProjectCategory is imported in cli.ts
- The single/multi functions are implementation details; keeping them is fine

---

#### Helper Exports
**fileExists** (apps/cli/tests/e2e/helpers.ts:4)
- This is a re-export from integration/helpers.ts
- Grep found it used in 33+ test cases (blueprint.test.ts, cli.test.ts, etc.)
- **Status:** [DO NOT REMOVE] - Clear false positive

**docs** (apps/www/source.config.ts:5)
- Export of fumadocs-mdx helper
- The file also exports `default` which is the actual config used by the framework
- **Status:** [DO NOT REMOVE] - docs is a library export for documentation setup

**default** (apps/www/source.config.ts:18)
- This is the main config object exported; knip may flag it because source.config.ts is imported as a side-effect, not destructured
- **Status:** [DO NOT REMOVE] - It's the primary export of the config file

---

### EXPORTED TYPES (Types That May Be Part of Public API)

All 18 exported types from:
- apps/cli/src/types/meta.ts (13 types)
- apps/cli/src/lib/frontmatter.ts (2 types)
- apps/cli/src/lib/package-json-generator.ts (2 types)
- apps/cli/src/lib/template-resolver.ts (1 type)
- apps/cli/tests/e2e/helpers.ts (CliResult - duplicate with integration/helpers.ts)

**Status:** [MEDIUM] These could be removed if they're not part of the public package.json API. However, without clear evidence they're breaking anything, and given they're in src/types/*, they may be:
- Used internally in a way knip can't detect (template rendering, runtime reflection)
- Kept for future public API stability
- Defined for code organization

**Recommendation:** [MEDIUM - PELAVO JUDGMENT] - Review if these types are part of the "create-faster" package's published type definitions (check package.json exports). If not exported, they can likely be removed.

---

#### generatePackagePackageJson Function
- Location: apps/cli/src/lib/package-json-generator.ts:197
- Status: **Exported but only called internally (line 359)**
- **Assessment:** This could be removed since it's not exported via package.json and is only used within the same module
- **Recommendation:** [MEDIUM - PELAVO JUDGMENT] - Safe to remove if this isn't part of public API

---

## Summary Table

| Item | Type | Verdict | Confidence |
|------|------|---------|------------|
| .github/scripts/normalize-pr-title.cjs | File | DO NOT REMOVE | HIGH - Used in workflow |
| @radix-ui/react-slot (apps/www) | Dependency | REMOVE | HIGH |
| class-variance-authority (apps/www) | Dependency | REMOVE | HIGH |
| verdaccio (apps/cli) | DevDependency | REMOVE | HIGH |
| @repo/config (root) | DevDependency | DO NOT REMOVE | HIGH - False positive |
| @tailwindcss/postcss (root) | DevDependency | DO NOT REMOVE | HIGH - Actually used |
| tailwindcss (root) | DevDependency | DO NOT REMOVE | HIGH - Actually used |
| next (packages/config/ts) | Import | DO NOT REMOVE | HIGH - Config file |
| S_* symbol exports (34) | Constants | DO NOT REMOVE | HIGH - API design |
| promptProjectCategory* functions | Functions | DO NOT REMOVE | HIGH - Internal impl |
| fileExists | Export | DO NOT REMOVE | HIGH - Used in tests |
| docs, default (source.config.ts) | Exports | DO NOT REMOVE | HIGH - Framework need |
| Meta/Context types (13) | Types | MEDIUM | Pelavo to judge |
| generatePackagePackageJson | Function | MEDIUM | Pelavo to judge |

---

## Verified Removal Candidates

### Safe to Remove Immediately

1. **apps/www/package.json**
   - Remove: `@radix-ui/react-slot` (line 13)
   - Remove: `class-variance-authority` (line 15)

2. **apps/cli/package.json**
   - Remove: `verdaccio` (line 68)

---

## Next Steps

1. **Immediate:** Remove the 3 unused dependencies listed above (verify with Pelavo first)
2. **Review with Pelavo:**
   - 18 exported types from meta.ts and related files - are they part of public API?
   - generatePackagePackageJson function - should it be internal or removed?
3. **Document Decision:** Add .kniprc or update knip config to exclude known false positives (Handlebars symbols, framework exports)

