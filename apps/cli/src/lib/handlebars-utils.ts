import Handlebars from 'handlebars';
import type { AppContext, TemplateContext } from '@/types';

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
      return `postgresql://postgres:password@localhost:5432/postgres-${this.projectName}`;
    } else if (this.database === 'mysql') {
      return `mysql://mysql:password@localhost:3306/mysql-${this.projectName}`;
    }
    return null;
  });

  Handlebars.registerHelper('hasServer', (app: AppContext | undefined) => {
    if (!app) return false;
    return app.metaServer !== undefined;
  });

  Handlebars.registerHelper('hasApp', (app: AppContext | undefined) => {
    if (!app) return false;
    return app.metaApp !== undefined;
  });

  Handlebars.registerHelper('isStandaloneServer', (app: AppContext | undefined) => {
    if (!app) return false;
    return app.metaServer !== undefined && app.metaApp === undefined;
  });

  Handlebars.registerHelper('isFullstack', (app: AppContext | undefined) => {
    if (!app) return false;
    return app.metaApp !== undefined && app.metaServer !== undefined;
  });

  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('isSingleRepo', function (this: TemplateContext) {
    return this.repo === 'single';
  });

  Handlebars.registerHelper('hasModule', function (this: AppContext | TemplateContext, moduleName: string) {
    const modules = 'metaApp' in this ? this.metaApp?.modules : undefined;
    if (!modules || !Array.isArray(modules)) return false;
    return modules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper('moduleEnabled', function (this: AppContext | TemplateContext, moduleName: string) {
    const modules = 'metaApp' in this ? this.metaApp?.modules : undefined;
    if (!modules || !Array.isArray(modules)) return false;
    return modules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper('hasServerModule', function (this: AppContext | TemplateContext, moduleName: string) {
    const serverModules = 'metaServer' in this ? this.metaServer?.modules : undefined;
    if (!serverModules || !Array.isArray(serverModules)) return false;
    return serverModules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper('serverModuleEnabled', function (this: AppContext | TemplateContext, moduleName: string) {
    const serverModules = 'metaServer' in this ? this.metaServer?.modules : undefined;
    if (!serverModules || !Array.isArray(serverModules)) return false;
    return serverModules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper(
    'hasContext',
    function (this: AppContext | TemplateContext, contextName: keyof TemplateContext) {
      return contextName in this && (this as TemplateContext)[contextName] !== undefined;
    },
  );

  Handlebars.registerHelper('hasAnyApp', function (this: TemplateContext, appType: string) {
    return this.apps.some((app) => app.metaApp?.name === appType);
  });

  Handlebars.registerHelper('hasAnyServer', function (this: TemplateContext, serverType: string) {
    return this.apps.some((app) => app.metaServer?.name === serverType);
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
