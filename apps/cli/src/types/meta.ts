import type { PackageManagerName } from '@/types/ctx';
import type { StackName } from '@/types/stack-name';
import type { Conditional, WhenMatch } from '@/types/when';

type RepoType = 'single' | 'turborepo';
export type MonoScope = 'app' | 'pkg' | 'root';

type AddonMono = { scope: 'app' } | { scope: 'pkg'; name: string } | { scope: 'root' };

export type EnvScope = 'app' | 'root' | { pkg: string };

export interface EnvVar {
  value: string;
  monoScope: EnvScope[];
  stacks?: StackName[];
  when?: WhenMatch;
  file?: string;
  secret?: boolean | WhenMatch;
  /** Turborepo tasks that read the variable; the root `turbo.json` lists it in their `env` (`taskEnv` helper). */
  tasks?: string[];
  /** A command that prints a value for the variable; the first-run steps tell to run it and set the variable in the `.env` of each app that reads it. The CLI never writes the value. */
  generateCommand?: string;
}

export type FirstRunCommand = { command: string } | { script: string };

/** One thing a fresh project needs before `dev` works; `script` runs through the selected package manager. */
export interface FirstRunStep {
  description: string;
  commands: FirstRunCommand[];
}

/** A package.json script that builds, serves or ships a project, with the sentence the READMEs and the CLI summary give it. */
export interface ProductionScript {
  script: string;
  description: string;
}

/** A package.json script the CLI runs through the selected package manager once the dependencies are installed. */
export interface PostGenerateStep {
  description: string;
  script: string;
}

/** Dependencies by package name: `true` lets the install scripts of the package run, `false` skips them. */
export type InstallScripts = Record<string, boolean>;

interface AddonSupport {
  stacks?: StackName[] | 'all';
}

// Mirrors ProjectContext keys but with string[] for "one of these" semantics
export interface AddonRequire {
  git?: true;
  linter?: true | string[];
  database?: string[];
  orm?: string[];
  deployment?: string[];
  tooling?: string[];
  libraries?: string[];
  stacks?: StackName[];
}

interface PackageJsonShape<Value> {
  dependencies?: Record<string, Value>;
  devDependencies?: Record<string, Value>;
  scripts?: Record<string, Value>;
  exports?: Record<string, Value>;
  [key: string]: unknown;
}

/** Package.json contribution as authored in META: values may be `$when` conditionals. */
export type PackageJsonConfig = PackageJsonShape<Conditional<string>>;

/** Package.json contribution after `$when` conditionals are resolved against a context. */
export type ResolvedPackageJsonConfig = PackageJsonShape<string>;

interface AppUrlContext {
  projectName: string;
  appName: string;
  isTurborepo: boolean;
  port: number;
}

export type AppScriptTransform = ((cmd: string) => string) | { from: string; wrap: (cmd: string) => string };

interface AddonRuntime {
  /** Transform or add app scripts. Key = output script name. */
  appScripts?: Record<string, AppScriptTransform>;
  /** Resolve the {{appUrl}} env placeholder for apps where this addon is active */
  resolveAppUrl?: (ctx: AppUrlContext) => string;
}

export interface MetaAddon {
  label: string;
  hint?: string;
  category?: string;
  compose?: string[];
  support?: AddonSupport;
  require?: AddonRequire;
  /** Library that cannot run without a server runtime (e.g. better-auth, trpc). */
  needsServerRuntime?: boolean;
  /** Deployment that runs on a server runtime. Defaults to true; set false for static-only targets. */
  providesServerRuntime?: boolean;
  /** Database accessed per-request through a Cloudflare binding (no module singleton) on a binding-providing deployment. */
  serverlessBinding?: string;
  /** Binding database whose server-side consumers (better-auth/trpc) are wired per-request, so it no longer needs a singleton. */
  serverlessConsumersWired?: boolean;
  /** Deployment that exposes databases as per-request bindings (e.g. Cloudflare D1/Hyperdrive). */
  providesDbBindings?: boolean;
  /** Database stored in files on the local disk (e.g. SQLite), so it needs a deployment that provides a filesystem. */
  needsLocalFilesystem?: boolean;
  /** Deployment with a writable local filesystem. Defaults to true; set false for runtimes without one (e.g. Cloudflare Workers). */
  providesLocalFilesystem?: boolean;
  /** Library that consumes a module-singleton `db` and cannot use a per-request binding database yet. */
  needsSingletonDb?: boolean;
  mono?: AddonMono;
  packageJson?: PackageJsonConfig;
  /** Package.json contribution applied when `ctx.project.deployment` matches the key. */
  deploymentPackageJson?: Record<string, PackageJsonConfig>;
  stackPackageJson?: Partial<Record<StackName, PackageJsonConfig>>;
  appPackageJson?: PackageJsonConfig;
  /** Install scripts of the dependencies this addon brings, direct or transitive. */
  installScripts?: InstallScripts;
  envs?: EnvVar[];
  runtime?: AddonRuntime;
  /** ORM scripts that prompt on stdin. The turborepo root runs them inside the package, because turbo's stream UI never forwards stdin. */
  interactiveScripts?: string[];
  /** Steps of a fresh project's first run, in order (README and CLI summary). */
  firstRun?: FirstRunStep[];
  /** Scripts run once the dependencies are installed. A failing step only warns. */
  postGenerate?: PostGenerateStep[];
  /** The scripts this addon adds that build, serve or ship an app, in the order a user runs them. */
  productionScripts?: Conditional<ProductionScript>[];
}

export interface MetaProjectCategory {
  prompt: string;
  selection: 'single' | 'multi';
  require?: string[];
  options: Record<string, MetaAddon>;
}

/** Package.json contribution applied when the effective package manager matches the key. */
export type PackageManagerPackageJson = Partial<Record<PackageManagerName, PackageJsonConfig>>;

interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  moduleType?: 'module';
  packageJson: PackageJsonConfig;
  packageManagerPackageJson?: PackageManagerPackageJson;
  /** Install scripts of the dependencies this stack brings, direct or transitive. */
  installScripts?: InstallScripts;
  /** The scripts of this stack that build, serve or ship an app, in the order a user runs them. */
  productionScripts?: Conditional<ProductionScript>[];
}

interface MetaRepoStack {
  label: string;
  hint?: string;
}

type MetaProject = {
  database: MetaProjectCategory;
  orm: MetaProjectCategory;
  deployment: MetaProjectCategory;
  linter: MetaProjectCategory;
  tooling: MetaProjectCategory;
};

export type ProjectCategoryName = keyof MetaProject;

export interface TemplateFrontmatter {
  path?: string;
  mono?: {
    scope?: MonoScope;
    name?: string;
    path?: string;
  };
  only?: 'mono' | 'single' | 'no-blueprint';
  deploymentPath?: Record<string, string>;
  deploymentSkip?: string[];
  blueprintSkip?: string[];
}

export interface PartialFrontmatter {
  inline?: boolean;
}

export interface MetaBlueprint {
  label: string;
  hint: string;
  category: string;
  /** Blueprint whose templates this one inherits, its own files winning per destination. Templates only: context, envs, package.json and `firstRun` are declared on each blueprint. */
  extends?: string;
  context: {
    apps: { appName: string; stackName: StackName; libraries: string[] }[];
    project: { database?: string; orm?: string; deployment?: string };
  };
  packageJson?: PackageJsonConfig;
  packageManagerPackageJson?: PackageManagerPackageJson;
  pkgPackageJson?: Record<string, PackageJsonConfig>;
  rootPackageJson?: PackageJsonConfig;
  /** Install scripts of the dependencies this blueprint brings beyond its apps and addons. */
  installScripts?: InstallScripts;
  envs?: EnvVar[];
  agentArchitecture?: string;
  /** Replaces the first-run steps of the project addons, for a blueprint that ships its own setup script. */
  firstRun?: FirstRunStep[];
}

export interface MetaLibrary extends MetaAddon {
  /** Package.json keys only the repo root reads (npm `overrides`): the app's package.json in a single repo, the root one of a turborepo. */
  rootPackageJson?: PackageJsonConfig;
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  libraries: Record<string, MetaLibrary>;
  project: MetaProject;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
  blueprints: Record<string, MetaBlueprint>;
}
