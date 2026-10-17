import { join } from 'node:path';
import Handlebars from 'handlebars';
import { getProjectAddon } from '@/lib/addon-utils';
import type { EnrichedTemplateContext, ProjectContext, TemplateContext } from '@/types/ctx';
import type { PartialFrontmatter } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import { PARTIALS_DIR } from './constants';
import { collectAppSecrets, collectProjectSecrets, collectTaskEnv, resolveAppUrl } from './env-generator';
import { getErrorMessage } from './error-utils';
import { scanDirectory } from './file-writer';
import { collectFirstRunSteps } from './first-run';
import { readFrontmatterFile } from './frontmatter';
import { collectInstallScripts } from './install-scripts';
import { appListensOnPort, collectMonoPackages, getRootScripts } from './package-json-generator';
import {
  getAppScriptCommand,
  getBinaryRunner,
  getPackageRunner,
  getScriptCommand,
  getScriptCommandOfApp,
  getTypeScriptRunner,
} from './package-manager';
import { collectProductionSteps } from './production-steps';
import { resolveAppPort } from './utils';

const COMPILE_OPTIONS: CompileOptions = {
  noEscape: true,
  strict: false,
  preventIndent: false,
};

const PARTIAL_EXTENSION = '.hbs';

export function setupTemplateEngine(partialsDir: string = PARTIALS_DIR): void {
  registerHelpers();
  registerPartials(partialsDir);
}

function registerHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every((v) => Boolean(v)));
  Handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some((v) => Boolean(v)));

  Handlebars.registerHelper('isMono', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('hasLibrary', function (this: EnrichedTemplateContext, name: string) {
    if (Array.isArray(this.libraries)) {
      return this.libraries.includes(name);
    }
    return Array.isArray(this.apps) && this.apps.some((app) => app.libraries.includes(name));
  });

  Handlebars.registerHelper('has', function (this: EnrichedTemplateContext, category: string, value: string) {
    if (category === 'stack') {
      return this.apps.some((app) => app.stackName === value);
    }

    if (!(category in this.project)) {
      return false;
    }

    const categoryValue = this.project[category as keyof ProjectContext];
    if (Array.isArray(categoryValue)) {
      return categoryValue.includes(value);
    } else {
      return categoryValue === value;
    }
  });

  Handlebars.registerHelper('databaseBinding', function (this: EnrichedTemplateContext, binding: string) {
    const { database } = this.project;
    return database !== undefined && getProjectAddon('database', database)?.serverlessBinding === binding;
  });

  Handlebars.registerHelper('hasContext', function (this: TemplateContext, contextName: keyof TemplateContext) {
    return contextName in this && this[contextName] !== undefined;
  });

  Handlebars.registerHelper('hasPackage', (name: string, options: Handlebars.HelperOptions) => {
    return collectMonoPackages(options.data.root as TemplateContext).has(name);
  });

  Handlebars.registerHelper('hasRootScript', function (this: TemplateContext, name: string) {
    return name in getRootScripts(this);
  });

  Handlebars.registerHelper('appUrl', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return appListensOnPort(root, appName) ? resolveAppUrl(root, appName) : '';
  });

  Handlebars.registerHelper('appSecrets', function (this: EnrichedTemplateContext, options: Handlebars.HelperOptions) {
    return this.appName ? collectAppSecrets(options.data.root as TemplateContext, this.appName) : [];
  });

  Handlebars.registerHelper('projectSecrets', (...args: unknown[]) => {
    const options = args.pop() as Handlebars.HelperOptions;
    return collectProjectSecrets(options.data.root as TemplateContext, args as StackName[]);
  });

  Handlebars.registerHelper('taskEnv', (task: string, options: Handlebars.HelperOptions) => {
    return collectTaskEnv(options.data.root as TemplateContext, task);
  });

  Handlebars.registerHelper('monoPackages', (options: Handlebars.HelperOptions) => {
    return [...collectMonoPackages(options.data.root as TemplateContext).keys()];
  });

  Handlebars.registerHelper('runScript', (script: string, ...rest: unknown[]) => {
    const options = rest.pop() as Handlebars.HelperOptions;
    const [args] = rest as (string | undefined)[];
    return getScriptCommand(options.data.root as TemplateContext, script, args);
  });

  Handlebars.registerHelper('tsRunner', (options: Handlebars.HelperOptions) => {
    return getTypeScriptRunner(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('runAppScript', (script: string, options: Handlebars.HelperOptions) => {
    return getAppScriptCommand(options.data.root as TemplateContext, script);
  });

  Handlebars.registerHelper(
    'runScriptOfApp',
    function (this: EnrichedTemplateContext, script: string, options: Handlebars.HelperOptions) {
      return getScriptCommandOfApp(options.data.root as TemplateContext, script, this.appName ?? '');
    },
  );

  Handlebars.registerHelper('installScripts', (options: Handlebars.HelperOptions) => {
    const scripts = collectInstallScripts(options.data.root as TemplateContext);
    return Object.keys(scripts).length > 0 ? scripts : undefined;
  });

  Handlebars.registerHelper('firstRunSteps', (options: Handlebars.HelperOptions) => {
    return collectFirstRunSteps(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('productionSteps', (options: Handlebars.HelperOptions) => {
    return collectProductionSteps(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('stackApps', (stack: string, options: Handlebars.HelperOptions) => {
    return (options.data.root as TemplateContext).apps.filter((app) => app.stackName === stack);
  });

  Handlebars.registerHelper('packageRunner', (options: Handlebars.HelperOptions) => {
    return getPackageRunner(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('binaryRunner', (options: Handlebars.HelperOptions) => {
    return getBinaryRunner(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('camelCase', (str: string) => {
    return str.replace(/[-_]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''));
  });

  Handlebars.registerHelper('pascalCase', (str: string) => {
    return str
      .split(/[-_]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  });

  Handlebars.registerHelper('raw', function (this: TemplateContext, options: Handlebars.HelperOptions) {
    return options.fn(this);
  });

  Handlebars.registerHelper('appPort', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return resolveAppPort(root.apps ?? [], appName);
  });
}

// A partial called alone on its line replaces that line, so it must end with exactly one line break;
// a partial marked `inline: true` is inserted mid-line, so it must end with none. Normalizing here
// keeps an editor's final newline from breaking the callers.
function normalizePartialEnding(content: string, { inline }: PartialFrontmatter): string {
  const body = content.replace(/(\r?\n)+$/, '');
  return inline === true ? body : `${body}\n`;
}

// Each `.hbs` file under the partials directory becomes the partial `{{> <relative path without .hbs>}}`,
// compiled with the same options as the templates that call it.
function registerPartials(partialsDir: string): void {
  for (const file of scanDirectory(partialsDir)) {
    if (!file.endsWith(PARTIAL_EXTENSION)) continue;
    const name = file.slice(0, -PARTIAL_EXTENSION.length);
    const { data, content } = readFrontmatterFile<PartialFrontmatter>(join(partialsDir, file));
    Handlebars.registerPartial(name, Handlebars.compile(normalizePartialEnding(content, data), COMPILE_OPTIONS));
  }
}

export function renderTemplate(templateContent: string, context: TemplateContext): string {
  try {
    const template = Handlebars.compile(templateContent, COMPILE_OPTIONS);

    return template(context);
  } catch (error) {
    throw new Error(`Handlebars compilation failed: ${getErrorMessage(error)}`);
  }
}
