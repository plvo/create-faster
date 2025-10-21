import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { META } from '@/__meta__';
import type { App, Category, Scope, TemplateContext } from '@/types';

function getTemplatesRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '../../templates');
}

function scanTemplates(category: Category, stack: string): string[] {
  const dir = path.join(getTemplatesRoot(), category, stack);
  return fg.sync('**/*.hbs', { cwd: dir });
}

function resolveDestination(relativePath: string, appName: string, scope: Scope, context: TemplateContext): string {
  const cleanPath = relativePath.replace('.hbs', '');

  if (context.repo === 'single') {
    return cleanPath;
  }

  switch (scope) {
    case 'app':
      return `apps/${appName}/${cleanPath}`;
    case 'package': {
      const packageName = META.orm?.packageName || 'shared';
      return `packages/${packageName}/${cleanPath}`;
    }
    case 'root':
      return cleanPath;
  }
}

function getTemplatesForStack(
  category: Category,
  stack: string,
  appName: string,
  context: TemplateContext,
): Array<{ source: string; destination: string }> {
  const categoryMeta = META[category];

  if (!categoryMeta || !categoryMeta.stacks[stack]) {
    return [];
  }

  try {
    const files = scanTemplates(category, stack);
    const scope = categoryMeta.scope;

    return files.map((file) => ({
      source: `templates/${category}/${stack}/${file}`,
      destination: resolveDestination(file, appName, scope, context),
    }));
  } catch {
    return [];
  }
}

function getTemplatesForApp(app: App, context: TemplateContext): Array<{ source: string; destination: string }> {
  return getTemplatesForStack(app.platform, app.framework, app.name, context);
}

function getTemplatesForBackend(app: App, context: TemplateContext): Array<{ source: string; destination: string }> {
  if (!app.backend || app.backend === 'builtin') {
    return [];
  }

  const backendAppName = `${app.name}-api`;
  return getTemplatesForStack('api', app.backend, backendAppName, context);
}

export function getAllTemplatesForContext(context: TemplateContext): Array<{ source: string; destination: string }> {
  const result: Array<{ source: string; destination: string }> = [];

  for (const app of context.apps) {
    result.push(...getTemplatesForApp(app, context));
    result.push(...getTemplatesForBackend(app, context));
  }

  if (context.orm) {
    result.push(...getTemplatesForStack('orm', context.orm, 'db', context));
  }

  if (context.database) {
    result.push(...getTemplatesForStack('database', context.database, '', context));
  }

  if (context.extras) {
    for (const extra of context.extras) {
      result.push(...getTemplatesForStack('extras', extra, '', context));
    }
  }

  return result;
}
