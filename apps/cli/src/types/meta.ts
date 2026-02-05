// ABOUTME: Type definitions for META configuration
// ABOUTME: Unified addon system with mono scope for monorepo destination

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type AddonType = 'module' | 'orm' | 'database' | 'extra';
export type RepoType = 'single' | 'turborepo';
export type MonoScope = 'app' | 'pkg' | 'root';

export type AddonMono = { scope: 'app' } | { scope: 'pkg'; name: string } | { scope: 'root' };

export interface AddonSupport {
  stacks?: StackName[] | 'all';
  addons?: string[];
}

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface MetaAddon {
  type: AddonType;
  label: string;
  hint?: string;
  support?: AddonSupport;
  mono?: AddonMono;
  packageJson?: PackageJsonConfig;
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
  addons: Record<string, MetaAddon>;
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}
