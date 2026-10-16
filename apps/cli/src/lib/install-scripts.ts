import { META } from '@/__meta__';
import { getAppLibraries, getSelectedProjectAddons } from '@/lib/addon-utils';
import { getInstallScriptsField } from '@/lib/package-manager';
import { sortObjectKeys } from '@/lib/utils';
import type { TemplateContext } from '@/types/ctx';
import type { InstallScripts, PackageJsonConfig } from '@/types/meta';

function selectedInstallScripts(ctx: TemplateContext): (InstallScripts | undefined)[] {
  const fromApps = ctx.apps.flatMap((app) => [
    META.stacks[app.stackName].installScripts,
    ...getAppLibraries(app).map(({ library }) => library.installScripts),
  ]);
  const fromAddons = getSelectedProjectAddons(ctx).map((addon) => addon.installScripts);
  const fromBlueprint = ctx.blueprint ? META.blueprints[ctx.blueprint]?.installScripts : undefined;

  return [...fromApps, ...fromAddons, fromBlueprint];
}

/** The install scripts of the dependencies the selected choices bring, by package name. */
export function collectInstallScripts(ctx: TemplateContext): InstallScripts {
  return sortObjectKeys(Object.assign({}, ...selectedInstallScripts(ctx)));
}

/** The root manifest field (the single app, or the turborepo root) that carries the policy, for the package managers that read one. */
export function installScriptsPackageJson(ctx: TemplateContext): PackageJsonConfig {
  const field = getInstallScriptsField(ctx);
  const scripts = collectInstallScripts(ctx);
  return field && Object.keys(scripts).length > 0 ? { [field]: scripts } : {};
}
