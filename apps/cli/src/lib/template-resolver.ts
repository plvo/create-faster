import { join } from 'node:path';
import { META, type ProjectCategoryName } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, StackName } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import type { TemplateFrontmatter } from './frontmatter';
import { parseStackSuffix, readFrontmatterFile, shouldSkipTemplate } from './frontmatter';

const VALID_STACKS = Object.keys(META.stacks);

export function resolveAddonNames(category: ProjectCategoryName, addonName: string): string[] {
  const addon = META.project[category].options[addonName];
  if (addon?.compose) return addon.compose;
  return [addonName];
}

export function resolveLibraryDestination(
  relativePath: string,
  library: MetaAddon,
  ctx: TemplateContext,
  appName: string,
  frontmatter: TemplateFrontmatter,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  if (!isTurborepo) {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? library.mono?.scope ?? 'app';
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'root':
      return filePath;
    case 'pkg': {
      const name = library.mono?.scope === 'pkg' ? library.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }
    default:
      return `apps/${appName}/${filePath}`;
  }
}

export function resolveProjectAddonDestination(
  relativePath: string,
  addon: MetaAddon,
  ctx: TemplateContext,
  frontmatter: TemplateFrontmatter,
): string {
  const isTurborepo = ctx.repo === 'turborepo';

  if (!isTurborepo) {
    return frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? addon.mono?.scope ?? 'root';
  const filePath = frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'pkg': {
      const name = addon.mono?.scope === 'pkg' ? addon.mono.name : 'unknown';
      return `packages/${name}/${filePath}`;
    }
    case 'app':
      return `apps/${ctx.apps[0]?.appName ?? ctx.projectName}/${filePath}`;
    default:
      return filePath;
  }
}

export function resolveStackDestination(relativePath: string, ctx: TemplateContext, appName: string): string {
  const isTurborepo = ctx.repo === 'turborepo';
  return isTurborepo ? `apps/${appName}/${relativePath}` : relativePath;
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
    const destination = resolveStackDestination(transformedFilename, ctx, appName);
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
    const destination = resolveLibraryDestination(transformedPath, library, ctx, appName, frontmatter);
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
    const destination = resolveProjectAddonDestination(transformedPath, addon, ctx, frontmatter);
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
  const isTurborepo = ctx.repo === 'turborepo';

  for (const file of files) {
    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (!fileSuffix) continue;

    const source = join(addonDir, file);
    const { only } = readFrontmatter(source);
    if (shouldSkipTemplate(only, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);

    for (const app of apps) {
      if (app.stackName !== fileSuffix) continue;
      const destination = isTurborepo ? `apps/${app.appName}/${transformedPath}` : transformedPath;
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

  return templates;
}
