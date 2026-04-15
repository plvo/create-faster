import Handlebars from 'handlebars';
import type { EnrichedTemplateContext, ProjectContext, TemplateContext } from '@/types/ctx';
import { getErrorMessage } from './error-utils';
import { resolveAppPort } from './utils';

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

export function renderTemplate(templateContent: string, context: TemplateContext): string {
  try {
    const template = Handlebars.compile(templateContent, {
      noEscape: true,
      strict: false,
      preventIndent: false,
    });

    return template(context);
  } catch (error) {
    throw new Error(`Handlebars compilation failed: ${getErrorMessage(error)}`);
  }
}
