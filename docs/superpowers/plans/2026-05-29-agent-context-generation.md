# Agent Context Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate AI-agent context (`AGENTS.md` + `CLAUDE.md` import + blueprint `docs/agents/`) in every project created by create-faster.

**Architecture:** A new programmatic generator (`agent-context-generator.ts`), modeled on `env-generator.ts`, collects co-located `__agent.md.hbs` fiches and a per-repo header template, renders them with Handlebars, groups them by scope into one or more `AGENTS.md` files, and writes a `CLAUDE.md` (`@AGENTS.md`) companion next to each. It runs as step 5 of `generateProjectFiles`. The normal template pipeline is taught to ignore `__agent.md.hbs` files. Blueprints add an `agentArchitecture` section and ship rich guides under `docs/agents/*.md.hbs` (rendered by the existing pipeline).

**Tech Stack:** TypeScript, Bun, Handlebars, gray-matter, Zod-free (META-driven), `bun:test`.

---

## File Structure

**New files:**
- `apps/cli/src/lib/agent-context-generator.ts` — collects, renders, groups, assembles agent context files. One responsibility: produce `{ destination, content }[]` for `AGENTS.md`/`CLAUDE.md`.
- `apps/cli/tests/unit/lib/agent-context-generator.test.ts` — unit tests for the generator.
- `apps/cli/templates/repo/single/__agent.md.hbs` — project header (single repo).
- `apps/cli/templates/repo/turborepo/__agent.md.hbs` — project header (monorepo root).
- `apps/cli/templates/stack/nextjs/__agent.md.hbs`, `.../expo/__agent.md.hbs`, `.../hono/__agent.md.hbs` — stack fiches.
- `apps/cli/templates/project/orm/drizzle/__agent.md.hbs`, `.../orm/prisma/__agent.md.hbs` — ORM fiches.
- `apps/cli/templates/project/database/postgres/__agent.md.hbs`, `.../database/mysql/__agent.md.hbs` — database fiches.
- `apps/cli/templates/libraries/better-auth/__agent.md.hbs`, `.../shadcn/__agent.md.hbs`, `.../trpc/__agent.md.hbs` — library fiches.
- `apps/cli/templates/blueprints/org-dashboard/docs/agents/auth.md.hbs`, `.../data-layer.md.hbs` — blueprint rich guides.

**Modified files:**
- `apps/cli/src/types/ctx.ts` — add `agentContext?: boolean` to `TemplateContext`.
- `apps/cli/src/types/meta.ts` — add `agentArchitecture?: string` to `MetaBlueprint`.
- `apps/cli/src/lib/template-resolver.ts` — add `scanTemplateFiles` wrapper that excludes `__agent.md.hbs`; use it in every resolver.
- `apps/cli/src/lib/file-generator.ts` — add step 5 calling the generator (gated on `agentContext !== false`).
- `apps/cli/src/flags.ts` — add `--no-agent-context`; thread into partial context.
- `apps/cli/src/tui/summary.ts` — append `--no-agent-context` to recreate command when disabled.
- `apps/cli/src/__meta__.ts` — add `agentArchitecture` to existing blueprint entries.

---

## Task 1: Types — context flag, blueprint field, fiche frontmatter

**Files:**
- Modify: `apps/cli/src/types/ctx.ts:19-29`
- Modify: `apps/cli/src/types/meta.ts:106-118`

- [ ] **Step 1: Add `agentContext` to `TemplateContext`**

In `apps/cli/src/types/ctx.ts`, change the `TemplateContext` interface to add the field after `dbPort`:

```typescript
export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  project: ProjectContext;
  git: boolean;
  pm?: PackageManager;
  skipInstall?: boolean;
  blueprint?: string;
  dbPort?: number;
  agentContext?: boolean;
}
```

- [ ] **Step 2: Add `agentArchitecture` to `MetaBlueprint`**

In `apps/cli/src/types/meta.ts`, change the `MetaBlueprint` interface to add the optional field after `envs`:

```typescript
export interface MetaBlueprint {
  label: string;
  hint: string;
  category: string;
  context: {
    apps: { appName: string; stackName: StackName; libraries: string[] }[];
    project: { database?: string; orm?: string; deployment?: string };
  };
  packageJson?: PackageJsonConfig;
  rootPackageJson?: PackageJsonConfig;
  pkgPackageJson?: Record<string, PackageJsonConfig>;
  envs?: EnvVar[];
  agentArchitecture?: string;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd apps/cli && bunx tsc --noEmit`
Expected: PASS (no errors). The new fields are optional, so nothing else breaks.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/types/ctx.ts apps/cli/src/types/meta.ts
git commit -m "feat(types): add agentContext flag and blueprint agentArchitecture"
```

---

## Task 2: Exclude `__agent.md.hbs` from the normal template pipeline

The resolvers scan every file in addon dirs and copy it. Without this, each `__agent.md.hbs` would be emitted as a `.agent.md` file (via `transformFilename`). We add a single wrapper used by all resolvers.

**Files:**
- Modify: `apps/cli/src/lib/template-resolver.ts:1-10` (add constant + wrapper) and the five resolver functions
- Test: `apps/cli/tests/unit/lib/template-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/tests/unit/lib/template-resolver.test.ts`:

```typescript
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTemplateFiles } from '@/lib/template-resolver';

describe('scanTemplateFiles', () => {
  test('excludes __agent.md.hbs but keeps normal templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-scan-'));
    writeFileSync(join(dir, 'page.tsx.hbs'), 'x');
    writeFileSync(join(dir, '__agent.md.hbs'), 'fiche');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', '__agent.md.hbs'), 'nested fiche');

    const files = scanTemplateFiles(dir);

    expect(files).toContain('page.tsx.hbs');
    expect(files.some((f) => f.endsWith('__agent.md.hbs'))).toBe(false);
  });
});
```

(If the file already imports `describe`/`expect`/`test`, do not re-import them — only add the new imports and `describe` block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/lib/template-resolver.test.ts -t scanTemplateFiles`
Expected: FAIL — `scanTemplateFiles` is not exported.

- [ ] **Step 3: Add the wrapper and constant**

In `apps/cli/src/lib/template-resolver.ts`, after the imports (line 8) and before `const VALID_STACKS`, add:

```typescript
const AGENT_DOC_FILENAME = '__agent.md.hbs';

export function scanTemplateFiles(dir: string): string[] {
  return scanDirectory(dir).filter((file) => !file.endsWith(AGENT_DOC_FILENAME));
}
```

- [ ] **Step 4: Use `scanTemplateFiles` in every resolver**

Replace each `scanDirectory(...)` call that scans an addon/stack/repo/blueprint dir with `scanTemplateFiles(...)`:
- `resolveTemplatesForStack`: `const files = scanTemplateFiles(stackDir);`
- `resolveTemplatesForLibrary`: `const files = scanTemplateFiles(libraryDir);`
- `resolveTemplatesForProjectAddon`: `const files = scanTemplateFiles(addonDir);`
- `resolveStackSpecificAddonTemplatesForApps`: `const files = scanTemplateFiles(addonDir);`
- `resolveTemplatesForRepo`: `const files = scanTemplateFiles(repoDir);`
- `resolveTemplatesForBlueprint`: `const files = scanTemplateFiles(blueprintDir);`

Leave the `scanDirectory` import in place (still referenced by `scanTemplateFiles`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/lib/template-resolver.test.ts`
Expected: PASS (new test + all existing resolver tests).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/lib/template-resolver.ts apps/cli/tests/unit/lib/template-resolver.test.ts
git commit -m "feat(templates): exclude __agent.md.hbs from output pipeline"
```

---

## Task 3: Generator core — fiche collection + single-repo assembly

**Files:**
- Create: `apps/cli/src/lib/agent-context-generator.ts`
- Create: `apps/cli/tests/unit/lib/agent-context-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/unit/lib/agent-context-generator.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { collectAgentContextFiles } from '@/lib/agent-context-generator';
import type { TemplateContext } from '@/types/ctx';

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'single',
    apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: ['better-auth'] }],
    project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
    git: true,
    pm: 'bun',
    ...overrides,
  };
}

describe('collectAgentContextFiles (single repo)', () => {
  test('emits a root AGENTS.md', () => {
    const files = collectAgentContextFiles(makeContext());
    const agents = files.find((f) => f.destination === 'AGENTS.md');
    expect(agents).toBeDefined();
  });

  test('AGENTS.md contains the project header and the stack name', () => {
    const files = collectAgentContextFiles(makeContext());
    const agents = files.find((f) => f.destination === 'AGENTS.md');
    expect(agents?.content).toContain('my-project');
    expect(agents?.content).toContain('Next.js');
  });

  test('AGENTS.md includes a section per selected addon with a fiche', () => {
    const files = collectAgentContextFiles(makeContext());
    const agents = files.find((f) => f.destination === 'AGENTS.md');
    expect(agents?.content).toContain('## Better Auth');
    expect(agents?.content).toContain('## Drizzle');
  });

  test('writes a CLAUDE.md companion that imports AGENTS.md', () => {
    const files = collectAgentContextFiles(makeContext());
    const claude = files.find((f) => f.destination === 'CLAUDE.md');
    expect(claude?.content).toBe('@AGENTS.md\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts`
Expected: FAIL — module `@/lib/agent-context-generator` not found.

- [ ] **Step 3: Implement the generator (single-repo path)**

Create `apps/cli/src/lib/agent-context-generator.ts`:

```typescript
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import { collectEnvGroups } from '@/lib/env-generator';
import { readFrontmatterFile } from '@/lib/frontmatter';
import { renderTemplate } from '@/lib/handlebars';
import type { AppContext, TemplateContext } from '@/types/ctx';

interface AgentContextFile {
  destination: string;
  content: string;
}

interface AgentDocFrontmatter {
  scope?: 'app' | 'root';
  heading?: string;
  order?: number;
}

interface Section {
  destination: string;
  heading: string;
  order: number;
  body: string;
}

const AGENT_DOC_FILENAME = '__agent.md.hbs';

const DEFAULT_ORDER = {
  stack: 10,
  database: 20,
  orm: 30,
  deployment: 35,
  library: 50,
  linter: 80,
  tooling: 90,
} as const;

function renderFiche(
  source: string,
  ctx: TemplateContext,
  enrich: Partial<AppContext>,
): { frontmatter: AgentDocFrontmatter; body: string } | null {
  if (!existsSync(source)) return null;
  const { data, content } = readFrontmatterFile(source);
  const frontmatter = data as unknown as AgentDocFrontmatter;
  const envGroups = collectEnvGroups(ctx);
  const body = renderTemplate(content, { ...ctx, ...enrich, envGroups } as TemplateContext).trim();
  if (!body) return null;
  return { frontmatter, body };
}

function resolveDestination(scope: 'app' | 'root', ctx: TemplateContext, appName?: string): string {
  if (ctx.repo === 'single') return 'AGENTS.md';
  if (scope === 'root') return 'AGENTS.md';
  return appName ? `apps/${appName}/AGENTS.md` : 'AGENTS.md';
}

function singleAppEnrich(ctx: TemplateContext): Partial<AppContext> {
  return ctx.repo === 'single' && ctx.apps[0] ? ctx.apps[0] : {};
}

function collectSections(ctx: TemplateContext): Section[] {
  const sections: Section[] = [];

  const push = (
    source: string,
    defaultScope: 'app' | 'root',
    defaultHeading: string,
    defaultOrder: number,
    ctxForRender: TemplateContext,
    enrich: Partial<AppContext>,
    appName?: string,
  ) => {
    const rendered = renderFiche(source, ctxForRender, enrich);
    if (!rendered) return;
    const scope = rendered.frontmatter.scope ?? defaultScope;
    sections.push({
      destination: resolveDestination(scope, ctx, appName),
      heading: rendered.frontmatter.heading ?? defaultHeading,
      order: rendered.frontmatter.order ?? defaultOrder,
      body: rendered.body,
    });
  };

  for (const app of ctx.apps) {
    const stackFiche = join(TEMPLATES_DIR, 'stack', app.stackName, AGENT_DOC_FILENAME);
    push(stackFiche, 'app', META.stacks[app.stackName].label, DEFAULT_ORDER.stack, ctx, app, app.appName);

    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (!library || !isLibraryCompatible(library, app.stackName)) continue;
      const ficheSource = join(TEMPLATES_DIR, 'libraries', libraryName, AGENT_DOC_FILENAME);
      push(ficheSource, 'app', library.label, DEFAULT_ORDER.library, ctx, app, app.appName);
    }
  }

  const projectEnrich = singleAppEnrich(ctx);
  const projectCategories: { category: keyof typeof META.project; order: number }[] = [
    { category: 'database', order: DEFAULT_ORDER.database },
    { category: 'orm', order: DEFAULT_ORDER.orm },
    { category: 'deployment', order: DEFAULT_ORDER.deployment },
    { category: 'linter', order: DEFAULT_ORDER.linter },
  ];

  for (const { category, order } of projectCategories) {
    const value = ctx.project[category as 'database' | 'orm' | 'deployment' | 'linter'];
    if (!value) continue;
    const addon = META.project[category].options[value];
    if (!addon) continue;
    const ficheSource = join(TEMPLATES_DIR, 'project', category, value, AGENT_DOC_FILENAME);
    push(ficheSource, 'root', addon.label, order, ctx, projectEnrich);
  }

  for (const tooling of ctx.project.tooling) {
    const addon = META.project.tooling.options[tooling];
    if (!addon) continue;
    const ficheSource = join(TEMPLATES_DIR, 'project', 'tooling', tooling, AGENT_DOC_FILENAME);
    push(ficheSource, 'root', addon.label, DEFAULT_ORDER.tooling, ctx, projectEnrich);
  }

  return sections;
}

function renderHeader(ctx: TemplateContext): string {
  const source = join(TEMPLATES_DIR, 'repo', ctx.repo, AGENT_DOC_FILENAME);
  if (!existsSync(source)) return `# ${ctx.projectName}\n`;
  const { content } = readFrontmatterFile(source);
  const envGroups = collectEnvGroups(ctx);
  const enrich = singleAppEnrich(ctx);
  return renderTemplate(content, { ...ctx, ...enrich, envGroups } as TemplateContext).trim();
}

function assembleSections(sections: Section[]): string {
  return [...sections]
    .sort((a, b) => a.order - b.order || a.heading.localeCompare(b.heading))
    .map((s) => `## ${s.heading}\n\n${s.body}`)
    .join('\n\n');
}

export function collectAgentContextFiles(ctx: TemplateContext): AgentContextFile[] {
  const sections = collectSections(ctx);
  const files: AgentContextFile[] = [];

  const header = renderHeader(ctx);
  const rootSections = sections.filter((s) => s.destination === 'AGENTS.md');
  const rootBody = [header, assembleSections(rootSections)].filter(Boolean).join('\n\n');
  files.push({ destination: 'AGENTS.md', content: `${rootBody}\n` });

  for (const file of files.slice()) {
    const claudePath = file.destination.replace(/AGENTS\.md$/, 'CLAUDE.md');
    files.push({ destination: claudePath, content: '@AGENTS.md\n' });
  }

  return files;
}
```

- [ ] **Step 4: Add minimal fiches so the test has content to find**

Create `apps/cli/templates/stack/nextjs/__agent.md.hbs`:

```markdown
Next.js App Router project. Routes in `src/app/`, shared code in `src/lib/`.
Import alias `@/*` maps to `src/*`.
```

Create `apps/cli/templates/libraries/better-auth/__agent.md.hbs`:

```markdown
Auth config in `src/lib/auth/`. `auth.ts` is the server instance, `auth-client.ts` the client.
Add a social provider by editing `socialProviders` in `auth.ts`.
```

Create `apps/cli/templates/project/orm/drizzle/__agent.md.hbs`:

```markdown
Drizzle schema lives in the db package. Run `{{pm}} db:push` to sync the schema and `{{pm}} db:studio` to inspect data.
```

(Full fiche content for all addons is authored in Tasks 9-12; these three are enough to make Task 3 green.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/lib/agent-context-generator.ts apps/cli/tests/unit/lib/agent-context-generator.test.ts apps/cli/templates/stack/nextjs/__agent.md.hbs apps/cli/templates/libraries/better-auth/__agent.md.hbs apps/cli/templates/project/orm/drizzle/__agent.md.hbs
git commit -m "feat(agent-context): generate root AGENTS.md and CLAUDE.md import (single repo)"
```

---

## Task 4: Generator — turborepo per-app destinations

**Files:**
- Modify: `apps/cli/src/lib/agent-context-generator.ts:collectAgentContextFiles`
- Modify: `apps/cli/tests/unit/lib/agent-context-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/tests/unit/lib/agent-context-generator.test.ts`:

```typescript
describe('collectAgentContextFiles (turborepo)', () => {
  function monoContext(): TemplateContext {
    return {
      projectName: 'mysaas',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
      git: true,
      pm: 'bun',
    };
  }

  test('emits a root AGENTS.md and one per app', () => {
    const files = collectAgentContextFiles(monoContext());
    const destinations = files.map((f) => f.destination);
    expect(destinations).toContain('AGENTS.md');
    expect(destinations).toContain('apps/web/AGENTS.md');
  });

  test('app-scoped library section lands in that app file, not root', () => {
    const files = collectAgentContextFiles(monoContext());
    const web = files.find((f) => f.destination === 'apps/web/AGENTS.md');
    const root = files.find((f) => f.destination === 'AGENTS.md');
    expect(web?.content).toContain('## Better Auth');
    expect(root?.content).not.toContain('## Better Auth');
  });

  test('every AGENTS.md has a sibling CLAUDE.md import', () => {
    const files = collectAgentContextFiles(monoContext());
    expect(files.find((f) => f.destination === 'apps/web/CLAUDE.md')?.content).toBe('@AGENTS.md\n');
    expect(files.find((f) => f.destination === 'CLAUDE.md')?.content).toBe('@AGENTS.md\n');
  });

  test('apps with no fiche-bearing addon get no AGENTS.md', () => {
    const files = collectAgentContextFiles(monoContext());
    // api (hono, no libs) has no stack/lib fiche yet → no apps/api/AGENTS.md
    expect(files.some((f) => f.destination === 'apps/api/AGENTS.md')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts -t turborepo`
Expected: FAIL — only the root `AGENTS.md` is currently emitted; per-app destinations are missing.

- [ ] **Step 3: Build per-destination files**

Replace the body of `collectAgentContextFiles` in `agent-context-generator.ts` with:

```typescript
export function collectAgentContextFiles(ctx: TemplateContext): AgentContextFile[] {
  const sections = collectSections(ctx);
  const files: AgentContextFile[] = [];

  const header = renderHeader(ctx);
  const rootSections = sections.filter((s) => s.destination === 'AGENTS.md');
  const rootBody = [header, assembleSections(rootSections)].filter(Boolean).join('\n\n');
  files.push({ destination: 'AGENTS.md', content: `${rootBody}\n` });

  const appDestinations = new Set(
    sections.filter((s) => s.destination !== 'AGENTS.md').map((s) => s.destination),
  );

  for (const destination of appDestinations) {
    const appName = destination.split('/')[1];
    const app = ctx.apps.find((a) => a.appName === appName);
    const preamble = app ? `# ${app.appName}\n\n${META.stacks[app.stackName].label} app.` : `# ${appName}`;
    const appSections = sections.filter((s) => s.destination === destination);
    const body = [preamble, assembleSections(appSections)].filter(Boolean).join('\n\n');
    files.push({ destination, content: `${body}\n` });
  }

  for (const file of files.slice()) {
    if (!file.destination.endsWith('AGENTS.md')) continue;
    const claudePath = file.destination.replace(/AGENTS\.md$/, 'CLAUDE.md');
    files.push({ destination: claudePath, content: '@AGENTS.md\n' });
  }

  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts`
Expected: PASS (all single + turborepo tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lib/agent-context-generator.ts apps/cli/tests/unit/lib/agent-context-generator.test.ts
git commit -m "feat(agent-context): per-app AGENTS.md in turborepo"
```

---

## Task 5: Generator — blueprint Architecture section + guide index

**Files:**
- Modify: `apps/cli/src/lib/agent-context-generator.ts`
- Modify: `apps/cli/tests/unit/lib/agent-context-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/tests/unit/lib/agent-context-generator.test.ts`:

```typescript
import { META } from '@/__meta__';

describe('collectAgentContextFiles (blueprint)', () => {
  test('injects Architecture section from META.agentArchitecture', () => {
    const blueprintName = Object.keys(META.blueprints).find(
      (n) => META.blueprints[n].agentArchitecture,
    );
    if (!blueprintName) return; // no blueprint annotated yet
    const blueprint = META.blueprints[blueprintName];
    const ctx: TemplateContext = {
      projectName: 'demo',
      repo: blueprint.context.apps.length > 1 ? 'turborepo' : 'single',
      apps: blueprint.context.apps.map((a) => ({ ...a })),
      project: { ...blueprint.context.project, tooling: [] },
      git: true,
      pm: 'bun',
      blueprint: blueprintName,
    };
    const root = collectAgentContextFiles(ctx).find((f) => f.destination === 'AGENTS.md');
    expect(root?.content).toContain('## Architecture');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts -t blueprint`
Expected: FAIL — no Architecture section is emitted (and no blueprint is annotated yet; the test no-ops until Task 13 adds `agentArchitecture`, but the code path must exist). To make the path testable now, this test will pass trivially (return) until Task 13; implement the code so that once annotated it works.

- [ ] **Step 3: Add the Architecture section to the root file**

In `agent-context-generator.ts`, add a helper above `collectAgentContextFiles`:

```typescript
function blueprintArchitecture(ctx: TemplateContext): string {
  if (!ctx.blueprint) return '';
  const blueprint = META.blueprints[ctx.blueprint];
  if (!blueprint?.agentArchitecture) return '';
  return `## Architecture\n\n${blueprint.agentArchitecture.trim()}`;
}
```

Then, in `collectAgentContextFiles`, change the root body assembly to include it right after the header:

```typescript
  const header = renderHeader(ctx);
  const architecture = blueprintArchitecture(ctx);
  const rootSections = sections.filter((s) => s.destination === 'AGENTS.md');
  const rootBody = [header, architecture, assembleSections(rootSections)]
    .filter(Boolean)
    .join('\n\n');
  files.push({ destination: 'AGENTS.md', content: `${rootBody}\n` });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts`
Expected: PASS (blueprint test no-ops until Task 13, all others green).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lib/agent-context-generator.ts apps/cli/tests/unit/lib/agent-context-generator.test.ts
git commit -m "feat(agent-context): inject blueprint Architecture section"
```

---

## Task 6: Wire the generator into file generation

**Files:**
- Modify: `apps/cli/src/lib/file-generator.ts:1-9` (import) and the body of `generateProjectFiles`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/integration/agent-context.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('agent context generation (integration)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(
      ['myapp', '--app', 'myapp:nextjs:better-auth', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install'],
      dir,
    );
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('writes AGENTS.md', async () => {
    expect(await fileExists(join(dir, 'myapp', 'AGENTS.md'))).toBe(true);
  });

  test('writes CLAUDE.md importing AGENTS.md', async () => {
    const content = await readTextFile(join(dir, 'myapp', 'CLAUDE.md'));
    expect(content).toBe('@AGENTS.md\n');
  });

  test('does not emit a stray .agent.md file', async () => {
    expect(await fileExists(join(dir, 'myapp', '.agent.md'))).toBe(false);
    expect(await fileExists(join(dir, 'myapp', 'src', '.agent.md'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/integration/agent-context.test.ts`
Expected: FAIL — `AGENTS.md` is not written (generator not wired).

- [ ] **Step 3: Wire step 5 into `generateProjectFiles`**

In `apps/cli/src/lib/file-generator.ts`, add the import near the other lib imports (after line 4):

```typescript
import { collectAgentContextFiles } from './agent-context-generator';
```

Then, after the Handlebars template loop and before "// 4. Compile results" (around line 99), add:

```typescript
  // 5. Generate agent context files (programmatic)
  if (context.agentContext !== false) {
    const agentFiles = collectAgentContextFiles(context);
    for (const { destination, content } of agentFiles) {
      const fullPath = join(projectPath, destination);
      try {
        await writeFileContent(fullPath, content);
        allResults.push({ success: true, destination });
      } catch (error) {
        allResults.push({ success: false, destination, error: getErrorMessage(error) });
      }
    }
  }
```

(Place it before the `// 4. Compile results` block so the agent files are counted in the results loop. Renumber the trailing comment if desired; functionality is unaffected.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/integration/agent-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lib/file-generator.ts apps/cli/tests/integration/agent-context.test.ts
git commit -m "feat(agent-context): write AGENTS.md/CLAUDE.md during generation"
```

---

## Task 7: CLI flag `--no-agent-context`

**Files:**
- Modify: `apps/cli/src/flags.ts:9-21` (interface), `:60-81` (option registration), `:176-196` (threading)
- Modify: `apps/cli/tests/unit/flags.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/tests/unit/flags.test.ts` a check that the flag is documented. Since `parseFlags` reads `process.argv` and calls `process.exit`, assert against the help string instead. Add:

```typescript
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('agent-context flag', () => {
  test('flags.ts registers --no-agent-context', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/flags.ts'), 'utf-8');
    expect(src).toContain('--no-agent-context');
  });
});
```

(If `flags.test.ts` already imports these, do not duplicate imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/flags.test.ts -t agent-context`
Expected: FAIL — string not found.

- [ ] **Step 3: Add the flag to the `ParsedFlags` interface**

In `apps/cli/src/flags.ts`, add to the `ParsedFlags` interface after `install?: boolean;`:

```typescript
  agentContext?: boolean;
```

- [ ] **Step 4: Register the commander option**

In the `program` chain, after `.option('--no-install', 'Skip dependency installation')` (line 81), add:

```typescript
    .option('--no-agent-context', 'Skip AGENTS.md / CLAUDE.md generation')
```

- [ ] **Step 5: Thread into the partial context**

After the `if (flags.install === false)` block (line 191), add:

```typescript
  if (flags.agentContext === false) {
    partial.agentContext = false;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/flags.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the flag works end to end**

Run: `cd apps/cli && bun run src/index.ts optout --app optout:nextjs --no-git --no-install --no-agent-context && test ! -f optout/AGENTS.md && echo "NO-AGENTS-OK" && rm -rf optout`
Expected: prints `NO-AGENTS-OK` (no AGENTS.md generated). Clean up the `optout` dir afterward (the command does this).

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/flags.ts apps/cli/tests/unit/flags.test.ts
git commit -m "feat(flags): add --no-agent-context opt-out"
```

---

## Task 8: Reflect the flag in the recreate command

**Files:**
- Modify: `apps/cli/src/tui/summary.ts:37-47`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/unit/summary.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('recreate command', () => {
  test('summary.ts appends --no-agent-context when disabled', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/tui/summary.ts'), 'utf-8');
    expect(src).toContain('--no-agent-context');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test tests/unit/summary.test.ts`
Expected: FAIL — string not found.

- [ ] **Step 3: Append the flag when disabled**

In `apps/cli/src/tui/summary.ts`, after the `if (ctx.pm) { ... }` block (line 43) and before the `if (flagsCommand.length > 140)` check, add:

```typescript
  if (ctx.agentContext === false) {
    flagsCommand += ' --no-agent-context';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/unit/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Mention agent context in the summary structure**

In `apps/cli/src/tui/summary.ts`, inside `buildProjectStructure`, after the `tooling` loop that pushes to `configs` (around line 106, before the `if (configs.length > 0)` check), add:

```typescript
  if (ctx.agentContext !== false) {
    configs.push('AGENTS.md');
  }
```

This surfaces the generated agent context in the `└─ ⚙️` config line of the summary.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/tui/summary.ts apps/cli/tests/unit/summary.test.ts
git commit -m "feat(summary): reflect --no-agent-context in recreate command"
```

---

## Task 9: Project header templates

These render the top of each root `AGENTS.md`. They use Handlebars helpers (`isMono`, `has`, `appPort`) and the `envGroups` injected by the generator.

**Files:**
- Create: `apps/cli/templates/repo/single/__agent.md.hbs`
- Create: `apps/cli/templates/repo/turborepo/__agent.md.hbs`

- [ ] **Step 1: Create the single-repo header**

Create `apps/cli/templates/repo/single/__agent.md.hbs`:

```markdown
# {{projectName}}

Generated with create-faster. {{#each apps}}{{stackName}}{{/each}} project{{#if (has "orm" "drizzle")}} with Drizzle{{/if}}{{#if (has "orm" "prisma")}} with Prisma{{/if}}.

## Stack
{{#each apps}}
- App: {{stackName}}
{{/each}}
{{#if (has "orm" "drizzle")}}- ORM: Drizzle{{/if}}
{{#if (has "orm" "prisma")}}- ORM: Prisma{{/if}}
{{#if (has "database" "postgres")}}- Database: PostgreSQL{{/if}}
{{#if (has "database" "mysql")}}- Database: MySQL{{/if}}
{{#if (has "linter" "biome")}}- Linter: Biome{{/if}}
{{#if (has "linter" "eslint")}}- Linter: ESLint{{/if}}
- Package manager: {{pm}}

## Scripts
- `{{pm}} dev` — start the dev server
- `{{pm}} build` — production build
{{#if (has "orm" "drizzle")}}- `{{pm}} db:push` — sync the Drizzle schema{{/if}}
{{#if (has "orm" "prisma")}}- `{{pm}} db:push` — sync the Prisma schema{{/if}}
{{#if (has "linter" "biome")}}- `{{pm}} check` — format and lint with Biome{{/if}}

## Environment
{{#if envGroups.length}}
Copy `.env.example` to `.env` and fill in:
{{#each envGroups}}
{{#each vars}}
- `{{this}}`
{{/each}}
{{/each}}
{{else}}
No environment variables required.
{{/if}}

## Conventions
- Import alias: `@/*` → `src/*`
- Keep changes small and typed; no `any`.
```

- [ ] **Step 2: Create the turborepo header**

Create `apps/cli/templates/repo/turborepo/__agent.md.hbs`:

```markdown
# {{projectName}}

Generated with create-faster. Turborepo monorepo.

## Apps
{{#each apps}}
- `apps/{{appName}}` — {{stackName}} (port {{appPort appName}})
{{/each}}

## Packages
{{#if (has "orm" "drizzle")}}- `packages/db` — Drizzle schema and client{{/if}}
{{#if (has "orm" "prisma")}}- `packages/db` — Prisma schema and client{{/if}}

## Stack
{{#if (has "database" "postgres")}}- Database: PostgreSQL{{/if}}
{{#if (has "database" "mysql")}}- Database: MySQL{{/if}}
{{#if (has "linter" "biome")}}- Linter: Biome{{/if}}
{{#if (has "linter" "eslint")}}- Linter: ESLint{{/if}}
- Package manager: {{pm}}

## Scripts
- `{{pm}} dev` — run all apps via Turborepo
- `{{pm}} build` — build all apps
{{#if (has "orm" "drizzle")}}- `{{pm}} db:push` — sync the Drizzle schema (from `packages/db`){{/if}}
{{#if (has "orm" "prisma")}}- `{{pm}} db:push` — sync the Prisma schema (from `packages/db`){{/if}}

## Environment
{{#if envGroups.length}}
Each `.env.example` lists the variables for its scope:
{{#each envGroups}}
- `{{path}}`: {{#each vars}}`{{this}}` {{/each}}
{{/each}}
{{else}}
No environment variables required.
{{/if}}

## Conventions
- Per-app detail lives in each `apps/<app>/AGENTS.md`.
- Import alias: `@/*` → that app's `src/*`.
```

- [ ] **Step 3: Verify rendered output (single + mono)**

Run: `cd apps/cli && bun run src/index.ts hdr --app hdr:nextjs --database postgres --orm drizzle --linter biome --no-git --no-install && sed -n '1,40p' hdr/AGENTS.md && rm -rf hdr`
Expected: A clean `# hdr` header with Stack/Scripts/Environment/Conventions sections, no stray `{{...}}` Handlebars left, no blank-line spam. If Handlebars whitespace looks off, adjust `{{#each}}`/`{{#if}}` placement (this is the expected iteration point for header formatting).

Run: `cd apps/cli && bun run src/index.ts hdrmono --app web:nextjs --app api:hono --database postgres --orm drizzle --no-git --no-install && sed -n '1,40p' hdrmono/AGENTS.md && rm -rf hdrmono`
Expected: Turborepo header listing both apps with ports.

- [ ] **Step 4: Run the generator unit tests**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts`
Expected: PASS (header now richer; `## Better Auth` / `## Drizzle` sections still present).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/repo/single/__agent.md.hbs apps/cli/templates/repo/turborepo/__agent.md.hbs
git commit -m "feat(agent-context): project header templates"
```

---

## Task 10: Stack fiches (expo, hono)

`nextjs` was created in Task 3. Add the remaining two stacks.

**Files:**
- Create: `apps/cli/templates/stack/expo/__agent.md.hbs`
- Create: `apps/cli/templates/stack/hono/__agent.md.hbs`

- [ ] **Step 1: Create the Expo fiche**

Create `apps/cli/templates/stack/expo/__agent.md.hbs`:

```markdown
Expo (React Native) app using expo-router. Screens live in `app/`, shared code in `src/`.
Run on a device/simulator with `{{pm}} start`.
```

- [ ] **Step 2: Create the Hono fiche**

Create `apps/cli/templates/stack/hono/__agent.md.hbs`:

```markdown
Hono server. Routes are registered in `src/index.ts`. Handlers stay thin; shared logic goes in `src/lib/`.
```

- [ ] **Step 3: Verify they render**

Run: `cd apps/cli && bun run src/index.ts apptest --app api:hono --no-git --no-install && grep -q "Hono server" apptest/AGENTS.md && echo "HONO-FICHE-OK" && rm -rf apptest`
Expected: prints `HONO-FICHE-OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/stack/expo/__agent.md.hbs apps/cli/templates/stack/hono/__agent.md.hbs
git commit -m "feat(agent-context): expo and hono stack fiches"
```

---

## Task 11: Data-layer fiches (prisma, postgres, mysql)

`drizzle` was created in Task 3. Add prisma + both databases.

**Files:**
- Create: `apps/cli/templates/project/orm/prisma/__agent.md.hbs`
- Create: `apps/cli/templates/project/database/postgres/__agent.md.hbs`
- Create: `apps/cli/templates/project/database/mysql/__agent.md.hbs`

- [ ] **Step 1: Create the Prisma fiche**

Create `apps/cli/templates/project/orm/prisma/__agent.md.hbs`:

```markdown
Prisma schema lives in the db package (`schema.prisma`). After editing it, run `{{pm}} db:push` to sync and `{{pm}} db:generate` to regenerate the client. Inspect data with `{{pm}} db:studio`.
```

- [ ] **Step 2: Create the PostgreSQL fiche**

Create `apps/cli/templates/project/database/postgres/__agent.md.hbs`:

```markdown
PostgreSQL via Docker Compose. Start it with `docker compose up -d`. The connection string is in `DATABASE_URL` (see `.env.example`).
```

- [ ] **Step 3: Create the MySQL fiche**

Create `apps/cli/templates/project/database/mysql/__agent.md.hbs`:

```markdown
MySQL via Docker Compose. Start it with `docker compose up -d`. The connection string is in `DATABASE_URL` (see `.env.example`).
```

- [ ] **Step 4: Verify they render**

Run: `cd apps/cli && bun run src/index.ts dbtest --app dbtest:nextjs --database postgres --orm prisma --no-git --no-install && grep -q "## Prisma" dbtest/AGENTS.md && grep -q "## PostgreSQL" dbtest/AGENTS.md && echo "DB-FICHE-OK" && rm -rf dbtest`
Expected: prints `DB-FICHE-OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/project/orm/prisma/__agent.md.hbs apps/cli/templates/project/database/postgres/__agent.md.hbs apps/cli/templates/project/database/mysql/__agent.md.hbs
git commit -m "feat(agent-context): prisma, postgres, mysql fiches"
```

---

## Task 12: Library fiches (shadcn, trpc)

`better-auth` was created in Task 3. Add shadcn + trpc.

**Files:**
- Create: `apps/cli/templates/libraries/shadcn/__agent.md.hbs`
- Create: `apps/cli/templates/libraries/trpc/__agent.md.hbs`

- [ ] **Step 1: Create the shadcn fiche**

Create `apps/cli/templates/libraries/shadcn/__agent.md.hbs`:

```markdown
shadcn/ui components live in `src/components/ui/`. Config is in `components.json`. Add components with `bunx shadcn@latest add <name>`. Style tokens are defined in the global CSS, not hardcoded per component.
```

- [ ] **Step 2: Create the tRPC fiche**

Create `apps/cli/templates/libraries/trpc/__agent.md.hbs`:

```markdown
tRPC router is defined in `src/trpc/`. Add a procedure to a router, then call it from the client via the typed `trpc` hooks. Input validation uses the router's schema, not manual checks.
```

- [ ] **Step 3: Verify they render**

Run: `cd apps/cli && bun run src/index.ts libtest --app libtest:nextjs:shadcn,trpc --no-git --no-install && grep -q "## shadcn" libtest/AGENTS.md && grep -q "tRPC router" libtest/AGENTS.md && echo "LIB-FICHE-OK" && rm -rf libtest`
Expected: prints `LIB-FICHE-OK`. (Heading for shadcn comes from its META `label`.)

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/libraries/shadcn/__agent.md.hbs apps/cli/templates/libraries/trpc/__agent.md.hbs
git commit -m "feat(agent-context): shadcn and trpc fiches"
```

---

## Task 13: Blueprint Architecture + org-dashboard guides

**Files:**
- Modify: `apps/cli/src/__meta__.ts` (add `agentArchitecture` to `org-dashboard`)
- Create: `apps/cli/templates/blueprints/org-dashboard/docs/agents/auth.md.hbs`
- Create: `apps/cli/templates/blueprints/org-dashboard/docs/agents/data-layer.md.hbs`

- [ ] **Step 1: Add `agentArchitecture` to the org-dashboard blueprint**

In `apps/cli/src/__meta__.ts`, locate the `'org-dashboard'` entry under `blueprints`. Add an `agentArchitecture` field (alongside `label`/`hint`/`context`). Use the actual composition of that blueprint:

```typescript
    agentArchitecture: [
      'Organization dashboard: Next.js app with Better Auth (organizations + roles),',
      'tRPC for typed API calls, TanStack Query for client data, and Drizzle + PostgreSQL.',
      '',
      'Per-aspect detail in `docs/agents/`:',
      '- [Auth & permissions](docs/agents/auth.md)',
      '- [Data layer](docs/agents/data-layer.md)',
    ].join('\n'),
```

(If the blueprint's real composition differs, adjust the prose to match its `context.apps`/`context.project`. Read the entry first.)

- [ ] **Step 2: Create the auth guide**

Create `apps/cli/templates/blueprints/org-dashboard/docs/agents/auth.md.hbs`:

```markdown
---
path: docs/agents/auth.md
mono:
  scope: root
  path: docs/agents/auth.md
---
# Auth & Permissions

Better Auth is configured in `src/lib/auth/auth.ts` with the organization plugin.
Sessions are persisted in PostgreSQL via Drizzle (`user`, `account`, `session`, `organization`, `member` tables).

## Adding a protected route
1. Read the session server-side with the auth helper in `src/lib/auth/`.
2. Redirect unauthenticated users to the sign-in route.
3. For org-scoped pages, check the member's role before rendering.

## Roles
Roles (owner / admin / member) are defined on the organization plugin. Gate actions by role, not by user id.
```

- [ ] **Step 3: Create the data-layer guide**

Create `apps/cli/templates/blueprints/org-dashboard/docs/agents/data-layer.md.hbs`:

```markdown
---
path: docs/agents/data-layer.md
mono:
  scope: root
  path: docs/agents/data-layer.md
---
# Data Layer

Drizzle schema lives in the db package. tRPC procedures read and write through the Drizzle client; the client never touches the database directly.

## Flow
1. Client calls a typed `trpc` hook.
2. The procedure validates input via its schema.
3. The procedure queries Drizzle and returns typed data.
4. TanStack Query caches the result on the client.

## Adding a query
Add a procedure to the relevant tRPC router, then consume it with the generated hook. Keep DB access inside procedures.
```

- [ ] **Step 4: Verify the blueprint output**

Run: `cd apps/cli && bun run src/index.ts bp --blueprint org-dashboard --no-git --no-install && grep -q "## Architecture" bp/AGENTS.md && test -f bp/docs/agents/auth.md && test -f bp/docs/agents/data-layer.md && echo "BLUEPRINT-OK" && rm -rf bp`
Expected: prints `BLUEPRINT-OK`. (If `org-dashboard` is multi-app/turborepo, the `docs/agents/*.md` land at root via the `mono.scope: root` frontmatter.)

- [ ] **Step 5: Run the blueprint unit test**

Run: `cd apps/cli && bun test tests/unit/lib/agent-context-generator.test.ts -t blueprint`
Expected: PASS — the test now finds an annotated blueprint and asserts `## Architecture` is present.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/templates/blueprints/org-dashboard/docs/agents/auth.md.hbs apps/cli/templates/blueprints/org-dashboard/docs/agents/data-layer.md.hbs
git commit -m "feat(agent-context): org-dashboard architecture and guides"
```

---

## Task 14: Blueprint integration coverage

**Files:**
- Modify: `apps/cli/tests/integration/agent-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append a blueprint block to `apps/cli/tests/integration/agent-context.test.ts`:

```typescript
describe('agent context generation (blueprint)', () => {
  let bpDir: string;

  beforeAll(async () => {
    bpDir = await createTempDir();
    await runCli(['bp', '--blueprint', 'org-dashboard', '--no-git', '--no-install'], bpDir);
  });

  afterAll(async () => {
    await cleanupTempDir(bpDir);
  });

  test('blueprint AGENTS.md has an Architecture section', async () => {
    const content = await readTextFile(join(bpDir, 'bp', 'AGENTS.md'));
    expect(content).toContain('## Architecture');
  });

  test('blueprint ships docs/agents guides', async () => {
    expect(await fileExists(join(bpDir, 'bp', 'docs', 'agents', 'auth.md'))).toBe(true);
    expect(await fileExists(join(bpDir, 'bp', 'docs', 'agents', 'data-layer.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/cli && bun test tests/integration/agent-context.test.ts`
Expected: PASS — the custom block and the blueprint block both green (the implementation already exists; this task adds coverage).

- [ ] **Step 3: Commit**

```bash
git add apps/cli/tests/integration/agent-context.test.ts
git commit -m "test(agent-context): blueprint integration coverage"
```

---

## Task 15: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit + integration suite**

Run: `cd apps/cli && bun test`
Expected: PASS. Investigate and fix any failure before continuing — do not skip.

- [ ] **Step 2: Format and lint**

Run: `cd /home/ttecim/.lab/create-faster && bun run check`
Expected: No errors. Fix any reported issues.

- [ ] **Step 3: Type-check**

Run: `cd apps/cli && bunx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 4: Build the CLI**

Run: `cd /home/ttecim/.lab/create-faster && bun run build:cli`
Expected: Builds the single executable with no errors.

- [ ] **Step 5: Smoke-test a real generation**

Run: `cd apps/cli && bun run src/index.ts smoke --app web:nextjs:shadcn,better-auth --app api:hono --database postgres --orm drizzle --linter biome --no-git --no-install`
Then inspect:
- `smoke/AGENTS.md` (turborepo header + apps list, no Better Auth section at root)
- `smoke/apps/web/AGENTS.md` (Next.js preamble + `## Better Auth` + `## shadcn`)
- `smoke/apps/web/CLAUDE.md` == `@AGENTS.md`
- no `.agent.md` files anywhere: `find smoke -name '.agent.md'` returns nothing
Then clean up: `rm -rf smoke`

- [ ] **Step 6: Final commit (if any cleanup changes were made)**

```bash
git add -A
git status   # review before committing
git commit -m "chore(agent-context): verification cleanup"
```

(Skip this commit if Steps 1-5 required no changes.)

---

## Notes for the implementer

- **Handlebars whitespace** in the header templates (Task 9) is the most likely source of cosmetic issues (extra blank lines from `{{#each}}`/`{{#if}}` on their own lines). The render verification steps exist precisely to catch this — adjust template line placement, not the generator, when output looks off.
- **Fiches are content.** The prose provided is factual and create-faster-specific by design (no re-explaining the libraries). Tweak wording freely, but keep fiches short and never duplicate official library docs.
- **Graceful degradation is load-bearing:** an addon without a `__agent.md.hbs` must produce no section and no error. The `existsSync` guard in `renderFiche` handles this; don't replace it with a throwing read.
- **`agentContext !== false`** is the gate everywhere (undefined ⇒ enabled). Do not default the field to `true` in the context construction; the inequality check is intentional.
```
