// ABOUTME: Handlebars template engine setup with custom helpers
// ABOUTME: Provides core helpers for template rendering with unified addons

import Handlebars from 'handlebars';
import { META } from '@/__meta__';
import type { AppContext, EnrichedTemplateContext, TemplateContext } from '@/types/ctx';

export function registerHandlebarsHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every((v) => Boolean(v)));
  Handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some((v) => Boolean(v)));
  Handlebars.registerHelper('isTurborepo', function (this: TemplateContext) {
    return this.repo === 'turborepo';
  });

  Handlebars.registerHelper('has', function (this: EnrichedTemplateContext, category: string, value: string) {
    switch (category) {
      case 'module':
        return Array.isArray(this.addons) && this.addons.includes(value);
      case 'database':
        return Array.isArray(this.globalAddons) && this.globalAddons.includes(value);
      case 'orm':
        return Array.isArray(this.globalAddons) && this.globalAddons.includes(value);
      case 'extra':
        return Array.isArray(this.globalAddons) && this.globalAddons.includes(value);
      case 'addon':
        return (
          (Array.isArray(this.addons) && this.addons.includes(value)) ||
          (Array.isArray(this.globalAddons) && this.globalAddons.includes(value))
        );
      case 'stack':
        return Array.isArray(this.apps) && this.apps.some((app) => app.stackName === value);
      default:
        return false;
    }
  });

  Handlebars.registerHelper('hasAddon', function (this: EnrichedTemplateContext, addonName: string) {
    return (
      (Array.isArray(this.addons) && this.addons.includes(addonName)) ||
      (Array.isArray(this.globalAddons) && this.globalAddons.includes(addonName))
    );
  });

  Handlebars.registerHelper('hasAddonType', function (this: EnrichedTemplateContext, addonType: string) {
    const allAddons = [...(this.addons ?? []), ...(this.globalAddons ?? [])];
    return allAddons.some((name) => META.addons[name]?.type === addonType);
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
    if (this.globalAddons?.includes('postgres')) {
      return `postgresql://postgres:password@localhost:5432/postgres-${this.projectName}`;
    } else if (this.globalAddons?.includes('mysql')) {
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
