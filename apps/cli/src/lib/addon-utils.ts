import { META } from '@/__meta__';
import { getTypeScriptRunner, resolveCommandPackageManager } from '@/lib/package-manager';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { AddonRequire, AppScriptTransform, MetaAddon, MetaLibrary, ProjectCategoryName } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

export function isLibraryCompatible(library: MetaAddon, stackName: StackName): boolean {
  if (!library.support?.stacks) return true;
  if (library.support.stacks === 'all') return true;
  return library.support.stacks.includes(stackName);
}

export function getCompatibleLibraryNames(stackName: StackName): string[] {
  return Object.entries(META.libraries)
    .filter(([, library]) => isLibraryCompatible(library, stackName))
    .map(([name]) => name);
}

/** The libraries of an app that its stack supports, in the order they were selected. */
export function getAppLibraries(app: AppContext): { name: string; library: MetaLibrary }[] {
  return app.libraries.flatMap((name) => {
    const library = META.libraries[name];
    return library && isLibraryCompatible(library, app.stackName) ? [{ name, library }] : [];
  });
}

export function getProjectAddon(category: string, name: string): MetaAddon | undefined {
  const cat = META.project[category as ProjectCategoryName];
  if (!cat) return undefined;
  return cat.options[name];
}

export function resolveCompositeAddons(
  category: ProjectCategoryName,
  addonName: string,
): { name: string; addon: MetaAddon }[] {
  const addon = META.project[category].options[addonName];
  if (!addon) return [];
  if (!addon.compose) return [{ name: addonName, addon }];

  const parts: { name: string; addon: MetaAddon }[] = [];
  for (const name of addon.compose) {
    const composed = META.project[category].options[name];
    if (composed) parts.push({ name, addon: composed });
  }
  parts.push({ name: addonName, addon });
  return parts;
}

/** The selected project addons in category order, each composite addon preceded by the addons it composes. */
export function getSelectedProjectAddons(ctx: TemplateContext): MetaAddon[] {
  const categories = Object.keys(META.project) as ProjectCategoryName[];

  return categories.flatMap((category) => {
    const selection = ctx.project[category];
    const names = Array.isArray(selection) ? selection : selection ? [selection] : [];
    return names.flatMap((name) => resolveCompositeAddons(category, name).map(({ addon }) => addon));
  });
}

export function isCategoryValueAllowedByLibraries(
  categoryName: ProjectCategoryName,
  value: string,
  ctx: Partial<TemplateContext>,
): boolean {
  const selectedLibraries = (ctx.apps ?? []).flatMap((app) => app.libraries);
  for (const libraryName of selectedLibraries) {
    const constraint = META.libraries[libraryName]?.require?.[categoryName as keyof AddonRequire];
    if (Array.isArray(constraint) && !(constraint as string[]).includes(value)) {
      return false;
    }
  }
  return true;
}

export function isServerRuntimeSatisfied(addon: MetaAddon | undefined, ctx: Partial<TemplateContext>): boolean {
  if (addon?.providesServerRuntime !== false) return true;

  const selectedLibraries = (ctx.apps ?? []).flatMap((app) => app.libraries);
  return !selectedLibraries.some((lib) => META.libraries[lib]?.needsServerRuntime);
}

export function isSingletonDbSatisfied(addon: MetaAddon | undefined, ctx: Partial<TemplateContext>): boolean {
  if (!addon?.serverlessBinding) return true;
  if (addon.serverlessConsumersWired) return true;

  const deployment = ctx.project?.deployment;
  const deploymentAddon = deployment ? META.project.deployment.options[deployment] : undefined;
  if (!deploymentAddon?.providesDbBindings) return true;

  const selectedLibraries = (ctx.apps ?? []).flatMap((app) => app.libraries);
  return !selectedLibraries.some((lib) => META.libraries[lib]?.needsSingletonDb);
}

export function isLocalFilesystemSatisfied(addon: MetaAddon | undefined, ctx: Partial<TemplateContext>): boolean {
  if (!addon?.needsLocalFilesystem) return true;

  const deployment = ctx.project?.deployment;
  const deploymentAddon = deployment ? META.project.deployment.options[deployment] : undefined;
  return deploymentAddon?.providesLocalFilesystem !== false;
}

export function isRequirementMet(require: AddonRequire | undefined, ctx: Partial<TemplateContext>): boolean {
  if (!require) return true;

  const project = ctx.project;
  const apps = ctx.apps ?? [];

  if (require.git && !ctx.git) return false;

  if (require.linter) {
    if (!project?.linter) return false;
    if (Array.isArray(require.linter) && !require.linter.includes(project.linter)) return false;
  }

  if (require.database && (!project?.database || !require.database.includes(project.database))) {
    return false;
  }

  if (require.orm && (!project?.orm || !require.orm.includes(project.orm))) {
    return false;
  }

  if (require.deployment && (!project?.deployment || !require.deployment.includes(project.deployment))) {
    return false;
  }

  if (require.tooling && !require.tooling.some((t) => project?.tooling.includes(t))) {
    return false;
  }

  if (require.libraries) {
    const allLibraries = apps.flatMap((app) => app.libraries);
    if (!require.libraries.some((lib) => allLibraries.includes(lib))) {
      return false;
    }
  }

  if (require.stacks && !apps.some((app) => require.stacks?.includes(app.stackName))) {
    return false;
  }

  return true;
}

export function isProjectCategoryAvailable(category: ProjectCategoryName, ctx: Partial<TemplateContext>): boolean {
  const cat = META.project[category];
  if (!cat?.require) return true;

  for (const dep of cat.require) {
    const value = ctx.project?.[dep as keyof typeof ctx.project];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return false;
    }
  }
  return true;
}

export function findRuntimeAddon(ctx: TemplateContext): MetaAddon | undefined {
  for (const toolingName of ctx.project.tooling) {
    const addon = META.project.tooling.options[toolingName];
    if (addon?.runtime) return addon;
  }
  return undefined;
}

export function getMonoPackageName(addon: MetaAddon | undefined): string | null {
  return addon?.mono?.scope === 'pkg' ? addon.mono.name : null;
}

export function resolveDeployAppDir(ctx: TemplateContext): string | undefined {
  const deployment = ctx.project.deployment;
  if (!deployment) return undefined;

  const deployStacks = Object.keys(META.project.deployment.options[deployment]?.stackPackageJson ?? {});
  const candidates = ctx.apps.filter((app) => deployStacks.includes(app.stackName));
  const first = candidates[0];
  if (!first) return undefined;

  const consumer = candidates.find((app) => app.libraries.some((lib) => META.libraries[lib]?.needsSingletonDb));
  return (consumer ?? first).appName;
}

export function resolveScriptPlaceholders(
  scripts: Record<string, string>,
  ctx: TemplateContext,
): Record<string, string> {
  const workspaceRoot = ctx.repo === 'turborepo' ? '../..' : '.';
  const deployAppDir = resolveDeployAppDir(ctx);

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    let next = value
      .replace(/\{\{workspaceRoot\}\}/g, workspaceRoot)
      .replace(/\{\{packageManager\}\}/g, resolveCommandPackageManager(ctx))
      .replace(/\{\{tsRunner\}\}/g, getTypeScriptRunner(ctx));
    if (deployAppDir) next = next.replace(/\{\{deployAppDir\}\}/g, deployAppDir);
    resolved[key] = next;
  }
  return resolved;
}

export function applyAppScripts(
  scripts: Record<string, string>,
  transforms: Record<string, AppScriptTransform>,
): Record<string, string> {
  const next = { ...scripts };
  for (const [key, transform] of Object.entries(transforms)) {
    if (typeof transform === 'function') {
      const current = next[key];
      if (current) next[key] = transform(current);
    } else {
      const source = next[transform.from];
      if (source) next[key] = transform.wrap(source);
    }
  }
  return next;
}

export function describeRequire(require: AddonRequire): string {
  const parts: string[] = [];
  if (require.git) parts.push('git');
  if (require.linter) parts.push(Array.isArray(require.linter) ? `linter: ${require.linter.join(' or ')}` : 'a linter');
  if (require.database) parts.push(`database: ${require.database.join(' or ')}`);
  if (require.orm) parts.push(`orm: ${require.orm.join(' or ')}`);
  if (require.deployment) parts.push(`deployment: ${require.deployment.join(' or ')}`);
  if (require.tooling) parts.push(`tooling: ${require.tooling.join(' or ')}`);
  if (require.libraries) parts.push(`library: ${require.libraries.join(' or ')}`);
  if (require.stacks) parts.push(`an app on stack: ${require.stacks.join(' or ')}`);
  return parts.join(', ');
}

function getDeploymentLabel(ctx: Partial<TemplateContext>): string {
  const deployment = ctx.project?.deployment;
  if (!deployment) return 'this deployment';
  return META.project.deployment.options[deployment]?.label ?? deployment;
}

export function getCategoryOptionUnavailability(
  categoryName: ProjectCategoryName,
  name: string,
  addon: MetaAddon | undefined,
  ctx: Partial<TemplateContext>,
): string | undefined {
  if (!addon) return undefined;

  if (addon.require && !isRequirementMet(addon.require, ctx)) {
    return `requires ${describeRequire(addon.require)}`;
  }

  if (!isCategoryValueAllowedByLibraries(categoryName, name, ctx)) {
    const blocking = (ctx.apps ?? [])
      .flatMap((app) => app.libraries)
      .find((lib) => Array.isArray(META.libraries[lib]?.require?.[categoryName as keyof AddonRequire]));
    return blocking ? `incompatible with ${blocking}` : 'incompatible with a selected library';
  }

  if (!isServerRuntimeSatisfied(addon, ctx)) {
    const blocking = (ctx.apps ?? [])
      .flatMap((app) => app.libraries)
      .find((lib) => META.libraries[lib]?.needsServerRuntime);
    return blocking ? `needs a server runtime — ${blocking}` : 'needs a server runtime';
  }

  if (!isSingletonDbSatisfied(addon, ctx)) {
    const deploymentLabel = getDeploymentLabel(ctx);
    const blocking = (ctx.apps ?? [])
      .flatMap((app) => app.libraries)
      .find((lib) => META.libraries[lib]?.needsSingletonDb);
    return blocking
      ? `not yet supported with ${blocking}: it needs a database shared by the whole app, and on ${deploymentLabel} the database is a per-request binding`
      : `not yet supported with the selected library on ${deploymentLabel}`;
  }

  if (!isLocalFilesystemSatisfied(addon, ctx)) {
    return `needs a local filesystem, which ${getDeploymentLabel(ctx)} does not provide`;
  }

  return undefined;
}
