# Blueprints Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add "blueprints" — pre-composed project templates that combine META stacks/libs/addons with application code, starting with a Dashboard blueprint.

**Architecture:** A blueprint is a preset `TemplateContext` declared in META + a folder of Handlebars template files for business logic. The existing generation pipeline (template resolution, package.json, env, file generation) is reused as-is. Blueprint files are injected as a final step in template resolution, with override semantics (same destination = blueprint wins).

**Tech Stack:** TypeScript, Bun, @clack/prompts, Commander.js, Handlebars, bun:test

**Design doc:** `docs/plans/2026-03-04-blueprints-design.md`

---

### Task 1: Add MetaBlueprint type and extend Meta

**Files:**
- Modify: `apps/cli/src/types/meta.ts:76-83` (add MetaBlueprint, extend Meta)
- Modify: `apps/cli/src/types/ctx.ts:18-26` (add blueprint? to TemplateContext)
- Test: `apps/cli/tests/unit/types/meta.test.ts`

**Step 1: Write the failing test**

In `apps/cli/tests/unit/types/meta.test.ts`, add a test that validates `MetaBlueprint` type exists and META.blueprints is defined:

```typescript
describe('META.blueprints validation', () => {
  test('blueprints section exists', () => {
    expect(META.blueprints).toBeDefined();
    expect(typeof META.blueprints).toBe('object');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/types/meta.test.ts`
Expected: FAIL — `META.blueprints` is undefined

**Step 3: Write minimal implementation**

In `apps/cli/src/types/meta.ts`, add before the `Meta` interface:

```typescript
import type { AppContext, ProjectContext } from './ctx';

export interface MetaBlueprint {
  label: string;
  hint: string;
  context: {
    apps: AppContext[];
    project: ProjectContext;
  };
  packageJson?: PackageJsonConfig;
  envs?: EnvVar[];
}
```

Extend the `Meta` interface (line 76-83) to add:
```typescript
  blueprints: Record<string, MetaBlueprint>;
```

In `apps/cli/src/types/ctx.ts`, add to `TemplateContext` (line 18-26):
```typescript
  blueprint?: string;
```

In `apps/cli/src/__meta__.ts`, add an empty `blueprints: {}` section after `repo` (line 532), before the closing `} as const satisfies Meta`. This will make TypeScript enforce the type.

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/types/meta.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/types/meta.ts apps/cli/src/types/ctx.ts apps/cli/src/__meta__.ts apps/cli/tests/unit/types/meta.test.ts
git commit -m "feat(blueprints): add MetaBlueprint type and extend Meta/TemplateContext"
```

---

### Task 2: Add --blueprint flag to CLI flags parser

**Files:**
- Modify: `apps/cli/src/flags.ts:11-21` (add blueprint to ParsedFlags)
- Modify: `apps/cli/src/flags.ts:32-70` (add --blueprint option)
- Modify: `apps/cli/src/flags.ts:81-158` (handle blueprint flag, mutual exclusion)
- Test: `apps/cli/tests/unit/flags.test.ts` (new file)

**Step 1: Write the failing test**

Create `apps/cli/tests/unit/flags.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('--blueprint flag', () => {
  test('blueprint names in META are valid', () => {
    const blueprintNames = Object.keys(META.blueprints);
    // When we have blueprints, all must have label and context
    for (const [name, bp] of Object.entries(META.blueprints)) {
      expect(bp.label, `${name} must have label`).toBeDefined();
      expect(bp.context, `${name} must have context`).toBeDefined();
      expect(bp.context.apps.length, `${name} must have at least one app`).toBeGreaterThan(0);
    }
  });
});
```

This test validates META blueprint structure. We'll add more tests after implementing the flag parsing.

**Step 2: Run test to verify it passes (baseline)**

Run: `cd apps/cli && bun test tests/unit/flags.test.ts`
Expected: PASS (empty blueprints is valid)

**Step 3: Write implementation**

In `apps/cli/src/flags.ts`:

1. Add `blueprint?: string` to `ParsedFlags` interface (line ~18)

2. Add the `--blueprint` option to the Commander program (after line 44):
```typescript
.option('--blueprint <name>', `Use a blueprint template (${Object.keys(META.blueprints).join(', ') || 'none available'})`)
```

3. After line 89 (after handling `flags.app`), add blueprint handling:
```typescript
if (flags.blueprint) {
  const blueprint = META.blueprints[flags.blueprint];
  if (!blueprint) {
    printError(
      `Invalid blueprint '${flags.blueprint}'`,
      `Available blueprints: ${Object.keys(META.blueprints).join(', ') || 'none'}`,
    );
    process.exit(1);
  }

  // Mutual exclusion: --blueprint conflicts with composition flags
  const conflicting = ['app', 'database', 'orm', 'linter', 'tooling'].filter(
    (f) => flags[f as keyof ParsedFlags] !== undefined &&
           (Array.isArray(flags[f as keyof ParsedFlags])
            ? (flags[f as keyof ParsedFlags] as string[]).length > 0
            : true)
  );
  if (conflicting.length > 0) {
    printError(
      `--blueprint cannot be combined with --${conflicting[0]}`,
      'Blueprint defines the full project composition',
    );
    process.exit(1);
  }

  partial.blueprint = flags.blueprint;
  partial.apps = blueprint.context.apps.map((app) => ({ ...app }));
  partial.project = { ...blueprint.context.project };
}
```

4. Update the help examples section to include a blueprint example.

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/flags.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/flags.ts apps/cli/tests/unit/flags.test.ts
git commit -m "feat(blueprints): add --blueprint flag with mutual exclusion validation"
```

---

### Task 3: Add blueprint selection prompt to CLI flow

**Files:**
- Modify: `apps/cli/src/index.ts:12-51` (add blueprint choice before cli())
- Modify: `apps/cli/src/cli.ts:14-149` (extract shared prompts for reuse in blueprint flow)

**Step 1: Write the failing test**

In `apps/cli/tests/integration/cli.test.ts` (or new file `apps/cli/tests/integration/blueprint.test.ts`), add:

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, runCli } from './helpers';

describe('Blueprint CLI flag', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('--blueprint flag generates project with blueprint context', async () => {
    // This will only work once we have a real blueprint in META
    // For now, validate that an invalid blueprint name produces an error
    const result = await runCli(
      ['test-bp', '--blueprint', 'nonexistent', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid blueprint');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/integration/blueprint.test.ts`
Expected: FAIL — `--blueprint` flag not recognized

**Step 3: Write implementation**

In `apps/cli/src/index.ts`, modify the `main()` function. After the CLI flag parsing, if `partial.blueprint` is set, skip the full interactive `cli()` flow and instead:

1. Only prompt for `projectName` (if not provided via flag)
2. Only prompt for `git` (if not provided via flag)
3. Only prompt for `pm` (if not provided via flag)
4. Use the blueprint's pre-filled context for apps + project

If no flags at all, add a prompt after project name: "What would you like to create?" with options:
- "Start from scratch" → existing `cli()` flow
- "Use a template" → show blueprint selection, then light prompts

The simplest approach: create a new function `blueprintCli(blueprintName: string, partial?: Partial<TemplateContext>)` in `cli.ts` that returns `Omit<TemplateContext, 'repo'>` with only the light prompts (project name, git, pm).

In `apps/cli/src/cli.ts`, add:

```typescript
export async function blueprintCli(
  blueprintName: string,
  partial?: Partial<TemplateContext>,
): Promise<Omit<TemplateContext, 'repo'>> {
  const blueprint = META.blueprints[blueprintName];
  if (!blueprint) {
    cancel(`Blueprint "${blueprintName}" not found`);
    process.exit(1);
  }

  const progress = new Progress(['Project', 'Install']);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: blueprint.context.apps.map((app) => ({ ...app })),
    project: { ...blueprint.context.project },
    git: false,
    blueprint: blueprintName,
  };

  // Project name prompt (same as existing)
  if (partial?.projectName) {
    ctx.projectName = partial.projectName;
    log.info(`${color.green('✓')} Using project name: ${color.bold(partial.projectName)}`);
    const fullPath = join(process.cwd(), partial.projectName);
    if (existsSync(fullPath)) {
      cancel(`Directory "${partial.projectName}" already exists.`);
      process.exit(1);
    }
  } else {
    ctx.projectName = await promptText<string>(progress.message('Name of your project?'), {
      placeholder: 'my-app',
      initialValue: 'my-app',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'Project name is required';
        const fullPath = join(process.cwd(), trimmed);
        if (existsSync(fullPath)) {
          return `Directory "${trimmed}" already exists.`;
        }
      },
    });
  }

  log.info(`${color.green('✓')} Using blueprint: ${color.bold(blueprint.label)}`);
  log.info(`${color.gray('  Stack:')} ${ctx.apps.map(a => `${a.appName} (${META.stacks[a.stackName]?.label})`).join(', ')}`);
  progress.next();

  // Git prompt
  if (partial?.git !== undefined) {
    ctx.git = partial.git;
  } else {
    ctx.git = await promptConfirm(progress.message(`Initialize ${color.bold('Git')}?`), {
      initialValue: true,
    });
  }

  // Package manager prompt
  if (partial?.skipInstall) {
    ctx.skipInstall = true;
  } else if (partial?.pm !== undefined) {
    ctx.pm = partial.pm;
  } else {
    ctx.pm = await promptSelect(undefined, progress.message(`Install dependencies ${color.bold('now')}?`), ctx, {
      options: [
        { label: 'Install with bun', value: 'bun' },
        { label: 'Install with pnpm', value: 'pnpm' },
        { label: 'Install with npm', value: 'npm' },
        { label: 'Skip installation', value: undefined },
      ],
    });
  }
  progress.next();

  return ctx;
}
```

In `apps/cli/src/index.ts`, modify `main()`:

```typescript
async function main() {
  const partial = parseFlags();

  console.log(ASCII);
  intro(INTRO_MESSAGE);

  try {
    let config: Omit<TemplateContext, 'repo'>;

    if (partial.blueprint) {
      // Non-interactive blueprint mode (from --blueprint flag)
      config = await blueprintCli(partial.blueprint, partial);
    } else if (Object.keys(partial).length > 0) {
      // Non-interactive custom mode (from other flags)
      config = await cli(partial);
    } else {
      // Fully interactive: ask template vs custom first
      // For now, go straight to cli() — we'll add the prompt in a follow-up
      // once we have at least one blueprint in META
      config = await cli(partial);
    }

    // ... rest unchanged
  }
}
```

We'll add the interactive "template vs custom" prompt once we have the dashboard blueprint in META (Task 6).

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/integration/blueprint.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/index.ts apps/cli/src/cli.ts apps/cli/tests/integration/blueprint.test.ts
git commit -m "feat(blueprints): add blueprintCli flow and wire to index.ts"
```

---

### Task 4: Add blueprint template resolution to template-resolver

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts:210-244` (add blueprint step in getAllTemplatesForContext)
- Test: `apps/cli/tests/unit/lib/template-resolver.test.ts`

**Step 1: Write the failing test**

Read the existing `template-resolver.test.ts` to understand its patterns, then add:

```typescript
describe('blueprint template resolution', () => {
  test('getAllTemplatesForContext includes blueprint templates when blueprint is set', () => {
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'test', stackName: 'nextjs', libraries: ['shadcn', 'better-auth', 'tanstack-query'] }],
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
      git: false,
      blueprint: 'dashboard',
    };

    const templates = getAllTemplatesForContext(ctx);
    // Blueprint templates should be included (if the dashboard directory exists)
    // For now, just verify the function doesn't crash with blueprint set
    expect(templates).toBeDefined();
    expect(Array.isArray(templates)).toBe(true);
  });

  test('blueprint templates override structural templates with same destination', () => {
    // We need a blueprint with a file that conflicts with a stack file
    // This test will be meaningful once we have actual blueprint template files
    const ctx: TemplateContext = {
      projectName: 'test',
      repo: 'single',
      apps: [{ appName: 'test', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: false,
      blueprint: 'dashboard',
    };

    const templates = getAllTemplatesForContext(ctx);
    // No duplicate destinations
    const destinations = templates.map((t) => t.destination);
    const unique = new Set(destinations);
    expect(unique.size).toBe(destinations.length);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/lib/template-resolver.test.ts`
Expected: FAIL — blueprint property doesn't affect resolution, or crash

**Step 3: Write implementation**

In `apps/cli/src/lib/template-resolver.ts`, add a new function `resolveTemplatesForBlueprint`:

```typescript
function resolveTemplatesForBlueprint(blueprintName: string, ctx: TemplateContext): TemplateFile[] {
  const blueprintDir = join(TEMPLATES_DIR, 'blueprints', blueprintName);
  const files = scanDirectory(blueprintDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(blueprintDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix) {
      // Only include stack-specific files for stacks present in the blueprint
      const hasStack = ctx.apps.some((app) => app.stackName === fileSuffix);
      if (!hasStack) continue;
    }

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(fileSuffix ? cleanFilename : file);

    // Resolve destination: default to app scope (like libraries)
    const isTurborepo = ctx.repo === 'turborepo';
    let destination: string;

    if (!isTurborepo) {
      destination = frontmatter.path ?? transformedPath;
    } else {
      const scope = frontmatter.mono?.scope ?? 'app';
      const filePath = frontmatter.mono?.path ?? transformedPath;

      switch (scope) {
        case 'root':
          destination = filePath;
          break;
        case 'pkg': {
          const pkgName = frontmatter.mono?.name ?? 'unknown';
          destination = `packages/${pkgName}/${filePath}`;
          break;
        }
        default: {
          // Default to first app
          const appName = ctx.apps[0]?.appName ?? ctx.projectName;
          destination = `apps/${appName}/${filePath}`;
          break;
        }
      }
    }

    templates.push({ source, destination });
  }

  return templates;
}
```

Then in `getAllTemplatesForContext` (line 210), add blueprint resolution at the end, **with deduplication** (blueprint overrides):

```typescript
// Step 5: Blueprint templates (override structural files)
if (ctx.blueprint) {
  const blueprintTemplates = resolveTemplatesForBlueprint(ctx.blueprint, ctx);

  // Blueprint files override structural files with same destination
  const blueprintDestinations = new Set(blueprintTemplates.map((t) => t.destination));
  const filtered = templates.filter((t) => !blueprintDestinations.has(t.destination));

  return [...filtered, ...blueprintTemplates];
}

return templates;
```

Also create an empty directory `templates/blueprints/` so the structure exists:
```bash
mkdir -p templates/blueprints
```

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/lib/template-resolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts apps/cli/tests/unit/lib/template-resolver.test.ts templates/blueprints/
git commit -m "feat(blueprints): add blueprint template resolution with override semantics"
```

---

### Task 5: Add blueprint deps and envs to generators

**Files:**
- Modify: `apps/cli/src/lib/package-json-generator.ts:115-199` (merge blueprint packageJson)
- Modify: `apps/cli/src/lib/env-generator.ts:41-75` (collect blueprint envs)
- Test: `apps/cli/tests/unit/lib/package-json-generator.test.ts`
- Test: `apps/cli/tests/unit/lib/env-generator.test.ts`

**Step 1: Write the failing test**

In `apps/cli/tests/unit/lib/package-json-generator.test.ts`, add:

```typescript
describe('blueprint package.json generation', () => {
  test('merges blueprint dependencies into app package.json', () => {
    // This test depends on having a blueprint with packageJson in META
    // We'll validate the merge logic works when blueprint deps exist
    const ctx: TemplateContext = {
      projectName: 'test-bp',
      repo: 'single',
      apps: [{ appName: 'test-bp', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: false,
      blueprint: 'dashboard',
    };

    const result = generateAppPackageJson(ctx.apps[0], ctx, 0);
    // When blueprint has packageJson.dependencies, they should appear
    expect(result.content.dependencies).toBeDefined();
  });
});
```

In `apps/cli/tests/unit/lib/env-generator.test.ts`, add:

```typescript
describe('blueprint env generation', () => {
  test('collects blueprint envs', () => {
    const ctx: TemplateContext = {
      projectName: 'test-bp',
      repo: 'single',
      apps: [{ appName: 'test-bp', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: false,
      blueprint: 'dashboard',
    };

    const files = collectEnvFiles(ctx);
    // Should not crash even without blueprint envs
    expect(Array.isArray(files)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail/pass (baseline)**

Run: `cd apps/cli && bun test tests/unit/lib/package-json-generator.test.ts tests/unit/lib/env-generator.test.ts`

**Step 3: Write implementation**

In `apps/cli/src/lib/package-json-generator.ts`, in `generateAppPackageJson()` (after line ~170, after linter handling), add:

```typescript
// Merge blueprint-specific dependencies
if (ctx.blueprint) {
  const blueprint = META.blueprints[ctx.blueprint];
  if (blueprint?.packageJson) {
    merged = mergeResolved(ctx, merged, blueprint.packageJson);
  }
}
```

In `apps/cli/src/lib/env-generator.ts`, in `collectAllEnvs()` (after the library env collection, around line 73), add:

```typescript
// Collect blueprint envs
if (ctx.blueprint) {
  const blueprint = META.blueprints[ctx.blueprint];
  if (blueprint?.envs) {
    for (const env of blueprint.envs) {
      for (const scope of env.monoScope) {
        envs.push({ value: env.value, scope, source: 'project' });
      }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/cli && bun test tests/unit/lib/package-json-generator.test.ts tests/unit/lib/env-generator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/lib/package-json-generator.ts apps/cli/src/lib/env-generator.ts apps/cli/tests/unit/lib/package-json-generator.test.ts apps/cli/tests/unit/lib/env-generator.test.ts
git commit -m "feat(blueprints): merge blueprint deps and envs into generators"
```

---

### Task 6: Update summary to show --blueprint in CLI command

**Files:**
- Modify: `apps/cli/src/tui/summary.ts:6-41` (show --blueprint in auto-generated command)

**Step 1: Write the failing test**

This is a display function. Add a unit test for `displayOutroCliCommand` logic. Since the function writes to stdout, test the logic by checking the command string generation. Extract `buildCliCommand` if it doesn't exist yet, or test by capturing output.

Actually, looking at `summary.ts`, the command is built inline. The simplest approach is to just implement the change and verify visually in integration tests. But let's at least write a test for the conditional logic.

Create or extend tests:

```typescript
// In tests for summary, or inline in integration/blueprint.test.ts:
test('blueprint project generates correct CLI command', async () => {
  // Integration test that verifies the output contains --blueprint
  // This will be covered by the full integration test
});
```

**Step 2: Write implementation**

In `apps/cli/src/tui/summary.ts`, modify `displayOutroCliCommand`:

After line 7 (`let flagsCommand = ...`), add an early return path for blueprint:

```typescript
export function displayOutroCliCommand(ctx: TemplateContext, projectPath: string): void {
  let flagsCommand: string;

  if (ctx.blueprint) {
    flagsCommand = `bunx create-faster ${ctx.projectName} --blueprint ${ctx.blueprint}`;
  } else {
    flagsCommand = `bunx create-faster ${ctx.projectName}`;

    for (const app of ctx.apps) {
      const librariesStr = app.libraries.length > 0 ? `:${app.libraries.join(',')}` : '';
      flagsCommand += ` --app ${app.appName}:${app.stackName}${librariesStr}`;
    }

    for (const projectKey of Object.keys(ctx.project) as (keyof ProjectContext)[]) {
      if (Array.isArray(ctx.project[projectKey])) {
        for (const value of ctx.project[projectKey]) {
          flagsCommand += ` --${projectKey} ${value}`;
        }
      } else {
        flagsCommand += ` --${projectKey} ${ctx.project[projectKey]}`;
      }
    }
  }

  if (ctx.git) {
    flagsCommand += ' --git';
  }

  if (ctx.pm) {
    flagsCommand += ` --pm ${ctx.pm}`;
  }

  // ... rest unchanged
}
```

**Step 3: Run existing tests**

Run: `cd apps/cli && bun test`
Expected: All existing tests still PASS

**Step 4: Commit**

```bash
git add apps/cli/src/tui/summary.ts
git commit -m "feat(blueprints): show --blueprint in auto-generated CLI command"
```

---

### Task 7: Add Dashboard blueprint to META and create template files

**Files:**
- Modify: `apps/cli/src/__meta__.ts:532` (add dashboard blueprint)
- Create: `templates/blueprints/dashboard/` (all template files)
- Test: `apps/cli/tests/unit/meta.test.ts`

**Step 1: Write the failing test**

In `apps/cli/tests/unit/meta.test.ts`, add:

```typescript
describe('META.blueprints.dashboard', () => {
  test('dashboard blueprint is defined', () => {
    expect(META.blueprints.dashboard).toBeDefined();
  });

  test('dashboard has valid context', () => {
    const bp = META.blueprints.dashboard;
    expect(bp.context.apps.length).toBeGreaterThan(0);
    expect(bp.context.apps[0].stackName).toBe('nextjs');
    expect(bp.context.apps[0].libraries).toContain('shadcn');
    expect(bp.context.apps[0].libraries).toContain('better-auth');
  });

  test('dashboard libraries are compatible with stack', () => {
    const bp = META.blueprints.dashboard;
    for (const app of bp.context.apps) {
      for (const lib of app.libraries) {
        expect(META.libraries[lib], `library ${lib} must exist in META`).toBeDefined();
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/meta.test.ts`
Expected: FAIL — `META.blueprints.dashboard` is undefined

**Step 3: Write implementation**

In `apps/cli/src/__meta__.ts`, replace the empty `blueprints: {}` with the dashboard definition:

```typescript
blueprints: {
  dashboard: {
    label: 'Dashboard',
    hint: 'Internal CRM-style dashboard with auth, sidebar, and admin panel',
    context: {
      apps: [
        {
          appName: 'web',
          stackName: 'nextjs',
          libraries: ['shadcn', 'better-auth', 'tanstack-query'],
        },
      ],
      project: {
        database: 'postgres',
        orm: 'drizzle',
        linter: 'biome',
        tooling: [],
      },
    },
    packageJson: {
      dependencies: {
        recharts: '^2.15.0',
      },
    },
    envs: [
      {
        value: 'ADMIN_EMAIL=admin@example.com',
        monoScope: ['app'],
      },
    ],
  },
},
```

Then create the dashboard template files in `templates/blueprints/dashboard/`. These are Handlebars templates that provide the actual dashboard application code.

Start with a minimal set of files that demonstrate the blueprint works:

- `src/app/page.tsx.hbs` — Dashboard home page (overrides the default Next.js page)
- `src/app/(dashboard)/layout.tsx.hbs` — Dashboard layout with sidebar
- `src/app/(dashboard)/page.tsx.hbs` — Dashboard main content
- `src/app/(dashboard)/settings/page.tsx.hbs` — Settings page
- `src/components/sidebar.tsx.hbs` — Sidebar component
- `src/components/header.tsx.hbs` — Header component

Each file should use the existing Handlebars helpers (e.g., `{{#hasLibrary "shadcn"}}`) and frontmatter where needed.

**NOTE:** The actual content of these template files is the creative/design work of building the Dashboard UI. This task focuses on creating structurally correct `.hbs` files that:
1. Are valid Handlebars templates
2. Use correct frontmatter for path resolution
3. Import from the right places (shadcn components, better-auth, etc.)
4. Compile without errors

The template content quality can be iterated on separately — the architecture just needs to work.

**Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/meta.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/cli/src/__meta__.ts templates/blueprints/dashboard/
git commit -m "feat(blueprints): add dashboard blueprint definition and template files"
```

---

### Task 8: Add interactive "template vs custom" prompt

**Files:**
- Modify: `apps/cli/src/index.ts` (add blueprint selection when no flags)
- Modify: `apps/cli/src/prompts/base-prompts.ts` or new file for blueprint prompt

**Step 1: Write implementation**

In `apps/cli/src/index.ts`, when there are no flags AND blueprints exist in META, show the choice prompt:

```typescript
import { select } from '@clack/prompts';

async function main() {
  const partial = parseFlags();

  console.log(ASCII);
  intro(INTRO_MESSAGE);

  try {
    let config: Omit<TemplateContext, 'repo'>;

    if (partial.blueprint) {
      config = await blueprintCli(partial.blueprint, partial);
    } else {
      const hasFlags = Object.keys(partial).length > 0;
      const hasBlueprints = Object.keys(META.blueprints).length > 0;

      if (!hasFlags && hasBlueprints) {
        const mode = await select({
          message: 'What would you like to create?',
          options: [
            { value: 'custom', label: 'Start from scratch', hint: 'Choose your own stack and libraries' },
            { value: 'blueprint', label: 'Use a template', hint: 'Pre-configured project with application code' },
          ],
        });

        if (isCancel(mode)) {
          cancel('👋 Bye');
          process.exit(0);
        }

        if (mode === 'blueprint') {
          const blueprintName = await select({
            message: 'Choose a template:',
            options: Object.entries(META.blueprints).map(([name, bp]) => ({
              value: name,
              label: bp.label,
              hint: bp.hint,
            })),
          });

          if (isCancel(blueprintName)) {
            cancel('👋 Bye');
            process.exit(0);
          }

          config = await blueprintCli(blueprintName as string, partial);
        } else {
          config = await cli(partial);
        }
      } else {
        config = await cli(partial);
      }
    }

    // ... rest unchanged
  }
}
```

**Step 2: Run all tests**

Run: `cd apps/cli && bun test`
Expected: All tests PASS

**Step 3: Manual test**

Run: `cd apps/cli && bun run src/index.ts`
Expected: See "What would you like to create?" prompt with "Start from scratch" and "Use a template" options

**Step 4: Commit**

```bash
git add apps/cli/src/index.ts
git commit -m "feat(blueprints): add interactive template vs custom prompt"
```

---

### Task 9: Integration test — full blueprint generation

**Files:**
- Modify: `apps/cli/tests/integration/blueprint.test.ts`

**Step 1: Write the test**

```typescript
describe('Blueprint generation - dashboard', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint dashboard', async () => {
    const result = await runCli(
      ['test-dashboard', '--blueprint', 'dashboard', '--no-install', '--git'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);

    const projectPath = join(tempDir, 'test-dashboard');

    // Core files exist
    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
    expect(await fileExists(join(projectPath, '.env.example'))).toBe(true);

    // Package.json has blueprint-specific deps
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(
      join(projectPath, 'package.json'),
    );
    expect(pkg.dependencies.recharts).toBeDefined();
    expect(pkg.dependencies.next).toBeDefined();

    // Blueprint template files exist
    // (paths depend on actual template files created in Task 7)
  });

  test('--blueprint and --app are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict', '--blueprint', 'dashboard', '--app', 'web:nextjs', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('env file includes blueprint envs', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const envContent = await readTextFile(join(projectPath, '.env.example'));
    expect(envContent).toContain('ADMIN_EMAIL');
  });

  test('output shows --blueprint in recreate command', async () => {
    const result = await runCli(
      ['test-bp-cmd', '--blueprint', 'dashboard', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint dashboard');
  });
});
```

**Step 2: Run test**

Run: `cd apps/cli && bun test tests/integration/blueprint.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/cli/tests/integration/blueprint.test.ts
git commit -m "test(blueprints): add integration tests for blueprint generation"
```

---

### Task 10: Run full test suite and fix any regressions

**Step 1: Run all tests**

```bash
cd apps/cli && bun test
```

**Step 2: Fix any failures**

Address any regressions in existing tests caused by the new `blueprint` field on `TemplateContext` or changes to the CLI flow.

Common things to check:
- Tests that construct `TemplateContext` objects might need `blueprint: undefined`
- Tests that parse CLI output might see different formatting
- Template resolver tests might need updating

**Step 3: Run tests again**

```bash
cd apps/cli && bun test
```
Expected: All PASS

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(blueprints): resolve test regressions from blueprint feature"
```

---

### Task 11: Update CLAUDE.md documentation

**Files:**
- Modify: `apps/cli/.claude/CLAUDE.md` or root `.claude/CLAUDE.md`

Add documentation about the blueprints feature:
- New META section: `blueprints`
- New CLI flag: `--blueprint`
- New template directory: `templates/blueprints/`
- Blueprint flow explanation

**Step 1: Update the docs**

Add a "Blueprints" section covering:
- What blueprints are
- How to add a new blueprint (META entry + template files)
- CLI usage (`--blueprint` flag)
- Template resolution with override semantics

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(blueprints): document blueprint feature in CLAUDE.md"
```
