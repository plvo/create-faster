// ABOUTME: Type definitions for META configuration
// ABOUTME: Unified addon system with discriminated destination types

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type AddonType = 'module' | 'orm' | 'database' | 'extra';
export type RepoType = 'single' | 'turborepo';

// Discriminated union for destination - package requires name
export type AddonDestination =
  | { target: 'app' }
  | { target: 'package'; name: string; singlePath?: string }
  | { target: 'root' };

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
  destination?: AddonDestination;
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
