// ABOUTME: Type definitions for META configuration
// ABOUTME: Defines stacks, modules, orm, database, extras, and repo structures

export type StackName = 'nextjs' | 'expo' | 'hono' | 'tanstack-start';
export type StacksCompatibility = StackName[] | 'all';
export type ModuleName = string;
export type OrmName = 'drizzle' | 'prisma';
export type DatabaseName = 'postgres' | 'mysql';
export type ExtraName = 'biome' | 'husky';
export type RepoType = 'single' | 'turborepo';

export interface PackageJsonConfig {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface MetaStack {
  type: 'app' | 'server';
  label: string;
  hint?: string;
  packageJson: PackageJsonConfig;
}

export interface MetaModule {
  label: string;
  hint?: string;
  stacks: StacksCompatibility;
  asPackage?: string;
  singlePath?: string;
  requires?: string[];
  packageJson: PackageJsonConfig;
}

export interface MetaOrmStack {
  label: string;
  hint?: string;
  asPackage: string;
  singlePath: string;
  packageJson: PackageJsonConfig;
}

export interface MetaDatabaseStack {
  label: string;
  hint?: string;
  packageJson?: PackageJsonConfig;
}

export interface MetaExtraStack {
  label: string;
  hint?: string;
  requires?: string[];
  packageJson?: PackageJsonConfig;
}

export interface MetaRepoStack {
  label: string;
  hint?: string;
}

export interface MetaOrm {
  asPackage: string;
  singlePath: string;
  requires: string[];
  stacks: Record<OrmName, MetaOrmStack>;
}

export interface Meta {
  stacks: Record<StackName, MetaStack>;
  modules: Record<ModuleName, MetaModule>;
  orm: MetaOrm;
  database: {
    stacks: Record<DatabaseName, MetaDatabaseStack>;
  };
  extras: {
    stacks: Record<ExtraName, MetaExtraStack>;
  };
  repo: {
    stacks: Record<RepoType, MetaRepoStack>;
  };
}

export function isModuleCompatible(module: MetaModule, stackName: StackName): boolean {
  if (module.stacks === 'all') return true;
  return module.stacks.includes(stackName);
}
