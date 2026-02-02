// ABOUTME: Resolves template files to destination paths
// ABOUTME: Unified resolution for all addon types using META destination config

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'fast-glob';
import { META } from '@/__meta__';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { isAddonCompatible } from '@/lib/addon-utils';
import { transformSpecialFilename } from './file-writer';
import type { DestType, OnlyType } from './magic-comments';
import { parseDestFromContent, parseOnlyFromContent, shouldSkipTemplate } from './magic-comments';

export function resolveAddonDestination(
  relativePath: string,
  addon: MetaAddon,
  ctx: TemplateContext,
  appName: string,
  destOverride: DestType | null,
): string {
  const isTurborepo = ctx.repo === 'turborepo';
  const target = destOverride ?? addon.destination?.target ?? 'app';

  switch (target) {
    case 'root':
      return relativePath;

    case 'package': {
      if (!addon.destination || addon.destination.target !== 'package') {
        return relativePath;
      }
      if (isTurborepo) {
        return `packages/${addon.destination.name}/${relativePath}`;
      }
      const singlePath = addon.destination.singlePath ?? '';
      return `${singlePath}${relativePath}`;
    }

    case 'app':
    default:
      return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
  }
}

export function resolveStackDestination(relativePath: string, ctx: TemplateContext, appName: string): string {
  const isTurborepo = ctx.repo === 'turborepo';
  return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
}

function scanTemplates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return globSync('**/*', { cwd: dir, onlyFiles: true, dot: true });
  } catch {
    return [];
  }
}

function transformFilename(filename: string): string {
  let result = filename.replace(/\.hbs$/, '');
  result = transformSpecialFilename(result);
  return result;
}

function resolveTemplatesForStack(stackName: StackName, appName: string, ctx: TemplateContext): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stack', stackName);
  const files = scanTemplates(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    if (file.endsWith('package.json.hbs')) continue;

    const source = join(stackDir, file);
    const transformedPath = transformFilename(file);
    const destination = resolveStackDestination(transformedPath, ctx, appName);

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForAddon(addonName: string, appName: string, ctx: TemplateContext): TemplateFile[] {
  const addon = META.addons[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'addons', addonName);
  const files = scanTemplates(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    if (file.endsWith('package.json.hbs')) continue;

    const source = join(addonDir, file);

    let destOverride: DestType | null = null;
    let onlyValue: OnlyType | null = null;
    try {
      const content = readFileSync(source, 'utf-8');
      destOverride = parseDestFromContent(content);
      onlyValue = parseOnlyFromContent(content);
    } catch {
      // Can't read file, use defaults
    }

    if (shouldSkipTemplate(onlyValue, ctx)) continue;

    const transformedPath = transformFilename(file);
    const destination = resolveAddonDestination(transformedPath, addon, ctx, appName, destOverride);

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForRepo(ctx: TemplateContext): TemplateFile[] {
  const repoDir = join(TEMPLATES_DIR, 'repo', ctx.repo);
  const files = scanTemplates(repoDir);

  return files
    .filter((file) => !file.endsWith('package.json.hbs'))
    .map((file) => {
      const source = join(repoDir, file);
      const transformedPath = transformFilename(file);
      return { source, destination: transformedPath };
    });
}

export function getAllTemplatesForContext(ctx: TemplateContext): TemplateFile[] {
  const templates: TemplateFile[] = [];

  templates.push(...resolveTemplatesForRepo(ctx));

  for (const app of ctx.apps) {
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx));

    for (const addonName of app.addons) {
      const addon = META.addons[addonName];
      if (addon && isAddonCompatible(addon, app.stackName)) {
        templates.push(...resolveTemplatesForAddon(addonName, app.appName, ctx));
      }
    }
  }

  const defaultAppName = ctx.apps[0]?.appName ?? ctx.projectName;
  for (const addonName of ctx.globalAddons) {
    templates.push(...resolveTemplatesForAddon(addonName, defaultAppName, ctx));
  }

  return templates;
}
