// ABOUTME: Resolves template files to destination paths
// ABOUTME: Unified resolution for all addon types using META destination config

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { isAddonCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import type { DestType, OnlyType } from './magic-comments';
import { parseMagicCommentsFromContent, shouldSkipTemplate } from './magic-comments';

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

function resolveTemplatesForStack(stackName: StackName, appName: string, ctx: TemplateContext): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stack', stackName);
  const files = scanDirectory(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(stackDir, file);
    const transformedFilename = transformFilename(file);
    const destination = resolveStackDestination(transformedFilename, ctx, appName);

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForAddon(addonName: string, appName: string, ctx: TemplateContext): TemplateFile[] {
  const addon = META.addons[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'addons', addonName);
  const files = scanDirectory(addonDir);
  console.log('files', files);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    let destOverride: DestType | null = null;
    let onlyValue: OnlyType | null = null;
    try {
      const content = readFileSync(source, 'utf-8');
      const parsed = parseMagicCommentsFromContent(content);
      destOverride = parsed.dest ?? null;
      onlyValue = parsed.only ?? null;
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
  const files = scanDirectory(repoDir);

  return files.map((file) => {
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

  for (const addonName of ctx.globalAddons) {
    templates.push(...resolveTemplatesForAddon(addonName, ctx.projectName, ctx));
  }

  return templates;
}
