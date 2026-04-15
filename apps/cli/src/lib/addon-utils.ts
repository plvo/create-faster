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

  if (require.tooling && !require.tooling.some((t) => ctx.project.tooling.includes(t))) {
    return false;
  }

  if (require.libraries) {
    const allLibraries = ctx.apps.flatMap((app) => app.libraries);
    if (!require.libraries.some((lib) => allLibraries.includes(lib))) {
      return false;
    }
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
