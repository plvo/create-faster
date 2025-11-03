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

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  orm?: keyof Meta['orm']['stacks'];
  database?: keyof Meta['database']['stacks'];
  git: boolean;
  extras?: (keyof Meta['extras']['stacks'])[];
}

export interface TemplateFile {
  source: string;
  destination: string;
}
