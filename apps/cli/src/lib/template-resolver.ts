import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { META, MODULES } from '@/__meta__';
import type { Category, Scope, TemplateContext, TemplateFile } from '@/types';
import { extractFirstLine, parseMagicComments, shouldSkipTemplate } from './magic-comments';

function getTemplatesRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '../../templates');
}

function scanTemplates(category: Category | 'modules', stack: string): string[] {
  const dir = path.join(getTemplatesRoot(), category, stack);
  return fg.sync('**/*', { cwd: dir });
}

function scanModuleTemplates(framework: string, moduleName: string): string[] {
  const dir = path.join(getTemplatesRoot(), 'modules', framework, moduleName);
  return fg.sync('**/*', { cwd: dir });
}

function resolveDestination(
  relativePath: string,
  appName: string,
  scope: Scope,
  ctx: TemplateContext,
  packageName?: string,
): string {
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
      const pkgName = packageName || META.orm?.packageName || 'shared';
      return `packages/${pkgName}/${cleanPath}`;
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
  packageName?: string,
): Array<TemplateFile> {
  const categoryMeta = META[category];

  if (!categoryMeta || !categoryMeta.stacks[stack]) {
    return [];
  }

  try {
    const files = scanTemplates(category, stack);
    const scope = categoryMeta.scope;
    const templatesRoot = getTemplatesRoot();

    return files
      .map((file) => {
        const fullPath = path.join(templatesRoot, category, stack, file);

        // Read first line to check for magic comments (like @repo:turborepo)
        try {
          const content = readFileSync(fullPath, 'utf8');
          const firstLine = extractFirstLine(content);
          const magicComments = parseMagicComments(firstLine);

          // Skip file if magic comments say so (e.g., @repo:turborepo in single mode)
          if (shouldSkipTemplate(magicComments, ctx)) {
            return null; // Skip this file
          }

          // Check for @scope override
          const scopeComment = magicComments.find((c) => c.type === 'scope');
          const finalScope = scopeComment ? (scopeComment.values[0] as Scope) : scope;

          return {
            source: `templates/${category}/${stack}/${file}`,
            destination: resolveDestination(file, appName, finalScope, ctx, packageName),
          };
        } catch {
          // If can't read, include it (fallback)
          return {
            source: `templates/${category}/${stack}/${file}`,
            destination: resolveDestination(file, appName, scope, ctx, packageName),
          };
        }
      })
      .filter((t): t is TemplateFile => t !== null);
  } catch {
    return [];
  }
}

function processModules(
  framework: string,
  modules: string[] | undefined,
  appName: string,
  ctx: TemplateContext,
): Array<TemplateFile> {
  if (!modules || modules.length === 0) return [];

  const result: Array<TemplateFile> = [];
  const frameworkModules = MODULES[framework];
  if (!frameworkModules) return [];

  for (const moduleName of modules) {
    const moduleMeta = frameworkModules[moduleName];
    if (!moduleMeta) continue;

    try {
      const files = scanModuleTemplates(framework, moduleName);
      const templatesRoot = getTemplatesRoot();

      const moduleTemplates = files.map((file) => {
        const fullPath = path.join(templatesRoot, 'modules', framework, moduleName, file);

        // Read first line to check for @scope override
        let scope: Scope;
        let targetName: string;
        let packageNameOverride: string | undefined;

        try {
          const content = readFileSync(fullPath, 'utf8');
          const firstLine = extractFirstLine(content);
          const magicComments = parseMagicComments(firstLine);
          const scopeComment = magicComments.find((c) => c.type === 'scope');

          if (scopeComment) {
            // Magic comment @scope overrides default behavior
            scope = scopeComment.values[0] as Scope;
            targetName = scope === 'package' && moduleMeta.packageName ? moduleMeta.packageName : appName;
            packageNameOverride = scope === 'package' ? moduleMeta.packageName : undefined;
          } else {
            // Default: package if turborepo + packageName, else app
            scope = ctx.repo === 'turborepo' && moduleMeta.packageName ? 'package' : 'app';
            targetName = scope === 'package' && moduleMeta.packageName ? moduleMeta.packageName : appName;
            packageNameOverride = moduleMeta.packageName;
          }
        } catch {
          // Fallback if can't read file
          scope = ctx.repo === 'turborepo' && moduleMeta.packageName ? 'package' : 'app';
          targetName = scope === 'package' && moduleMeta.packageName ? moduleMeta.packageName : appName;
          packageNameOverride = moduleMeta.packageName;
        }

        return {
          source: `templates/modules/${framework}/${moduleName}/${file}`,
          destination: resolveDestination(file, targetName, scope, ctx, packageNameOverride),
        };
      });

      result.push(...moduleTemplates);
    } catch {
      // Module templates not found, skip silently
    }
  }

  return result;
}

export function getAllTemplatesForContext(ctx: TemplateContext): Array<TemplateFile> {
  const result: Array<TemplateFile> = [];

  result.push(...getTemplatesForStack('repo', ctx.repo, '', ctx));

  for (const app of ctx.apps) {
    // App templates
    if (app.metaApp) {
      result.push(...getTemplatesForStack('app', app.metaApp.name, app.appName, ctx));
      result.push(...processModules(app.metaApp.name, app.metaApp.modules, app.appName, ctx));
    }

    // Server templates
    if (app.metaServer && app.metaServer.name !== 'builtin') {
      const serverAppName = app.metaApp ? `${app.appName}-server` : app.appName;
      result.push(...getTemplatesForStack('server', app.metaServer.name, serverAppName, ctx));
      result.push(...processModules(app.metaServer.name, app.metaServer.modules, serverAppName, ctx));
    }
  }

  if (ctx.orm) {
    result.push(...getTemplatesForStack('orm', ctx.orm, 'db', ctx));
  }

  if (ctx.database) {
    result.push(...getTemplatesForStack('database', ctx.database, '', ctx));
  }

  if (ctx.extras) {
    for (const extra of ctx.extras) {
      result.push(...getTemplatesForStack('extras', extra, '', ctx));
    }
  }

  return result;
}
