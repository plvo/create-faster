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
  orm?: keyof Meta['orm']['stacks'] | null;
  database?: keyof Meta['database']['stacks'] | null;
  git: boolean;
  pm?: PackageManager;
  extras?: (keyof Meta['extras']['stacks'])[];
  skipInstall?: boolean;
}

export interface TemplateFile {
  source: string;
  destination: string;
}
