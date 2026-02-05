// ABOUTME: Resolves template files to destination paths
// ABOUTME: Uses frontmatter and META mono config for path resolution

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { isAddonCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import type { TemplateFrontmatter } from './frontmatter';
import { parseFrontmatter, parseStackSuffix, shouldSkipTemplate } from './frontmatter';

const VALID_STACKS = Object.keys(META.stacks);

export function resolveAddonDestination(
  relativePath: string,
  addon: MetaAddon,
  ctx: TemplateContext,
  appName: string,
  frontmatter: TemplateFrontmatter,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  if (!isTurborepo) {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? addon.mono?.scope ?? 'app';
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'root':
      return filePath;

    case 'pkg': {
      const name = addon.mono?.scope === 'pkg' ? addon.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }

    case 'app':
    default:
      return `apps/${appName}/${filePath}`;
  }
}

export function resolveStackDestination(relativePath: string, ctx: TemplateContext, appName: string): string {
  const isTurborepo = ctx.repo === 'turborepo';
  return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
}

function readFrontmatter(source: string): { frontmatter: TemplateFrontmatter; only: string | undefined } {
  try {
    const raw = readFileSync(source, 'utf-8');
    const parsed = parseFrontmatter(raw);
    return { frontmatter: parsed.data, only: parsed.data.only };
  } catch {
    return { frontmatter: {}, only: undefined };
  }
}

function resolveTemplatesForStack(stackName: StackName, appName: string, ctx: TemplateContext): TemplateFile[] {
  const stackDir = join(TEMPLATES_DIR, 'stack', stackName);
  const files = scanDirectory(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(stackDir, file);

    const { only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedFilename = transformFilename(file);
    const destination = resolveStackDestination(transformedFilename, ctx, appName);

    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForAddon(
  addonName: string,
  appName: string,
  ctx: TemplateContext,
  stackName?: StackName,
): TemplateFile[] {
  const addon = META.addons[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'addons', addonName);
  const files = scanDirectory(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix && stackName && fileSuffix !== stackName) continue;

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);
    const destination = resolveAddonDestination(transformedPath, addon, ctx, appName, frontmatter);

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
        templates.push(...resolveTemplatesForAddon(addonName, app.appName, ctx, app.stackName));
      }
    }
  }

  for (const addonName of ctx.globalAddons) {
    templates.push(...resolveTemplatesForAddon(addonName, ctx.projectName, ctx));
  }

  return templates;
}
