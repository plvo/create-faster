// ABOUTME: Resolves template files to their destination paths
// ABOUTME: Uses META config (asPackage, singlePath) and @dest: magic comments

import { globSync } from 'fast-glob';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { META } from '@/__meta__';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { DestType } from './magic-comments';
import { parseDestFromContent } from './magic-comments';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import { isModuleCompatible, type StackName } from '@/types/meta';
import { transformSpecialFilename } from './file-writer';

interface DestinationMeta {
  type: 'stack' | 'module' | 'orm' | 'database' | 'extras' | 'repo';
  appName?: string;
  asPackage?: string;
  singlePath?: string;
}

export function resolveDestination(
  relativePath: string,
  meta: DestinationMeta,
  ctx: TemplateContext,
  destOverride?: DestType | null,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  // Handle @dest: overrides
  if (destOverride === 'root') {
    return relativePath;
  }

  if (destOverride === 'app' && meta.appName) {
    return isTurborepo ? `apps/${meta.appName}/${relativePath}` : relativePath;
  }

  if (destOverride === 'pkg' && meta.asPackage) {
    return isTurborepo ? `packages/${meta.asPackage}/${relativePath}` : relativePath;
  }

  // Default behavior based on type
  switch (meta.type) {
    case 'stack':
      return isTurborepo ? `apps/${meta.appName}/${relativePath}` : relativePath;

    case 'module':
      if (meta.asPackage) {
        // Turborepo: files go to packages/{asPackage}/
        // Single: files go to root (template paths already contain the structure)
        return isTurborepo ? `packages/${meta.asPackage}/${relativePath}` : relativePath;
      }
      return isTurborepo ? `apps/${meta.appName}/${relativePath}` : relativePath;

    case 'orm':
      // Turborepo: files go to packages/{asPackage}/
      // Single: files go to root (template paths already contain the structure)
      return isTurborepo ? `packages/${meta.asPackage}/${relativePath}` : relativePath;

    case 'database':
    case 'extras':
    case 'repo':
      return relativePath;

    default:
      return relativePath;
  }
}

export function resolveModuleDestination(
  relativePath: string,
  moduleConfig: { asPackage?: string; singlePath?: string },
  destOverride: DestType | null,
  appName: string,
  ctx: TemplateContext,
): string {
  return resolveDestination(
    relativePath,
    {
      type: 'module',
      appName,
      asPackage: moduleConfig.asPackage,
      singlePath: moduleConfig.singlePath,
    },
    ctx,
    destOverride,
  );
}

function scanTemplates(dir: string): string[] {
  try {
    return globSync('**/*', { cwd: dir, onlyFiles: true, dot: true });
  } catch {
    return [];
  }
}

function getRelativePath(file: string): string {
  return file;
}

function transformFilename(filename: string): string {
  let result = filename.replace(/\.hbs$/, '');
  result = transformSpecialFilename(result);
  return result;
}

function resolveTemplatesForStack(stackName: string, appName: string, ctx: TemplateContext): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stack', stackName);
  const files = scanTemplates(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(stackDir, file);
    const relativePath = getRelativePath(file);
    const transformedPath = transformFilename(relativePath);
    const destination = resolveDestination(transformedPath, { type: 'stack', appName }, ctx);

    templates.push({ source, destination, appName });
  }

  return templates;
}

function resolveTemplatesForModule(moduleName: string, appName: string, ctx: TemplateContext): TemplateFile[] {
  const mod = META.modules[moduleName];
  if (!mod) return [];

  const app = ctx.apps.find((a) => a.appName === appName);
  if (!app) return [];

  const moduleDir = join(TEMPLATES_DIR, 'modules', app.stackName, moduleName);
  const files = scanTemplates(moduleDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(moduleDir, file);

    // Read file to check for @dest: magic comment
    let destOverride: DestType | null = null;
    try {
      const content = readFileSync(source, 'utf-8');
      destOverride = parseDestFromContent(content);
    } catch {
      // Can't read file, use default
    }

    const relativePath = getRelativePath(file);
    const transformedPath = transformFilename(relativePath);
    const destination = resolveModuleDestination(
      transformedPath,
      { asPackage: mod.asPackage, singlePath: mod.singlePath },
      destOverride,
      appName,
      ctx,
    );

    templates.push({ source, destination, appName });
  }

  return templates;
}

function resolveTemplatesForOrm(ctx: TemplateContext): TemplateFile[] {
  if (!ctx.orm) return [];

  const ormConfig = META.orm.stacks[ctx.orm];
  const ormDir = join(TEMPLATES_DIR, 'orm', ctx.orm);
  const files = scanTemplates(ormDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(ormDir, file);

    let destOverride: DestType | null = null;
    try {
      const content = readFileSync(source, 'utf-8');
      destOverride = parseDestFromContent(content);
    } catch {
      // Can't read file, use default
    }

    const relativePath = getRelativePath(file);
    const transformedPath = transformFilename(relativePath);
    const destination = resolveDestination(
      transformedPath,
      {
        type: 'orm',
        asPackage: META.orm.asPackage,
        singlePath: META.orm.singlePath,
      },
      ctx,
      destOverride,
    );

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForDatabase(ctx: TemplateContext): TemplateFile[] {
  if (!ctx.database) return [];

  const dbDir = join(TEMPLATES_DIR, 'database', ctx.database);
  const files = scanTemplates(dbDir);

  return files.map((file) => {
    const source = join(dbDir, file);
    const relativePath = getRelativePath(file);
    const transformedPath = transformFilename(relativePath);
    return {
      source,
      destination: resolveDestination(transformedPath, { type: 'database' }, ctx),
    };
  });
}

function resolveTemplatesForExtras(ctx: TemplateContext): TemplateFile[] {
  if (!ctx.extras?.length) return [];

  const templates: TemplateFile[] = [];

  for (const extra of ctx.extras) {
    const extraDir = join(TEMPLATES_DIR, 'extras', extra);
    const files = scanTemplates(extraDir);

    for (const file of files) {
      const source = join(extraDir, file);
      const relativePath = getRelativePath(file);
      const transformedPath = transformFilename(relativePath);
      templates.push({
        source,
        destination: resolveDestination(transformedPath, { type: 'extras' }, ctx),
      });
    }
  }

  return templates;
}

function resolveTemplatesForRepo(ctx: TemplateContext): TemplateFile[] {
  const repoDir = join(TEMPLATES_DIR, 'repo', ctx.repo);
  const files = scanTemplates(repoDir);

  return files.map((file) => {
    const source = join(repoDir, file);
    const relativePath = getRelativePath(file);
    const transformedPath = transformFilename(relativePath);
    return {
      source,
      destination: resolveDestination(transformedPath, { type: 'repo' }, ctx),
    };
  });
}

export function getAllTemplatesForContext(ctx: TemplateContext): TemplateFile[] {
  const templates: TemplateFile[] = [];

  // 1. Repo templates (turborepo or single config files)
  templates.push(...resolveTemplatesForRepo(ctx));

  // 2. Stack and module templates for each app
  for (const app of ctx.apps) {
    // Stack templates
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx));

    // Module templates
    for (const moduleName of app.modules) {
      const mod = META.modules[moduleName];
      if (mod && isModuleCompatible(mod, app.stackName as StackName)) {
        templates.push(...resolveTemplatesForModule(moduleName, app.appName, ctx));
      }
    }
  }

  // 3. ORM templates
  templates.push(...resolveTemplatesForOrm(ctx));

  // 4. Database templates
  templates.push(...resolveTemplatesForDatabase(ctx));

  // 5. Extras templates
  templates.push(...resolveTemplatesForExtras(ctx));

  return templates;
}
