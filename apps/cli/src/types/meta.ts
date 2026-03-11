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
  tooling?: string[];
  libraries?: string[];
}

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
  [key: string]: any;
}

export interface MetaAddon {
  label: string;
  hint?: string;
  category?: string;
  compose?: string[];
  support?: AddonSupport;
  require?: AddonRequire;
  mono?: AddonMono;
  packageJson?: PackageJsonConfig;
  appPackageJson?: PackageJsonConfig;
  envs?: EnvVar[];
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

export interface MetaBlueprint {
  label: string;
  hint: string;
  category: string;
  context: {
    apps: { appName: string; stackName: StackName; libraries: string[] }[];
    project: { database?: string; orm?: string; deployment?: string };
  };
  packageJson?: PackageJsonConfig;
  envs?: EnvVar[];
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
