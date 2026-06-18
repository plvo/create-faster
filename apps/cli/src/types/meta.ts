export type StackName = 'nextjs' | 'expo' | 'hono' | 'node' | 'tanstack-start';
export type RepoType = 'single' | 'turborepo';
export type MonoScope = 'app' | 'pkg' | 'root';

export type AddonMono = { scope: 'app' } | { scope: 'pkg'; name: string } | { scope: 'root' };

export type EnvScope = 'app' | 'root' | { pkg: string };

export interface EnvVar {
  value: string;
  monoScope: EnvScope[];
}

export interface AddonSupport {
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

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
  [key: string]: unknown;
}

export interface AppUrlContext {
  projectName: string;
  appName: string;
  isTurborepo: boolean;
  port: number;
}

export type AppScriptTransform = ((cmd: string) => string) | { from: string; wrap: (cmd: string) => string };

export interface AddonRuntime {
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
  /** Deployment that exposes databases as per-request bindings (e.g. Cloudflare D1/Hyperdrive). */
  providesDbBindings?: boolean;
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
}

export interface MetaProjectCategory {
  prompt: string;
  selection: 'single' | 'multi';
  require?: string[];
  options: Record<string, MetaAddon>;
}

export interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  moduleType?: 'module';
  packageJson: PackageJsonConfig;
}

export interface MetaRepoStack {
  label: string;
  hint?: string;
}

export interface MetaProject {
  database: MetaProjectCategory;
  orm: MetaProjectCategory;
  deployment: MetaProjectCategory;
  linter: MetaProjectCategory;
  tooling: MetaProjectCategory;
}

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
