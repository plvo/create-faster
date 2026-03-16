---
name: documenting-blueprint
description: Use when documenting blueprints in create-faster MDX docs - covers pre-composed starter projects with composition, architecture, application code, CLI usage, and extra dependencies
---

# Documenting Blueprint

## Overview

Document what create-faster generates for each blueprint. Focus on the composition, architecture, and application code — not on teaching each library.

**Core principle:** Document the COMPOSITION and what APPLICATION CODE is included. For individual libraries in the composition, link to their standalone module/stack pages.

## When to Use

Use when:
- Adding a new blueprint documentation page
- Updating existing blueprint docs after template changes
- Documenting newly created blueprints

Do NOT use for:
- Stack documentation (use `documenting-stack` skill)
- Module documentation (use `documenting-module` skill)
- Creating blueprints (use `adding-blueprints` skill)
- Database/ORM documentation (use `documenting-stack` skill)

## Architecture Context

**Where things live:**
- Blueprint metadata: `META.blueprints[name]` in `apps/cli/src/__meta__.ts`
- Blueprint templates: `apps/cli/apps/cli/templates/blueprints/{name}/`
- Composition stacks: `META.stacks[stackName]`
- Composition libraries: `META.libraries[libName]`
- Composition project addons: `META.project.{category}.options[name]`
- Documentation pages: `apps/www/content/docs/blueprints/{category}/{name}.mdx`

**Key concepts:**
- `context.apps[]` — what stacks and libraries are pre-selected
- `context.project` — what project addons are pre-selected (database, orm, deployment)
- `packageJson` — extra dependencies ONLY for the blueprint (not from composition)
- `envs` — extra env vars ONLY for the blueprint (not from composition)
- Blueprint templates **override** structural templates with the same destination path

**Package.json is programmatic.** Composition dependencies come from META stacks/libraries/addons. Blueprint `packageJson` only declares EXTRA dependencies.

**Env vars are programmatic.** Composition envs come from META libraries/addons. Blueprint `envs` only declares EXTRA env vars.

## Structure Template

```markdown
---
title: Blueprint Name
description: One-line description of the starter project (from META.blueprints[name].hint)
---

## Presentation

Brief description of the complete starter project (2-3 sentences). What does the user get?

## Composition

**Apps:**
- `appName` — Stack ([→ docs](/docs/stacks/stackname)) + modules ([→ module](/docs/modules/category/name), ...)

**Project addons:**
- Database: [→ PostgreSQL](/docs/database/postgresql)
- ORM: [→ Drizzle](/docs/orm/drizzle)
- Deployment: [→ SST](/docs/deployment/sst) (if applicable)

## Architecture

File tree of the blueprint-specific application code (only what the blueprint ADDS beyond structural templates):

\`\`\`
src/
├── app/
│   ├── page.tsx                # Description
│   └── (section)/
│       ├── layout.tsx          # Description
│       └── page.tsx            # Description
├── components/
│   └── component.tsx           # Description
└── lib/
    └── util.ts                 # Description
\`\`\`

For multi-app blueprints (turborepo), show per-app structure.

## What's included

Describe the key application features the blueprint provides. Keep it factual — what pages exist, what functionality they have. Use subsections if the blueprint has multiple significant features.

Code examples ONLY for blueprint-specific patterns (e.g., custom auth integration, special middleware). Do NOT show code for standard library setup — link to module docs instead.

## Extra dependencies

Only if `META.blueprints[name].packageJson` exists:

\`\`\`
package        version     purpose
recharts       ^2.15.0     Dashboard charts
\`\`\`

## Environment variables

Only if `META.blueprints[name].envs` exists:

- `VAR_NAME` - Purpose (scope: app/root/pkg)

## CLI usage

\`\`\`bash
bunx create-faster myproject --blueprint {name} --linter biome --git --pm bun
\`\`\`
```

## Documentation Workflow

### Step 1: Analyze META for Blueprint Metadata

**CRITICAL: META is the source of truth for composition, dependencies, and env vars.**

```bash
# Check blueprint metadata in META
grep -A 40 "'{blueprintname}'" apps/cli/src/__meta__.ts

# Check composition: apps, stacks, libraries
grep -A 20 "context:" apps/cli/src/__meta__.ts | grep -A 15 "'{blueprintname}'"

# Check extra dependencies
grep -A 10 "packageJson:" apps/cli/src/__meta__.ts | grep -A 8 "'{blueprintname}'"

# Check extra env vars
grep -A 10 "envs:" apps/cli/src/__meta__.ts | grep -A 8 "'{blueprintname}'"
```

### Step 2: Analyze Blueprint Template Files

```bash
# List all blueprint template files
find apps/cli/templates/blueprints/{blueprintname}/ -name "*.hbs" | sort

# Check for frontmatter (path/scope overrides)
grep -l '^---' apps/cli/templates/blueprints/{blueprintname}/**/*.hbs

# Check for stack-specific templates
ls apps/cli/templates/blueprints/{blueprintname}/**/*.*.hbs

# Check for mono/single filtering
grep 'only:' apps/cli/templates/blueprints/{blueprintname}/**/*.hbs
```

Document EXACTLY what files the blueprint adds. Cross-reference every claim with actual template files.

### Step 3: Identify Overrides vs Additions

For each blueprint template file, determine:
1. **Override** — replaces a structural template (same destination path as a stack/library template)
2. **Addition** — new file not present in structural templates

Only document the blueprint-specific files. Don't document structural templates that pass through unchanged.

### Step 4: Structure Document

**Frontmatter (YAML):**
- `title`: Blueprint display name (from `META.blueprints[name].label`)
- `description`: From `META.blueprints[name].hint`

**CRITICAL - Don't add `# Title`:**
Title in frontmatter already renders as H1. Adding `# Title` creates duplicate.

**Document structure:**
1. `## Presentation` — what the user gets (complete starter project description)
2. `## Composition` — stacks, libraries, project addons with links to their doc pages
3. `## Architecture` — file tree of blueprint-specific files
4. `## What's included` — application features and key code patterns
5. `## Extra dependencies` — only blueprint-specific extras from META
6. `## Environment variables` — only blueprint-specific extras from META
7. `## CLI usage` — example command

### Step 5: Focus on Blueprint-Specific Content

**DO document:**
- The complete starter project description (what you get)
- Full composition with links to individual stack/module/addon pages
- Blueprint template files (verified in `apps/cli/templates/blueprints/{name}/`)
- Application features (pages, layouts, components, routes)
- Key code patterns unique to the blueprint (custom auth flows, special middleware)
- Extra dependencies from `META.blueprints[name].packageJson`
- Extra env vars from `META.blueprints[name].envs`
- Multi-app architecture (for turborepo blueprints)
- CI/CD workflows (if included in blueprint templates)

**DON'T document:**
- How individual libraries work (link to module docs)
- How the stack works (link to stack docs)
- How the ORM/database works (link to their docs)
- Standard library setup code (shadcn components, tRPC init, etc.)
- Dependencies that come from the composition (they're in the library/stack META)
- Env vars that come from the composition (they're in the library/addon META)
- Structural template files that pass through unchanged

### Step 6: Verify Every Claim

**MANDATORY verification before publishing:**

```bash
# Verify composition matches META
grep -A 30 "'{blueprintname}'" apps/cli/src/__meta__.ts

# Verify template files exist
find apps/cli/templates/blueprints/{blueprintname}/ -name "*.hbs" | sort

# Verify extra dependencies are in blueprint META (not composition META)
grep -A 10 "packageJson:" apps/cli/src/__meta__.ts | grep -A 8 "'{blueprintname}'"

# Verify extra envs are in blueprint META (not composition META)
grep -A 10 "envs:" apps/cli/src/__meta__.ts | grep -A 8 "'{blueprintname}'"

# Verify apps in composition
grep -A 15 "context:" apps/cli/src/__meta__.ts | grep -A 10 "'{blueprintname}'"
```

Every composition element, file reference, dependency, and env var MUST be verified against the codebase.

## Fumadocs Page Placement

Blueprint pages live under `apps/www/content/docs/blueprints/{category}/`:

```
content/docs/blueprints/
├── meta.json              # Root folder config listing categories
├── business/
│   ├── meta.json          # { "title": "Business" }
│   └── dashboard.mdx
├── web3/
│   ├── meta.json          # { "title": "Web3" }
│   ├── dapp-privy.mdx
│   └── dapp-rainbowkit.mdx
└── aws/
    ├── meta.json          # { "title": "AWS" }
    ├── lambda-sst.mdx
    └── lambda-terraform-aws.mdx
```

Each category is a subdirectory with its own `meta.json` (like modules). The root `meta.json` lists categories:

```json
{
  "title": "Blueprints",
  "pages": ["business", "web3", "aws"]
}
```

The root docs `meta.json` loads the blueprints folder:
```json
"---BLUEPRINTS---",
"...blueprints"
```

## RED FLAGS - You're Documenting Wrong

**STOP if you write:**
- `# Blueprint Name` title (title in frontmatter already renders as H1)
- How to use shadcn/better-auth/drizzle (link to their module docs)
- Standard library setup code (that's module documentation, not blueprint)
- Composition dependencies listed as "blueprint dependencies" (only extras go in blueprint docs)
- Composition envs listed as "blueprint env vars" (only extras go in blueprint docs)
- Missing composition section (REQUIRED — it's the blueprint's defining characteristic)
- No links to individual stack/module/addon pages

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Explaining library features | Link to module docs, focus on blueprint application code |
| Listing composition deps as extras | Only `META.blueprints[name].packageJson` goes in extra deps |
| Listing composition envs as extras | Only `META.blueprints[name].envs` goes in extra env vars |
| Missing composition section | REQUIRED: list all stacks, libraries, project addons with links |
| No file tree | Show blueprint-specific files with tree structure |
| Documenting structural templates | Only document what the BLUEPRINT adds/overrides |
| Missing CLI usage | Show `--blueprint {name}` example command |
| Unverified template files | Check `apps/cli/templates/blueprints/{name}/` |
| Missing multi-app architecture | Turborepo blueprints need per-app structure |

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Need to explain what shadcn does" | Module docs exist. Link to them. |
| "Should show tRPC setup" | Module docs cover that. Blueprint docs cover application code. |
| "All dependencies should be listed" | Only blueprint-specific extras. Composition deps are in their own META entries. |
| "Should explain how better-auth works" | Link to `/docs/modules/auth/better-auth`. Focus on blueprint-specific auth patterns. |
| "The file tree should show everything" | Only blueprint-specific files. Structural templates are documented elsewhere. |
| "I saw this dependency in the generated output" | Verify it's in `META.blueprints[name].packageJson`, not coming from composition. |
| "Users need the full picture" | Composition links + blueprint specifics IS the full picture. Don't duplicate. |

## Template Checklist

**Frontmatter:**
- [ ] `title:` in YAML (don't add `# Title` after)
- [ ] `description:` from META hint or similar one-liner

**Document:**
- [ ] `## Presentation` — what the user gets
- [ ] `## Composition` — all stacks, libraries, project addons with doc links
- [ ] `## Architecture` — file tree of blueprint-specific files only
- [ ] `## What's included` — application features
- [ ] `## Extra dependencies` — ONLY from `META.blueprints[name].packageJson`
- [ ] `## Environment variables` — ONLY from `META.blueprints[name].envs`
- [ ] `## CLI usage` — `--blueprint {name}` example
- [ ] Code examples limited to blueprint-specific patterns
- [ ] Links to stack/module/addon pages for composition elements
- [ ] Multi-app structure shown for turborepo blueprints

**Verification (MANDATORY):**
- [ ] Composition verified in `META.blueprints[name].context`
- [ ] Every template file verified in `apps/cli/templates/blueprints/{name}/`
- [ ] Extra deps verified in `META.blueprints[name].packageJson`
- [ ] Extra envs verified in `META.blueprints[name].envs`
- [ ] Blueprint category verified in `META.blueprints[name].category`
- [ ] Overrides vs additions correctly identified
