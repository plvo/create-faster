import { META } from '@/__meta__';
import { getSelectedProjectAddons, isLibraryCompatible } from '@/lib/addon-utils';
import { resolveCommandPackageManager } from '@/lib/package-manager';
import { sortObjectKeys } from '@/lib/utils';
import type { PackageManagerName, TemplateContext } from '@/types/ctx';
import type { InstallScripts, PackageJsonConfig } from '@/types/meta';

interface InstallScriptPolicy {
  name: string;
  allowed: boolean;
}

function selectedInstallScripts(ctx: TemplateContext): InstallScripts[] {
  const fromApps = ctx.apps.flatMap((app) => [
    META.stacks[app.stackName].installScripts,
    ...app.libraries.map((name) => {
      const library = META.libraries[name];
      return library && isLibraryCompatible(library, app.stackName) ? library.installScripts : undefined;
    }),
  ]);
  const fromAddons = getSelectedProjectAddons(ctx).map((addon) => addon.installScripts);
  const fromBlueprint = ctx.blueprint ? META.blueprints[ctx.blueprint]?.installScripts : undefined;

  return [...fromApps, ...fromAddons, fromBlueprint].filter((scripts) => scripts !== undefined);
}

/** The install scripts of the dependencies the selection brings, by package name. A package any addon denies stays denied. */
export function collectInstallScripts(ctx: TemplateContext): InstallScripts {
  const collected: InstallScripts = {};
  for (const scripts of selectedInstallScripts(ctx)) {
    for (const [name, allowed] of Object.entries(scripts)) {
      collected[name] = allowed && collected[name] !== false;
    }
  }
  return sortObjectKeys(collected);
}

export function listInstallScriptPolicies(ctx: TemplateContext): InstallScriptPolicy[] {
  return Object.entries(collectInstallScripts(ctx)).map(([name, allowed]) => ({ name, allowed }));
}

/**
 * How each package manager reads the policy from the root package.json. pnpm reads it from `pnpm-workspace.yaml`.
 * Bun blocks the scripts of untrusted dependencies on its own and can only list trusted ones; a `trustedDependencies`
 * field replaces its default trusted list, which would block packages it runs today, so Bun gets none.
 */
const PACKAGE_JSON_POLICY: Record<PackageManagerName, (scripts: InstallScripts) => PackageJsonConfig> = {
  npm: (scripts) => ({ allowScripts: scripts }),
  pnpm: () => ({}),
  bun: () => ({}),
};

/** The package.json fields of the root manifest (the single app, or the turborepo root) that carry the policy. */
export function installScriptsPackageJson(ctx: TemplateContext): PackageJsonConfig {
  const scripts = collectInstallScripts(ctx);
  if (Object.keys(scripts).length === 0) return {};
  return PACKAGE_JSON_POLICY[resolveCommandPackageManager(ctx)](scripts);
}
