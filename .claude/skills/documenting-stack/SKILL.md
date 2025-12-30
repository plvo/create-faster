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

## RED FLAGS - You're Documenting Wrong

**STOP if you write:**
- `# Stack Name` title (title in frontmatter already renders as H1)
- Changed description style (keep original framework presentation)
- Categorized module sections ("UI & Styling", "Data Fetching")
- "Why use X?" explanations (that's official docs' job)
- Generic framework features (link to docs instead)
- Framework-agnostic options as stack features (Biome, git, etc.)
- Optional features presented as defaults (Turbopack is optional, not default)
- Default framework configs everyone uses (TypeScript strict, etc.)
- Module descriptions without technical changes
- Bullet lists of dependencies without file structure

**These mean:** Refocus on what create-faster adds, not what the framework does.

## Documentation Workflow

### Step 1: Analyze Templates

**CRITICAL: Templates are the source of truth. Verify every file reference.**

```bash
# Find all template files for stack
ls -la apps/cli/templates/stack/{stackname}/

# Check modules (not all stacks have modules directories)
ls -la apps/cli/templates/modules/{framework}/

# Verify specific files mentioned in docs
find apps/cli/templates -name "filename.hbs"

# Check package.json for scripts
grep "script-name" apps/cli/templates/stack/{stackname}/package.json.hbs
```

Document EXACTLY what files we create/modify. Cross-reference every claim with actual template files.

### Step 2: Structure Document

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

### Step 3: Focus on Technical Changes

**DO document:**
- Files we create (verifiable in `apps/cli/templates/`)
  - Example: `apps/cli/templates/modules/nextjs/shadcn/src/lib/utils.ts.hbs`
  - Example: `apps/cli/templates/stack/nextjs/src/hooks/use-mobile.ts.hbs`
- Files we modify (verifiable in `apps/cli/templates/`)
  - Example: `apps/cli/templates/stack/nextjs/next.config.ts.hbs` (MDX support)
- Custom utilities (functions in template files)
  - Example: `cn()` function in utils.ts
  - Example: `useIsMobile()` hook in use-mobile.ts
- Custom scripts with clear purpose (in package.json templates)
  - Example: `build:analyze` in `apps/cli/templates/stack/nextjs/package.json.hbs`
  - Example: `start:inspect` in `apps/cli/templates/stack/nextjs/package.json.hbs`
- Turborepo package structure (conditional based on repo type)
- Integration configs (ORM adapters, database providers)

**DON'T document:**
- What the framework/module does (official docs)
- Generic "benefits" or "why use"
- Basic usage examples (they have tutorials)
- Framework-agnostic options (Biome, git - user chooses)
- Optional features as defaults (Turbopack is optional)
- Standard configs everyone uses (TypeScript strict)

### Step 4: Mini Configs Emphasis

**Highlight create-faster value:**
- Pre-configured optimizations
- Utilities you'd repeatedly create
- Scripts that speed up dev workflow
- Patterns to avoid repetition

**Example:**
```markdown
**Development Scripts:**
- `build:analyze` - Bundle size analysis with @next/bundle-analyzer
- `start:inspect` - Debug mode with Node inspector

*Why these?* Common debugging/optimization tasks made one command.
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Categorizing modules | Flat list with ### Module Name |
| Explaining framework features | Link to official docs, focus on our additions |
| No file structure | Show tree with files created |
| Missing "What we add" | Required section at top |
| Verbose descriptions | Technical changes only |
| No official doc link | MANDATORY at top |

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
| "Turbopack is default" | It's optional. Don't claim as default. |
| "TypeScript strict is our addition" | Everyone uses strict. Not worth mentioning. |
| "Tree structure is extra work" | Shows exactly what we create. Essential. |
| "Integration notes aren't needed" | ORM/database combos need explanation. |

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
- [ ] Modules section (flat, no categories like "UI & Styling")
- [ ] Each module has link to official docs
- [ ] Each module shows files added/modified with tree structure
- [ ] Technical changes focus on OUR additions
- [ ] Turborepo differences noted where applicable
- [ ] Integration notes for ORM/database modules
- [ ] No "Why use X?" sections
- [ ] No framework feature explanations

**Verification (MANDATORY):**
- [ ] Every file reference verified in `apps/cli/templates/`
- [ ] Every script reference verified in package.json.hbs
- [ ] Every utility function verified in template source
- [ ] Error page references checked against actual templates
- [ ] Module structure verified (some use inline conditionals, not separate files)

## Real-World Impact

**Without this skill:**
- 20 minutes → Verbose doc mixing framework features + our additions
- Categories make finding modules harder
- Missing technical details about files created
- No clarity on what create-faster actually adds

**With this skill:**
- 10 minutes → Clean doc focused on technical changes
- Flat module list, easy to scan
- Clear file structures showing our additions
- Highlights mini configs and optimizations
