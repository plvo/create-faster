# Linter Separation & ESLint Support

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate linters from tooling extras into a dedicated `linter` category with single selection, and add ESLint as an alternative to Biome.

**Architecture:** New `linter` category in `META.project` with `selection: 'single'`. Biome moves from `tooling` to `linter`. ESLint uses `mono: { scope: 'pkg', name: 'eslint-config' }` for shared turborepo package, with stack-specific per-app configs via stack suffixes. All ESLint deps go in the shared package (unused stack deps are harmless devDeps). Template processor already enriches context from destination path and skips empty renders.

**Tech Stack:** ESLint 9 flat config, typescript-eslint, eslint-plugin-react, eslint-plugin-react-hooks, @next/eslint-plugin-next, globals

---

## Task 1: Types — Add linter to MetaProject and ProjectContext

**Files:**
- Modify: `apps/cli/src/types/meta.ts:65-69`
- Modify: `apps/cli/src/types/ctx.ts:9-13`

**Step 1: Add `linter` to `MetaProject` interface**

```typescript
// apps/cli/src/types/meta.ts — MetaProject interface
export interface MetaProject {
  database: MetaProjectCategory;
  orm: MetaProjectCategory;
  linter: MetaProjectCategory;
  tooling: MetaProjectCategory;
}
```

Order matters: `linter` before `tooling` so prompts appear in the right sequence.

**Step 2: Add `linter` to `ProjectContext` interface**

```typescript
// apps/cli/src/types/ctx.ts — ProjectContext interface
export interface ProjectContext {
  database?: string;
  orm?: string;
  linter?: string;
  tooling: string[];
}
```

**Step 3: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

Expected: Type errors in files that reference `META.project` (missing `linter` property) — that's fine, we'll fix those in subsequent tasks.

**Step 4: Commit**

```bash
git add apps/cli/src/types/meta.ts apps/cli/src/types/ctx.ts
git commit -m "feat(types): add linter to MetaProject and ProjectContext"
```

---

## Task 2: META — Add linter category, move biome from tooling

**Files:**
- Modify: `apps/cli/src/__meta__.ts:289-418`

**Step 1: Add `linter` category and move biome from `tooling`**

In `META.project`, add `linter` between `orm` and `tooling`. Move biome from `tooling.options` to `linter.options`. Add ESLint entry.

```typescript
// apps/cli/src/__meta__.ts — inside META.project, after orm and before tooling:
linter: {
  prompt: 'Choose a linter?',
  selection: 'single',
  options: {
    biome: {
      label: 'Biome',
      hint: 'Fast linter & formatter',
      mono: { scope: 'root' },
      packageJson: {
        devDependencies: {
          '@biomejs/biome': '^2.3.11',
        },
        scripts: {
          format: 'biome format --write .',
          lint: 'biome lint',
          check: 'biome check --fix .',
        },
      },
    },
    eslint: {
      label: 'ESLint',
      hint: 'Most popular JavaScript linter',
      mono: { scope: 'pkg', name: 'eslint-config' },
      packageJson: {
        devDependencies: {
          eslint: '^9',
          '@eslint/js': '^9',
          'typescript-eslint': '^8',
          globals: '^16',
          'eslint-plugin-react': '^7',
          'eslint-plugin-react-hooks': '^5',
          '@next/eslint-plugin-next': '^15',
        },
        exports: {
          './base': './base.js',
          './next': './next.js',
          './react': './react.js',
          './react-native': './react-native.js',
          './server': './server.js',
        },
      },
      appPackageJson: {
        scripts: {
          lint: 'eslint .',
        },
      },
    },
  },
},
```

Remove `biome` from `tooling.options` (only `husky` remains).

**Step 2: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

Expected: Should compile (META satisfies Meta with the new linter field).

**Step 3: Commit**

```bash
git add apps/cli/src/__meta__.ts
git commit -m "feat(meta): add linter category with biome and eslint, remove biome from tooling"
```

---

## Task 3: Handlebars — Add linter case to `has` helper

**Files:**
- Modify: `apps/cli/src/lib/handlebars.ts:21-34`

**Step 1: Add linter case to the `has` helper switch**

```typescript
// apps/cli/src/lib/handlebars.ts — inside the 'has' helper switch statement
case 'linter':
  return this.project?.linter === value;
```

Add this case after `'orm'` and before `'tooling'`.

**Step 2: Commit**

```bash
git add apps/cli/src/lib/handlebars.ts
git commit -m "feat(handlebars): add linter case to has helper"
```

---

## Task 4: Template Resolver — Add stack suffix support for project addons

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts:132-196`

This is the key architectural change. Project addon templates can now have stack suffixes (e.g., `eslint.config.mjs.nextjs.hbs`). When a stack suffix is detected, the template is resolved per-app instead of project-level.

**Step 1: Update `resolveTemplatesForProjectAddon` to skip stack-suffix files**

Add stack suffix detection at the start of the for loop:

```typescript
// apps/cli/src/lib/template-resolver.ts — inside resolveTemplatesForProjectAddon, in the for loop, before frontmatter parsing:
const { stackName: fileSuffix } = parseStackSuffix(file, VALID_STACKS);
if (fileSuffix) continue;
```

**Step 2: Add new `resolveStackSpecificAddonTemplates` function**

After `resolveTemplatesForProjectAddon`:

```typescript
function resolveStackSpecificAddonTemplates(
  category: ProjectCategoryName,
  addonName: string,
  appName: string,
  stackName: StackName,
  ctx: TemplateContext,
): TemplateFile[] {
  const addon = META.project[category]?.options[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'project', category, addonName);
  const files = scanDirectory(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (!fileSuffix) continue;
    if (fileSuffix !== stackName) continue;

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);
    const isTurborepo = ctx.repo === 'turborepo';
    const destination = isTurborepo ? `apps/${appName}/${transformedPath}` : transformedPath;
    templates.push({ source, destination });
  }

  return templates;
}
```

**Step 3: Update `getAllTemplatesForContext` to handle linter**

After the tooling loop:

```typescript
if (ctx.project.linter) {
  templates.push(...resolveTemplatesForProjectAddon('linter', ctx.project.linter, ctx));
  for (const app of ctx.apps) {
    templates.push(
      ...resolveStackSpecificAddonTemplates('linter', ctx.project.linter, app.appName, app.stackName, ctx),
    );
  }
}
```

**Step 4: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

**Step 5: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts
git commit -m "feat(resolver): add stack suffix support for project addon templates"
```

---

## Task 5: Package JSON Generator — Add linter handling

**Files:**
- Modify: `apps/cli/src/lib/package-json-generator.ts`

Three functions need updates: `generateAppPackageJson`, `generateRootPackageJson`, `generateAllPackageJsons`.

**Step 1: Update `generateAppPackageJson`**

After the tooling block (line ~166), add linter handling:

```typescript
// Process linter addon
if (ctx.project.linter) {
  const linterAddon = META.project.linter.options[ctx.project.linter];
  if (linterAddon) {
    const packageName = getProjectAddonPackageName(linterAddon);
    if (packageName && isTurborepo) {
      merged.devDependencies = {
        ...merged.devDependencies,
        [`@repo/${packageName}`]: '*',
      };
      if (linterAddon.appPackageJson) {
        merged = mergePackageJsonConfigs(merged, linterAddon.appPackageJson);
      }
    } else if (!isTurborepo) {
      merged = mergePackageJsonConfigs(merged, linterAddon.packageJson, linterAddon.appPackageJson);
    }
  }
}
```

Logic:
- ESLint + turborepo (`mono: pkg`): adds `@repo/eslint-config: *` to devDeps + merges `appPackageJson` (lint script)
- ESLint + single: merges all deps + scripts directly
- Biome + turborepo (`mono: root`): skipped (root handles it)
- Biome + single: merges deps + scripts directly

**Step 2: Update `generateRootPackageJson`**

After the tooling loop (line ~256), add linter handling:

```typescript
// Add root-scoped linter to root package.json (biome)
if (ctx.project.linter) {
  const linterAddon = META.project.linter.options[ctx.project.linter];
  if (linterAddon?.mono?.scope === 'root' && linterAddon.packageJson) {
    if (linterAddon.packageJson.devDependencies) {
      devDependencies = { ...devDependencies, ...linterAddon.packageJson.devDependencies };
    }
    if (linterAddon.packageJson.scripts) {
      Object.assign(scripts, linterAddon.packageJson.scripts);
    }
  }
}
```

**Step 3: Update `generateAllPackageJsons`**

After the ORM package collection (line ~313), add linter package collection:

```typescript
// Collect linter package (eslint-config)
if (ctx.project.linter) {
  const linterAddon = META.project.linter.options[ctx.project.linter];
  if (linterAddon?.mono?.scope === 'pkg') {
    const pkgName = linterAddon.mono.name;
    extractedPackages.set(pkgName, linterAddon.packageJson ?? {});
  }
}
```

Also add `eslint-config` to the `existingPackages` set — this happens automatically since we add to `extractedPackages` before the set is built.

**Step 4: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

**Step 5: Commit**

```bash
git add apps/cli/src/lib/package-json-generator.ts
git commit -m "feat(pkg-gen): add linter handling for app, root, and package generation"
```

---

## Task 6: CLI — Add linter prompt handling

**Files:**
- Modify: `apps/cli/src/cli.ts`

**Step 1: Add linter to the switch statement**

In the `for` loop iterating `META.project` categories (line ~92):

```typescript
case 'linter':
  ctx.project.linter = result as string | undefined;
  break;
```

**Step 2: Add linter to the flags display log**

In the `hasAnyFlags` block (line ~78), add linter to the parts:

```typescript
if (ctx.project.linter) parts.push(`linter: ${ctx.project.linter}`);
```

**Step 3: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

**Step 4: Commit**

```bash
git add apps/cli/src/cli.ts
git commit -m "feat(cli): add linter prompt handling"
```

---

## Task 7: Flags — Add --linter flag

**Files:**
- Modify: `apps/cli/src/flags.ts`

**Step 1: Add linter to ParsedFlags interface**

```typescript
interface ParsedFlags {
  projectName?: string;
  app?: string[];
  database?: string;
  orm?: string;
  linter?: string;
  tooling?: string[];
  git?: boolean;
  pm?: string;
  install?: boolean;
}
```

**Step 2: Add --linter option to Commander**

After `--orm`:

```typescript
const linterNames = Object.keys(META.project.linter.options).join(', ');
// ...
.option('--linter <name>', `Linter (${linterNames})`)
```

**Step 3: Add linter to help text**

```typescript
${color.gray('Available linters:')} ${linterNames}
```

**Step 4: Add linter to the hasProjectFlags check and validation**

```typescript
const hasProjectFlags = flags.database || flags.orm || flags.linter || (flags.tooling && flags.tooling.length > 0);
```

**Step 5: Add linter validation and partial building**

After the ORM validation block:

```typescript
if (flags.linter) {
  if (!META.project.linter.options[flags.linter]) {
    printError(
      `Invalid linter '${flags.linter}'`,
      `Available linters: ${Object.keys(META.project.linter.options).join(', ')}`,
    );
    process.exit(1);
  }
  partial.project!.linter = flags.linter;
}
```

**Step 6: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

**Step 7: Commit**

```bash
git add apps/cli/src/flags.ts
git commit -m "feat(flags): add --linter flag"
```

---

## Task 8: Summary — Update display and CLI command generation

**Files:**
- Modify: `apps/cli/src/tui/summary.ts`

**Step 1: Add linter to CLI command output**

After the ORM section in `displayOutroCliCommand` (line ~20):

```typescript
if (ctx.project.linter) {
  flagsCommand += ` --linter ${ctx.project.linter}`;
}
```

**Step 2: Update project structure configs display**

In `buildProjectStructure` (line ~90), replace the biome check:

```typescript
// Replace: if (ctx.project.tooling.includes('biome')) configs.push('Biome');
// With:
if (ctx.project.linter === 'biome') configs.push('Biome');
if (ctx.project.linter === 'eslint') configs.push('ESLint');
```

**Step 3: Verify TypeScript compilation**

Run: `cd /home/ttecim/.lab/create-faster && bun run check 2>&1 | head -50`

**Step 4: Commit**

```bash
git add apps/cli/src/tui/summary.ts
git commit -m "feat(summary): display linter in CLI command and project structure"
```

---

## Task 9: Move biome template from tooling to linter

**Files:**
- Move: `templates/project/tooling/biome/` → `templates/project/linter/biome/`

**Step 1: Move the biome template directory**

```bash
cd /home/ttecim/.lab/create-faster/apps/cli
mkdir -p templates/project/linter
git mv templates/project/tooling/biome templates/project/linter/biome
```

**Step 2: Update biome.json schema version**

Update the `$schema` version in `templates/project/linter/biome/biome.json.hbs` from `2.2.6` to `2.3.11` (matches the dep version in META).

**Step 3: Commit**

```bash
git add -A templates/project/
git commit -m "refactor(templates): move biome from tooling to linter category"
```

---

## Task 10: ESLint Templates — Shared config package (turborepo)

**Files:**
- Create: `templates/project/linter/eslint/base.js.hbs`
- Create: `templates/project/linter/eslint/next.js.hbs`
- Create: `templates/project/linter/eslint/react.js.hbs`
- Create: `templates/project/linter/eslint/react-native.js.hbs`
- Create: `templates/project/linter/eslint/server.js.hbs`

All shared config files have frontmatter `only: mono` and `mono: { scope: pkg, path: <filename> }`.

**Step 1: Create `base.js.hbs`**

```handlebars
---
only: mono
mono:
  scope: pkg
  path: base.js
---
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
];
```

**Step 2: Create `next.js.hbs`**

```handlebars
---
only: mono
mono:
  scope: pkg
  path: next.js
---
import { globalIgnores } from "eslint/config";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginNext from "@next/eslint-plugin-next";
import globals from "globals";
import { baseConfig } from "./base.js";

export const nextConfig = [
  ...baseConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
];
```

**Step 3: Create `react.js.hbs`** (TanStack Start)

```handlebars
---
only: mono
mono:
  scope: pkg
  path: react.js
---
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { baseConfig } from "./base.js";

export const reactConfig = [
  ...baseConfig,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
];
```

**Step 4: Create `react-native.js.hbs`** (Expo)

```handlebars
---
only: mono
mono:
  scope: pkg
  path: react-native.js
---
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { baseConfig } from "./base.js";

export const reactNativeConfig = [
  ...baseConfig,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    ignores: [".expo/**", "android/**", "ios/**"],
  },
];
```

**Step 5: Create `server.js.hbs`** (Hono)

```handlebars
---
only: mono
mono:
  scope: pkg
  path: server.js
---
import globals from "globals";
import { baseConfig } from "./base.js";

export const serverConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
```

**Step 6: Commit**

```bash
git add apps/cli/templates/project/linter/eslint/
git commit -m "feat(templates): add ESLint shared config package for turborepo"
```

---

## Task 11: ESLint Templates — Per-app configs (stack suffix)

**Files:**
- Create: `templates/project/linter/eslint/eslint.config.mjs.nextjs.hbs`
- Create: `templates/project/linter/eslint/eslint.config.mjs.expo.hbs`
- Create: `templates/project/linter/eslint/eslint.config.mjs.hono.hbs`
- Create: `templates/project/linter/eslint/eslint.config.mjs.tanstack-start.hbs`

Each file uses `{{#if (isMono)}}` for thin import (turborepo) vs full inline config (single repo). The stack suffix ensures only the matching stack app gets the file. The template processor enriches context from the destination path (see `template-processor.ts:49-58`).

**Step 1: Create `eslint.config.mjs.nextjs.hbs`**

```handlebars
{{#if (isMono)}}
import { nextConfig } from "@repo/eslint-config/next";

export default nextConfig;
{{else}}
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginNext from "@next/eslint-plugin-next";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
]);
{{/if}}
```

**Step 2: Create `eslint.config.mjs.expo.hbs`**

```handlebars
{{#if (isMono)}}
import { reactNativeConfig } from "@repo/eslint-config/react-native";

export default reactNativeConfig;
{{else}}
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([".expo/**", "android/**", "ios/**", "node_modules/**"]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
]);
{{/if}}
```

**Step 3: Create `eslint.config.mjs.hono.hbs`**

```handlebars
{{#if (isMono)}}
import { serverConfig } from "@repo/eslint-config/server";

export default serverConfig;
{{else}}
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores(["dist/**", "node_modules/**"]),
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
]);
{{/if}}
```

**Step 4: Create `eslint.config.mjs.tanstack-start.hbs`**

```handlebars
{{#if (isMono)}}
import { reactConfig } from "@repo/eslint-config/react";

export default reactConfig;
{{else}}
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores(["dist/**", ".vinxi/**", ".output/**", "node_modules/**"]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
  },
  pluginReact.configs.flat["jsx-runtime"],
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
]);
{{/if}}
```

**Step 5: Commit**

```bash
git add apps/cli/templates/project/linter/eslint/
git commit -m "feat(templates): add per-app ESLint configs for all stacks"
```

---

## Task 12: Integration Testing

Test all combinations manually using CLI flags. The `--no-install` flag speeds up testing by skipping `bun install`.

**Step 1: Test ESLint + single repo + Next.js**

```bash
cd /tmp && rm -rf test-eslint-single
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-eslint-single \
  --app test-eslint-single:nextjs \
  --linter eslint \
  --no-install --no-git
```

Verify:
- `test-eslint-single/eslint.config.mjs` exists with full inline Next.js config
- `test-eslint-single/package.json` has eslint, @eslint/js, typescript-eslint, globals, eslint-plugin-react, eslint-plugin-react-hooks, @next/eslint-plugin-next in devDependencies
- `test-eslint-single/package.json` has `lint: 'eslint .'` script
- NO `packages/eslint-config/` directory

**Step 2: Test ESLint + turborepo + Next.js + Hono**

```bash
cd /tmp && rm -rf test-eslint-turbo
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-eslint-turbo \
  --app web:nextjs \
  --app api:hono \
  --linter eslint \
  --no-install --no-git
```

Verify:
- `packages/eslint-config/package.json` exists with all ESLint deps + exports
- `packages/eslint-config/base.js` exists
- `packages/eslint-config/next.js` exists
- `packages/eslint-config/server.js` exists
- `packages/eslint-config/react.js` exists
- `packages/eslint-config/react-native.js` exists
- `apps/web/eslint.config.mjs` exists with thin `import { nextConfig }` import
- `apps/api/eslint.config.mjs` exists with thin `import { serverConfig }` import
- `apps/web/package.json` has `@repo/eslint-config: *` and `lint: 'eslint .'`
- `apps/api/package.json` has `@repo/eslint-config: *` and `lint: 'eslint .'`
- Root `package.json` does NOT have eslint devDependencies (they're in the shared package)

**Step 3: Test Biome + single repo (moved from tooling)**

```bash
cd /tmp && rm -rf test-biome-single
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-biome-single \
  --app test-biome-single:nextjs \
  --linter biome \
  --no-install --no-git
```

Verify:
- `biome.json` exists at root
- `package.json` has `@biomejs/biome` in devDependencies
- `package.json` has `format`, `lint`, `check` scripts

**Step 4: Test Biome + turborepo**

```bash
cd /tmp && rm -rf test-biome-turbo
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-biome-turbo \
  --app web:nextjs \
  --app api:hono \
  --linter biome \
  --no-install --no-git
```

Verify:
- Root `biome.json` exists
- Root `package.json` has `@biomejs/biome` and biome scripts
- App `package.json` files do NOT have biome deps

**Step 5: Test ESLint + all 4 stacks in turborepo**

```bash
cd /tmp && rm -rf test-eslint-all
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-eslint-all \
  --app web:nextjs \
  --app mobile:expo \
  --app api:hono \
  --app start:tanstack-start \
  --linter eslint \
  --no-install --no-git
```

Verify:
- All 4 app dirs have `eslint.config.mjs` with correct thin imports
- Each imports from the correct shared config export (next, react-native, server, react)

**Step 6: Test no linter selected (interactive skip)**

```bash
cd /tmp && rm -rf test-no-linter
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-no-linter \
  --app test-no-linter:nextjs \
  --no-install --no-git
```

This will prompt for linter (since no --linter flag). Select "None".

Verify:
- No `eslint.config.mjs`
- No `biome.json`
- No eslint or biome deps in package.json

**Step 7: Test --tooling still works for husky only**

```bash
cd /tmp && rm -rf test-husky
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-husky \
  --app test-husky:nextjs \
  --linter biome \
  --tooling husky \
  --git \
  --no-install
```

Verify:
- `.husky/` directory exists
- `biome.json` exists
- Both biome and husky deps in package.json

**Step 8: Test --linter flag validation**

```bash
bunx /home/ttecim/.lab/create-faster/apps/cli/src/index.ts test-bad \
  --app test-bad:nextjs \
  --linter invalid
```

Expected: Error message with available linters.

**Step 9: Clean up and commit**

```bash
rm -rf /tmp/test-eslint-* /tmp/test-biome-* /tmp/test-no-linter /tmp/test-husky /tmp/test-bad
```

No commit needed for testing (unless fixes were made).

---

## Task 13: Update CLAUDE.md documentation

**Files:**
- Modify: `apps/cli/.claude/CLAUDE.md`

Update all references to biome/tooling to reflect the new linter category:
- Add `linter` to the META.project description
- Add `--linter` to CLI flags documentation
- Update the "Dev Tools" section
- Update examples showing `--extras biome` → `--linter biome`

**Step 1: Make documentation updates**

Specific sections to update:
- "Supported Stacks > Dev Tools": Add "Linter: Biome, ESLint (single selection)"
- "CLI Flags Usage": Add `--linter` flag and update examples
- "Available Flags": Add `--linter <name>` documentation
- All example commands: Replace `--extras biome,husky` with `--linter biome --tooling husky`
- "Auto-Generated Command" example: Update
- META documentation: Add linter category
- ProjectContext docs: Add `linter?: string`

**Step 2: Commit**

```bash
git add apps/cli/.claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md for linter category and ESLint support"
```
