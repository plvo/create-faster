---
name: documenting-module
description: Use when documenting modules (libraries/addons) in create-faster MDX docs - covers standalone module pages with supported stacks, dependencies, env vars, and file structures
---

# Documenting Module

## Overview

Document what create-faster configures for each module. Focus on technical changes, not library features.

**Core principle:** Document OUR additions, link to THEIR docs. Each module gets its own standalone page.

## When to Use

Use when:
- Adding a new module documentation page
- Updating existing module docs after template changes
- Extracting module docs from stack pages into standalone pages

Do NOT use for:
- Stack documentation (use `documenting-stack` skill)
- Database/ORM documentation (use `documenting-stack` skill)
- General library tutorials (link to official docs)

## Architecture Context

**Where things live:**
- Module metadata: `META.libraries[name]` in `apps/cli/src/__meta__.ts`
- Module templates: `apps/cli/templates/libraries/{library}/`
- Documentation pages: `apps/www/content/docs/modules/{category}/{module}.mdx`
- Dependencies/scripts: `META.libraries[name].packageJson` (NOT in templates)
- Env vars: `META.libraries[name].envs` (NOT in templates)
- Supported stacks: `META.libraries[name].support.stacks`
- Requirements: `META.libraries[name].require`
- Monorepo scope: `META.libraries[name].mono`

**Package.json is programmatic.** Dependencies are declared in META, not in template files.

**Env vars are programmatic.** Check `envs` fields in META, not template files.

## Structure Template

```markdown
---
title: Module Name
description: One-line description of what create-faster sets up for this module
---

## Presentation

Brief description of what you get (1-2 sentences).

[→ Official Documentation](https://...)

**Supported stacks:** Next.js, TanStack Start (list from META.support.stacks)

**Requirements:** ORM (Drizzle or Prisma) — only if META.require exists

## What create-faster adds

**Technical changes:**

Files added:
\`\`\`
src/
├── path/to/
│   └── file.tsx        # Description
└── config.json         # Description

# Turborepo only:
packages/name/
└── package.json        # Description
\`\`\`

**Modified files:**
- `file.tsx` - What changed and why

**Dependencies:**
- List from META.libraries[name].packageJson.dependencies
- List from META.libraries[name].packageJson.devDependencies (as dev deps)

**Environment variables:** (only if META.libraries[name].envs exists)
- `VAR_NAME` - Purpose and scope

**Turborepo mode:**
How it behaves differently in monorepo (package name, imports, scope).

**Integration notes:**
How it works with ORM/database/other modules (only if relevant).
```

## Documentation Workflow

### Step 1: Analyze META for Module Metadata

**CRITICAL: META is the source of truth for dependencies, env vars, and support.**

```bash
# Check module metadata in META
grep -A 30 "'modulename'" apps/cli/src/__meta__.ts

# Check supported stacks
grep -B 2 -A 5 "'modulename'" apps/cli/src/__meta__.ts | grep support

# Check requirements
grep -A 3 "'modulename'" apps/cli/src/__meta__.ts | grep require

# Check mono config
grep -A 3 "'modulename'" apps/cli/src/__meta__.ts | grep mono

# Check env vars
grep -A 10 "'modulename'" apps/cli/src/__meta__.ts | grep -A 5 envs
```

### Step 2: Analyze Template Files

```bash
# Find all template files for module
ls -la apps/cli/templates/libraries/{modulename}/

# Check for frontmatter (only/mono filters)
grep -l '^---' apps/cli/templates/libraries/{modulename}/*.hbs
head -5 apps/cli/templates/libraries/{modulename}/*.hbs

# Check for stack-specific templates (.nextjs.hbs, .expo.hbs)
ls apps/cli/templates/libraries/{modulename}/*.*.hbs
```

Document EXACTLY what files we create/modify. Cross-reference every claim with actual template files AND META.

### Step 3: Structure Document

**Frontmatter (YAML):**
- `title`: Module display name (from META.libraries[name].label)
- `description`: What create-faster sets up (NOT what the library does)

**CRITICAL - Don't add `# Title`:**
Title in frontmatter already renders as H1. Adding `# Title` creates duplicate.

**Document structure:**
1. `## Presentation` - Brief description + link to official docs
2. Supported stacks list
3. Requirements (if any)
4. `## What create-faster adds` - Technical changes

### Step 4: Focus on Technical Changes

**DO document:**
- Files we create (verifiable in `apps/cli/templates/libraries/`)
- Files we modify (verifiable in templates with conditionals)
- Dependencies from META `packageJson.dependencies`
- Dev dependencies from META `packageJson.devDependencies`
- Env vars from META `envs` fields (with scope)
- Turborepo vs single repo differences (check `mono` config and frontmatter `only` filters)
- `appPackageJson` dependencies (installed in the app, not the module package)
- `exports` from META `packageJson.exports` (package entry points)

**DON'T document:**
- What the library does (official docs)
- Generic "benefits" or "why use"
- Basic usage examples (they have tutorials)
- Dependencies not in META (verify!)
- Configuration that comes from the library itself, not our templates

### Step 5: Verify Every Claim

**MANDATORY verification before publishing:**

```bash
# Verify dependencies exist in META
grep "'modulename'" -A 30 apps/cli/src/__meta__.ts | grep -A 10 packageJson

# Verify template files exist
ls apps/cli/templates/libraries/{modulename}/

# Verify supported stacks
grep "'modulename'" -A 10 apps/cli/src/__meta__.ts | grep stacks

# Verify env vars
grep "'modulename'" -A 20 apps/cli/src/__meta__.ts | grep -A 5 envs
```

Every dependency, env var, and file reference MUST be verified against the codebase.

## Fumadocs Page Placement

Module pages live under `apps/www/content/docs/modules/{category}/`:

```
content/docs/modules/
├── meta.json              # Folder config
├── ui/
│   ├── meta.json
│   ├── shadcn.mdx
│   ├── next-themes.mdx
│   └── nativewind.mdx
├── content/
│   ├── meta.json
│   ├── mdx.mdx
│   └── pwa.mdx
├── auth/
│   ├── meta.json
│   └── better-auth.mdx
├── api/
│   ├── meta.json
│   └── trpc.mdx
├── data-fetching/
│   ├── meta.json
│   ├── tanstack-query.mdx
│   └── tanstack-devtools.mdx
├── forms/
│   ├── meta.json
│   ├── react-hook-form.mdx
│   └── tanstack-form.mdx
└── deploy/
    ├── meta.json
    └── aws-lambda.mdx
```

Each `meta.json` sets the folder title for the sidebar:
```json
{
  "title": "Category Name"
}
```

Categories match `META.libraries[name].category` values.

## RED FLAGS - You're Documenting Wrong

**STOP if you write:**
- `# Module Name` title (title in frontmatter already renders as H1)
- "Why use X?" explanations (that's official docs' job)
- Generic library features (link to docs instead)
- Dependencies not verified in META
- Missing supported stacks list
- Module page inside a stack folder (modules are standalone)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Explaining library features | Link to official docs, focus on our additions |
| No file structure | Show tree with files created |
| Missing supported stacks | Check META.libraries[name].support.stacks |
| Unverified dependencies | Check `META.libraries[name].packageJson` |
| Missing turborepo differences | Check META `mono` config and frontmatter `only` filters |
| Putting module page in stack folder | Module pages go in `modules/{category}/` |
| Forgetting appPackageJson | Some modules install deps in the app too (e.g., tRPC) |

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Need to explain what the library does" | Official docs exist. Link to them. |
| "Users need usage examples" | Official docs have tutorials. We document setup. |
| "Dependencies are obvious" | Verify against META. Old docs had errors. |
| "Single file, no tree needed" | Even one file gets a tree for consistency. |
| "Turborepo mode is the same" | Check mono config. Package creation differs. |

## Template Checklist

**Frontmatter:**
- [ ] `title:` in YAML (don't add `# Title` after)
- [ ] `description:` describes what create-faster sets up

**Document:**
- [ ] `## Presentation` with brief description
- [ ] Link to official documentation (→ syntax, MANDATORY)
- [ ] Supported stacks listed
- [ ] Requirements listed (if any from META.require)
- [ ] `## What create-faster adds` section
- [ ] Files added with tree structure
- [ ] Modified files listed
- [ ] Dependencies from META
- [ ] Env vars from META (if any)
- [ ] Turborepo differences noted
- [ ] Integration notes (if applicable)

**Verification (MANDATORY):**
- [ ] Every dependency verified in `META.libraries[name].packageJson`
- [ ] Every file reference verified in `apps/cli/templates/libraries/`
- [ ] Supported stacks verified in `META.libraries[name].support`
- [ ] Env vars verified in META `envs` fields
- [ ] Requirements verified in META `require` fields
- [ ] Monorepo scope verified in META `mono` config
