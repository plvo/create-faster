export type Scope = 'app' | 'package' | 'root';
export type Category = 'app' | 'server' | 'orm' | 'database' | 'extras' | 'repo';

interface SelectOptionBase {
  label: string;
  hint?: string;
}

interface MetaModuleStack extends SelectOptionBase {
  packageName?: string; // if defined, default scope is 'package' for turborepo
}

export type MetaModules = Record<string, Record<string, MetaModuleStack>>;

export interface MetaStack extends SelectOptionBase {
  hasBackend?: boolean; // like nextjs
  requires?: (Category | (string & {}))[];
  // [group][moduleName]
  modules?: MetaModules;
}

interface MetaCategory {
  scope: Scope;
  packageName?: string; // used for turborepo packages/<packageName>
  requires?: Category[]; // like orm.requires = ['database']
  stacks: Record<string, MetaStack>;
}

export type Meta = Record<Category, MetaCategory>;
export type MetaApp = keyof Meta['app']['stacks'];
export type MetaServer = keyof Meta['server']['stacks'] | 'none';
