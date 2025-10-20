export type Scope = 'app' | 'package' | 'root';
export type Platform = 'web' | 'api' | 'mobile';
export type Category = 'web' | 'api' | 'mobile' | 'orm' | 'database' | 'extras';

export interface StackMeta {
  label: string;
  hint?: string;
  requires?: Category[];
  hasBackend?: boolean;
}

export interface CategoryMeta {
  scope: Scope;
  packageName?: string;
  stacks: Record<string, StackMeta>;
}

export type Meta = Record<Category, CategoryMeta>;

export type StackForCategory<C extends Category> = keyof Meta[C]['stacks'];

export interface App {
  name: string;
  platform: Platform;
  framework: string;
  backend?: string;
}

export interface Config {
  name: string;
  apps: App[];
  orm?: string;
  database?: string;
  extras?: string[];
}

export interface TemplateContext {
  repo: 'single' | 'turborepo';
  apps: App[];
  orm?: string;
  database?: string;
  extras?: string[];
}
