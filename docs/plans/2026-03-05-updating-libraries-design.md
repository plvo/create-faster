# Updating Libraries Skill — Design

## Purpose

Guide Claude through safely updating library and project addon versions in create-faster, with emphasis on catching breaking changes before they reach generated projects.

## Scope

- **In scope**: `META.libraries` (better-auth, shadcn, trpc, etc.) and `META.project` addons (drizzle, prisma, biome, eslint, etc.)
- **Out of scope**: Stack framework updates (Next.js, Expo, Hono) — different beast, different skill
- **Strictly one library/addon per invocation**, atomic commits

## Skill Type

Technique (rigid, follow exactly).

## Workflow — 5 Phases

### Phase 1 — Research

- Use `context7` MCP to resolve the library and fetch latest docs
- Fetch the changelog/migration guide via web
- Output: version delta, breaking changes list, new/removed/renamed packages, API changes, new peer dependencies

### Phase 2 — Map Touchpoints

4-category inventory, no changes until complete:

| Category | What to search | How |
|----------|---------------|-----|
| META entry | `__meta__.ts` — version, deps, envs, exports, require, mono, support | Read the entry |
| Direct templates | `templates/libraries/{name}/` or `templates/project/{cat}/{name}/` | Glob |
| Cross-references | Any `.hbs` file with `hasLibrary "{name}"` or `has "{category}" "{name}"` | Grep all templates |
| Tests | Any test file referencing the library name | Grep `tests/` |

Output: structured inventory listing every file, line, and what it references.

### Phase 3 — Update

- Version in `__meta__.ts`
- Package names/deps in META `packageJson`
- Template code for API changes (new imports, renamed functions, changed config)
- Cross-referenced templates if integration API changed
- Env vars if needed
- Smallest changes possible

### Phase 4 — Verify

**Step 1**: Run `bun test`. Fix failures before proceeding.

**Step 2**: Identify critical combinations from Phase 2 cross-references. Each `hasLibrary`/`has`/`isMono` conditional in affected templates implies a combination to test.

**Step 3**: Generate test projects for each critical combination:
```bash
bunx create-faster test-X --app name:stack:libs --database X --orm X --pm bun
cd test-X && bun install && bun run build
```

**Step 4**: Clean up test directories.

### Phase 5 — Commit

- `chore(meta): update {name} to {version}` for version-only bumps
- `feat(templates): update {name} templates for v{version}` if breaking changes required template changes

## Constraints

- Phase 2 gates Phase 3 (inventory before changes)
- Tests before generation in Phase 4
- One library at a time, atomic commits
- Cascading peer dependency bumps = separate skill invocation

## Location

`.claude/skills/updating-libraries/SKILL.md` — project skill alongside `adding-templates`, `fixing-templates`, etc.
