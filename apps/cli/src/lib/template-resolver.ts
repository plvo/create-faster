import { join } from 'node:path';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import type { MetaAddon, MonoScope, ProjectCategoryName, StackName, TemplateFrontmatter } from '@/types/meta';
import { scanDirectory, transformFilename } from './file-writer';
import { parseStackSuffix, readFrontmatterFile, shouldSkipTemplate } from './frontmatter';

const AGENT_DOC_FILENAME = '__agent.md.hbs';

export function scanTemplateFiles(dir: string): string[] {
  return scanDirectory(dir).filter((file) => !file.endsWith(AGENT_DOC_FILENAME));
}

const VALID_STACKS = Object.keys(META.stacks);

// A template can declare deployment-specific output paths via frontmatter `deploymentPath`.
// When the active deployment platform has an entry, that path replaces the default one (and
// any `path` / `mono.path` override); scope resolution still applies on top of it.
function findDeploymentPath(frontmatter: TemplateFrontmatter, ctx: TemplateContext): string | undefined {
  const { deployment } = ctx.project;
  if (!deployment) return undefined;
  return frontmatter.deploymentPath?.[deployment];
}

// A template can opt out of being generated for specific deployment platforms via frontmatter `deploymentSkip`.
function isSkippedForDeployment(frontmatter: TemplateFrontmatter, ctx: TemplateContext): boolean {
  const { deployment } = ctx.project;
  if (!deployment) return false;
  return frontmatter.deploymentSkip?.includes(deployment) ?? false;
}

// A template can opt out of being generated for specific blueprints via frontmatter `blueprintSkip`.
function isSkippedForBlueprint(frontmatter: TemplateFrontmatter, ctx: TemplateContext): boolean {
  if (!ctx.blueprint) return false;
  return frontmatter.blueprintSkip?.includes(ctx.blueprint) ?? false;
}

function isTemplateExcluded(frontmatter: TemplateFrontmatter, ctx: TemplateContext): boolean {
  return (
    shouldSkipTemplate(frontmatter.only, ctx) ||
    isSkippedForDeployment(frontmatter, ctx) ||
    isSkippedForBlueprint(frontmatter, ctx)
  );
}

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
  const deploymentPath = findDeploymentPath(frontmatter, ctx);

  if (ctx.repo !== 'turborepo') {
    return deploymentPath ?? frontmatter.path ?? relativePath;
  }

  const scope = frontmatter.mono?.scope ?? addon?.mono?.scope ?? defaultScope;
  const filePath = deploymentPath ?? frontmatter.mono?.path ?? relativePath;

  switch (scope) {
    case 'root':
      return filePath;
    case 'pkg': {
      const name = frontmatter.mono?.name ?? (addon?.mono?.scope === 'pkg' ? addon.mono.name : 'unknown');
      return `packages/${name}/${filePath}`;
    }
    default: {
      const resolvedAppName = appName ?? ctx.apps[0]?.appName ?? ctx.projectName;
      return `apps/${resolvedAppName}/${filePath}`;
    }
  }
}

function readFrontmatter(source: string): TemplateFrontmatter {
  try {
    return readFrontmatterFile(source).data;
  } catch {
    return {};
  }
}

function resolveTemplatesForStack(
  stackName: StackName,
  appName: string,
  ctx: TemplateContext,
  templatesDir: string,
): TemplateFile[] {
  const stackDir = join(templatesDir, 'stack', stackName);
  const files = scanTemplateFiles(stackDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(stackDir, file);
    const frontmatter = readFrontmatter(source);
    if (isTemplateExcluded(frontmatter, ctx)) continue;

    const destination = resolveDestination({
      relativePath: transformFilename(file),
      ctx,
      frontmatter,
      appName,
    });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForLibrary(
  libraryName: string,
  appName: string,
  ctx: TemplateContext,
  stackName: StackName,
  templatesDir: string,
): TemplateFile[] {
  const library = META.libraries[libraryName];
  if (!library) return [];

  const libraryDir = join(templatesDir, 'libraries', libraryName);
  const files = scanTemplateFiles(libraryDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(libraryDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix && fileSuffix !== stackName) continue;

    const frontmatter = readFrontmatter(source);
    if (isTemplateExcluded(frontmatter, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);
    const destination = resolveDestination({
      relativePath: transformedPath,
      ctx,
      frontmatter,
      addon: library,
      appName,
    });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForProjectAddon(
  category: ProjectCategoryName,
  addonName: string,
  ctx: TemplateContext,
  templatesDir: string,
): TemplateFile[] {
  const addon = META.project[category]?.options[addonName];
  if (!addon) return [];

  const addonDir = join(templatesDir, 'project', category, addonName);
  const files = scanTemplateFiles(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(addonDir, file);

    const { stackName: fileSuffix } = parseStackSuffix(file, VALID_STACKS);
    if (fileSuffix) continue;

    const frontmatter = readFrontmatter(source);
    if (isTemplateExcluded(frontmatter, ctx)) continue;

    const transformedPath = transformFilename(file);
    const destination = resolveDestination({
      relativePath: transformedPath,
      ctx,
      frontmatter,
      addon,
      defaultScope: 'root',
    });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveStackSpecificAddonTemplatesForApps(
  category: ProjectCategoryName,
  addonName: string,
  apps: { appName: string; stackName: StackName }[],
  ctx: TemplateContext,
  templatesDir: string,
): TemplateFile[] {
  const addon = META.project[category]?.options[addonName];
  if (!addon) return [];

  const addonDir = join(templatesDir, 'project', category, addonName);
  const files = scanTemplateFiles(addonDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);
    if (!fileSuffix) continue;

    const source = join(addonDir, file);
    const frontmatter = readFrontmatter(source);
    if (isTemplateExcluded(frontmatter, ctx)) continue;

    const transformedPath = transformFilename(cleanFilename);

    for (const app of apps) {
      if (app.stackName !== fileSuffix) continue;
      const destination = resolveDestination({
        relativePath: transformedPath,
        ctx,
        frontmatter,
        appName: app.appName,
      });
      templates.push({ source, destination });
    }
  }

  return templates;
}

function resolveTemplatesForRepo(ctx: TemplateContext, templatesDir: string): TemplateFile[] {
  const repoDir = join(templatesDir, 'repo', ctx.repo);
  const files = scanTemplateFiles(repoDir);

  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(repoDir, file);
    const frontmatter = readFrontmatter(source);
    if (isTemplateExcluded(frontmatter, ctx)) continue;

    const destination = resolveDestination({
      relativePath: transformFilename(file),
      ctx,
      frontmatter,
      defaultScope: 'root',
    });
    templates.push({ source, destination });
  }

  return templates;
}

function resolveTemplatesForBlueprint(
  blueprintName: string,
  ctx: TemplateContext,
  templatesDir: string,
): TemplateFile[] {
  const blueprintDir = join(templatesDir, 'blueprints', blueprintName);
  const files = scanTemplateFiles(blueprintDir);
  const templates: TemplateFile[] = [];

  for (const file of files) {
    const source = join(blueprintDir, file);

    const { stackName: fileSuffix, cleanFilename } = parseStackSuffix(file, VALID_STACKS);

    const frontmatter = readFrontmatter(source);
    if (isTemplateExcluded(frontmatter, ctx)) continue;

    const transformedPath = transformFilename(fileSuffix ? cleanFilename : file);

    if (fileSuffix) {
      for (const app of ctx.apps.filter((a) => a.stackName === fileSuffix)) {
        const destination = resolveDestination({
          relativePath: transformedPath,
          ctx,
          frontmatter,
          appName: app.appName,
        });
        templates.push({ source, destination });
      }
      continue;
    }

    const destination = resolveDestination({ relativePath: transformedPath, ctx, frontmatter });
    templates.push({ source, destination });
  }

  return templates;
}

export function getAllTemplatesForContext(ctx: TemplateContext, templatesDir = TEMPLATES_DIR): TemplateFile[] {
  const templates: TemplateFile[] = [];

  templates.push(...resolveTemplatesForRepo(ctx, templatesDir));

  for (const app of ctx.apps) {
    templates.push(...resolveTemplatesForStack(app.stackName, app.appName, ctx, templatesDir));

    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (library && isLibraryCompatible(library, app.stackName)) {
        templates.push(...resolveTemplatesForLibrary(libraryName, app.appName, ctx, app.stackName, templatesDir));
      }
    }
  }

  if (ctx.project.database) {
    templates.push(...resolveTemplatesForProjectAddon('database', ctx.project.database, ctx, templatesDir));
  }
  if (ctx.project.orm) {
    templates.push(...resolveTemplatesForProjectAddon('orm', ctx.project.orm, ctx, templatesDir));
  }
  if (ctx.project.deployment) {
    templates.push(...resolveTemplatesForProjectAddon('deployment', ctx.project.deployment, ctx, templatesDir));
    templates.push(
      ...resolveStackSpecificAddonTemplatesForApps('deployment', ctx.project.deployment, ctx.apps, ctx, templatesDir),
    );
  }
  if (ctx.project.linter) {
    const addonNames = resolveAddonNames('linter', ctx.project.linter);
    for (const name of addonNames) {
      templates.push(...resolveTemplatesForProjectAddon('linter', name, ctx, templatesDir));
      templates.push(...resolveStackSpecificAddonTemplatesForApps('linter', name, ctx.apps, ctx, templatesDir));
    }
  }
  for (const tooling of ctx.project.tooling) {
    templates.push(...resolveTemplatesForProjectAddon('tooling', tooling, ctx, templatesDir));
  }

  if (ctx.blueprint) {
    const blueprintTemplates = resolveTemplatesForBlueprint(ctx.blueprint, ctx, templatesDir);
    const blueprintDestinations = new Set(blueprintTemplates.map((t) => t.destination));
    const filtered = templates.filter((t) => !blueprintDestinations.has(t.destination));
    return [...filtered, ...blueprintTemplates];
  }

  return templates;
}
