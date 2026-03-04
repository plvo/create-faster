# Blueprints Feature Design

## Problem

create-faster currently scaffolds project **structure** (configs, deps, base files). Users who want a **functional starting point** (e.g., a CRM dashboard with auth, sidebar, pages) must manually build all the application code after scaffolding.

## Solution

Add "blueprints" — pre-composed project templates that combine META stacks/libs/addons with **application code**. A blueprint = a fixed `TemplateContext` + additional Handlebars template files for business logic.

## Decisions

- **Exclusive + light options**: Blueprint fixes the tech composition. User only chooses project name, git, and package manager.
- **Embedded in CLI**: Blueprints ship with the package. No remote fetching.
- **Blueprint imposes everything**: App names, stacks, libs, and project addons are defined by the blueprint. No customization of the tech stack.
- **V1 scope**: One blueprint (Dashboard) to validate the architecture.
- **UX entry point**: After project name prompt — "Start from scratch or use a template?"

## Architecture

### Approach: Blueprint as TemplateContext preset

A blueprint is a function that returns a pre-filled `TemplateContext`. The existing pipeline (template resolution, file generation, package.json, env) is **unchanged**. Blueprint-specific code files are added as an extra step in template resolution.

### Why this approach

- Reuses 100% of the existing pipeline
- Blueprints inherit META version bumps automatically
- Minimal new code — just metadata + template files
- Easy to test: a blueprint = a fixed context

## Metadata

New `blueprints` section in `META`:

```typescript
blueprints: {
  dashboard: {
    label: 'Dashboard',
    hint: 'Internal CRM-style dashboard with auth, sidebar, and admin panel',
    context: {
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['shadcn', 'better-auth', 'tanstack-query'] },
      ],
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
    },
    packageJson: {
      dependencies: { recharts: '^2.15.0' },
    },
    envs: [
      { value: 'ADMIN_EMAIL=admin@example.com', monoScope: ['app'] },
    ],
  },
}
```

Fields:
- `label` / `hint` — display in prompt
- `context` — pre-filled apps + project (everything except projectName, git, pm, repo)
- `packageJson` — additional deps merged into app package.json
- `envs` — additional env vars added to .env.example

## CLI Flow

### Interactive

```
1. Parse CLI flags
2. ASCII intro
3. Prompt: project name
4. NEW — Prompt: "What would you like to create?"
   ├─ "Start from scratch" → existing cli() flow
   └─ "Use a template" → select blueprint → prompt git → prompt pm
5. Template resolution (with blueprint files injected)
6. File generation
7. Post-generation (install, git)
8. Summary + CLI command
```

### Non-Interactive

New flag `--blueprint <name>`:
```bash
bunx create-faster myapp --blueprint dashboard --git --pm bun
```

`--blueprint` is mutually exclusive with `--app`, `--database`, `--orm`, `--linter`, `--tooling`.

## Template Resolution

Existing steps:
1. Repo templates
2. Stack templates (per app)
3. Library templates (per app)
4. Project addon templates

New step 5:
```
5. Blueprint templates (if ctx.blueprint is set)
   → Scan templates/blueprints/{blueprintName}/
   → Same path resolution (frontmatter, scope, stack suffix)
   → Added AFTER structural files
   → Same destination = blueprint overrides structural file
```

Override behavior: if a blueprint file has the same resolved destination as a structural file, the blueprint version wins. This lets a Dashboard template replace the default `page.tsx` with its own.

### Blueprint template directory

```
templates/blueprints/dashboard/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx.hbs
│   │   └── register/page.tsx.hbs
│   ├── (dashboard)/
│   │   ├── layout.tsx.hbs
│   │   ├── page.tsx.hbs
│   │   └── settings/page.tsx.hbs
│   └── page.tsx.hbs
├── components/
│   ├── sidebar.tsx.hbs
│   ├── header.tsx.hbs
│   └── user-nav.tsx.hbs
└── lib/
    └── admin.ts.hbs
```

## Type Changes

```typescript
// types/meta.ts
interface MetaBlueprint {
  label: string;
  hint: string;
  context: {
    apps: AppContext[];
    project: ProjectContext;
  };
  packageJson?: Partial<PackageJson>;
  envs?: EnvVar[];
}

// Extend Meta
interface Meta {
  // ... existing fields
  blueprints: Record<string, MetaBlueprint>;
}
```

```typescript
// types/ctx.ts
interface TemplateContext {
  // ... existing fields
  blueprint?: string;  // blueprint name or undefined if custom
}
```

## Files Impacted

| File | Change |
|---|---|
| `types/meta.ts` | Add `MetaBlueprint`, extend `Meta` |
| `types/ctx.ts` | Add `blueprint?` to `TemplateContext` |
| `__meta__.ts` | Add `blueprints` section with dashboard definition |
| `index.ts` | Add "template vs custom" prompt before `cli()` |
| `flags.ts` | Add `--blueprint` flag, mutual exclusion validation |
| `cli.ts` | Extract logic so blueprint flow bypasses custom flow |
| `lib/template-resolver.ts` | Add step 5: blueprint template resolution |
| `lib/package-json-generator.ts` | Merge blueprint deps into package.json |
| `lib/env-generator.ts` | Collect blueprint envs |
| `lib/schema.ts` | Add Zod validation for blueprint |
| `tui/summary.ts` | Show `--blueprint` in auto-generated CLI command |
| `templates/blueprints/dashboard/` | All Handlebars files for Dashboard template |

**Unchanged**: template-processor.ts, file-writer.ts, frontmatter.ts, handlebars.ts, post-generation.ts

## Testing Strategy

- Unit test: blueprint context generation produces valid TemplateContext
- Unit test: template resolver includes blueprint files and handles overrides
- Unit test: `--blueprint` flag parsing and mutual exclusion validation
- E2E test: generate a project with `--blueprint dashboard` and verify output
