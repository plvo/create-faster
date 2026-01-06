import type { Meta, StackName } from './meta';

export interface AppContext {
  appName: string;
  stackName: StackName;
  modules: string[];
}

type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  orm?: keyof Meta['orm']['stacks'];
  database?: keyof Meta['database']['stacks'];
  linter?: keyof Meta['linter']['stacks'];
  git: boolean;
  pm?: PackageManager;
  extras?: (keyof Meta['extras']['stacks'])[];
}

export interface TemplateFile {
  source: string;
  destination: string;
}
