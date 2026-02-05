// ABOUTME: Handlebars template engine setup with custom helpers
// ABOUTME: Provides helpers for libraries and project context

import Handlebars from 'handlebars';
import type { AppContext, EnrichedTemplateContext, TemplateContext } from '@/types/ctx';

export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every((v) => Boolean(v)));
  Handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some((v) => Boolean(v)));

  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('hasLibrary', function (this: EnrichedTemplateContext, name: string) {
    return Array.isArray(this.libraries) && this.libraries.includes(name);
  });

  Handlebars.registerHelper('has', function (this: EnrichedTemplateContext, category: string, value: string) {
    switch (category) {
      case 'database':
        return this.project?.database === value;
      case 'orm':
        return this.project?.orm === value;
      case 'tooling':
        return Array.isArray(this.project?.tooling) && this.project.tooling.includes(value);
      case 'stack':
        return Array.isArray(this.apps) && this.apps.some((app) => app.stackName === value);
      default:
        return false;
    }
  });

  Handlebars.registerHelper('hasContext', function (this: TemplateContext, contextName: keyof TemplateContext) {
    return contextName in this && this[contextName] !== undefined;
  });

  Handlebars.registerHelper('appPort', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    const index = root.apps?.findIndex((app: AppContext) => app.appName === appName) ?? -1;
    return index === -1 ? 3000 : 3000 + index;
  });

  Handlebars.registerHelper('databaseUrl', function (this: TemplateContext) {
    if (this.project?.database === 'postgres') {
      return `postgresql://postgres:password@localhost:5432/postgres-${this.projectName}`;
    }
    if (this.project?.database === 'mysql') {
      return `mysql://mysql:password@localhost:3306/mysql-${this.projectName}`;
    }
    return null;
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
    if (error instanceof Error) {
      throw new Error(`Handlebars compilation failed: ${error.message}`);
    }
    throw error;
  }
}
