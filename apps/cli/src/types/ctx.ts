import type { StackName } from './meta';

export interface AppContext {
  appName: string;
  stackName: StackName;
  libraries: string[];
}

export interface ProjectContext {
  database?: string;
  orm?: string;
  linter?: string;
  tooling: string[];
}

export type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  project: ProjectContext;
  git: boolean;
  pm?: PackageManager;
  skipInstall?: boolean;
}

export interface TemplateFile {
  source: string;
  destination: string;
}

export type EnrichedTemplateContext = TemplateContext & Partial<AppContext>;
