import { join } from 'node:path';
import Handlebars from 'handlebars';
import { getBlueprintSeed, getProjectAddon, resolveDeployAppDir } from '@/lib/addon-utils';
import { collectGeneratedFiles } from '@/lib/generated-files';
import type { EnrichedTemplateContext, ProjectContext, TemplateContext } from '@/types/ctx';
import type { GeneratedFileTool, PartialFrontmatter } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import { PARTIALS_DIR } from './constants';
import {
  collectAppOriginEnvs,
  collectAppReceivesEnv,
  collectAppSecretDetails,
  collectAppSecrets,
  collectDeploySecrets,
  collectEnvFileNames,
  collectProjectSecrets,
  collectTaskEnv,
  collectThirdPartyEnvs,
  resolveAppUrl,
} from './env-generator';
import { getErrorMessage } from './error-utils';
import { scanDirectory } from './file-writer';
import { collectFirstRunSteps } from './first-run';
import { readFrontmatterFile } from './frontmatter';
import { collectInstallScripts } from './install-scripts';
import { collectInteractiveSteps, getInteractiveScript } from './interactive-steps';
import { appListensOnPort, collectMonoPackages, getAppScripts, getRootScripts } from './package-json-generator';
import {
  getAppScriptCommand,
  getCommandInWorkspaceDirectory,
  getInstalledBinaryRunner,
  getPackageRunner,
  getScriptCommand,
  getTypeScriptRunner,
} from './package-manager';
import { collectManualPostGenerateSteps } from './post-generate';
import { collectProductionSteps } from './production-steps';
import { collectScriptList, describeScript } from './script-list';
import { getAllTemplatesForContext, resolveBlueprintChain } from './template-resolver';
import { resolveAppPort } from './utils';

const COMPILE_OPTIONS: CompileOptions = {
  noEscape: true,
  strict: false,
  preventIndent: false,
};

const PARTIAL_EXTENSION = '.hbs';

const EMPTY_PARTIAL = (): string => '';
const DEFAULT_SEED_FILE = 'scripts/seed.ts';

/** Truthiness as `{{#if}}` reads it: a helper that returns a list (`appSecrets`) is false when the list is empty. */
const isPresent = (value: unknown): boolean => Boolean(value) && !(Array.isArray(value) && value.length === 0);

export function setupTemplateEngine(partialsDir: string = PARTIALS_DIR): void {
  registerHelpers();
  registerPartials(partialsDir);
}

function registerHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(isPresent));
  Handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(isPresent));

  Handlebars.registerHelper('isMono', (options: Handlebars.HelperOptions) => {
    return (options.data.root as TemplateContext).repo === 'turborepo';
  });

  Handlebars.registerHelper('hasLibrary', function (this: EnrichedTemplateContext, name: string) {
    if (Array.isArray(this.libraries)) {
      return this.libraries.includes(name);
    }
    return Array.isArray(this.apps) && this.apps.some((app) => app.libraries.includes(name));
  });

  Handlebars.registerHelper('has', (category: string, value: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    if (category === 'stack') {
      return root.apps.some((app) => app.stackName === value);
    }

    if (!(category in root.project)) {
      return false;
    }

    const categoryValue = root.project[category as keyof ProjectContext];
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

  Handlebars.registerHelper('hasAppScript', (name: string, options: Handlebars.HelperOptions) => {
    return getAppScripts(options.data.root as TemplateContext).some(({ scripts }) => name in scripts);
  });

  Handlebars.registerHelper('appUrl', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return appListensOnPort(root, appName) ? resolveAppUrl(root, appName) : '';
  });

  Handlebars.registerHelper('listeningApps', (options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return root.apps.filter((app) => appListensOnPort(root, app.appName));
  });

  Handlebars.registerHelper('appSecrets', function (this: EnrichedTemplateContext, options: Handlebars.HelperOptions) {
    return this.appName ? collectAppSecrets(options.data.root as TemplateContext, this.appName) : [];
  });

  Handlebars.registerHelper(
    'appSecretDetails',
    function (this: EnrichedTemplateContext, options: Handlebars.HelperOptions) {
      return this.appName ? collectAppSecretDetails(options.data.root as TemplateContext, this.appName) : [];
    },
  );

  Handlebars.registerHelper('deploySecrets', (options: Handlebars.HelperOptions) => {
    return collectDeploySecrets(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('appOriginEnvs', (...args: unknown[]) => {
    const options = args.pop() as Handlebars.HelperOptions;
    return collectAppOriginEnvs(options.data.root as TemplateContext, args as StackName[]);
  });

  Handlebars.registerHelper(
    'receivesEnv',
    function (this: EnrichedTemplateContext, name: string, options: Handlebars.HelperOptions) {
      return this.appName ? collectAppReceivesEnv(options.data.root as TemplateContext, this.appName, name) : false;
    },
  );

  Handlebars.registerHelper('envFiles', (options: Handlebars.HelperOptions) =>
    collectEnvFileNames(options.data.root as TemplateContext),
  );

  Handlebars.registerHelper('projectSecrets', (...args: unknown[]) => {
    const options = args.pop() as Handlebars.HelperOptions;
    return collectProjectSecrets(options.data.root as TemplateContext, args as StackName[]);
  });

  Handlebars.registerHelper('taskEnv', (task: string, options: Handlebars.HelperOptions) => {
    return collectTaskEnv(options.data.root as TemplateContext, task);
  });

  Handlebars.registerHelper('thirdPartyEnvs', (options: Handlebars.HelperOptions) => {
    return collectThirdPartyEnvs(options.data.root as TemplateContext);
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

  Handlebars.registerHelper('inDirectory', function (this: unknown, ...args: unknown[]) {
    const options = args.pop() as Handlebars.HelperOptions;
    return getCommandInWorkspaceDirectory(
      options.data.root as TemplateContext,
      args.join('/'),
      options.fn(this).trim(),
    );
  });

  Handlebars.registerHelper('joinEntries', function (this: unknown, options: Handlebars.HelperOptions) {
    const entries: string[] = [];
    options.fn(this, { data: { ...Handlebars.createFrame(options.data), joinedEntries: entries } });
    const { open = '', close = '', closeIndent = '' } = options.hash as Record<string, string | undefined>;
    if (entries.length === 0) return `${open}${close}`;
    const body = entries.join(',\n');
    return open || close ? `${open}\n${body}\n${closeIndent}${close}` : body;
  });

  Handlebars.registerHelper('entry', function (this: unknown, options: Handlebars.HelperOptions) {
    const entries = options.data.joinedEntries as string[] | undefined;
    if (!entries) throw new Error('{{#entry}} must be inside {{#joinEntries}}');
    const content = options
      .fn(this)
      .replace(/^\s*\n/, '')
      .trimEnd();
    if (content.trim() !== '') entries.push(content);
    return '';
  });

  Handlebars.registerHelper('orderedSteps', function (this: unknown, options: Handlebars.HelperOptions) {
    const steps: string[] = [];
    options.fn(this, { data: { ...Handlebars.createFrame(options.data), orderedSteps: steps } });
    return steps.map((content, index) => `${index + 1}. ${content}\n`).join('\n');
  });

  Handlebars.registerHelper('step', function (this: unknown, options: Handlebars.HelperOptions) {
    const steps = options.data.orderedSteps as string[] | undefined;
    if (!steps) throw new Error('{{#step}} must be inside {{#orderedSteps}}');
    const content = options
      .fn(this)
      .replace(/^\s*\n/, '')
      .trimEnd();
    if (content.trim() !== '') steps.push(content);
    return '';
  });

  Handlebars.registerHelper('deployAppDir', (options: Handlebars.HelperOptions) => {
    return resolveDeployAppDir(options.data.root as TemplateContext) ?? '';
  });

  Handlebars.registerHelper('installScripts', (options: Handlebars.HelperOptions) => {
    const scripts = collectInstallScripts(options.data.root as TemplateContext);
    return Object.keys(scripts).length > 0 ? scripts : undefined;
  });

  Handlebars.registerHelper('firstRunSteps', (options: Handlebars.HelperOptions) => {
    return collectFirstRunSteps(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper(
    'interactiveScript',
    function (this: EnrichedTemplateContext, options: Handlebars.HelperOptions) {
      return this.appName ? getInteractiveScript(options.data.root as TemplateContext, this.appName) : undefined;
    },
  );

  Handlebars.registerHelper('interactiveSteps', (options: Handlebars.HelperOptions) => {
    return collectInteractiveSteps(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('manualPostGenerateSteps', (options: Handlebars.HelperOptions) => {
    return collectManualPostGenerateSteps(options.data.root as TemplateContext).map(({ description, command }) => ({
      description,
      commands: [command],
    }));
  });

  Handlebars.registerHelper('productionSteps', (options: Handlebars.HelperOptions) => {
    return collectProductionSteps(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('scriptList', (options: Handlebars.HelperOptions) => {
    return collectScriptList(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('scriptDescription', (script: string, options: Handlebars.HelperOptions) => {
    return describeScript(options.data.root as TemplateContext, script) ?? '';
  });

  Handlebars.registerHelper('stackApps', (stack: string, options: Handlebars.HelperOptions) => {
    return (options.data.root as TemplateContext).apps.filter((app) => app.stackName === stack);
  });

  Handlebars.registerHelper('packageRunner', (options: Handlebars.HelperOptions) => {
    return getPackageRunner(options.data.root as TemplateContext);
  });

  Handlebars.registerHelper('installedBinaryRunner', (options: Handlebars.HelperOptions) => {
    return getInstalledBinaryRunner(options.data.root as TemplateContext);
  });

  // The destinations do not depend on the app being rendered, so a project resolves them once. They are the paths the resolver
  // keeps before rendering: a template that renders empty still counts, because rendering one needs this helper to answer.
  const generatedDestinations = new WeakMap<object, string[]>();
  Handlebars.registerHelper('hasAppFile', (path: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    let destinations = generatedDestinations.get(root);
    if (!destinations) {
      destinations = getAllTemplatesForContext(root).map((template) => template.destination);
      generatedDestinations.set(root, destinations);
    }
    return destinations.some(
      (destination) =>
        destination === path || (destination.startsWith('apps/') && destination.split('/').slice(2).join('/') === path),
    );
  });

  Handlebars.registerHelper('hasBlueprintPartial', (name: string, options: Handlebars.HelperOptions) => {
    const { blueprint } = options.data.root as TemplateContext;
    if (!blueprint) return false;
    return resolveBlueprintChain(blueprint).some((link) => Handlebars.partials[`blueprints/${link}/${name}`]);
  });

  Handlebars.registerHelper('generatedFiles', (tool: GeneratedFileTool, options: Handlebars.HelperOptions) => {
    return collectGeneratedFiles(options.data.root as TemplateContext, tool);
  });

  Handlebars.registerHelper('seedFile', (options: Handlebars.HelperOptions) => {
    return getBlueprintSeed(options.data.root as TemplateContext)?.file ?? DEFAULT_SEED_FILE;
  });

  Handlebars.registerHelper('blueprintSeed', (options: Handlebars.HelperOptions) => {
    return getBlueprintSeed(options.data.root as TemplateContext);
  });

  // A partial block cannot fall back for a computed name (`{{#> (name)}}` has no closing tag in Handlebars), so a missing partial resolves to an empty one.
  Handlebars.registerHelper('blueprintPartial', (name: string, options: Handlebars.HelperOptions) => {
    const { blueprint } = options.data.root as TemplateContext;
    if (!blueprint) return EMPTY_PARTIAL;
    const chain = resolveBlueprintChain(blueprint).reverse();
    for (const link of chain) {
      const partial = Handlebars.partials[`blueprints/${link}/${name}`];
      if (partial) return partial;
    }
    return EMPTY_PARTIAL;
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
