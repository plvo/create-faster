import { readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { META } from '@/__meta__';
import { TEMPLATES_DIR } from '@/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { Category, Scope } from '@/types/meta';
import { transformSpecialFilename } from './file-writer';
import { extractFirstLine, parseMagicComments, shouldSkipTemplate } from './magic-comments';

function scanTemplates(category: Category, stack: string): string[] {
  const dir = path.join(TEMPLATES_DIR, category, stack);
  return fg.sync('**/*', { cwd: dir });
}

function scanModuleTemplates(framework: string, moduleName: string): string[] {
  const dir = path.join(TEMPLATES_DIR, 'modules', framework, moduleName);
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

  cleanPath = transformSpecialFilename(cleanPath);

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

    return files
      .map((file) => {
        const fullPath = path.join(TEMPLATES_DIR, category, stack, file);

        try {
          const content = readFileSync(fullPath, 'utf8');
          const firstLine = extractFirstLine(content);
          const magicComments = parseMagicComments(firstLine);

          if (shouldSkipTemplate(magicComments, ctx)) {
            return null;
          }

          const scopeComment = magicComments.find((c) => c.type === 'scope');
          const finalScope = scopeComment ? (scopeComment.values[0] as Scope) : scope;

          return {
            source: path.join(TEMPLATES_DIR, category, stack, file),
            destination: resolveDestination(file, appName, finalScope, ctx, packageName),
          };
        } catch {
          return {
            source: path.join(TEMPLATES_DIR, category, stack, file),
            destination: resolveDestination(file, appName, scope, ctx, packageName),
          };
        }
      })
      .filter((t): t is TemplateFile => t !== null);
  } catch {
    return [];
  }
}

function getTemplatesForStackType(stackName: string, appName: string, ctx: TemplateContext): Array<TemplateFile> {
  const stackMeta = META.stacks[stackName];
  if (!stackMeta) return [];

  const stackType = stackMeta.type;
  const scope = stackMeta.scope;

  try {
    const dir = path.join(TEMPLATES_DIR, stackType, stackName);
    const files = fg.sync('**/*', { cwd: dir });

    return files
      .map((file) => {
        const fullPath = path.join(dir, file);

        try {
          const content = readFileSync(fullPath, 'utf8');
          const firstLine = extractFirstLine(content);
          const magicComments = parseMagicComments(firstLine);

          if (shouldSkipTemplate(magicComments, ctx)) {
            return null;
          }

          const scopeComment = magicComments.find((c) => c.type === 'scope');
          const finalScope = scopeComment ? (scopeComment.values[0] as Scope) : scope;

          return {
            source: fullPath,
            destination: resolveDestination(file, appName, finalScope, ctx),
          };
        } catch {
          return {
            source: fullPath,
            destination: resolveDestination(file, appName, scope, ctx),
          };
        }
      })
      .filter((t): t is TemplateFile => t !== null);
  } catch {
    return [];
  }
}

function processModules(
  stackName: string,
  modules: string[] | undefined,
  appName: string,
  ctx: TemplateContext,
): Array<TemplateFile> {
  if (!modules || modules.length === 0) return [];

  const result: Array<TemplateFile> = [];
  const stackModules = META.stacks[stackName]?.modules;
  if (!stackModules) return [];

  for (const moduleName of modules) {
    let moduleMeta: (typeof stackModules)[string][string] | undefined;
    for (const categoryModules of Object.values(stackModules)) {
      if (categoryModules[moduleName]) {
        moduleMeta = categoryModules[moduleName];
        break;
      }
    }
    if (!moduleMeta) continue;

    try {
      const files = scanModuleTemplates(stackName, moduleName);

      const moduleTemplates = files.map((file) => {
        const fullPath = path.join(TEMPLATES_DIR, 'modules', stackName, moduleName, file);

        let scope: Scope;
        let targetName: string;
        let packageNameOverride: string | undefined;

        try {
          const content = readFileSync(fullPath, 'utf8');
          const firstLine = extractFirstLine(content);
          const magicComments = parseMagicComments(firstLine);
          const scopeComment = magicComments.find((c) => c.type === 'scope');

          if (scopeComment) {
            scope = scopeComment.values[0] as Scope;
            targetName = scope === 'package' && moduleMeta.packageName ? moduleMeta.packageName : appName;
            packageNameOverride = scope === 'package' ? moduleMeta.packageName : undefined;
          } else {
            scope = ctx.repo === 'turborepo' && moduleMeta.packageName ? 'package' : 'app';
            targetName = scope === 'package' && moduleMeta.packageName ? moduleMeta.packageName : appName;
            packageNameOverride = moduleMeta.packageName;
          }
        } catch {
          scope = ctx.repo === 'turborepo' && moduleMeta.packageName ? 'package' : 'app';
          targetName = scope === 'package' && moduleMeta.packageName ? moduleMeta.packageName : appName;
          packageNameOverride = moduleMeta.packageName;
        }

        return {
          source: path.join(TEMPLATES_DIR, 'modules', stackName, moduleName, file),
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
    result.push(...getTemplatesForStackType(app.stackName, app.appName, ctx));
    result.push(...processModules(app.stackName, app.modules, app.appName, ctx));
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
