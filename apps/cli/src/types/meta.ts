// ABOUTME: Type definitions for META configuration
// ABOUTME: Declarative project addons with libraries and project categories

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type RepoType = 'single' | 'turborepo';
export type MonoScope = 'app' | 'pkg' | 'root';

export type AddonMono = { scope: 'app' } | { scope: 'pkg'; name: string } | { scope: 'root' };

export interface AddonSupport {
  stacks?: StackName[] | 'all';
  require?: string[];
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
  require?: { git?: boolean };
  mono?: AddonMono;
  packageJson?: PackageJsonConfig;
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

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  libraries: Record<string, MetaAddon>;
  project: Record<string, MetaProjectCategory>;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}
