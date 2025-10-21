export type Repo = 'single' | 'turborepo';
export type Scope = 'app' | 'package' | 'root';
export type Platform = 'web' | 'api' | 'mobile';
export type Category = Platform | 'orm' | 'database' | 'extras' | 'repo';

export interface StackMeta {
  label: string;
  hint?: string;
  hasBackend?: boolean;
  requires?: (Category | (string & {}))[];
  framework?: Framework;
}

export interface CategoryMeta {
  scope: Scope;
  packageName?: string;
  requires?: Category[];
  stacks: Record<string, StackMeta>;
}

export type Meta = Record<Category, CategoryMeta>;

export type ModuleStackMeta = Omit<StackMeta, 'framework'> & { packageName?: string };
export type ModuleMeta = Record<Framework, Record<string, ModuleStackMeta>>;

export type Framework = keyof Meta[Platform]['stacks'];
export type Backend = 'builtin' | keyof Meta['api']['stacks'];

export interface App {
  appName: string;
  platform: Platform;
  framework: Framework;
  backend?: Backend;
  modules?: string[];
}

export interface TemplateContext {
  projectName: string;
  repo: Repo;
  apps: App[];
  orm?: keyof Meta['orm']['stacks'];
  database?: keyof Meta['database']['stacks'];
  git: boolean;
  extras?: (keyof Meta['extras']['stacks'])[];
}

export interface TemplateFile {
  source: string;
  destination: string;
}
