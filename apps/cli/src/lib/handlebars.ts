import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import type { EnrichedTemplateContext, ProjectContext, TemplateContext } from '@/types/ctx';
import { PARTIALS_DIR } from './constants';
import { getErrorMessage } from './error-utils';
import { scanDirectory } from './file-writer';
import { resolveAppPort } from './utils';

const COMPILE_OPTIONS: CompileOptions = {
  noEscape: true,
  strict: false,
  preventIndent: false,
};

const PARTIAL_EXTENSION = '.hbs';

export function registerHandlebarsHelpers(): void {
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

  Handlebars.registerHelper('hasContext', function (this: TemplateContext, contextName: keyof TemplateContext) {
    return contextName in this && this[contextName] !== undefined;
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

// Each `.hbs` file under the partials directory becomes the partial `{{> <relative path without .hbs>}}`,
// compiled with the same options as the templates that call it.
export function registerHandlebarsPartials(partialsDir: string = PARTIALS_DIR): void {
  for (const file of scanDirectory(partialsDir)) {
    if (!file.endsWith(PARTIAL_EXTENSION)) continue;
    const name = file.slice(0, -PARTIAL_EXTENSION.length);
    const content = readFileSync(join(partialsDir, file), 'utf-8');
    Handlebars.registerPartial(name, Handlebars.compile(content, COMPILE_OPTIONS));
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
