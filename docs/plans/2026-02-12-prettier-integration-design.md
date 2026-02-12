# Prettier Integration Design

Add Prettier as a code quality option alongside Biome and ESLint.

## Context

PR #74 separated linters into a dedicated `linter` category with single selection (Biome, ESLint). Prettier is a formatter (not a linter), but users pick one code quality strategy — so it belongs in the same flat category rather than a separate `formatter` category.

## Design Decisions

**Flat single-selection category.** The `linter` key stays as-is (internal naming, CLI flag, types, template directory). The prompt label changes to "Code quality tools?" to reflect the broader scope.

**Four options:**

| Option | What it does |
|--------|-------------|
| `biome` | Lint + format (unchanged) |
| `eslint-prettier` | Lint with ESLint, format with Prettier |
| `eslint` | Lint only, no formatter |
| `prettier` | Format only, no linter |

**Composite addons via `compose`.** `eslint-prettier` declares `compose: ['eslint', 'prettier']` in META. The resolver and package.json generator expand composites into their parts — resolving templates and merging deps from each composed addon, plus the composite's own incremental additions (`eslint-config-prettier`).

## META Changes (`__meta__.ts`)

```typescript
linter: {
  prompt: 'Code quality tools?',
  selection: 'single',
  options: {
    biome: {
      // unchanged
    },
    'eslint-prettier': {
      label: 'ESLint + Prettier',
      hint: 'Lint with ESLint, format with Prettier',
      compose: ['eslint', 'prettier'],
      mono: { scope: 'pkg', name: 'eslint-config' },
      packageJson: {
        devDependencies: {
          'eslint-config-prettier': '^10.1.8',
        },
      },
    },
    eslint: {
      // unchanged
    },
    prettier: {
      label: 'Prettier',
      hint: 'Opinionated code formatter (no linter)',
      mono: { scope: 'root' },
      packageJson: {
        devDependencies: {
          prettier: '^3.8.1',
          'prettier-plugin-tailwindcss': '^0.7.2',
        },
        scripts: {
          format: 'prettier --write .',
          'format:check': 'prettier --check .',
        },
      },
    },
  },
},
```

### Type change (`types/meta.ts`)

Add optional `compose` field to `MetaAddon`:

```typescript
compose?: string[];
```

## Template Files

### New: `templates/project/linter/prettier/`

**`__prettierrc.hbs`** → `.prettierrc` (root scope):

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindFunctions": ["clsx", "cn"]
}
```

Tailwind plugin always included — no-op on non-Tailwind files, simpler than conditional logic.

**`__prettierignore.hbs`** → `.prettierignore` (root scope):

```
dist
build
out
.next
.turbo
coverage
node_modules
*.min.js
*.min.css
pnpm-lock.yaml
bun.lockb
package-lock.json
```

### Modified: ESLint templates

Add conditional `eslint-config-prettier` integration when linter is `eslint-prettier`.

**`base.js.hbs`** (shared config in turborepo — `packages/eslint-config/base.js`):

```handlebars
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
{{#if (has 'linter' 'eslint-prettier')}}
import eslintConfigPrettier from "eslint-config-prettier/flat";
{{/if}}

export default tseslint.config(
  // ... existing rules
{{#if (has 'linter' 'eslint-prettier')}}
  eslintConfigPrettier,
{{/if}}
);
```

Only added in `base.js` — all stack configs extend base, so prettier overrides cascade.

**Per-stack single-repo configs** (`eslint.config.mjs.{stack}.hbs`):

Same pattern in the `{{else}}` branch of `{{#if (isMono)}}` — add import and append `eslintConfigPrettier` as last entry.

## Resolver Changes (`template-resolver.ts`)

Add a `resolveAddonNames()` helper:

```typescript
function resolveAddonNames(
  category: ProjectCategoryName,
  addonName: string,
): string[] {
  const addon = META.project[category].options[addonName];
  if (addon?.compose) return addon.compose;
  return [addonName];
}
```

Update `getAllTemplatesForContext()`:

```typescript
if (ctx.project.linter) {
  const addonNames = resolveAddonNames('linter', ctx.project.linter);
  for (const name of addonNames) {
    templates.push(
      ...resolveTemplatesForProjectAddon('linter', name, ctx),
    );
    templates.push(
      ...resolveStackSpecificAddonTemplatesForApps('linter', name, ctx.apps, ctx),
    );
  }
}
```

This is generic — any future composite addon works the same way.

## Package.json Generator Changes (`package-json-generator.ts`)

The generator already collects packages by name from META. For composites:

1. Expand `compose` to get the list of addons
2. Process each composed addon's `packageJson` and `mono` scope normally
3. Merge the composite's own `packageJson` into the appropriate scope

For `eslint-prettier`:
- `eslint` → `packages/eslint-config/package.json` (pkg scope) with ESLint deps
- `prettier` → root `package.json` (root scope) with Prettier deps + scripts
- `eslint-prettier` → `packages/eslint-config/package.json` (pkg scope, same as eslint) with `eslint-config-prettier`

Single repo: all deps merge into root `package.json`.

## Dependency Versions

| Package | Version | Purpose |
|---------|---------|---------|
| `prettier` | `^3.8.1` | Code formatter |
| `prettier-plugin-tailwindcss` | `^0.7.2` | Tailwind class sorting |
| `eslint-config-prettier` | `^10.1.8` | Disable conflicting ESLint rules |

## CLI Flag

`--linter` already validates against META options. Adding `prettier` and `eslint-prettier` to META makes them available automatically:

```bash
bunx create-faster myapp --app myapp:nextjs:shadcn --linter eslint-prettier --pm bun
```

## Files Changed

### Source (5 files)

| File | Change |
|------|--------|
| `types/meta.ts` | Add `compose?: string[]` to `MetaAddon` |
| `__meta__.ts` | Add `prettier` and `eslint-prettier` options, update prompt label |
| `template-resolver.ts` | Add `resolveAddonNames()`, update linter resolution loop |
| `package-json-generator.ts` | Handle composite addon expansion for deps/scripts merging |
| `handlebars.ts` | No change needed — `has('linter', 'eslint-prettier')` works as-is |

### Templates (2 new + ~5 modified)

| File | Change |
|------|--------|
| `templates/project/linter/prettier/__prettierrc.hbs` | New |
| `templates/project/linter/prettier/__prettierignore.hbs` | New |
| `templates/project/linter/eslint/base.js.hbs` | Add conditional prettier import |
| `templates/project/linter/eslint/eslint.config.mjs.nextjs.hbs` | Add conditional prettier (single-repo branch) |
| `templates/project/linter/eslint/eslint.config.mjs.hono.hbs` | Add conditional prettier (single-repo branch) |
| `templates/project/linter/eslint/eslint.config.mjs.expo.hbs` | Add conditional prettier (single-repo branch) |
| `templates/project/linter/eslint/eslint.config.mjs.tanstack-start.hbs` | Add conditional prettier (single-repo branch) |

### Tests

- Unit tests for `resolveAddonNames()` expansion
- Unit tests for package.json generation with composite addons
- Integration tests for `--linter prettier` and `--linter eslint-prettier`
- Meta validation tests for compose references

## Test Matrix

| Scenario | Verify |
|----------|--------|
| `prettier` + single repo | `.prettierrc`, `.prettierignore` at root, deps in root package.json |
| `prettier` + turborepo | Same files at root, deps in root package.json |
| `eslint-prettier` + single repo | ESLint inline config with prettier import, Prettier configs at root, all deps in root |
| `eslint-prettier` + turborepo | `packages/eslint-config/` with `eslint-config-prettier` dep, Prettier configs at root, per-app ESLint configs import shared package |
| `eslint-prettier` + all 4 stacks | Correct per-stack ESLint config with prettier override |
| `biome` unchanged | No regression |
| `eslint` unchanged | No regression |
| `--linter eslint-prettier` flag | Validates and generates correctly |
| `--linter invalid` | Error with updated available options |
