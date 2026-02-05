// ABOUTME: Helper functions for working with libraries and project addons
// ABOUTME: Compatibility checking and requirement validation

import { META, type ProjectCategoryName } from '@/__meta__';
import type { AddonRequire, MetaAddon, StackName } from '@/types/meta';
import type { TemplateContext } from '@/types/ctx';

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
