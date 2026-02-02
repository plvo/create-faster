// ABOUTME: Handlebars template engine setup with custom helpers
// ABOUTME: Provides core helpers for template rendering

import Handlebars from 'handlebars';
import type { AppContext, TemplateContext } from '@/types/ctx';

export function registerHandlebarsHelpers(): void {
  // Equality check
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

  // Inequality check
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);

  // Logical AND - all args must be truthy
  Handlebars.registerHelper('and', (...args: unknown[]) => {
    const values = args.slice(0, -1); // Last arg is Handlebars options
    return values.every((v) => Boolean(v));
  });

  // Logical OR - any arg must be truthy
  Handlebars.registerHelper('or', (...args: unknown[]) => {
    const values = args.slice(0, -1);
    return values.some((v) => Boolean(v));
  });

  // Check if repo is turborepo
  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  // Generic existence/value check
  Handlebars.registerHelper('has', function (this: TemplateContext, category: string, value: string) {
    switch (category) {
      case 'module':
        return Array.isArray(this.modules) && this.modules.includes(value);
      case 'database':
        return this.database === value;
      case 'orm':
        return this.orm === value;
      case 'extra':
        return Array.isArray(this.extras) && this.extras.includes(value);
      case 'stack':
        return Array.isArray(this.apps) && this.apps.some((app) => app.stackName === value);
      default:
        return false;
    }
  });

  // Check if context has a specific key with a value
  Handlebars.registerHelper('hasContext', function (this: TemplateContext, contextName: keyof TemplateContext) {
    return contextName in this && this[contextName] !== undefined;
  });

  // Get app port based on app index
  Handlebars.registerHelper('appPort', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    const index = root.apps?.findIndex((app: AppContext) => app.appName === appName) ?? -1;
    return index === -1 ? 3000 : 3000 + index;
  });

  // Generate database URL
  Handlebars.registerHelper('databaseUrl', function (this: TemplateContext) {
    if (this.database === 'postgres') {
      return `postgresql://postgres:password@localhost:5432/postgres-${this.projectName}`;
    } else if (this.database === 'mysql') {
      return `mysql://mysql:password@localhost:3306/mysql-${this.projectName}`;
    }
    return null;
  });
}

export function renderTemplate(templateContent: string, context: TemplateContext): string {
  try {
    const template = Handlebars.compile(templateContent, {
      noEscape: true,
      strict: false, // Changed from true to handle missing properties gracefully
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
