import { join } from 'node:path';
import { META, type ProjectCategoryName } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, MonoScope, StackName } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import type { TemplateFrontmatter } from './frontmatter';
import { parseStackSuffix, readFrontmatterFile, shouldSkipTemplate } from './frontmatter';

const VALID_STACKS = Object.keys(META.stacks);

export function resolveAddonNames(category: ProjectCategoryName, addonName: string): string[] {
  const addon = META.project[category].options[addonName];
  if (addon?.compose) return addon.compose;
  return [addonName];
}

export interface DestinationParams {
  relativePath: string;
  ctx: TemplateContext;
  frontmatter?: TemplateFrontmatter;
  addon?: MetaAddon;
  appName?: string;
  defaultScope?: MonoScope;
}

export function resolveDestination({
  relativePath,
  ctx,
  frontmatter = {},
  addon,
  appName,
  defaultScope = 'app',
}: DestinationParams): string {
  if (ctx.repo !== 'turborepo') {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? addon?.mono?.scope ?? defaultScope;
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'root':
      return filePath;
    case 'pkg': {
      const name = addon?.mono?.scope === 'pkg' ? addon.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }
    default: {
      const resolvedAppName = appName ?? ctx.apps[0]?.appName ?? ctx.projectName;
      return `apps/${resolvedAppName}/${filePath}`;
    }
  }
}

function readFrontmatter(source: string): { frontmatter: TemplateFrontmatter; only: string | undefined } {
  try {
    const parsed = readFrontmatterFile(source);
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
    const destination = resolveDestination({ relativePath: transformedFilename, ctx, appName });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForLibrary(
  libraryName: string,
  appName: string,
  ctx: TemplateContext,
  stackName: StackName,
): TemplateFile[] {
  const library = META.libraries[libraryName];
  if (!library) return [];

  const libraryDir = join(TEMPLATES_DIR, 'libraries', libraryName);
  const files = scanDirectory(libraryDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(libraryDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix && fileSuffix !== stackName) continue;

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);
    const destination = resolveDestination({ relativePath: transformedPath, ctx, frontmatter, addon: library, appName });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForProjectAddon(
  category: ProjectCategoryName,
  addonName: string,
  ctx: TemplateContext,
): TemplateFile[] {
  const addon = META.project[category]?.options[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'project', category, addonName);
  const files = scanDirectory(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    const { stackName: fileSuffix } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix) continue;

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(file);
    const destination = resolveDestination({ relativePath: transformedPath, ctx, frontmatter, addon, defaultScope: 'root' });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveStackSpecificAddonTemplatesForApps(
  category: ProjectCategoryName,
  addonName: string,
  apps: { appName: string; stackName: StackName }[],
  ctx: TemplateContext,
): TemplateFile[] {
  const addon = META.project[category]?.options[addonName];
  if (!addon) return [];

  const addonDir = join(TEMPLATES_DIR, 'project', category, addonName);
  const files = scanDirectory(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (!fileSuffix) continue;

    const source = join(addonDir, file);
    const { only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);

    for (const app of apps) {
      if (app.stackName !== fileSuffix) continue;
      const destination = resolveDestination({ relativePath: transformedPath, ctx, appName: app.appName });
      templates.push({ source, destination });
    }
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

function resolveTemplatesForBlueprint(blueprintName: string, ctx: TemplateContext): TemplateFile[] {
  const blueprintDir = join(TEMPLATES_DIR, 'blueprints', blueprintName);
  const files = scanDirectory(blueprintDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(blueprintDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix) {
      const hasStack = ctx.apps.some((app) => app.stackName === fileSuffix);
      if (!hasStack) continue;
    }

    const { frontmatter, only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(fileSuffix ? cleanFilename : file);
    const destination = resolveDestination({ relativePath: transformedPath, ctx, frontmatter });
    templates.push({ source, destination });
  }

  return templates;
}

export function getAllTemplatesForContext(ctx: TemplateContext): TemplateFile[] {
  const templates: TemplateFile[] = [];

  templates.push(...resolveTemplatesForRepo(ctx));

  for (const app of ctx.apps) {
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx));

    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (library && isLibraryCompatible(library, app.stackName)) {
        templates.push(...resolveTemplatesForLibrary(libraryName, app.appName, ctx, app.stackName));
      }
    }
  }

  if (ctx.project.database) {
    templates.push(...resolveTemplatesForProjectAddon('database', ctx.project.database, ctx));
  }
  if (ctx.project.orm) {
    templates.push(...resolveTemplatesForProjectAddon('orm', ctx.project.orm, ctx));
  }
  if (ctx.project.deployment) {
    templates.push(...resolveTemplatesForProjectAddon('deployment', ctx.project.deployment, ctx));
  }
  if (ctx.project.linter) {
    const addonNames = resolveAddonNames('linter', ctx.project.linter);
    for (const name of addonNames) {
      templates.push(...resolveTemplatesForProjectAddon('linter', name, ctx));
      templates.push(...resolveStackSpecificAddonTemplatesForApps('linter', name, ctx.apps, ctx));
    }
  }
  for (const tooling of ctx.project.tooling) {
    templates.push(...resolveTemplatesForProjectAddon('tooling', tooling, ctx));
  }

  if (ctx.blueprint) {
    const blueprintTemplates = resolveTemplatesForBlueprint(ctx.blueprint, ctx);
    const blueprintDestinations = new Set(blueprintTemplates.map((t) => t.destination));
    const filtered = templates.filter((t) => !blueprintDestinations.has(t.destination));
    return [...filtered, ...blueprintTemplates];
  }

  return templates;
}
