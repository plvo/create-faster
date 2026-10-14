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
}

export type FirstRunCommand = { command: string } | { script: string };

/** One thing a fresh project needs before `dev` works; `script` runs through the selected package manager. */
export interface FirstRunStep {
  description: string;
  commands: FirstRunCommand[];
}

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
  envs?: EnvVar[];
  runtime?: AddonRuntime;
  /** ORM scripts that prompt on stdin. The turborepo root runs them inside the package, because turbo's stream UI never forwards stdin. */
  interactiveScripts?: string[];
  /** Steps of a fresh project's first run, in order (README and CLI summary). */
  firstRun?: FirstRunStep[];
}

export interface MetaProjectCategory {
  prompt: string;
  selection: 'single' | 'multi';
  require?: string[];
  options: Record<string, MetaAddon>;
}

interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  moduleType?: 'module';
  packageJson: PackageJsonConfig;
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
  context: {
    apps: { appName: string; stackName: StackName; libraries: string[] }[];
    project: { database?: string; orm?: string; deployment?: string };
  };
  packageJson?: PackageJsonConfig;
  pkgPackageJson?: Record<string, PackageJsonConfig>;
  rootPackageJson?: PackageJsonConfig;
  envs?: EnvVar[];
  agentArchitecture?: string;
  /** Replaces the first-run steps of the project addons, for a blueprint that ships its own setup script. */
  firstRun?: FirstRunStep[];
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  libraries: Record<string, MetaAddon>;
  project: MetaProject;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
  blueprints: Record<string, MetaBlueprint>;
}
