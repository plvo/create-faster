export type Scope = 'app' | 'package' | 'root';
export type Category = 'framework' | 'backend' | 'orm' | 'database' | 'extras';

export interface StackMeta {
  label: string;
  hint?: string;
  requires?: Category[];
}

export interface CategoryMeta {
  scope: Scope;
  packageName?: string;
  stacks: Record<string, StackMeta>;
}

export type Meta = Record<Category, CategoryMeta>;

export type StackForCategory<C extends Category> = keyof Meta[C]['stacks'];

export interface AppSelection {
  stack: string;
  appName: string;
}

export interface Config {
  name: string;
  framework?: AppSelection;
  backend?: AppSelection;
  orm?: string;
  database?: string;
  extras?: string[];
}

export interface TemplateContext {
  repo: 'single' | 'turborepo';
  framework?: AppSelection;
  backend?: AppSelection;
  orm?: string;
  database?: string;
  extras?: string[];
}
