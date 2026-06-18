import { META } from '@/__meta__';
import type { TemplateContext } from '@/types/ctx';
import type { AddonRequire, AppScriptTransform, MetaAddon, ProjectCategoryName, StackName } from '@/types/meta';

export function isLibraryCompatible(library: MetaAddon, stackName: StackName): boolean {
  if (!library.support?.stacks) return true;
  if (library.support.stacks === 'all') return true;
  return library.support.stacks.includes(stackName);
}

export function getProjectAddon(category: string, name: string): MetaAddon | undefined {
  const cat = META.project[category as ProjectCategoryName];
  if (!cat) return undefined;
  return cat.options[name];
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

  const deployment = ctx.project?.deployment;
  const deploymentAddon = deployment ? META.project.deployment.options[deployment] : undefined;
  if (!deploymentAddon?.providesDbBindings) return true;

  const selectedLibraries = (ctx.apps ?? []).flatMap((app) => app.libraries);
  return !selectedLibraries.some((lib) => META.libraries[lib]?.needsSingletonDb);
}

export function isRequirementMet(require: AddonRequire | undefined, ctx: TemplateContext): boolean {
  if (!require) return true;

  if (require.git && !ctx.git) return false;

  if (require.linter) {
    if (!ctx.project.linter) return false;
    if (Array.isArray(require.linter) && !require.linter.includes(ctx.project.linter)) return false;
  }

  if (require.database && (!ctx.project.database || !require.database.includes(ctx.project.database))) {
    return false;
  }

  if (require.orm && (!ctx.project.orm || !require.orm.includes(ctx.project.orm))) {
    return false;
  }

  if (require.deployment && (!ctx.project.deployment || !require.deployment.includes(ctx.project.deployment))) {
    return false;
  }

  if (require.tooling && !require.tooling.some((t) => ctx.project.tooling.includes(t))) {
    return false;
  }

  if (require.libraries) {
    const allLibraries = ctx.apps.flatMap((app) => app.libraries);
    if (!require.libraries.some((lib) => allLibraries.includes(lib))) {
      return false;
    }
  }

  if (require.stacks && !ctx.apps.some((app) => require.stacks?.includes(app.stackName))) {
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

export function applyAppScripts(
  scripts: Record<string, string>,
  transforms: Record<string, AppScriptTransform>,
): Record<string, string> {
  const next = { ...scripts };
  for (const [key, transform] of Object.entries(transforms)) {
    if (typeof transform === 'function') {
      if (next[key]) next[key] = transform(next[key]);
    } else if (next[transform.from]) {
      next[key] = transform.wrap(next[transform.from]);
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

export function getCategoryOptionUnavailability(
  categoryName: ProjectCategoryName,
  name: string,
  addon: MetaAddon | undefined,
  ctx: Partial<TemplateContext>,
): string | undefined {
  if (!addon) return undefined;

  if (addon.require && !isRequirementMet(addon.require, ctx as TemplateContext)) {
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
    const deploymentLabel = ctx.project?.deployment
      ? (META.project.deployment.options[ctx.project.deployment]?.label ?? ctx.project.deployment)
      : 'this deployment';
    const blocking = (ctx.apps ?? [])
      .flatMap((app) => app.libraries)
      .find((lib) => META.libraries[lib]?.needsSingletonDb);
    return blocking
      ? `not yet supported with ${blocking} on ${deploymentLabel} (per-request binding — see #153)`
      : `not yet supported with the selected library on ${deploymentLabel}`;
  }

  return undefined;
}
