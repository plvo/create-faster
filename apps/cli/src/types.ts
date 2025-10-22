export type Scope = 'app' | 'package' | 'root';
export type Category = 'app' | 'server' | 'orm' | 'database' | 'extras' | 'repo';

export interface MetaStack {
  label: string;
  hint?: string;
  hasBackend?: boolean; // like nextjs
  requires?: (Category | (string & {}))[];
}

export interface MetaCategory {
  scope: Scope;
  packageName?: string; // used for turborepo packages/<packageName>
  requires?: Category[]; // like orm.requires = ['database']
  stacks: Record<string, MetaStack>;
}

export type Meta = Record<Category, MetaCategory>;
type MetaApp = keyof Meta['app']['stacks'];
type MetaServer = keyof Meta['server']['stacks'] | 'builtin';

type MetaModuleStack = Omit<MetaStack, 'hasBackend'> & { packageName?: string };
export type MetaModule = Record<string, Record<string, MetaModuleStack>>; // like nextjs.shadcn

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
