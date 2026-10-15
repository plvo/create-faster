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
| `lib/project-prompts.ts` | Decides which prompts are asked: `shouldPromptCategory`, `arePromptsSuppressed` (`--yes`, no terminal), interactive terminal detection |
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
| `lib/file-generator.ts`, `lib/post-generation.ts` | Generation orchestration; dependency install, the `postGenerate` steps (`lib/post-generate.ts`) and `git init`; a failed install makes the run exit 1 (files kept, retry command printed), a failed `postGenerate` step or `git init` only warns |
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
bun run check:unused         # knip (CI runs it; config in knip.jsonc)
bun run typecheck            # tsc --noEmit on apps/cli (CI runs it)
cd apps/cli && bun test tests/unit tests/integration
cd apps/cli && bun test tests/e2e/<file> --timeout 600000
```

- `tests/unit` and `tests/integration` run in CI. Integration tests run the real CLI and assert on generated files (`tests/integration/helpers.ts`).
- `tests/e2e` generates, installs and builds real projects. It is slow, needs network, and runs on demand, one file at a time.
- Biome does not lint `apps/cli/tests`.
- Tests read plain CLI output whatever the terminal or CI asks for: `apps/cli/bunfig.toml` preloads `tests/setup.ts` (in-process output) and `runCli` passes the same variables to the child CLI (`tests/plain-output-env.ts`: `NO_COLOR=1` and `FORCE_COLOR=0`, because picocolors lets `NO_COLOR` win over `FORCE_COLOR` and `CI` while Bun's own console lets `FORCE_COLOR` win). Never strip escape codes inside a test. A test that needs colors passes `{ NO_COLOR: '', FORCE_COLOR: '1' }` to `runCli`.

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
  - `monoPackages`: the names of the workspace packages a turborepo generates (the keys `collectMonoPackages` returns), for `{{#each (monoPackages)}}`; empty in a single repo. Inside that block `this` is the name, so `has` and `hasLibrary` (which read the context) do not work there: put them outside the block
  - `appSecrets`: the names of the secret variables the current app receives (`EnvVar.secret`, same per-app rules as `env-generator`: library envs only for apps with the library, `stacks` and `when` honored, never a `file` variable), from `collectAppSecrets` in `env-generator.ts`; empty outside an app-scoped file. The `cloudflare/secrets-required` partial renders them as `secrets.required` in every `wrangler.jsonc`
  - `projectSecrets(stack, ...)`: the names of the secret variables received by at least one app on one of the listed stacks, each once (`collectProjectSecrets` in `env-generator.ts`), for `{{#each (projectSecrets "nextjs" "hono")}}`. The `sst` deployment declares one `sst.Secret` per name from it, so a secret no deployed app reads (an app on a stack SST does not deploy) is never required
  - `appUrl(name)`: the dev URL of the app (`http://localhost:{port}`, or the URL a selected tooling addon provides, as for the `{{appUrl}}` env placeholder), or an empty string when the app does not serve on a port (none of its scripts carries the `{{port}}` placeholder: Node, Expo)
  - `hasRootScript(name)`: the generated root `package.json` (the turborepo root, or the single app's) defines the script, derived from META by `getRootScripts` in `package-json-generator.ts`; renders a CI step only when the script exists. A turborepo root gets `turbo start`, `turbo test`, `turbo test:e2e` and `turbo cf-typegen` (`APP_SCRIPTS_RUN_BY_TURBO`) when at least one app declares the script, and `turbo.json.hbs` declares the matching task under the same `hasRootScript` condition
  - `firstRunSteps`: the first-run steps of the project (`{ description, commands }[]`, commands already resolved for the package manager), for `{{#each (firstRunSteps)}}`; see First-run steps
  - `runScript(name)`: a package.json script as the selected package manager runs it (`bun run build`, `npm run build`, `pnpm run build`; `npm` when none is selected). An optional second argument forwards flags to the script, with the `--` npm needs (`{{runScript "db:seed" "--fixtures"}}` is `npm run db:seed -- --fixtures`, `bun run db:seed --fixtures`). Docs and notes written into generated projects never write `{{pm}} build`: a bare `bun build` is Bun's bundler and `npm build` is an unknown command
  - `tsRunner`: the command that runs a TypeScript file under the selected package manager (`bun`, or `tsx` for npm and pnpm; data in `package-manager.ts`). A script that runs a `.ts` file starts with it, and `tsx` is declared as a devDependency under `$when({ pm: { not: 'bun' } })`
  - `runAppScript(name)`: a script only the apps define (`deploy`, `preview`, `build:cf`: a turborepo root has none) as a user runs it: `runScript` in a single repo, `cd apps/<app> && <runScript>` in a turborepo, valid under every package manager. A script the root forwards to every app through turbo (`dev`, `build`, `cf-typegen`) stays `runScript`
  - `stackApps(stack)`: the apps on a stack, for `{{#each (stackApps "nextjs")}}`; inside the block `this` is the app, so `has` and `hasLibrary` do not work there. `{{> cloudflare/app-list stack="nextjs"}}` renders their names, for the note that tells which apps a per-app command applies to
  - `packageRunner`: the selected package manager's binary runner (`bunx`, `npx`, `pnpm dlx`; `npx` when none is selected), data in `package-manager.ts`
  - `camelCase`, `pascalCase` (`DATABASE_URL` and `web-app` become `DatabaseUrl` and `WebApp`), `raw`, `appPort(name)` (3000 + app index)
  - Express conditionals inside templates: `{{#if (has "deployment" "cloudflare")}}...{{/if}}`.
- **Handlebars partials** (`apps/cli/templates/partials/`, registered by `setupTemplateEngine` in `apps/cli/src/lib/handlebars.ts`): `{{> group/name}}` inserts a block that several templates share, rendered with the caller's context plus optional hash parameters. A choice mapping written in several templates (for example stack to better-auth cookie plugin) lives once in a partial, expressed with the helpers above. See Template system, Partials.
- **Frontmatter keys** (`TemplateFrontmatter` in `apps/cli/src/types/meta.ts`, applied generically in `template-resolver.ts`): `path`, `mono` (`scope`/`name`/`path`), `only` (`mono`, `single`, `no-blueprint`), `deploymentPath`, `deploymentSkip`, `blueprintSkip`. `only` and the deployment and blueprint skip keys are honored for every template kind (stack, library, project addon, stack-suffixed addon, repo, blueprint). They are the model: a generic key the resolver honors for ANY value.
- **META data** (`__meta__.ts`; types in `types/meta.ts`): `support`, `require`, `mono`, `packageJson`, `stackPackageJson`, `deploymentPackageJson`, `appPackageJson`, `envs`, `compose`, `runtime`, plus the capability flags below. Compatibility and dependency rules live here as data, validated generically.
  - `stackPackageJson`: per-app-stack dependencies. Honored for libraries, deployments and databases; for a database it lands in each matching app in single and turborepo alike. For example `sqlite` adds `@libsql/client` (same version constant as the db package) to TanStack Start apps running Nitro, so the app resolves it and Nitro externalizes it and traces `libsql` with its native binding instead of bundling it.
  - `deploymentPackageJson`: `Record<deployment, PackageJsonConfig>`, merged generically by `package-json-generator` when `ctx.project.deployment` matches a key. For example `postgres` adds `pg-cloudflare` under `cloudflare`.
  - `envs`: `EnvVar` with `value`, `monoScope`, an optional `when` (a `$when` match such as `{ orm: true }`: the variable is emitted only when it holds) and an optional `stacks: StackName[]`. When `stacks` is set the variable is emitted only for apps whose stack is listed, evaluated per app by `env-generator`, so one project can carry `NEXT_PUBLIC_X` on Next.js apps and `VITE_X` on TanStack Start apps. A root or pkg-scoped variable with `stacks` is emitted when at least one app (with the library, for library envs) has a listed stack. An optional `file` (a name such as `d1`) writes the variable to `.env.<file>.example` (same scope-to-path rules, in the generated project the file is `.env.<file>`) instead of `.env.example`. Use it for a secret that only a CLI reads, never a Worker or a framework: Wrangler, Vite and Next.js load `.env` (and `.env.local`, `.env.<mode>`) into the Worker environment, and OpenNext bundles it into the deployed Worker, while a `.env.<file>` of another name is read by nothing but the tool that loads it explicitly. A template that consumes such a file loads it itself (the drizzle `drizzle.config.ts` calls `process.loadEnvFile('.env.d1')`) and the generated `.gitignore` lists it.
  - `envs` `secret: true` marks a variable the app reads at runtime from outside the repo and must be given in production (`BETTER_AUTH_SECRET`, `PRIVY_APP_SECRET`, and `BETTER_AUTH_URL`: better-auth rejects every host but `localhost` without it). Never a `NEXT_PUBLIC_*` or `VITE_*` value, which is baked into the client at build. A Cloudflare Worker lists the variables it receives in `wrangler.jsonc` under `"secrets": { "required": [...] }` (see Cloudflare). Wrangler keeps only the listed keys in the local `.dev.vars` of a Worker, so a runtime variable that is not marked is missing from `vite preview`; a variable that is a binding on Cloudflare (`DATABASE_URL` through Hyperdrive) stays unmarked. `secret` also takes a `$when` match (`secret: { deployment: 'sst' }`): the variable is a secret only where the match holds, so the `postgres` and `mysql` `DATABASE_URL` is a secret under `sst` and a binding under `cloudflare`. Under `sst`, `sst.config.ts` declares each runtime secret as an `sst.Secret` (named in PascalCase, `DatabaseUrl`, as SST requires) and gives it to the apps that read it through `environment: { DATABASE_URL: secrets.DatabaseUrl.value }`, so the app code keeps reading `process.env`. `link` is not used: a linked `sst.Secret` reaches the code only through `Resource.X.value` of the `sst` SDK, never as an environment variable. A deploy and `sst dev` fail until each one is set (`sst secret set DatabaseUrl <value> --stage <stage>`, or `SST_SECRET_DatabaseUrl` in CI); the generated `AGENTS.md` lists the commands (`project/deployment/sst/__agent.md.hbs`).
  - `postGenerate`: `PostGenerateStep[]` (`{ description, script }`) on a project addon, a package.json script the CLI runs once the dependencies are installed, through the selected package manager (`getScriptCommand`: `bun run format`, `npm run format`, `pnpm run format`). A raw shell string is not accepted: naming a script keeps it portable, and the script must exist on the generated root `package.json` in a single repo and in a turborepo (a unit test checks every declaration). `collectPostGenerateSteps` (`lib/post-generate.ts`) returns the steps of the selected addons in the order of the `META.project` categories, a composite addon (`compose`) contributing the steps of the addons it composes; `runPostGeneration` runs them after a successful install and before `git init`, so the first commit is formatted. The linters with a formatter declare the script that leaves their own check passing: `oxc` and `prettier` (and `eslint-prettier`, through `compose`) `format`, `biome` `check` (`biome format` does not sort imports, which `biome check` enforces); `eslint` has none. A failing step never fails the generation (the files are valid, only unformatted): it warns with the command to rerun, like a failed `git init`, and the run exits 0. A step that did not run (`--no-install`) or failed is listed in the summary's next steps, after the dependency install (`PendingPostGenerateStep`). A formatter must leave alone the generated files that have to stay byte-identical to a tool's own output (the committed `src/routeTree.gen.ts`): they are excluded through the ignore files of each formatter, never through a step.
  - Category-level and addon-level `require`. `require.stacks` requires at least one app on a listed stack (for example `cloudflare-static` requires a Next.js or TanStack Start app; a turborepo mixing it with an unsupported stack still passes, and that app gets no `wrangler.jsonc`).
- **`$when` conditions** (`apps/cli/src/lib/when.ts`, wrapping package.json values and array items in `__meta__.ts`): keys `repo`, `pm` (the effective package manager, `npm` when none is selected, as for the printed commands), `stack`, `library` and any `ProjectContext` category (`database`, `orm`, `deployment`, `linter`, `tooling`). The value is a string, a list (any-of) or `true` (the category has a selection). Every key accepts a negation, `{ not: <value> }`, true when the positive match is false: `$when({ deployment: { not: 'cloudflare' } }, ...)` or `$when({ deployment: { not: ['cloudflare', 'cloudflare-static'] } }, ...)`. An unselected category satisfies any `not` (`{ not: 'cloudflare' }` is true when no deployment is chosen; `{ not: true }` is true only when the category is unselected). `stack` and `library` follow any-app semantics (`{ not: 'nextjs' }` is true only when no app uses Next.js). All keys of one `$when` must hold.
- **package.json script placeholders** (resolved by `resolveScriptPlaceholders` in `addon-utils.ts`, applied to the scripts of every generated package.json): `{{workspaceRoot}}` (repo-relative path to the workspace root: `.` in a single repo, `../..` in a turborepo) and `{{deployAppDir}}` (directory name of the app that consumes the deployment binding: the deployment's `stackPackageJson` stacks, preferring an app with a `needsSingletonDb` library; resolved by `resolveDeployAppDir`). Two more tokens follow the package manager: `{{packageManager}}` (`bun`, `npm` or `pnpm`, for a script that re-enters a script from another directory: `cd {{workspaceRoot}} && {{packageManager}} run db:seed`) and `{{tsRunner}}` (as the Handlebars helper). Author topology-dependent script strings with these tokens in META and combine them with `deploymentPackageJson` + `$when` for repo and deployment splits; never compute app paths in the generator. For example the d1 turborepo migrate script is `wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --local --persist-to {{workspaceRoot}}/.wrangler`.

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
- Local-filesystem capability: a database declares `needsLocalFilesystem: true` (`sqlite` opens a `file:` URL); a deployment declares `providesLocalFilesystem: false` when its runtime has no persistent writable disk (`cloudflare`, Workers; `sst` and `terraform-aws`, Lambda). Read generically by `isLocalFilesystemSatisfied`: a filesystem database is unavailable under a deployment without one (`d1` is the SQLite database there). `validateContext` rejects it in flags and `getCategoryOptionUnavailability` disables it in the prompt.
- Single-select project prompts show incompatibility instead of hiding it: `getCategoryOptionUnavailability` (`addon-utils.ts`) returns a generic, META-derived reason for any option, and `promptProjectCategorySingle` renders unavailable options disabled with that reason. No hardcoded choice value.

### Database first run

Turbo's `ui: stream` never forwards stdin, so a script that prompts hangs behind an invisible prompt (`prisma migrate dev` asks for a migration name) or fails while turbo still reports success (`drizzle-kit push` asks for confirmation and aborts without a TTY). An ORM declares such scripts in `interactiveScripts` (Drizzle `db:push`, Prisma `db:migrate`); `composeRootPackageJson` writes their turborepo root script as `cd packages/<db> && <pm> run <script>` instead of `turbo <script>`. A blueprint `rootPackageJson` must not redefine the `db:*` scripts the ORM already provides.

The Prisma client is generated into `generated/prisma` and not committed, and `prisma generate` reads `DATABASE_URL` through `prisma.config.ts`, so it cannot be a `postinstall` (the install runs before `.env` exists). It runs before `dev` and `build` instead: `repo/turborepo/turbo.json.hbs` adds `^db:generate` to both under `has "orm" "prisma"` and caches `generated/**`; in a single repo the Prisma ORM scripts define `predev` and `prebuild` through `$when({ repo: 'single' })`. Drizzle `db:generate` writes migration files into the source tree, so its task has `cache: false`.

The first-run steps are META data (`firstRun` on a project addon or a blueprint, see below), so the README and the CLI summary cannot drift. The commands never prompt: `docker compose up -d --wait` for a Docker database (`postgres`, `mysql`), then `db:push` for Prisma, or `db:generate` then `db:migrate` for Drizzle (every database, D1 included). The template ships no migration, so `db:migrate` alone has nothing to apply. The `local-setup` script of D1 runs `db:generate` first for the same reason.

### First-run steps

`firstRun` (`FirstRunStep[]`: a `description` and `commands`, each `{ script }` run through the selected package manager like `runScript`, or `{ command }` written as is) is declared on a project addon (a Docker database, an ORM) or on a blueprint. `collectFirstRunSteps` (`lib/first-run.ts`) returns the ordered steps of a project: the env files to copy (derived from `collectEnvGroups`, no META needed), then the `firstRun` of the selected addons in the order of the `META.project` categories. A blueprint `firstRun` replaces the addon steps (a blueprint with its own `local-setup` script declares it), the env step stays. The `firstRunSteps` Handlebars helper exposes the same list to the `readme/first-run` partial (the Getting Started section of both repo READMEs), and `buildStepsNote` in `tui/summary.ts` prints it before `dev`. Adding a database, ORM or blueprint with a first-run command is a META entry, never an edit to either consumer.

### Database TLS in production

A generated client reaching a Docker database through `DATABASE_URL` connects with TLS and certificate verification when `NODE_ENV=production`, and the local `.env.example` URL opts out, so a production build still runs against the local Docker database.
- PostgreSQL: the URL ends with `?sslmode=disable`; the Drizzle and Prisma clients set `ssl: process.env.NODE_ENV === 'production'`, which pg overrides with the parsed `sslmode`.
- MySQL: the URL ends with `?ssl=false`, which both `mysql2` (Drizzle) and the MariaDB connector behind Prisma's adapter read as no TLS. Neither driver lets code options default TLS on under a URL parameter (`mysql2` keeps a truthy code `ssl` over the URL), and the value that turns TLS on differs (`ssl={}` for `mysql2`, which rejects `true`; `ssl=true` for the connector, which reads `{}` as no TLS), so the `mysql/production-tls` partial appends `ssl=<tlsValue>` to the URL in production when it carries no `ssl`.
- Both clients log one warning in production when the URL disables TLS for a host other than localhost (`postgres/tls-warning`, `mysql/production-tls`). A Cloudflare Hyperdrive client has none: the binding carries the connection.
- The generated `AGENTS.md` of each database says where `NODE_ENV=production` comes from for the project's stacks (`database/node-env-production`, shared). A new database that connects with a URL does the same: TLS on in production by default, one URL parameter for the local opt out, a test like `tests/integration/postgres-ssl.test.ts` and an e2e against a real container (`tests/e2e/postgres-production.test.ts`, `tests/e2e/mysql-production.test.ts`).

### Scripts that run under every package manager

A script a generated project ships (a package.json script, `scripts/*.ts`) runs under Node for npm and pnpm and under Bun for bun, so no template calls a Bun API (`Bun.spawn`, `Bun.Glob`, `bun:sqlite`), starts with a `#!/usr/bin/env bun` shebang, or writes `bun run ...`.
- A `.ts` file is run through the `{{tsRunner}}` token (`bun`, or `tsx` for npm and pnpm). `tsx` is a devDependency of the package that runs it, declared with `TSX_RUNNER` (`$when({ pm: { not: 'bun' } })`). It runs the file as CommonJS when the package has no `"type": "module"`, so a script avoids top-level `await`.
- A script that calls another script writes `{{packageManager}} run <script>`, never `bun run --cwd` (`cd {{workspaceRoot}} && {{packageManager}} run db:seed`).
- The command a script prints or runs (`sh` in the blueprint `local-setup.ts`, the usage text of a seed) comes from `{{runScript "name" "args"}}`, resolved when the project is generated. `args` carries the `--` npm needs to forward flags.
- `scripts/local-setup.ts` of the blueprints shares `partials/local-setup/steps.hbs`: `node:child_process` `spawn` with a shell, a directory walk for `.env.example` files, no glob dependency.
- A seed reads its environment itself: `import 'dotenv/config'` first in the generic Drizzle seed (Bun loads `.env` on its own, Node does not), `--env-file` on the blueprint seeds. Prisma loads it through `prisma.config.ts`.
- A seed for the local D1 database opens the miniflare file with `@libsql/client` and `drizzle-orm/libsql` (the same on both runtimes), never `bun:sqlite`.

The `hono` and `node` stacks still run their `dev` and `start` scripts, and the Lambda blueprints their `build`, with `bun`.

### Prompts, testing libraries and linters

- Library prompts group libraries by their `category` field (`UI`, `Content`, `Auth`, `API`, `Data Fetching`, `Forms`, `Runtime`, `Observability`, `Analytics`, `Testing`); `multiselectLibrariesPrompt` in `prompts/stack-prompts.ts` builds the groups from META.
- Testing libraries: `vitest` (Next.js, TanStack Start; jsdom and Testing Library) and `vitest-node` (Hono, Node) declare the scripts `test`, `test:watch`, `test:coverage`; `playwright` (Next.js, TanStack Start, app-scoped config) declares `test:e2e` and `test:e2e:ui`; `jest-expo` (Expo, `jest-expo` preset and React Native Testing Library) declares `test` and `test:watch`.
- Generated and build output is never linted: a generated project must pass its own `lint` script before and after its `build`, for every linter (`tests/e2e/generated-lint.test.ts`). Biome reads the generated `.gitignore` (`vcs.useIgnoreFile`), so a build directory a choice writes only needs its `.gitignore` section; `biome.json.hbs` lists only the generated files that are committed (`routeTree.gen.ts`). The ESLint configs keep explicit ignore lists that mirror those `.gitignore` sections (the `eslint/cloudflare-ignores` partial holds the Cloudflare entries). oxlint, oxfmt and Prettier read `.gitignore` too, and `oxfmt.config.mts.hbs` and `__prettierignore.hbs` add the committed route tree. A new build directory goes in the `.gitignore` section and in the ESLint ignores of its choice.
- Linter `oxc` generates a root `oxlint.config.mts` and `oxfmt.config.mts` (`templates/project/linter/oxc/`). `oxlint.config.mts.hbs` has one override per app that has a React stack or a test library, with native plugins chosen by stack and library, and the `@shadcn/lint` JS plugin for an app that uses shadcn.

### Better Auth and framework cookie plugins

Framework cookie plugins live in the app, in generic templates. The better-auth factory (`create-auth.ts` in a single repo, `packages/auth/src/auth.ts` in a turborepo, from `templates/libraries/better-auth/src/lib/auth/auth.ts.hbs`) has one shape per database, `createAuth(cookiePlugin?)` or `createAuth(db, cookiePlugin?)`. It knows no framework, appends the cookie plugin after its own plugins, and sets `session.disableSessionRefresh` when there is none (a refresh through an instance without a cookie plugin would extend the session in the database but lose the cookie).

Each app builds its instance from the factory with its framework's plugin: `src/lib/auth/auth.ts` (app-scoped `auth-instance.ts.hbs`, in a single repo and in every turborepo app) or `src/lib/server.ts` on D1. A Next.js app and a TanStack Start app can therefore share one auth package. Package-side consumers that cannot import an app instance (the tRPC package) use a cookie-less `createAuth()` for read-only session lookups.

Exception: a single-framework blueprint whose shared package calls cookie-setting endpoints (the `multitenant-saas` routers call `changePassword` with `revokeOtherSessions`, `updateUser`, ...) may bind its framework's plugin in that package (`packages/api/src/auth.ts` calls `createAuth(nextCookies())`), because those cookies must reach the browser. That blueprint is Next.js only, so no other framework shares the package.

Production rate limiting keys on a client address header, which better-auth reads from `advanced.ipAddress.ipAddressHeaders` (default `x-forwarded-for`, which any client can set unless a proxy overwrites it). Every `betterAuth(...)` call (the library factory and the `org-dashboard`, `multitenant-saas`, `dapp-rainbowkit` and `cloudflare-fullstack` blueprint copies) inserts the `better-auth/client-ip` partial inside `advanced`: `cf-connecting-ip` under `cloudflare` (set by the edge, not spoofable through it), `x-forwarded-for` otherwise, with the generated better-auth notes describing the residual risk: better-auth rejects a multi-value `x-forwarded-for` (without `trustedProxies`), so an app exposed directly with no proxy can be dodged by rotating the header (it must sit behind a proxy or CDN that overwrites it), a single appending proxy is safe, and a proxy chain pushes every request into one shared bucket until `advanced.ipAddress.trustedProxies` is set. A new auth file calls the partial, never writes the header. A request that reaches the server with no `x-forwarded-for` would share one bucket with every other client, so the server fills the header with the connection address when it is absent, and leaves one a proxy set alone: `next start` does it itself (`req.headers['x-forwarded-for'] ??= socket.remoteAddress` in Next.js's `base-server.js`), and a TanStack Start app served by Nitro gets the same from `src/lib/nitro/client-ip.ts` (`templates/libraries/better-auth/src/lib/nitro/client-ip.ts.tanstack-start.hbs`), a Nitro plugin on the `request` hook reading `event.req.ip`, registered by `vite.config.ts.hbs` through `nitro({ plugins: [...] })` under `hasLibrary "better-auth"`. It is skipped on `cloudflare` and `cloudflare-static` (`deploymentSkip`), where `cf-connecting-ip` is trusted and there is no Nitro. A client that sends its own `x-forwarded-for` still picks its bucket when nothing in front of the app overwrites it. In e2e the probe in `tests/e2e/auth-probe.ts` plays the proxy or edge by setting a distinct address on both headers, and `expectRateLimitKeysOn` asserts that only the trusted one counts; `expectRateLimitKeysOnConnectionAddress` sends requests with no header from distinct loopback addresses and asserts one bucket per address, and that a header set by a proxy wins over the connection address.

### Post-login redirect

A login or signup form never passes a query parameter (`redirectTo`, `redirect`) straight to `router.push` or `redirect()`: an absolute URL would send a signed-in user to another site (open redirect). The `org-dashboard`, `cloudflare-fullstack` and `multitenant-saas` blueprints each generate `src/lib/safe-redirect.ts` from the `auth/safe-redirect` partial (`safeRedirectPath(value, fallback = '/')`: a single leading `/`, not `//` or `/\`, same origin once parsed, else the fallback), and their forms navigate to `const destination = safeRedirectPath(...)`. `tests/integration/blueprint-safe-redirect.test.ts` evaluates the generated helper and checks every form. A new form that follows a user-supplied destination uses the same file.

### Cloudflare

- Every app on `cloudflare` (Next.js, TanStack Start, Hono) has one script `cf-typegen` (`wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts`, the `CLOUDFLARE_TYPEGEN` constant in META) and a `postinstall` running the same command, so `tsc` and `next build` pass on a fresh install without a manual step (`cloudflare-env.d.ts` is gitignored). `wrangler` is a devDependency, so a production install (`--omit=dev`, `--production`, `--prod`) must pass `--ignore-scripts` or the `postinstall` fails; the `cloudflare/production-install` partial says so in the generated README and agent notes. A turborepo root runs it in every app with `turbo cf-typegen` (`APP_SCRIPTS_RUN_BY_TURBO`, a `cf-typegen` task in `turbo.json`), and the generated README names it through the `readme/cloudflare-types` partial. `cloudflare-static` keeps the script without the `postinstall`: nothing in a static app reads the generated types. Do not add a second name for the script.
- `cloudflare` (Workers) supports Hono (Wrangler), Next.js (OpenNext) and TanStack Start (`@cloudflare/vite-plugin`, no Nitro). `cloudflare-static` supports Next.js and TanStack Start. The deployments are `cloudflare`, `cloudflare-static`, `sst` and `terraform-aws`; the stacks each one supports are in META.
- A TanStack Start app drops `nitro` and the Nitro `start` script through `$when({ deployment: { not: 'cloudflare' } })`. `vite.config.ts.hbs` swaps `nitro()` for `cloudflare()` under `has "deployment" "cloudflare"`. `__env.start.hbs` carries `deploymentSkip: [cloudflare, cloudflare-static]`.
- Every Worker of a project binds the same D1 database: `cloudflare/d1-binding` names it `{{projectName}}-db` (never after the app) with one placeholder id, the database `db:migrate` and the seed target, and the generated notes tell to paste the one `wrangler d1 create` id into each app's `wrangler.jsonc`. Every Worker's local preview persists to the directory those scripts write (`--persist-to {{workspaceRoot}}/.wrangler` for Hono and Next.js, `persistState` for Start), because a Worker left on its own `.wrangler` state queries an empty database.
- Production servers run with `NODE_ENV=production`: Nitro through `NODE_ENV` in `.env.start`, Workers through `config: { vars: { NODE_ENV } }` on the `cloudflare()` plugin (`production` for `vite build`, `development` otherwise). Only the literal `process.env.NODE_ENV` is replaced at build time, not dynamic reads or external dependencies.
- A Next.js app on `cloudflare` declares `next`, `@opennextjs/cloudflare` and `wrangler` as a set: the `next` entry of `META.project.deployment.options.cloudflare.stackPackageJson.nextjs` overrides the stack's `^16.3.0` in a single repo, in every Next.js app of a turborepo and in `cloudflare-fullstack`, and starts where the OpenNext `next` peer range starts (`@opennextjs/cloudflare@1.20.12` peers `next >=15.5.28 <16 || >=16.4.1` and `wrangler ^4.148.0`, the latter held by `WRANGLER_VERSION`: npm refuses to install a range that can resolve outside a peer, ERESOLVE). `1.20.12` is also the first release that serves Next.js 16.4 (before it every route answered 500, opennextjs/opennextjs-cloudflare#1355). Raise them together when OpenNext raises a peer range; `tests/integration/cloudflare-opennext-peer.test.ts` holds the peer ranges and fails when the generated ranges leave them. Next.js apps under any other deployment keep the stack range; `cloudflare-static` is a static export that never loads OpenNext.
- A Next.js app (OpenNext) gets the same through the `cloudflare/node-env-var` partial (`"vars": { "NODE_ENV": "production" }`), inserted in `wrangler.jsonc.nextjs.hbs` and in the `cloudflare-fullstack` blueprint's own copy. Without it a dependency's runtime read of `NODE_ENV` sees `development` in workerd, because the build only inlines the literal `process.env.NODE_ENV`.
- A Next.js app on `cloudflare` or `cloudflare-static` has no `start` script (`$when(RUNS_NODE_SERVER, ...)` in META): `next start` serves it from Node, where OpenNext never initialises `getCloudflareContext` (every page answers 500), and rejects `output: export`. `build:cf` then `preview` runs the production build in workerd. `next.config.ts.hbs` calls `initOpenNextCloudflareForDev` only when `NODE_ENV` is `development`, and the app-side `getEnv()` (`src/lib/env.ts.nextjs.hbs`, and the `cloudflare-fullstack` copy) awaits `connection()` before `getCloudflareContext`, so `next build` never prerenders a page that reads a binding: each build worker would otherwise start a local workerd on the same local D1 state and fail intermittently with `SQLITE_BUSY`.
- With D1, `src/lib/server.ts.tanstack-start.hbs` builds `db` once at module scope from `cloudflare:workers` (the db package factory stays `createDb(d1)`), plus `auth = createAuth(db, tanstackStartCookies())` when better-auth is selected. With Hyperdrive, consumers call `await createDb(env.HYPERDRIVE)` per request.
- Every Hono app on `cloudflare` types `new Hono<{ Bindings: CloudflareEnv }>()` and includes `cloudflare-env.d.ts` in its tsconfig, so `tsc` needs `cf-typegen` first (as for Start). With Hyperdrive, `wrangler.jsonc.hono.hbs` declares the `HYPERDRIVE` binding (the `cloudflare/hyperdrive-binding` partial) and route handlers call `await createDb(c.env.HYPERDRIVE)` per request.
- Every Worker `wrangler.jsonc` template (the Next.js, TanStack Start and Hono ones of `cloudflare`, and the `cloudflare-fullstack` copies) ends with `{{> cloudflare/secrets-required}}`, which renders `"secrets": { "required": [...] }` from `appSecrets`, and nothing when the app has no secret. Wrangler then fails a deploy until each secret is set (`wrangler secret put`, or `--secrets-file` on the first deploy of a Worker that does not exist yet), warns in a local run (`wrangler dev`, `vite preview`) about a missing one, types each as `string` in `cloudflare-env.d.ts` (deterministic, no `.env` needed) and keeps only those keys in `dist/server/.dev.vars`. The field is not inherited by a named Wrangler environment. `cloudflare-static` has no runtime secret, so its templates carry none.
- Next.js on Cloudflare keeps its runtime secrets in `.env`, never in a `.dev.vars`. `build:cf` bundles every `.env*` value (all modes) into `.open-next/cloudflare/next-env.mjs` as a `process.env` fallback, with no opt-out: a secret set with `wrangler secret put` wins at runtime, but the bundled value is used silently when it was never set. A Worker for deploy is therefore built where `.env` holds no real secret (CI), and `preview` needs a `build:cf` after each `.env` change. OpenNext turns off Wrangler's own `.env` loading, so `preview` warns about a missing required secret even when `.env` holds it. The generated notes (`project/deployment/cloudflare/__agent.md.hbs`, the `cloudflare-fullstack` `cloudflare-deploy.md`) say so.
- On TanStack Start, `vite build` writes `dist/server/.dev.vars`, a local copy of `.env` for `vite preview` (the `secrets.required` keys only when listed). `wrangler deploy` does not upload it; `dist` ships only through `wrangler deploy`.

### Expo

- The `expo` stack, `nativewind` and `jest-expo` move together with the Expo SDK. Take every version from `bundledNativeModules.json` of the `expo` package (`react` and `react-native` exact, as React Native checks the renderer version), and verify with `expo-doctor` and `expo export` on a generated project, not only `tsc`.
- `main` is `expo-router/entry`; without it Metro falls back to `expo/AppEntry`. The generated `tsconfig.json` lists its `types` because TypeScript 6 no longer loads every `@types` package.
- Isolated installs (bun and pnpm workspaces) only expose declared dependencies to Babel and Metro: NativeWind's setup resolves `react-native-css-interop`, `babel-preset-expo` and `@babel/plugin-transform-react-jsx` from the app root, so `nativewind` declares them. `jest-expo` only lets the `.pnpm` store through `transformIgnorePatterns`, so `jest.config.js` adds `.bun` when `pm` is bun.
- A turborepo may hold Expo next to a Next.js or TanStack Start app on another React patch version. Each app keeps its own React and Expo's Metro config bundles a single one. `expo-doctor` reports `expo-constants`, `expo-font` and `expo-linking` as duplicates in a bun turborepo (bun's peer-suffixed copies of one version, absent from the Metro bundle), which is expected.

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
- `src/routeTree.gen.ts` is committed (TanStack's convention) but only exists after the first `vite dev` or `vite build`, so a fresh install would fail `tsc` and the editor. The stack declares the `postinstall` `tsr generate` (`GENERATE_ROUTE_TREE` in META) with `@tanstack/router-cli` (a dependency, not a devDependency, so `postinstall` still finds `tsr` in an install without dev dependencies), and `stack/tanstack-start/tsr.config.json.hbs` carries the footer the Start Vite plugin appends to the file (the `Register` block, `createStart` or `startInstance` import), so the file written on install is byte-identical to the one `vite dev` and `vite build` write and committing it causes no churn. Its start-file condition mirrors the gate of `src/start.ts.hbs` (the library list and `cloudflare-static`): change both together. The later declaration of a script name overwrites the earlier one: on `cloudflare` the deployment's `stackPackageJson` for Start declares the `postinstall` as `${CLOUDFLARE_TYPEGEN} && ${GENERATE_ROUTE_TREE}`, so any new `postinstall` step is chained there, never added as a second declaration. The generated README names the file through the `readme/route-tree` partial.
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

### Turborepo workspace packages

A workspace package is generated from META (`collectMonoPackages`): library and ORM `packageJson`, plus the blueprint's `pkgPackageJson`, merged per package.
- **`exports`** only lists files that are generated for the combination. An export a blueprint alone satisfies (`@repo/auth/permissions`, `@repo/ui/hooks/*`) is declared in that blueprint's `pkgPackageJson`, never in the library, and one that depends on a choice uses `$when`. `tests/integration/package-exports.test.ts` generates representative combinations and every blueprint, and checks that every export target exists and every `@repo/x/y` import in the generated sources is covered by an export.
- **`tsconfig.json`** of each package lists the `types` it needs and extends `@repo/config/ts/*` (`react-library.json` has the DOM lib; `base.json` has none). A package compiles the sources of the workspace packages it depends on, so it carries their types too: `@types/node` for `process`, `@cloudflare/workers-types` under `cloudflare` for the `D1Database` and `Hyperdrive` bindings, each added as a devDependency with `$when`. `tests/integration/workspace-package-tsconfig.test.ts` checks it, and `tests/e2e/workspace-packages-typecheck.test.ts` runs `tsc --noEmit` in every app and package.

### Generated `.gitignore`

`.gitignore` is a template per repo type (`templates/repo/{single,turborepo}/__gitignore.hbs`), one section per choice with `has` conditionals (`{{#if (has "stack" "tanstack-start")}}`). A directory that a stack, library or deployment writes at build or dev time and that must not be committed (`.output/` and `.tanstack/` for TanStack Start, `.wrangler/` for Cloudflare) goes in that choice's section. Keep the two files in step.

Under `sst` the root `sst.config.ts` is not compiled by the app: `sst install` writes `.sst/platform/config.d.ts`, which imports the whole SST platform source (about 600 type errors under `verbatimModuleSyntax`), and `**/*.ts` includes `.sst/` as well. A single-repo Next.js or Expo `tsconfig.json` therefore lists `.sst` and `sst.config.ts` in `exclude` (`{{#unless (isMono)}}{{#if (has "deployment" "sst")}}`): excluding the directory alone is not enough, because an imported file is compiled whatever `exclude` says. `tsc` and `next build` then pass before and after `sst install`; SST bundles the config with esbuild and never type-checks it, and an editor gets its types from the `/// <reference path>` once `sst install` (run by `sst dev` and `sst deploy`) has written the platform. A turborepo app sits in `apps/<app>`, away from the root files, so its tsconfig is unchanged.

### Generated agent context

Every generated project gets an `AGENTS.md` plus a `CLAUDE.md` containing exactly `@AGENTS.md`, next to every `AGENTS.md` (the root one and, in a turborepo, `apps/{app}/`). `--no-agent-context` skips them and any blueprint `docs/agents/` file. `lib/agent-context-generator.ts` assembles them from `__agent.md.hbs` fiches placed beside the stack, library and project addon templates (frontmatter `scope`, `heading`, `order`; a fiche rendering empty is dropped), under the header `repo/{single,turborepo}/__agent.md.hbs`. Blueprints add an About section and the `agentArchitecture` text from META.

The Next.js `next.config.ts.hbs` sets `agentRules: false` (option of Next.js 16.3 and later, hence `next: ^16.3.0`). Without it `next dev` run by a coding agent appends its own managed block to `AGENTS.md` (or creates the file under `--no-agent-context`), leaving a fresh project dirty in git. The Next.js fiche points to `node_modules/next/dist/docs/` instead.

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
- CI (`.github/workflows/ci.yml`) runs `bun run check`, `bun run check:unused`, `bun run typecheck`, `bun run build:cli`, unit and integration tests. Releases are automated by `.github/workflows/release.yml` (release-please, then `npm publish`).

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

`bunx create-faster [project-name] [options]`; `--help` prints the current choices. Omitted answers are prompted, per answer: a project category (database, ORM, deployment, linter, tooling) that a flag or the blueprint answered is skipped, the others are asked, and a category whose `require` is unmet is not offered. Prompts for what no flag answered are only asked in an interactive terminal (`process.stdin.isTTY` and `process.stdout.isTTY`) once any flag is passed (`arePromptsSuppressed` in `lib/project-prompts.ts`); without one, project categories stay empty, a missing `--git`/`--no-git` means no git and a missing `--pm`/`--no-install` means no install, so scripts and agents never block. `--yes` suppresses them in a terminal too (the project name and the apps are still asked). A run with no flag at all prompts everything. `require` and capability checks of what the flags selected (`validateRequirements`) run right after the flags are parsed without a terminal, and after the prompts in a terminal, so `--app web:nextjs:better-auth` prompts the database instead of failing; what a prompt leaves unmet is rejected after it. The needs of Husky are its META `require`, checked like any other. Every project category flag accepts `none` (`--database none`, `--tooling none`), validated generically from `META.project`: the category is answered with no selection, so it is neither prompted nor filled; `none` cannot be mixed with another `--tooling` value. The recreate command printed by `tui/summary.ts` is exact: it adds `--yes` when it leaves a category, git or the package manager empty (shorter than `none` per category), and `--no-install` next to `--pm` when the install was skipped. Flags are declared in `apps/cli/src/flags.ts`, which is authoritative.

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
| `--yes` | Ask nothing no flag answers: project categories stay empty, no git, no install |
| `none` as a value | Any project category flag: explicit "no selection" |

```bash
bunx create-faster mysaas \
  --app web:nextjs:shadcn,tanstack-query \
  --app api:hono \
  --database postgres --orm drizzle \
  --linter biome --git --pm bun
```

The valid values of each flag come from META; flag validation, `require` rules and runtime-capability checks are applied generically (`validateContext`). After generation the CLI prints the exact command that recreates the project (`tui/summary.ts`).
