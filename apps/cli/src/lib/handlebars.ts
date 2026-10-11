import { join } from 'node:path';
import Handlebars from 'handlebars';
import { getProjectAddon } from '@/lib/addon-utils';
import type { EnrichedTemplateContext, ProjectContext, TemplateContext } from '@/types/ctx';
import type { PartialFrontmatter } from '@/types/meta';
import { PARTIALS_DIR } from './constants';
import { getErrorMessage } from './error-utils';
import { scanDirectory } from './file-writer';
import { readFrontmatterFile } from './frontmatter';
import { collectMonoPackages, getRootScripts } from './package-json-generator';
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

  Handlebars.registerHelper('camelCase', (str: string) => {
    return str.replace(/[-_]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''));
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
