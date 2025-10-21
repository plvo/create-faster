import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { META } from '@/__meta__';
import type { Category, Scope, TemplateContext, TemplateFile } from '@/types';

function getTemplatesRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '../../templates');
}

function scanTemplates(category: Category, stack: string): string[] {
  const dir = path.join(getTemplatesRoot(), category, stack);
  return fg.sync('**/*.hbs', { cwd: dir });
}

function resolveDestination(relativePath: string, appName: string, scope: Scope, ctx: TemplateContext): string {
  let cleanPath = relativePath.replace('.hbs', '');

  if (cleanPath.startsWith('_')) {
    cleanPath = `.${cleanPath.slice(1)}`;
  }

  if (ctx.repo === 'single') {
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
  ctx: TemplateContext,
): Array<TemplateFile> {
  const categoryMeta = META[category];

  if (!categoryMeta || !categoryMeta.stacks[stack]) {
    return [];
  }

  try {
    const files = scanTemplates(category, stack);
    const scope = categoryMeta.scope;

    return files.map((file) => ({
      source: `templates/${category}/${stack}/${file}`,
      destination: resolveDestination(file, appName, scope, ctx),
    }));
  } catch {
    return [];
  }
}

export function getAllTemplatesForContext(ctx: TemplateContext): Array<TemplateFile> {
  const result: Array<TemplateFile> = [];

  for (const app of ctx.apps) {
    result.push(...getTemplatesForStack(app.platform, app.framework, app.appName, ctx));
    if (!app.backend || app.backend === 'builtin') {
      continue;
    }

    const backendAppName = `${app.appName}-api`;
    result.push(...getTemplatesForStack('api', app.backend, backendAppName, ctx));
  }

  if (ctx.orm) {
    result.push(...getTemplatesForStack('orm', ctx.orm, 'db', ctx));
  }

  if (ctx.database) {
    result.push(...getTemplatesForStack('database', ctx.database, '', ctx));
  }
  // Git (category with empty stacks but templates)
  if (ctx.git) {
    result.push(...getTemplatesForStack('git', 'git', '', ctx));
  }

  if (ctx.extras) {
    for (const extra of ctx.extras) {
      result.push(...getTemplatesForStack('extras', extra, '', ctx));
    }
  }

  return result;
}
