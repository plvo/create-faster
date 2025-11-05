import type { Meta, MetaApp, MetaServer } from './meta';

export interface AppContext {
  appName: string;
  metaApp?: {
    name: MetaApp;
    modules: string[];
  };
  metaServer?: {
    name: MetaServer;
    modules: string[];
  };
}

type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  orm?: keyof Meta['orm']['stacks'];
  database?: keyof Meta['database']['stacks'];
  git: boolean;
  pm?: PackageManager;
  extras?: (keyof Meta['extras']['stacks'])[];
}

export interface TemplateFile {
  source: string;
  destination: string;
}
