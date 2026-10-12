# create-faster

CLI that scaffolds projects from Handlebars templates. Interactive prompts or flags pick one or more apps (Next.js, Expo, Hono, Node, TanStack Start), libraries per app, and project-level choices (database, ORM, deployment, linter, tooling). Two or more apps produce a Turborepo, one app a single repo. Blueprints are pre-composed projects with application code.

Install and run: `bunx create-faster`. License: MIT. The published package is `apps/cli`.

## Repository layout

```
apps/cli/                  # The CLI (TypeScript, Bun)
  src/                     # Source, imported through the `@/*` alias
  templates/               # Handlebars templates (see Template system)
  tests/                   # unit, integration, e2e, blueprints
apps/www/                  # Documentation site (Next.js + Fumadocs), content in apps/www/content/docs
packages/config/           # Shared tsconfig
docs/agents/               # Research, plans and audits written by agents
.claude/skills/            # Repo skills for Claude Code (see Skills)
```

### Source map (`apps/cli/src`)

| File | Role |
|---|---|
| `index.ts` | Entry point: parse flags, run prompts, resolve templates, generate files, post-generation hooks, summary |
| `flags.ts` | Commander flags parser and validation against META |
| `cli.ts` | Interactive flow (`cli`, `blueprintCli`), skips every prompt a flag already answered |
| `__meta__.ts` | META: the single source of truth for stacks, libraries, project addons, repo types and blueprints |
| `types/meta.ts`, `types/ctx.ts` | META types and the generation context (`TemplateContext`, `AppContext`, `ProjectContext`) |
| `prompts/` | Prompt wrappers and the stack, library, blueprint and project category prompts |
| `lib/template-resolver.ts` | Discovers templates and maps each source file to a destination |
| `lib/template-processor.ts` | Renders one template and writes it; an empty render writes nothing |
| `lib/handlebars.ts` | Handlebars helpers and partials (`setupTemplateEngine`) |
| `lib/frontmatter.ts`, `lib/file-writer.ts` | Frontmatter parsing, stack suffixes, special filenames, directory scan |
| `lib/package-json-generator.ts` | Programmatic `package.json` generation from META |
| `lib/env-generator.ts` | Programmatic `.env.example` generation from META |
| `lib/agent-context-generator.ts` | `AGENTS.md` and `CLAUDE.md` of generated projects |
| `lib/addon-utils.ts` | Compatibility and requirement checks, script placeholders |
| `lib/when.ts` | `$when` conditions |
| `lib/file-generator.ts`, `lib/post-generation.ts` | Generation orchestration; dependency install and `git init` |
| `tui/` | Progress display, summary, and the copy-paste command that recreates the project |

## Commands

Run from the repository root unless noted. Bun is the package manager (`packageManager` in `package.json`; `apps/cli` requires `bun >= 1.3.1`).

```bash
bun install                  # Setup (also installs the husky hooks)
bun run dev:cli              # Run the CLI from source
bun run build:cli            # Build apps/cli to dist/
bun run check                # Biome format + lint check (CI runs it)
bun run lint                 # Biome lint with auto-fix
bun run format               # Biome format
bun run check:unused         # knip
bun run typecheck            # tsc --noEmit on apps/cli (CI runs it)
cd apps/cli && bun test tests/unit tests/integration
cd apps/cli && bun test tests/e2e/<file> --timeout 600000
```

- `tests/unit` and `tests/integration` run in CI. Integration tests run the real CLI and assert on generated files (`tests/integration/helpers.ts`).
- `tests/e2e` generates, installs and builds real projects. It is slow, needs network, and runs on demand, one file at a time.
- Biome does not lint `apps/cli/tests`.

## Declarative choice logic (mandatory)

**Every agent MUST follow this. No exception without explicit approval from the maintainer.**

NEVER hardcode logic tied to a specific choice value (a stack, library, deployment, database, ORM, linter, blueprint, etc.) inside core logic: the resolver, the file generator, the flags parser, the prompts engine, or any shared algorithm. Core code stays agnostic to which choices exist.

Forbidden:
- A literal branch on a choice value in core logic: `if (deployment === 'cloudflare-static')`, `if (stack === 'nextjs')`, `if (library === 'better-auth')`.
- An incompatibility, compatibility or support list hardcoded in a `.ts` core file (for example `const CLOUDFLARE_STATIC_INCOMPATIBLE_LIBRARIES = [...]`). That data belongs in META, read generically.
- Choice-specific output paths, filtering or skipping written as special cases in the resolver.

Required: choice-specific behavior is expressed through reusable operators that core logic applies generically.

- **Handlebars helpers** (`apps/cli/src/lib/handlebars.ts` is the list):
  - `eq`, `ne`, `and`, `or`
  - `isMono`: the project is a turborepo
  - `hasLibrary(name)`: the current app has the library; outside an app-scoped file, any app has it
  - `has(category, value)`: `database`, `orm`, `deployment`, `linter` or `tooling` selection; `has "stack" "x"` is true when any app uses the stack
  - `databaseBinding(name)`: true when the selected database declares `serverlessBinding: name` in META (`{{#if (databaseBinding "hyperdrive")}}`), so a new binding database needs no template edit
  - `hasContext(key)`: the key exists in the context
  - `hasPackage(name)`: a turborepo workspace package of that name is generated (it gets a `package.json`), from `collectMonoPackages` in `package-json-generator.ts`; false in a single repo. Use it to describe `packages/db` (`{{#if (hasPackage "db")}}`), never `project.orm`; it also works inside `{{#each}}` blocks
  - `hasRootScript(name)`: the generated root `package.json` (the turborepo root, or the single app's) defines the script, derived from META by `getRootScripts` in `package-json-generator.ts`; renders a CI step only when the script exists
  - `camelCase`, `raw`, `appPort(name)` (3000 + app index)
  - Express conditionals inside templates: `{{#if (has "deployment" "cloudflare")}}...{{/if}}`.
- **Handlebars partials** (`apps/cli/templates/partials/`, registered by `setupTemplateEngine` in `apps/cli/src/lib/handlebars.ts`): `{{> group/name}}` inserts a block that several templates share, rendered with the caller's context plus optional hash parameters. A choice mapping written in several templates (for example stack to better-auth cookie plugin) lives once in a partial, expressed with the helpers above. See Template system, Partials.
- **Frontmatter keys** (`TemplateFrontmatter` in `apps/cli/src/types/meta.ts`, applied generically in `template-resolver.ts`): `path`, `mono` (`scope`/`name`/`path`), `only` (`mono`, `single`, `no-blueprint`), `deploymentPath`, `deploymentSkip`, `blueprintSkip`. `only` and the deployment and blueprint skip keys are honored for every template kind (stack, library, project addon, stack-suffixed addon, repo, blueprint). They are the model: a generic key the resolver honors for ANY value.
- **META data** (`__meta__.ts`; types in `types/meta.ts`): `support`, `require`, `mono`, `packageJson`, `stackPackageJson`, `deploymentPackageJson`, `appPackageJson`, `envs`, `compose`, `runtime`, plus the capability flags below. Compatibility and dependency rules live here as data, validated generically.
  - `stackPackageJson`: per-app-stack dependencies. Honored for libraries, deployments and databases; for a database it lands in each matching app in single and turborepo alike. For example `sqlite` adds `@libsql/client` (same version constant as the db package) to TanStack Start apps running Nitro, so the app resolves it and Nitro externalizes it and traces `libsql` with its native binding instead of bundling it.
  - `deploymentPackageJson`: `Record<deployment, PackageJsonConfig>`, merged generically by `package-json-generator` when `ctx.project.deployment` matches a key. For example `postgres` adds `pg-cloudflare` under `cloudflare`.
  - `envs`: `EnvVar` with `value`, `monoScope`, an optional `when` (a `$when` match such as `{ orm: true }`: the variable is emitted only when it holds) and an optional `stacks: StackName[]`. When `stacks` is set the variable is emitted only for apps whose stack is listed, evaluated per app by `env-generator`, so one project can carry `NEXT_PUBLIC_X` on Next.js apps and `VITE_X` on TanStack Start apps. A root or pkg-scoped variable with `stacks` is emitted when at least one app (with the library, for library envs) has a listed stack. An optional `file` (a name such as `d1`) writes the variable to `.env.<file>.example` (same scope-to-path rules, in the generated project the file is `.env.<file>`) instead of `.env.example`. Use it for a secret that only a CLI reads, never a Worker or a framework: Wrangler, Vite and Next.js load `.env` (and `.env.local`, `.env.<mode>`) into the Worker environment, and OpenNext bundles it into the deployed Worker, while a `.env.<file>` of another name is read by nothing but the tool that loads it explicitly. A template that consumes such a file loads it itself (the drizzle `drizzle.config.ts` calls `process.loadEnvFile('.env.d1')`) and the generated `.gitignore` lists it.
  - Category-level and addon-level `require`. `require.stacks` requires at least one app on a listed stack (for example `cloudflare-static` requires a Next.js or TanStack Start app; a turborepo mixing it with an unsupported stack still passes, and that app gets no `wrangler.jsonc`).
- **`$when` conditions** (`apps/cli/src/lib/when.ts`, wrapping package.json values and array items in `__meta__.ts`): keys `repo`, `stack`, `library` and any `ProjectContext` category (`database`, `orm`, `deployment`, `linter`, `tooling`). The value is a string, a list (any-of) or `true` (the category has a selection). Every key accepts a negation, `{ not: <value> }`, true when the positive match is false: `$when({ deployment: { not: 'cloudflare' } }, ...)` or `$when({ deployment: { not: ['cloudflare', 'cloudflare-static'] } }, ...)`. An unselected category satisfies any `not` (`{ not: 'cloudflare' }` is true when no deployment is chosen; `{ not: true }` is true only when the category is unselected). `stack` and `library` follow any-app semantics (`{ not: 'nextjs' }` is true only when no app uses Next.js). All keys of one `$when` must hold.
- **package.json script placeholders** (resolved by `resolveScriptPlaceholders` in `addon-utils.ts`, applied to the scripts of every generated package.json): `{{workspaceRoot}}` (repo-relative path to the workspace root: `.` in a single repo, `../..` in a turborepo) and `{{deployAppDir}}` (directory name of the app that consumes the deployment binding: the deployment's `stackPackageJson` stacks, preferring an app with a `needsSingletonDb` library; resolved by `resolveDeployAppDir`). Author topology-dependent script strings with these tokens in META and combine them with `deploymentPackageJson` + `$when` for repo and deployment splits; never compute app paths in the generator. For example the d1 turborepo migrate script is `wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --local --persist-to {{workspaceRoot}}/.wrangler`.

When you need choice-conditional behavior and no operator covers it, the correct move is to add a new generic operator (a Handlebars helper or a frontmatter key handled generically by the resolver) and document it in this file under Template system, never to special-case a value in core code. Generalize first, then use it.

Compatibility and capability data is a separate mechanism: it is declared as META fields and read by generic checks (see META capabilities), never as a branch on a value in core code.

This keeps the tool extensible: adding the next stack, library or deployment requires a META entry and templates, never an edit to a core algorithm.

## META capabilities

`META` (`apps/cli/src/__meta__.ts`) has `stacks`, `libraries`, `project` (categories `database`, `orm`, `deployment`, `linter`, `tooling`), `repo` and `blueprints`. The lists of choices, the stacks each library supports (`support.stacks`) and the requirements live there; read them instead of copying them into docs or code.

- `META.stacks`: `type: 'app' | 'server'`, label and base `packageJson`.
- `META.libraries`: per-app addons with category, `support`, `require`, `mono`, `packageJson`, `stackPackageJson`, `envs`.
- `META.project`: each category declares its prompt, `selection: 'single' | 'multi'`, an optional category-level `require` (an ORM requires a database) and its `options`, which are addons like libraries.
- `META.blueprints`: preset context (apps with their libraries, plus `database`, `orm` and `deployment`), extra `packageJson` and `envs`, and an optional `agentArchitecture` text for the generated `AGENTS.md`.
- Addon `require` (`AddonRequire`): `git`, `linter`, `database`, `orm`, `deployment`, `tooling`, `libraries`, `stacks`. A flag or prompt that violates it is rejected generically (`isRequirementMet`, `describeRequire`).
- Server-runtime capability: a library declares `needsServerRuntime: true`; a deployment declares `providesServerRuntime: false` for static-only targets. Read generically by `isServerRuntimeSatisfied`: a server-less deployment is unavailable when any selected library needs a runtime.
- Singleton-db capability: a database declares `serverlessBinding` (it is accessed per request through a Cloudflare binding, no module singleton; `d1`, and `postgres` and `mysql` through Hyperdrive); a deployment declares `providesDbBindings: true` (Cloudflare); a library declares `needsSingletonDb: true` (better-auth, trpc consume a module-singleton `db`). A binding database whose server-side consumers are wired per request declares `serverlessConsumersWired: true` (`d1`). Read generically by `isSingletonDbSatisfied`: a binding-based database under a binding-providing deployment is unavailable when any selected library needs a singleton db, unless its consumers are wired. D1 is wired: better-auth and trpc build per request through `getDb()` and `getAuth()` from the app-side `src/lib/server.ts` (`templates/project/deployment/cloudflare/src/lib/server.ts.{nextjs,tanstack-start}.hbs`), gated by `{{#if (has "database" "d1")}}` in the `auth` and `trpc` templates. `postgres` and `mysql` on Cloudflare stay disabled with better-auth and trpc until their consumers are wired too.
- Local-filesystem capability: a database declares `needsLocalFilesystem: true` (`sqlite` opens a `file:` URL); a deployment declares `providesLocalFilesystem: false` when its runtime has no writable disk (`cloudflare`, Workers). Read generically by `isLocalFilesystemSatisfied`: a filesystem database is unavailable under a deployment without one (`d1` is the SQLite database there). `validateContext` rejects it in flags and `getCategoryOptionUnavailability` disables it in the prompt.
- Single-select project prompts show incompatibility instead of hiding it: `getCategoryOptionUnavailability` (`addon-utils.ts`) returns a generic, META-derived reason for any option, and `promptProjectCategorySingle` renders unavailable options disabled with that reason. No hardcoded choice value.

### Prompts, testing libraries and linters

- Library prompts group libraries by their `category` field (`UI`, `Content`, `Auth`, `API`, `Data Fetching`, `Forms`, `Runtime`, `Observability`, `Analytics`, `Testing`); `multiselectLibrariesPrompt` in `prompts/stack-prompts.ts` builds the groups from META.
- Testing libraries: `vitest` (Next.js, TanStack Start; jsdom and Testing Library) and `vitest-node` (Hono, Node) declare the scripts `test`, `test:watch`, `test:coverage`; `playwright` (Next.js, TanStack Start, app-scoped config) declares `test:e2e` and `test:e2e:ui`; `jest-expo` (Expo, `jest-expo` preset and React Native Testing Library) declares `test` and `test:watch`.
- Linter `oxc` generates a root `oxlint.config.mts` and `oxfmt.config.mts` (`templates/project/linter/oxc/`). `oxlint.config.mts.hbs` has one override per app that has a React stack or a test library, with native plugins chosen by stack and library, and the `@shadcn/lint` JS plugin for an app that uses shadcn.

### Better Auth and framework cookie plugins

Framework cookie plugins live in the app, in generic templates. The better-auth factory (`create-auth.ts` in a single repo, `packages/auth/src/auth.ts` in a turborepo, from `templates/libraries/better-auth/src/lib/auth/auth.ts.hbs`) has one shape per database, `createAuth(cookiePlugin?)` or `createAuth(db, cookiePlugin?)`. It knows no framework, appends the cookie plugin after its own plugins, and sets `session.disableSessionRefresh` when there is none (a refresh through an instance without a cookie plugin would extend the session in the database but lose the cookie).

Each app builds its instance from the factory with its framework's plugin: `src/lib/auth/auth.ts` (app-scoped `auth-instance.ts.hbs`, in a single repo and in every turborepo app) or `src/lib/server.ts` on D1. A Next.js app and a TanStack Start app can therefore share one auth package. Package-side consumers that cannot import an app instance (the tRPC package) use a cookie-less `createAuth()` for read-only session lookups.

Exception: a single-framework blueprint whose shared package calls cookie-setting endpoints (the `multitenant-saas` routers call `changePassword` with `revokeOtherSessions`, `updateUser`, ...) may bind its framework's plugin in that package (`packages/api/src/auth.ts` calls `createAuth(nextCookies())`), because those cookies must reach the browser. That blueprint is Next.js only, so no other framework shares the package.

Production rate limiting keys on a client address header, which better-auth reads from `advanced.ipAddress.ipAddressHeaders` (default `x-forwarded-for`, which any client can set unless a proxy overwrites it). Every `betterAuth(...)` call (the library factory and the `org-dashboard`, `multitenant-saas`, `dapp-rainbowkit` and `cloudflare-fullstack` blueprint copies) inserts the `better-auth/client-ip` partial inside `advanced`: `cf-connecting-ip` under `cloudflare` (set by the edge, not spoofable through it), `x-forwarded-for` otherwise, with the generated better-auth notes describing the residual risk: better-auth rejects a multi-value `x-forwarded-for` (without `trustedProxies`), so an app exposed directly with no proxy can be dodged by rotating the header (it must sit behind a proxy or CDN that overwrites it), a single appending proxy is safe, and a proxy chain pushes every request into one shared bucket until `advanced.ipAddress.trustedProxies` is set. A new auth file calls the partial, never writes the header. In e2e the probe in `tests/e2e/auth-probe.ts` plays the proxy or edge by setting a distinct address on both headers, and `expectRateLimitKeysOn` asserts that only the trusted one counts.

### Cloudflare

- `cloudflare` (Workers) supports Hono (Wrangler), Next.js (OpenNext) and TanStack Start (`@cloudflare/vite-plugin`, no Nitro). `cloudflare-static` supports Next.js and TanStack Start. The deployments are `cloudflare`, `cloudflare-static`, `sst` and `terraform-aws`; the stacks each one supports are in META.
- A TanStack Start app drops `nitro` and the Nitro `start` script through `$when({ deployment: { not: 'cloudflare' } })`. `vite.config.ts.hbs` swaps `nitro()` for `cloudflare()` under `has "deployment" "cloudflare"`. `__env.start.hbs` carries `deploymentSkip: [cloudflare, cloudflare-static]`.
- Production servers run with `NODE_ENV=production`: Nitro through `NODE_ENV` in `.env.start`, Workers through `config: { vars: { NODE_ENV } }` on the `cloudflare()` plugin (`production` for `vite build`, `development` otherwise). Only the literal `process.env.NODE_ENV` is replaced at build time, not dynamic reads or external dependencies.
- A Next.js app (OpenNext) gets the same through the `cloudflare/node-env-var` partial (`"vars": { "NODE_ENV": "production" }`), inserted in `wrangler.jsonc.nextjs.hbs` and in the `cloudflare-fullstack` blueprint's own copy. Without it a dependency's runtime read of `NODE_ENV` sees `development` in workerd, because the build only inlines the literal `process.env.NODE_ENV`.
- With D1, `src/lib/server.ts.tanstack-start.hbs` builds `db` once at module scope from `cloudflare:workers` (the db package factory stays `createDb(d1)`), plus `auth = createAuth(db, tanstackStartCookies())` when better-auth is selected. With Hyperdrive, consumers call `await createDb(env.HYPERDRIVE)` per request.
- Every Hono app on `cloudflare` types `new Hono<{ Bindings: CloudflareEnv }>()` and includes `cloudflare-env.d.ts` in its tsconfig, so `tsc` needs `cf-typegen` first (as for Start). With Hyperdrive, `wrangler.jsonc.hono.hbs` declares the `HYPERDRIVE` binding (the `cloudflare/hyperdrive-binding` partial) and route handlers call `await createDb(c.env.HYPERDRIVE)` per request.

## Template system

### Structure

```
apps/cli/templates/
├── stack/{stack}/                    # One directory per stack (nextjs, expo, hono, node, tanstack-start)
├── libraries/{library}/              # Per-app library templates
├── project/{category}/{option}/      # database, orm, deployment, linter, tooling options
├── blueprints/{blueprint}/           # Blueprint application code (override semantics)
├── partials/{group}/{name}.hbs       # Shared blocks inserted with {{> group/name}}, never output files
└── repo/{single,turborepo}/          # Repo-level files
```

Resolution order in `getAllTemplatesForContext`: repo, then each app's stack and libraries, then project addons (database, orm, deployment and its stack-suffixed files, linter, tooling), then the blueprint. A blueprint template replaces every structural template with the same destination.

### File naming

- Template files: `filename.extension.hbs`.
- `__name.hbs` becomes `.name` (`__gitignore.hbs` is `.gitignore`); `___name.hbs` becomes `__name` (`___root.tsx.hbs` is `__root.tsx`).
- Stack-specific: `file.ext.{stack}.hbs` (`wrangler.jsonc.hono.hbs`), generated only for apps on that stack. Parsed by `parseStackSuffix` in `lib/frontmatter.ts` against the stacks in META.
- `.env.example` files and `package.json` files are generated programmatically from META, not templates.
- `__agent.md.hbs` files are agent-context fiches, not output files (see Generated agent context).

### Handlebars context

The context is `TemplateContext` (`types/ctx.ts`): `projectName`, `repo`, `apps`, `project` (`project.database`, `project.orm`, `project.deployment`, `project.linter`, `project.tooling`), `git`, `pm`, `blueprint`, `dbPort`. A file under `apps/{app}/`, and the only app of a single repo, also gets that app's `appName`, `stackName` and `libraries`. Prefer the helpers over reading these directly.

`setupTemplateEngine()` is the one engine setup: it registers the helpers and every `templates/partials/**/*.hbs` partial. Anything that renders templates (a unit test included) calls it first; `generateProjectFiles` does at the start of each generation.

### Partials

A block that several templates render identically lives once in `templates/partials/`, and each template inserts it with `{{> group/name}}`.
- **Naming**: the partial name is the file path relative to `templates/partials/`, without `.hbs`, grouped by domain: `partials/cloudflare/d1-binding.hbs` is `{{> cloudflare/d1-binding}}`.
- **Never output files**: `templates/partials/` is not a template root of the resolver.
- **Context**: a partial renders with the caller's context, so `has`, `hasLibrary`, `isMono` and `{{appName}}` answer as in the caller. Hash parameters add per-call values: `{{> posthog/client-options debug="import.meta.env.DEV"}}` exposes `{{debug}}` inside the partial, and a partial that takes one names it in a `{{!-- --}}` comment at its top. Partials use the template compile options, so values are not HTML-escaped.
- **Line endings**: registration normalizes the end of every partial, so an editor adding or removing a final newline changes no output.
  - By default a partial is called alone on its line (`    {{> posthog/client-options ...}}`): it replaces that line, each of its lines gets the call's indentation, and it ends with exactly one line break. Avoid blank lines inside it: they would get the indentation as trailing spaces.
  - A partial whose frontmatter sets `inline: true` is called mid-line (`'https://{{> posthog/asset-host}}/static/:path*'`): it is inserted without indentation and without a final line break. A JSON fragment appended after a property carries its own leading comma (`cloudflare/d1-binding`).
- **When to use**: a partial holds shared content (a config block, an options object, a host, an import and its call). A computed value belongs in a helper (`appPort`); whether a file exists or where it goes belongs in frontmatter or META. Choice conditionals inside a partial use the helpers like any template.

### Frontmatter

```yaml
---
path: src/lib/db/schema.ts    # Output path for single repo
mono:
  scope: app | pkg | root     # Monorepo scope (overrides META)
  name: db                    # Package name when scope is pkg
  path: schema.ts             # Monorepo path (relative to scope)
only: mono | single | no-blueprint  # Repo type or blueprint filter
deploymentPath:               # Output path override keyed by deployment platform
  cloudflare: src/middleware.ts
deploymentSkip:               # Deployment platforms that do not get this file
  - cloudflare-static
blueprintSkip:                # Blueprints that do not get this file
  - org-dashboard
---
```

#### `deploymentPath`

A generic map of `{ <deployment platform>: <relative path> }`. When `ctx.project.deployment` matches a key, that path replaces the file's default output path (applied by `resolveDestination()` in `template-resolver.ts`, honored for every template kind). It takes precedence over `path` and `mono.path`. The replacement is the pre-scope relative path, so monorepo scoping still applies on top (`apps/{appName}/`, `packages/{name}/`, or root depending on the kind).

Why it exists: `templates/stack/nextjs/src/proxy.ts.hbs` declares `deploymentPath.cloudflare: src/middleware.ts`. Next.js 16's `proxy.ts` convention runs middleware on the Node.js runtime, which OpenNext (Cloudflare) does not support (`ERROR Node.js middleware is not currently supported`). The `middleware.ts` convention compiles to the Edge runtime that OpenNext supports. So a Next.js app deployed to Cloudflare emits `src/middleware.ts` instead of `src/proxy.ts`, and the template renders the exported function name and log label as `middleware`/`MIDDLEWARE` versus `proxy`/`PROXY` through `{{#if (has "deployment" "cloudflare")}}`. Keep this declarative in frontmatter; do not special-case deployment, stack or filename in the resolver.

#### `deploymentSkip`

A list of deployment platforms. When `ctx.project.deployment` is in the list, the template is not generated (`isSkippedForDeployment()` in `template-resolver.ts`, every template kind). Use it when the whole file is excluded under a deployment and every other case keeps it. When the file exists only for some deployments or libraries (a shortlist, not an exclusion list), use empty-render skipping instead.

#### `blueprintSkip`

A list of blueprint names. When `ctx.blueprint` is in the list, the template is not generated (`isSkippedForBlueprint()` in `template-resolver.ts`, every template kind). Use it only when a blueprint ships its own version of a file at a different destination than the generic template it supersedes, so the override-by-destination rule cannot replace it. When both land on the same destination, the blueprint file already wins and no entry is needed. Example: the drizzle `scripts/seed.ts.hbs` lands in `packages/db/scripts/` in a turborepo, while `org-dashboard`, `multitenant-saas` and `cloudflare-fullstack` keep their own root `scripts/seed.ts` there, so they list themselves (`dapp-privy` is single-repo, its seed shares the generic destination, so it does not).

#### Empty-render skipping

A template whose rendered output is empty or whitespace only is not written (`processTemplate` in `template-processor.ts`, every template kind, after Handlebars rendering). Wrap the whole body in `{{#if ...}}` sections and the file does not exist when no section is active. Use it when:
- the file exists only under a choice (`{{#if (has "deployment" "cloudflare")}}`) or a combination of choices, which `deploymentSkip` (a list of deployments to exclude) cannot express;
- the file is a shared entry point that only exists when a library contributes to it (see below).

Example: `repo/turborepo/pnpm-workspace.yaml.hbs` is wrapped in `{{#if (eq pm "pnpm")}}`. pnpm ignores the `workspaces` field of `package.json`, so a pnpm turborepo needs this file while bun and npm get none. `linkWorkspacePackages: true` makes the `*` range of internal dependencies resolve to the workspace package, as under bun and npm. Its `packages` globs must match `workspaces` in `generateRootPackageJson`; an integration test checks it.

#### Shared stack entry files with library sections

A file several libraries extend (a framework entry, a global middleware list) is owned by the stack template, never by one library, so the next library adds a section instead of colliding on the same path. The stack template holds the unconditional skeleton, and each library contributes a `{{#if (hasLibrary "x")}}` section that wraps or extends it, like `stack/nextjs/src/proxy.ts.hbs`:
- `stack/tanstack-start/src/server.ts.hbs` is the Cloudflare Worker entry. It is always generated under `cloudflare` (`wrangler.jsonc` `main` points to it unconditionally) and exports Start's handler; a library section wraps `fetch` inside it (evlog: `withEvlog` + `loggerStorage.run`).
- `stack/tanstack-start/src/start.ts.hbs` is Start's `createStart` instance. The gate lives at the top of this one file, as `{{#if (or (hasLibrary "x") ...)}}` listing the libraries that contribute (a project with none gets no file). Libraries only add entries to `requestMiddleware` and `functionMiddleware`.
- A library section must never drop framework defaults. Start applies its default CSRF middleware to server functions only when `src/start.ts` does not exist, so the skeleton always declares `csrfMiddleware` (`createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })`, the same call as Start's default) first in `requestMiddleware`, before any library entry. The same holds for any shared entry file whose presence disables a framework default.
- Express "this file is useless here" with `deploymentSkip` frontmatter in the file itself (both files above skip `cloudflare-static`, where nothing runs per request).

### Scope mapping and path resolution

Scopes: `app` is `apps/{appName}/` (turborepo) or the root (single repo); `pkg` is `packages/{name}/` (turborepo only; the name comes from `mono.name` in frontmatter or META); `root` is the project root.

Each per-kind resolver in `template-resolver.ts` first drops excluded files with `isTemplateExcluded`: `only` does not match the repo type or blueprint, `ctx.project.deployment` is in `deploymentSkip`, or `ctx.blueprint` is in `blueprintSkip`. `resolveDestination()` then computes the path only:
1. Take the relative path from `deploymentPath[ctx.project.deployment]` when present (it overrides `path` and `mono.path`).
2. Single repo: `frontmatter.path`, else that relative path; the scope is not used.
3. Turborepo: scope from `frontmatter.mono.scope`, else the addon's META `mono.scope`, else the default of the template kind: `app` for stack, library, stack-suffixed addon and blueprint files; `root` for repo files and for project addon files (database, orm, deployment, linter, tooling). Then apply the scope prefix above.

### Generated `.env.example` files

Env variables are declared in META (`envs` on libraries, project addons and blueprints) and written by `lib/env-generator.ts`: `collectEnvFiles(ctx)` returns `{ destination, content }[]`, and `collectEnvGroups(ctx)` returns `{ path, vars[] }[]` for the README and agent-context rendering.
- **Value placeholders** (`resolveEnvValue`): `{{projectName}}` and `{{dbPort}}` (when the context has a database port) everywhere; `{{appPort}}` and `{{appUrl}}` for app-scoped variables (`appUrl` is `http://localhost:{port}` unless a selected tooling addon's `runtime.resolveAppUrl` provides it).
- **Who receives a variable**: a library env goes only to the apps that have the library; a project addon env goes to every app. An env with `stacks` is further limited to apps on a listed stack (see `envs` above). Blueprint envs follow the project addon rule.
- **Scope to path**: in a turborepo `{ pkg: 'db' }` is `packages/db/.env.example`, `'app'` is `apps/{appName}/.env.example`, `'root'` is `.env.example`. A `{ pkg }` scope is only written when that package is generated, by the same collector as the package manifests (`collectMonoPackages` in `package-json-generator.ts`): a database env scoped to `{ pkg: 'db' }` lands in `packages/db/.env.example` only with an ORM, and without one it stays in each app's file. A variable whose scopes are all missing packages falls back to the app scope. In a single repo every scope collapses into the root `.env.example`. Lines are deduped by variable key within each file. The Cloudflare account credentials of D1 (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`) are read only by `drizzle-kit` (`d1-http`, `NODE_ENV=production`), so they live in `packages/db/.env.d1.example` (a turborepo) or the root `.env.d1.example` (a single repo), never in an app's `.env.example`.

### Generated `.gitignore`

`.gitignore` is a template per repo type (`templates/repo/{single,turborepo}/__gitignore.hbs`), one section per choice with `has` conditionals (`{{#if (has "stack" "tanstack-start")}}`). A directory that a stack, library or deployment writes at build or dev time and that must not be committed (`.output/` and `.tanstack/` for TanStack Start, `.wrangler/` for Cloudflare) goes in that choice's section. Keep the two files in step.

### Generated agent context

Every generated project gets an `AGENTS.md` plus a `CLAUDE.md` containing exactly `@AGENTS.md`, next to every `AGENTS.md` (the root one and, in a turborepo, `apps/{app}/`). `--no-agent-context` skips them and any blueprint `docs/agents/` file. `lib/agent-context-generator.ts` assembles them from `__agent.md.hbs` fiches placed beside the stack, library and project addon templates (frontmatter `scope`, `heading`, `order`; a fiche rendering empty is dropped), under the header `repo/{single,turborepo}/__agent.md.hbs`. Blueprints add an About section and the `agentArchitecture` text from META.

## Conventions

### Naming
- Choice values (stacks, libraries, options) are lowercase kebab-case: `nextjs`, `tanstack-start`, `better-auth`.
- Types PascalCase (`MetaStack`, `AppContext`), functions camelCase, files lowercase kebab-case, templates `feature.extension.hbs`, special files with the `__` prefix (`__meta__.ts`).
- Package names of generated monorepo packages are defined in META (`mono.name`, for example `db`).

### Type safety and structure
- Strict TypeScript (`packages/config/ts/base.json`), no `any`.
- Types are inferred from META, which is declared `as const satisfies Meta`.
- `@/*` maps to `apps/cli/src/*`.
- Early returns, validation first, graceful cancellation, one error path in the prompt wrappers (`handlePromptCancel`).

### Tooling
- Format and lint rules are in `biome.json`, checked by `bun run check` (CI and the pre-commit lint-staged hook run Biome).
- Commit types are enforced by `.husky/commit-msg`.
- CI (`.github/workflows/ci.yml`) runs `bun run check`, `bun run typecheck`, `bun run build:cli`, unit and integration tests. Releases are automated by `.github/workflows/release.yml` (release-please, then `npm publish`).

## Agent-generated documentation

All documentation produced by AI agents (research reports, plans, audits, cleanup assessments) MUST be written under `docs/agents/`, organized by topic (for example `docs/agents/cleanup/`, `docs/agents/superpowers/plans/`). Never write agent-generated docs to the `docs/` root or other locations.

## Skills

`.claude/skills/` holds workflow skills for Claude Code; the rules above apply to all of them.
- `adding-templates`: add a stack, library or project addon.
- `adding-blueprints`, `extracting-blueprints`, `extracting-templates`: compose a blueprint, or extract one from a working project.
- `updating-libraries`: bump library versions in META.
- `fixing-templates`: fix indentation and spacing in `.hbs` files.
- `documenting-stack`, `documenting-module`, `documenting-blueprint`: write the MDX docs under `apps/www/content/docs`.

## Adding content

### Stack
1. Add the name to `StackName` in `types/meta.ts` and the entry to `META.stacks` in `__meta__.ts`.
2. Create `templates/stack/{stack}/` with `.hbs` files (frontmatter where needed).
3. Declare in META which libraries and deployments support it (`support.stacks`, `stackPackageJson`).
4. Test with `bun run dev:cli`.

### Library or project addon
1. Add the entry to `META.libraries` (or to `META.project.{category}.options`) with `support`, `require`, `packageJson`, `stackPackageJson`, `envs` as needed.
2. Create `templates/libraries/{library}/` (or `templates/project/{category}/{option}/`); put stack-specific files in `file.ext.{stack}.hbs`.
3. Test with `bun run dev:cli`.

### Blueprint
1. Add the entry to `META.blueprints`: label, hint, category, `context` (apps with their libraries, plus `database`, `orm` and `deployment`), optional `packageJson`, `envs` and `agentArchitecture`.
2. Create `templates/blueprints/{blueprint}/` with `.hbs` files; a blueprint file overrides a structural template with the same destination, `blueprintSkip` covers a different one.
3. Test with `bun run dev:cli` and the `--blueprint {name}` flag.

## CLI flags

`bunx create-faster [project-name] [options]`; `--help` prints the current choices. Omitted answers are prompted. Flags are declared in `apps/cli/src/flags.ts`, which is authoritative.

| Flag | Meaning |
|---|---|
| `--app <name:stack:libraries>` | Add an app, repeatable. Libraries are comma-separated and optional: `--app web:nextjs:shadcn,mdx` |
| `--blueprint <name>` | Use a blueprint. Cannot be combined with `--app`, `--database` or `--orm`; `--deployment`, `--linter` and `--tooling` still apply |
| `--database <name>`, `--orm <name>` | Project database and ORM; an ORM requires a database |
| `--deployment <name>` | Deployment platform |
| `--linter <name>` | Linter (single selection) |
| `--tooling <name>` | Tooling, repeatable |
| `--git` / `--no-git` | Initialize a git repository or not |
| `--pm <bun\|npm\|pnpm>` | Package manager |
| `--no-install` | Skip dependency installation |
| `--no-agent-context` | Skip `AGENTS.md` and `CLAUDE.md` |

```bash
bunx create-faster mysaas \
  --app web:nextjs:shadcn,tanstack-query \
  --app api:hono \
  --database postgres --orm drizzle \
  --linter biome --git --pm bun
```

The valid values of each flag come from META; flag validation, `require` rules and runtime-capability checks are applied generically (`validateContext`). After generation the CLI prints the exact command that recreates the project (`tui/summary.ts`).
