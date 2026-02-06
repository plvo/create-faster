// ABOUTME: Type definitions for META configuration
// ABOUTME: Declarative project addons with libraries and project categories

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
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
}

export interface MetaAddon {
  label: string;
  hint?: string;
  support?: AddonSupport;
  require?: AddonRequire;
  mono?: AddonMono;
  packageJson?: PackageJsonConfig;
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
  packageJson: PackageJsonConfig;
}

export interface MetaRepoStack {
  label: string;
  hint?: string;
}

export interface MetaProject {
  database: MetaProjectCategory;
  orm: MetaProjectCategory;
  tooling: MetaProjectCategory;
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  libraries: Record<string, MetaAddon>;
  project: MetaProject;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}
