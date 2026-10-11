import type { PACKAGE_MANAGERS } from '@/lib/constants';
import type { StackName } from '@/types/stack-name';

export interface AppContext {
  appName: string;
  stackName: StackName;
  libraries: string[];
}

export interface ProjectContext {
  database?: string;
  orm?: string;
  deployment?: string;
  linter?: string;
  tooling: string[];
}

export type PackageManagerName = (typeof PACKAGE_MANAGERS)[number];

export type PackageManager = PackageManagerName | undefined;

export interface TemplateContext {
  projectName: string;
  repo: 'single' | 'turborepo';
  apps: AppContext[];
  project: ProjectContext;
  git: boolean;
  pm?: PackageManager;
  skipInstall?: boolean;
  blueprint?: string;
  dbPort?: number;
  agentContext?: boolean;
}

export interface TemplateFile {
  source: string;
  destination: string;
}

export interface ProcessResult {
  success: boolean;
  destination: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export type EnrichedTemplateContext = TemplateContext & Partial<AppContext>;
