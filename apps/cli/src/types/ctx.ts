// ABOUTME: Context types for template rendering and CLI flow
// ABOUTME: AppContext for per-app config, TemplateContext for full generation

import type { StackName } from './meta';

export interface AppContext {
  appName: string;
  stackName: StackName;
  addons: string[];
}

export type PackageManager = 'bun' | 'npm' | 'pnpm' | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  globalAddons: string[];
  git: boolean;
  pm?: PackageManager;
  skipInstall?: boolean;
}

export interface TemplateFile {
  source: string;
  destination: string;
}

export type EnrichedTemplateContext = TemplateContext & Partial<AppContext>;
