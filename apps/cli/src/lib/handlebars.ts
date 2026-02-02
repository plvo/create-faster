import Handlebars from 'handlebars';
import { META } from '@/__meta__';
import type { AppContext, TemplateContext } from '@/types/ctx';

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

  Handlebars.registerHelper('app', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return root.apps?.find((app) => app.appName === appName);
  });

  Handlebars.registerHelper('appIndex', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return root.apps?.findIndex((app) => app.appName === appName) ?? -1;
  });

  Handlebars.registerHelper('appPort', (appName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    const index = root.apps?.findIndex((app) => app.appName === appName) ?? -1;
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

  Handlebars.registerHelper('isAppStack', (app: AppContext | undefined) => {
    if (!app) return false;
    return META.stacks[app.stackName]?.type === 'app';
  });

  Handlebars.registerHelper('isServerStack', (app: AppContext | undefined) => {
    if (!app) return false;
    return META.stacks[app.stackName]?.type === 'server';
  });

  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('isSingleRepo', function (this: TemplateContext) {
    return this.repo === 'single';
  });

  Handlebars.registerHelper('hasModule', function (this: AppContext | TemplateContext, moduleName: string) {
    const modules = 'modules' in this && Array.isArray(this.modules) ? this.modules : undefined;
    if (!modules) return false;
    return modules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper('moduleEnabled', function (this: AppContext | TemplateContext, moduleName: string) {
    const modules = 'modules' in this && Array.isArray(this.modules) ? this.modules : undefined;
    if (!modules) return false;
    return modules.some((m) => m.includes(moduleName));
  });

  Handlebars.registerHelper('hasExtra', function (this: AppContext | TemplateContext, extraName: string) {
    const extras = 'extras' in this && Array.isArray(this.extras) ? this.extras : undefined;
    if (!extras) return false;
    return extras.includes(extraName);
  });

  Handlebars.registerHelper(
    'hasContext',
    function (this: AppContext | TemplateContext, contextName: keyof TemplateContext) {
      return contextName in this && (this as TemplateContext)[contextName] !== undefined;
    },
  );

  Handlebars.registerHelper('hasAnyStack', (stackName: string, options: Handlebars.HelperOptions) => {
    const root = options.data.root as TemplateContext;
    return root.apps?.some((app) => app.stackName === stackName) ?? false;
  });
}

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
