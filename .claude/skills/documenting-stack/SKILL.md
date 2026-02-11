---
name: documenting-stack
description: Use when documenting stacks, databases, or ORMs in create-faster MDX docs - focuses on technical changes and what we add beyond official setup
---

# Documenting Stack

## Overview

Document what create-faster adds beyond official framework setup. Focus on technical changes, not framework features.

**Core principle:** Document OUR additions, link to THEIR docs.

## When to Use

Use when:
- Adding new stack documentation (Next.js, Expo, TanStack Start, Hono)
- Documenting database/ORM integration (Drizzle, Prisma, PostgreSQL, MySQL)
- Updating existing stack docs after template changes

Do NOT use for:
- Project-specific documentation
- General framework tutorials (link to official docs)
- Module documentation (separate workflow)

## Architecture Context

**Where things live:**
- Stack templates: `templates/stack/{framework}/`
- Library templates: `templates/libraries/{library}/`
- Project addon templates: `templates/project/{category}/{name}/`
- Dependencies/scripts: `META.stacks[name].packageJson` in `__meta__.ts` (NOT in templates)
- Env vars: `META.libraries[name].envs` and `META.project.*.options.*.envs` (NOT in templates)
- Library compatibility: `META.libraries[name].support.stacks`
- Documentation site: `apps/www/content/docs/`

**Package.json is programmatic.** Scripts and dependencies are declared in META, not in template files. To verify what a stack provides, check `META.stacks[name].packageJson` in `__meta__.ts`.

**Env vars are programmatic.** Check `envs` fields in META addons, not template files.

## Structure Template

```markdown
---
title: Stack Name
description: Keep original style - framework presentation (don't change)
---

## Presentation

Brief explicit description of what you get as result (Full-stack X framework...).

[→ Official Documentation](https://...)

## What create-faster adds

Beyond the official setup, we include:

**Project Structure:**
- Pre-configured error pages
- Custom utilities directory
- Optimized layouts

**Development Scripts:**
- Custom scripts with purpose (build:analyze - Bundle analysis)
- Debug helpers (start:inspect - Node inspector)

**DO NOT include:**
- Framework-agnostic options (Biome, git, etc.)
- Default framework features (TypeScript, build tools)
- Optional features as if they're default

## Modules

### Module Name

*[→ Module Documentation](https://...)*

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

**Integration notes:**
- How it works with ORM/database/etc.
- Turborepo vs single repo differences
```

## Documentation Workflow

### Step 1: Analyze META for Dependencies and Scripts

**CRITICAL: META is the source of truth for dependencies and scripts, not template files.**

```bash
# Check META for stack's packageJson
grep -A 30 "'stackname'" apps/cli/src/__meta__.ts

# Check what libraries support this stack
grep -B 2 -A 5 "stacks:.*'stackname'" apps/cli/src/__meta__.ts
# Also check for stacks: 'all' (available to every stack)
grep -A 2 "stacks: 'all'" apps/cli/src/__meta__.ts
```

### Step 2: Analyze Template Files

```bash
# Find all template files for stack
ls -la apps/cli/templates/stack/{stackname}/

# Check library templates
ls -la apps/cli/templates/libraries/

# Verify specific files mentioned in docs
find apps/cli/templates -name "filename.hbs"

# Check for frontmatter (only/mono filters)
grep -l '^---' apps/cli/templates/stack/{stackname}/*.hbs
head -5 apps/cli/templates/stack/{stackname}/*.hbs
```

Document EXACTLY what files we create/modify. Cross-reference every claim with actual template files AND META.

### Step 3: Structure Document

**Frontmatter (YAML):**
- `title`: Stack name
- `description`: Keep original style - framework presentation (DON'T change)

**Document structure:**
1. Brief explicit description (what you get as result)
2. Link to official docs (MANDATORY, `→` syntax)
3. "What create-faster adds" section
4. Modules (flat list, no categories)

**CRITICAL - Don't add `# Title`:**
Title in frontmatter already renders as H1. Adding `# Title` creates duplicate.

**For each module:**
1. Title (### Module Name)
2. Link to module docs
3. Technical changes (files added/modified)
4. Tree structure showing files
5. Integration notes if applicable

### Step 4: Focus on Technical Changes

**DO document:**
- Files we create (verifiable in `apps/cli/templates/`)
- Files we modify (verifiable in templates with conditionals)
- Custom utilities (functions in template files)
- Scripts from META `packageJson.scripts` (with their purpose)
- Dependencies from META `packageJson.dependencies`
- Turborepo vs single repo differences (check frontmatter `only: mono` filters)
- Env vars from META `envs` fields (with scope resolution)

**DON'T document:**
- What the framework/module does (official docs)
- Generic "benefits" or "why use"
- Basic usage examples (they have tutorials)
- Framework-agnostic options (Biome, git - user chooses)
- Optional features as defaults
- Standard configs everyone uses (TypeScript strict)
- Dependencies not in META (verify!)
- Scripts not in META (verify!)

### Step 5: Verify Every Claim

**MANDATORY verification before publishing:**

```bash
# Verify scripts exist in META
grep "scripts:" -A 10 apps/cli/src/__meta__.ts | grep stackname

# Verify dependencies exist in META
grep "dependencies:" -A 10 apps/cli/src/__meta__.ts | grep stackname

# Verify template files exist
ls apps/cli/templates/stack/{stackname}/

# Verify library compatibility
grep "'stackname'" apps/cli/src/__meta__.ts
```

Every script, dependency, and file reference MUST be verified against the codebase. Existing docs have had factual errors (wrong script commands, nonexistent dependencies).

## RED FLAGS - You're Documenting Wrong

**STOP if you write:**
- `# Stack Name` title (title in frontmatter already renders as H1)
- Changed description style (keep original framework presentation)
- Categorized module sections ("UI & Styling", "Data Fetching")
- "Why use X?" explanations (that's official docs' job)
- Generic framework features (link to docs instead)
- Framework-agnostic options as stack features (Biome, git, etc.)
- Optional features presented as defaults
- Default framework configs everyone uses (TypeScript strict, etc.)
- Dependencies not verified in META (e.g., claiming `@hono/zod-validator` when it's not in META)
- Scripts not verified in META (e.g., claiming `build` script when only `dev` and `start` exist)

**These mean:** Refocus on what create-faster adds, not what the framework does. And VERIFY against code.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Categorizing modules | Flat list with ### Module Name |
| Explaining framework features | Link to official docs, focus on our additions |
| No file structure | Show tree with files created |
| Missing "What we add" | Required section at top |
| Verbose descriptions | Technical changes only |
| No official doc link | MANDATORY at top |
| Unverified dependencies | Check `META.stacks[name].packageJson` |
| Unverified scripts | Check `META.stacks[name].packageJson.scripts` |
| Checking package.json.hbs | Package.json is programmatic, check META instead |

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Need H1 title for clarity" | Frontmatter title renders as H1. Don't duplicate. |
| "Better description style" | Keep original framework presentation style. |
| "Categories help organization" | Flat structure is clearer, user can Ctrl+F |
| "Need context about framework" | Official docs exist. Link to them. |
| "More detail is better" | Technical changes only. Avoid bloat. |
| "Should explain benefits" | Features = official docs. Our additions = us. |
| "Biome/git are part of stack" | Framework-agnostic options. Not stack-specific. |
| "I saw it in the old docs" | Old docs had errors. Verify against META and templates. |
| "The package.json template has it" | There IS no package.json template. It's programmatic from META. |

## Template Checklist

**Frontmatter:**
- [ ] `title:` in YAML (don't add `# Title` after)
- [ ] `description:` keeps original framework presentation style

**Document:**
- [ ] `## Presentation` section added after frontmatter
- [ ] Brief explicit description (what you get as result)
- [ ] Link to official documentation (→ syntax, MANDATORY)
- [ ] "What create-faster adds" section
- [ ] NO framework-agnostic options (Biome, git, etc.)
- [ ] NO optional features claimed as defaults
- [ ] NO standard configs everyone uses
- [ ] Modules section (flat, no categories)
- [ ] Each module has link to official docs
- [ ] Each module shows files added/modified with tree structure
- [ ] Technical changes focus on OUR additions
- [ ] Turborepo differences noted where applicable
- [ ] Integration notes for ORM/database modules

**Verification (MANDATORY):**
- [ ] Every script verified in `META.stacks[name].packageJson.scripts`
- [ ] Every dependency verified in `META.stacks[name].packageJson.dependencies`
- [ ] Every file reference verified in `apps/cli/templates/`
- [ ] Library compatibility verified in `META.libraries[name].support`
- [ ] Env vars verified in META `envs` fields (if documented)
- [ ] Frontmatter filters checked (e.g., `only: mono` means turborepo-only)
