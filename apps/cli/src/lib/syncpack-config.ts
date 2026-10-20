import { META } from '@/__meta__';
import { getAppLibraries } from '@/lib/addon-utils';
import type { AppContext, TemplateContext } from '@/types/ctx';

interface IgnoredVersionGroup {
  label: string;
  dependencies: string[];
  packages?: string[];
  isIgnored: true;
}

export interface SyncpackConfig {
  versionGroups: IgnoredVersionGroup[];
}

const WORKSPACE_PACKAGES: IgnoredVersionGroup = {
  label: 'Workspace packages',
  dependencies: ['$LOCAL'],
  isIgnored: true,
};

function pinnedPackagesOf(app: AppContext): string[] {
  const stack = META.stacks[app.stackName];
  const libraries = getAppLibraries(app).map(({ library }) => library);
  return [...new Set([stack, ...libraries].flatMap((choice) => choice.pinnedPackages ?? []))];
}

/** The syncpack config of a turborepo root: workspace packages and the packages a stack or library pins in an app are left out of the version comparison. */
export function collectSyncpackConfig(ctx: TemplateContext): SyncpackConfig {
  const pinnedByApp = ctx.apps.flatMap((app): IgnoredVersionGroup[] => {
    const dependencies = pinnedPackagesOf(app);
    if (dependencies.length === 0) return [];
    return [
      {
        label: `Versions the stack and libraries of ${app.appName} require`,
        dependencies,
        packages: [app.appName],
        isIgnored: true,
      },
    ];
  });
  return { versionGroups: [WORKSPACE_PACKAGES, ...pinnedByApp] };
}
