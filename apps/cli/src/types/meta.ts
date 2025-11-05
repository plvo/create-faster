export type Scope = 'app' | 'package' | 'root';
export type Category = 'orm' | 'database' | 'extras' | 'repo';

interface SelectOptionBase {
  label: string;
  hint?: string;
}

interface MetaModuleStack extends SelectOptionBase {
  packageName?: string; // if defined, default scope is 'package' for turborepo
}

export type MetaModules = Record<string, Record<string, MetaModuleStack>>;

export interface MetaStack extends SelectOptionBase {
  type: 'app' | 'server';
  scope: Scope;
  requires?: (Category | (string & {}))[];
  modules?: MetaModules;
}

interface MetaCategory {
  scope: Scope;
  packageName?: string; // used for turborepo packages/<packageName>
  requires?: Category[]; // like orm.requires = ['database']
  stacks: Record<string, Omit<MetaStack, 'type' | 'scope'>>;
}

export interface Meta {
  stacks: Record<string, MetaStack>;
  database: MetaCategory;
  orm: MetaCategory;
  extras: MetaCategory;
  repo: MetaCategory;
}

export type StackName = keyof Meta['stacks'];
