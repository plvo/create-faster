# Documentation for Release v1.6.2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Fumadocs documentation site (`apps/www/`) to cover all features in release v1.6.2.

**Architecture:** Each new section (blueprints, deployment, node stack) gets its own doc pages plus navigation entries. Existing pages (options.mdx, cli.mdx, index.mdx, roadmap.mdx) are updated to reference new features. All doc pages follow existing patterns — use the appropriate skill (`documenting-blueprint`, `documenting-stack`, `documenting-module`) for each page type.

**Tech Stack:** Fumadocs MDX, Next.js, custom components (`<Stacks>`, `<Modules>`, `<Dependencies>`, `<Tabs>`, `<Steps>`)

**Skills required:**
- `@documenting-blueprint` — for all blueprint pages
- `@documenting-stack` — for node stack page and deployment pages
- `@documenting-module` — reference only (no new module pages needed)

---

## Chunk 1: New Section — Blueprints (5 pages + meta.json + concept page)

This is the largest new feature. Requires a concept/overview page plus individual blueprint pages.

**Files:**
- Create: `apps/www/content/docs/blueprints/meta.json`
- Create: `apps/www/content/docs/blueprints/index.mdx`
- Create: `apps/www/content/docs/blueprints/dashboard.mdx`
- Create: `apps/www/content/docs/blueprints/dapp-privy.mdx`
- Create: `apps/www/content/docs/blueprints/dapp-rainbowkit.mdx`
- Create: `apps/www/content/docs/blueprints/lambda-sst.mdx`
- Create: `apps/www/content/docs/blueprints/lambda-terraform-aws.mdx`

### Task 1: Create blueprints meta.json

- [ ] **Step 1: Create navigation file**

```json
// apps/www/content/docs/blueprints/meta.json
{
  "title": "Blueprints",
  "pages": [
    "index",
    "---BUSINESS---",
    "dashboard",
    "---WEB3---",
    "dapp-privy",
    "dapp-rainbowkit",
    "---AWS---",
    "lambda-sst",
    "lambda-terraform-aws"
  ]
}
```

Categories match `META.blueprints[name].category` values: Business, Web3, AWS.

- [ ] **Step 2: Commit**

```bash
git add apps/www/content/docs/blueprints/meta.json
git commit -m "docs(blueprints): add navigation meta.json"
```

### Task 2: Create blueprints overview page

This is a concept page explaining what blueprints are, how to use them, and listing all available blueprints.

- [ ] **Step 1: Write the overview page**

File: `apps/www/content/docs/blueprints/index.mdx`

**Content guidelines:**
- Frontmatter: `title: Blueprints`, `description: Pre-composed starter projects...`, `icon: Layers`
- Explain the concept: blueprints are complete, functional starter projects (not just presets)
- Show how to use: `bunx create-faster myproject --blueprint dashboard --linter biome --git --pm bun`
- Explain what you can customize: linter, tooling, git, pm (NOT stacks, libraries, database, orm — those come from the blueprint)
- List all available blueprints grouped by category with links to individual pages
- Mention interactive mode: "Blueprint or Custom?" prompt when blueprints exist
- Keep it short — individual pages have the details

**Reference data from META:**
- `META.blueprints` keys: `dapp-privy`, `dapp-rainbowkit`, `dashboard`, `lambda-sst`, `lambda-terraform-aws`
- Categories: Business, Web3, AWS
- Labels and hints from META entries

- [ ] **Step 2: Commit**

```bash
git add apps/www/content/docs/blueprints/index.mdx
git commit -m "docs(blueprints): add overview page"
```

### Task 3: Document dashboard blueprint

Use `@documenting-blueprint` skill.

- [ ] **Step 1: Analyze META and templates**

```bash
# META entry
grep -A 30 "dashboard:" apps/cli/src/__meta__.ts

# Template files
find templates/blueprints/dashboard/ -name "*.hbs" | sort
```

**Key data from META:**
- Category: Business
- Apps: `web` (nextjs) + shadcn, better-auth, tanstack-query
- Project: postgres + drizzle
- Extra deps: `recharts ^2.15.0`
- Extra envs: `ADMIN_EMAIL=admin@example.com` (scope: app)

- [ ] **Step 2: Write the doc page**

File: `apps/www/content/docs/blueprints/dashboard.mdx`

Follow the `@documenting-blueprint` structure template. Key content:
- Presentation: CRM-style dashboard with auth, sidebar, stats
- Composition: links to nextjs stack, shadcn/better-auth/tanstack-query modules, drizzle/postgres
- Architecture: file tree from `templates/blueprints/dashboard/` (layout, pages, sidebar, header, stats)
- What's included: sidebar navigation, dashboard with charts (recharts), settings page, auth integration
- Extra deps: recharts
- Extra envs: ADMIN_EMAIL
- CLI usage example

- [ ] **Step 3: Commit**

```bash
git add apps/www/content/docs/blueprints/dashboard.mdx
git commit -m "docs(blueprints): document dashboard blueprint"
```

### Task 4: Document dapp-privy blueprint

Use `@documenting-blueprint` skill.

- [ ] **Step 1: Analyze META and templates**

```bash
grep -A 40 "'dapp-privy':" apps/cli/src/__meta__.ts
find templates/blueprints/dapp-privy/ -name "*.hbs" | sort
```

**Key data from META:**
- Category: Web3
- Apps: `web` (nextjs) + shadcn, next-themes, tanstack-query, trpc
- Project: postgres + drizzle
- Extra deps: @privy-io/react-auth, @privy-io/wagmi, @privy-io/server-auth, wagmi, viem
- Extra envs: NEXT_PUBLIC_PRIVY_APP_ID, NEXT_PUBLIC_PRIVY_CLIENT_ID, PRIVY_APP_SECRET

- [ ] **Step 2: Write the doc page**

File: `apps/www/content/docs/blueprints/dapp-privy.mdx`

Key content:
- Presentation: Web3 dApp with Privy wallet auth
- Composition: links to all stacks/modules/addons
- Architecture: pages (home, protected), components (app-providers, header), tRPC routers, wagmi config, proxy middleware
- What's included: wallet connection, protected routes, user sync, wallet info dashboard
- Extra deps and envs tables
- CLI usage

- [ ] **Step 3: Commit**

```bash
git add apps/www/content/docs/blueprints/dapp-privy.mdx
git commit -m "docs(blueprints): document dapp-privy blueprint"
```

### Task 5: Document dapp-rainbowkit blueprint

Use `@documenting-blueprint` skill.

- [ ] **Step 1: Analyze META and templates**

```bash
grep -A 30 "'dapp-rainbowkit':" apps/cli/src/__meta__.ts
find templates/blueprints/dapp-rainbowkit/ -name "*.hbs" | sort
```

**Key data from META:**
- Category: Web3
- Apps: `web` (nextjs) + shadcn, next-themes, better-auth, tanstack-query, trpc
- Project: postgres + drizzle
- Extra deps: @rainbow-me/rainbowkit, wagmi, viem
- Extra envs: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

- [ ] **Step 2: Write the doc page**

File: `apps/www/content/docs/blueprints/dapp-rainbowkit.mdx`

Key content:
- Presentation: Web3 dApp with RainbowKit + SIWE (Sign-In with Ethereum)
- Composition: links to all stacks/modules/addons (note: includes better-auth for SIWE)
- Architecture: pages, components, auth (auth.ts, auth-client.ts with SIWE plugin), wagmi config
- What's included: wallet connection via RainbowKit, SIWE auth via better-auth, protected routes
- Extra deps and envs
- CLI usage

- [ ] **Step 3: Commit**

```bash
git add apps/www/content/docs/blueprints/dapp-rainbowkit.mdx
git commit -m "docs(blueprints): document dapp-rainbowkit blueprint"
```

### Task 6: Document lambda-sst blueprint

Use `@documenting-blueprint` skill.

- [ ] **Step 1: Analyze META and templates**

```bash
grep -A 25 "'lambda-sst':" apps/cli/src/__meta__.ts
find templates/blueprints/lambda-sst/ -name "*.hbs" | sort
```

**Key data from META:**
- Category: AWS
- Apps: `api` (hono + aws-lambda), `cron` (node), `worker` (node) — 3-app turborepo
- Project: deployment = sst
- Extra deps: @repo/shared, @types/aws-lambda (dev), build script
- No extra envs

- [ ] **Step 2: Write the doc page**

File: `apps/www/content/docs/blueprints/lambda-sst.mdx`

Key content:
- Presentation: AWS Lambda monorepo with API Gateway, SQS worker, EventBridge cron
- Composition: 3 apps (hono API, 2 node workers), SST deployment
- Architecture: per-app structure + packages/shared + sst.config.ts + GitHub Actions deploy workflow
- What's included: API Gateway v2 routing, SQS queue handler, EventBridge cron handler, shared types package, CI/CD
- Extra deps table
- CLI usage

- [ ] **Step 3: Commit**

```bash
git add apps/www/content/docs/blueprints/lambda-sst.mdx
git commit -m "docs(blueprints): document lambda-sst blueprint"
```

### Task 7: Document lambda-terraform-aws blueprint

Use `@documenting-blueprint` skill.

- [ ] **Step 1: Analyze META and templates**

```bash
grep -A 25 "'lambda-terraform-aws':" apps/cli/src/__meta__.ts
find templates/blueprints/lambda-terraform-aws/ -name "*.hbs" | sort
```

**Key data from META:**
- Category: AWS
- Apps: same as lambda-sst (api + cron + worker)
- Project: deployment = terraform-aws
- Extra deps: same as lambda-sst
- No extra envs

- [ ] **Step 2: Write the doc page**

File: `apps/www/content/docs/blueprints/lambda-terraform-aws.mdx`

Key content:
- Presentation: Same Lambda architecture but with Terraform modules instead of SST
- Composition: 3 apps + terraform-aws deployment
- Architecture: per-app structure + packages/shared + infra/ (Terraform modules: lambda, api-gateway, sqs, eventbridge) + justfile + GitHub Actions
- What's included: reusable Terraform modules, infra/main.tf wiring, justfile for local dev, CI/CD with OIDC
- Extra deps table
- CLI usage

- [ ] **Step 3: Commit**

```bash
git add apps/www/content/docs/blueprints/lambda-terraform-aws.mdx
git commit -m "docs(blueprints): document lambda-terraform-aws blueprint"
```

---

## Chunk 2: New Section — Deployment (2 pages + navigation)

### Task 8: Create deployment pages

Use `@documenting-stack` skill (adapted for project addons).

**Files:**
- Create: `apps/www/content/docs/deployment/sst.mdx`
- Create: `apps/www/content/docs/deployment/terraform-aws.mdx`

- [ ] **Step 1: Analyze META for deployment options**

```bash
grep -A 40 "deployment:" apps/cli/src/__meta__.ts
find templates/project/deployment/ -name "*.hbs" | sort
```

**SST data:**
- Package: `sst ^4.2.7` (dev dep), `sst-env` (dep)
- Templates: `sst.config.ts.hbs` (conditional: `sst.aws.Nextjs` vs `sst.aws.Function`), `sst-env.d.ts.hbs`
- Gitignore: `.sst/` added
- Stack-aware: Next.js gets `sst.aws.Nextjs`, Hono/TanStack Start get `sst.aws.Function` with `url: true`

**Terraform AWS data:**
- No npm dependencies (external CLI tool)
- Templates in `infra/`: providers.tf, backend.tf, variables.tf, variables.auto.tfvars, secrets.auto.tfvars, outputs.tf, main.tf, backend/dev.hcl, backend/prod.hcl
- Gitignore: `.terraform/`, `*.tfstate*`, `secrets.auto.tfvars` added
- AWS provider ~> 6.0, S3 backend with native file locking

- [ ] **Step 2: Write SST doc page**

File: `apps/www/content/docs/deployment/sst.mdx`

Follow `@documenting-stack` structure:
- Frontmatter: `title: SST`, `description: AWS deployment with SST Ion...`
- Link to SST docs
- What create-faster adds: sst.config.ts (stack-aware), sst-env.d.ts, .gitignore entry
- Show both patterns: Nextjs component vs Function
- Dependencies from META
- CLI usage: `--deployment sst`

- [ ] **Step 3: Write Terraform AWS doc page**

File: `apps/www/content/docs/deployment/terraform-aws.mdx`

Follow `@documenting-stack` structure:
- Frontmatter: `title: Terraform (AWS)`, `description: Infrastructure as code with Terraform for AWS...`
- Link to Terraform docs
- What create-faster adds: complete infra/ directory with providers, backend, variables, env configs
- File tree showing all generated files
- Explain: S3 backend, per-env configs (dev.hcl, prod.hcl), native file locking
- No npm deps (Terraform is external CLI)
- CLI usage: `--deployment terraform-aws`

- [ ] **Step 4: Commit**

```bash
git add apps/www/content/docs/deployment/
git commit -m "docs(deployment): add SST and Terraform AWS pages"
```

---

## Chunk 3: New Page — Node Stack

### Task 9: Document Node stack

Use `@documenting-stack` skill.

**Files:**
- Create: `apps/www/content/docs/stacks/node.mdx`

- [ ] **Step 1: Analyze META and templates**

```bash
grep -A 20 "'node':" apps/cli/src/__meta__.ts
find templates/stack/node/ -name "*.hbs" | sort
```

**Key data from META:**
- Type: server
- Label: Node.js
- Hint: Plain TypeScript server
- packageJson: scripts (dev, start), dependencies, devDependencies
- Templates: tsconfig.json.hbs, src/index.ts.hbs, eslint.config.mjs.node.hbs

- [ ] **Step 2: Write the doc page**

File: `apps/www/content/docs/stacks/node.mdx`

Follow `@documenting-stack` structure:
- Frontmatter: `title: Node.js`, `description: Plain TypeScript runtime for servers, workers, and cron jobs.`
- Link to Node.js docs
- What create-faster adds: minimal entry point, strict TypeScript config (ES2022, ESNext module, bundler resolution), dev/start scripts
- Use cases: plain TypeScript servers, workers, cron jobs, Lambda functions
- File tree: src/index.ts, tsconfig.json, package.json
- Compatible modules: none (clean slate)

- [ ] **Step 3: Commit**

```bash
git add apps/www/content/docs/stacks/node.mdx
git commit -m "docs(stacks): add Node.js stack page"
```

---

## Chunk 4: Update Existing Pages

### Task 10: Update root meta.json navigation

**Files:**
- Modify: `apps/www/content/docs/meta.json`

- [ ] **Step 1: Add new sections to navigation**

Add these entries to the `pages` array:
- `"stacks/node"` after `"stacks/hono"`
- `"---BLUEPRINTS---"` section with `"...blueprints"` (auto-loads blueprints/ folder)
- `"---DEPLOYMENT---"` section with `"deployment/sst"` and `"deployment/terraform-aws"`

Final `pages` array should be:
```json
[
  "---INTRODUCTION---",
  "index", "why", "cli", "options", "roadmap", "changelog",
  "---STACKS---",
  "stacks/nextjs", "stacks/expo", "stacks/tanstack-start", "stacks/hono", "stacks/node",
  "---MODULES---",
  "...modules",
  "---BLUEPRINTS---",
  "...blueprints",
  "---DATABASES---",
  "database/postgresql", "database/mysql",
  "---ORMS---",
  "orm/drizzle", "orm/prisma",
  "---DEPLOYMENT---",
  "deployment/sst", "deployment/terraform-aws",
  "---LINTERS---",
  "linter/biomejs", "linter/eslint",
  "---EXTRAS---",
  "extras/husky"
]
```

- [ ] **Step 2: Commit**

```bash
git add apps/www/content/docs/meta.json
git commit -m "docs(nav): add blueprints, deployment, and node stack to navigation"
```

### Task 11: Update options.mdx

**Files:**
- Modify: `apps/www/content/docs/options.mdx`

- [ ] **Step 1: Add missing flags**

Add these flag sections (after `--app` section):

**`--blueprint <name>`** — Use a blueprint template.
- Options: `dashboard`, `dapp-privy`, `dapp-rainbowkit`, `lambda-sst`, `lambda-terraform-aws`
- Mutually exclusive with `--app`, `--database`, `--orm`
- Can combine with `--linter`, `--tooling`, `--git`, `--pm`
- Example: `--blueprint dashboard --linter biome --git --pm bun`

**`--deployment <name>`** — Select a deployment platform.
- Options: `sst`, `terraform-aws`
- Example: `--deployment sst`

**`--linter <name>`** — Select a linter.
- Options: `biome`, `eslint-prettier`, `eslint`, `prettier`
- Example: `--linter biome`

- [ ] **Step 2: Fix `--tooling` section**

Current docs list `biome` under `--tooling`. Update to reflect that biome is now under `--linter`:
- `--tooling` options: `husky` (requires `--git` and a linter)

- [ ] **Step 3: Add blueprint example**

Add a "Blueprint" example section:
```bash
bunx create-faster my-dashboard \
  --blueprint dashboard \
  --linter biome \
  --tooling husky \
  --git \
  --pm bun
```

- [ ] **Step 4: Update dependency rules**

Add new validation rules:
- Blueprint is mutually exclusive with `--app`, `--database`, `--orm`
- Husky requires a linter (for lint-staged)
- Deployment is optional

- [ ] **Step 5: Update stacks list**

In the `--app` flag section, add `node` to the available stacks list.

- [ ] **Step 6: Commit**

```bash
git add apps/www/content/docs/options.mdx
git commit -m "docs(options): add blueprint, deployment, and linter flags"
```

### Task 12: Update cli.mdx

**Files:**
- Modify: `apps/www/content/docs/cli.mdx`

- [ ] **Step 1: Add blueprint selection step**

After the "Project Name" step, add a new step for blueprint selection:
- "Blueprint or Custom?" prompt appears when blueprints exist
- If blueprint selected: skips app count, app config, database, orm — goes straight to linter/tooling/git/pm
- If custom selected: continues with normal flow

- [ ] **Step 2: Add Node.js to stack selection**

Update the stack selection prompt to include Node.js:
```
└ Server / API
   ○ Hono (Fast web framework)
   ○ Node.js (Plain TypeScript server)
```

- [ ] **Step 3: Add deployment step**

After ORM selection, add a deployment step:
```bash
◇  Select a deployment platform?
│  ● SST
│  ○ Terraform (AWS)
│  ○ None
```

- [ ] **Step 4: Update linter/extras step**

Replace current "Extras" step (which incorrectly shows Biome under extras) with:

Linter step:
```bash
◇  Select a linter?
│  ● Biome
│  ○ ESLint + Prettier
│  ○ ESLint
│  ○ Prettier
│  ○ None
```

Tooling step (only if linter selected):
```bash
◇  Add any tooling?
│  ◻ Husky
```

- [ ] **Step 5: Commit**

```bash
git add apps/www/content/docs/cli.mdx
git commit -m "docs(cli): add blueprint selection, deployment, and linter steps"
```

### Task 13: Update index.mdx

**Files:**
- Modify: `apps/www/content/docs/index.mdx`

- [ ] **Step 1: Add blueprint mention**

Add a brief section after "Two Ways to Create Projects" about blueprints:
- Mention that blueprints provide complete starter projects
- Show a quick example: `bunx create-faster myapp --blueprint dashboard --pm bun`
- Link to the blueprints docs page

- [ ] **Step 2: Update the interactive mode description**

Update the bullet list to include:
- Deployment platform selection
- Linter selection (separate from tooling)

- [ ] **Step 3: Update the stack list**

Add Node.js to the stack selection description:
```
- Stack selection (Next.js, TanStack Start, Expo, Hono, Node.js)
```

- [ ] **Step 4: Commit**

```bash
git add apps/www/content/docs/index.mdx
git commit -m "docs(index): add blueprints section and update feature list"
```

### Task 14: Update roadmap.mdx

**Files:**
- Modify: `apps/www/content/docs/roadmap.mdx`

- [ ] **Step 1: Mark completed items**

Check off items that are now implemented:
- Cloud: `[x] Terraform (AWS)` — implemented via `--deployment terraform-aws`
- Examples: `[x] Web3 dApp` — implemented via dapp-privy and dapp-rainbowkit blueprints

Note: SST is not listed in roadmap (was not planned). Prettier/ESLint split is not in roadmap.

- [ ] **Step 2: Commit**

```bash
git add apps/www/content/docs/roadmap.mdx
git commit -m "docs(roadmap): mark Terraform AWS and Web3 dApp as completed"
```

---

## Chunk 5: Verification

### Task 15: Build and verify docs site

- [ ] **Step 1: Build the docs site**

```bash
cd apps/www && bun run build
```

Expected: Build succeeds with no errors. All new pages are generated.

- [ ] **Step 2: Check for broken links**

Verify that all internal links resolve:
- Blueprint pages link to correct stack/module/addon pages
- Navigation entries match actual file paths
- Cross-references between new and existing pages work

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "docs: fix build issues"
```

---

## Parallelization Guide

**Independent tasks (can run as parallel subagents):**

| Group | Tasks | Skill |
|-------|-------|-------|
| Blueprints batch 1 | Task 3 (dashboard), Task 4 (dapp-privy), Task 5 (dapp-rainbowkit) | `@documenting-blueprint` |
| Blueprints batch 2 | Task 6 (lambda-sst), Task 7 (lambda-terraform-aws) | `@documenting-blueprint` |
| Deployment | Task 8 (SST + Terraform AWS) | `@documenting-stack` |
| Node stack | Task 9 (Node.js) | `@documenting-stack` |

**Sequential tasks (depend on new pages existing):**

| Order | Tasks | Reason |
|-------|-------|--------|
| After blueprints | Task 1 (meta.json), Task 2 (overview) | Need to know final page list |
| After all new pages | Task 10 (root meta.json) | Needs all sections finalized |
| After all new pages | Task 11 (options.mdx) | References new features |
| After all new pages | Task 12 (cli.mdx) | References new workflow |
| After all new pages | Task 13 (index.mdx) | References new features |
| After all new pages | Task 14 (roadmap.mdx) | Independent but small |
| Last | Task 15 (build verification) | Validates everything |

**Recommended execution:**
1. Launch 4 parallel subagents: blueprints batch 1, blueprints batch 2, deployment, node stack
2. Once complete: run tasks 1, 2, 10-14 (can be sequential or partially parallel)
3. Final: task 15 (build verification)
