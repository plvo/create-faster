import Handlebars from 'handlebars';
import type { App, TemplateContext } from '@/types';

/**
 * Register custom Handlebars helpers for template rendering
 */
export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);

  Handlebars.registerHelper('and', (...args: unknown[]) => {
    // Last argument is Handlebars options object
    const values = args.slice(0, -1);
    return values.every((v) => Boolean(v));
  });

  Handlebars.registerHelper('or', (...args: unknown[]) => {
    const values = args.slice(0, -1);
    return values.some((v) => Boolean(v));
  });

  Handlebars.registerHelper('includes', (array: unknown, value: unknown) => {
    if (!Array.isArray(array)) return false;
    return array.includes(value);
  });

  Handlebars.registerHelper('app', function (this: TemplateContext, appName: string) {
    return this.apps.find((app) => app.appName === appName);
  });

  Handlebars.registerHelper('appIndex', function (this: TemplateContext, appName: string) {
    return this.apps.findIndex((app) => app.appName === appName);
  });

  Handlebars.registerHelper('appPort', function (this: TemplateContext, appName: string) {
    const index = this.apps.findIndex((app) => app.appName === appName);
    return index === -1 ? 3000 : 3000 + index;
  });

  Handlebars.registerHelper('databaseUrl', function (this: TemplateContext) {
    if (this.database === 'postgres') {
      return `postgresql://{{projectName}}:password@localhost:5432/{{projectName}}`;
    } else if (this.database === 'mysql') {
      return `mysql://{{projectName}}:password@localhost:3306/{{projectName}}`;
    }
    return '';
  });

  Handlebars.registerHelper('hasBackend', (app: App | undefined) => {
    if (!app) return false;
    return app.backend !== undefined;
  });

  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('isSingleRepo', function (this: TemplateContext) {
    return this.repo === 'single';
  });

  Handlebars.registerHelper('kebabCase', (str: string) => {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  });

  Handlebars.registerHelper('pascalCase', (str: string) => {
    return str
      .split(/[-_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  });

  Handlebars.registerHelper('hasModule', function (this: App | TemplateContext, moduleName: string) {
    const modules = 'modules' in this ? this.modules : undefined;
    if (!modules || !Array.isArray(modules)) return false;
    return modules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper('moduleEnabled', function (this: App | TemplateContext, moduleName: string) {
    const modules = 'modules' in this ? this.modules : undefined;
    if (!modules || !Array.isArray(modules)) return false;
    return modules.some((m) => m.includes(moduleName));
  });
}

/**
 * Configure Handlebars with optimal settings for code generation
 */
export function configureHandlebars(): typeof Handlebars {
  // Disable HTML escaping (we're generating code, not HTML)
  const hbs = Handlebars.create();

  // Copy registered helpers to new instance
  registerHandlebarsHelpers();

  return hbs;
}

/**
 * Compile and render a Handlebars template
 */
export function renderTemplate(templateContent: string, context: TemplateContext): string {
  try {
    const template = Handlebars.compile(templateContent, {
      noEscape: true,
      strict: true,
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
