// ABOUTME: Programmatic generation of package.json files
// ABOUTME: Merges dependencies from META based on unified addon system

import { META } from '@/__meta__';
import { getAddonsByType, isAddonCompatible } from '@/lib/addon-utils';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { PackageJsonConfig } from '@/types/meta';

export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  type?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

export interface GeneratedPackageJson {
  path: string;
  content: PackageJson;
}

export function mergePackageJsonConfigs(...configs: (PackageJsonConfig | undefined)[]): PackageJsonConfig {
  const result: PackageJsonConfig = {};

  for (const config of configs) {
    if (!config) continue;

    if (config.dependencies) {
      result.dependencies = { ...result.dependencies, ...config.dependencies };
    }
    if (config.devDependencies) {
      result.devDependencies = { ...result.devDependencies, ...config.devDependencies };
    }
    if (config.scripts) {
      result.scripts = { ...result.scripts, ...config.scripts };
    }
    if (config.exports) {
      result.exports = { ...result.exports, ...config.exports };
    }
  }

  return result;
}

function resolveScriptPorts(scripts: Record<string, string>, port: number): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = value.replace(/\{\{port\}\}/g, String(port));
  }
  return resolved;
}

function removePortPlaceholders(scripts: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = value.replace(/\s*--port\s*\{\{port\}\}/g, '');
  }
  return resolved;
}

function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted = {} as T;
  for (const key of Object.keys(obj).sort()) {
    (sorted as Record<string, unknown>)[key] = obj[key];
  }
  return sorted;
}

function getPackageName(addonName: string): string | null {
  const addon = META.addons[addonName];
  if (addon?.mono?.scope === 'pkg') {
    return addon.mono.name;
  }
  return null;
}

export function generateAppPackageJson(app: AppContext, ctx: TemplateContext, appIndex: number): GeneratedPackageJson {
  const stack = META.stacks[app.stackName];
  const port = 3000 + appIndex;
  const isTurborepo = ctx.repo === 'turborepo';

  let merged = mergePackageJsonConfigs(stack.packageJson);

  for (const addonName of app.addons) {
    const addon = META.addons[addonName];
    if (!addon || !isAddonCompatible(addon, app.stackName)) continue;

    const packageName = getPackageName(addonName);
    if (packageName && isTurborepo) {
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${packageName}`]: '*',
      };
    } else {
      merged = mergePackageJsonConfigs(merged, addon.packageJson);
    }
  }

  for (const addonName of ctx.globalAddons) {
    const addon = META.addons[addonName];
    if (!addon) continue;

    const packageName = getPackageName(addonName);

    if (packageName && isTurborepo) {
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${packageName}`]: '*',
      };
    } else if (!isTurborepo || addon.mono?.scope === 'root') {
      merged = mergePackageJsonConfigs(merged, addon.packageJson);
    }
  }

  if (!isTurborepo) {
    for (const addonName of ctx.globalAddons) {
      const addon = META.addons[addonName];
      if (addon?.type === 'extra') {
        merged = mergePackageJsonConfigs(merged, addon.packageJson);
      }
    }
  }

  let scripts = merged.scripts ?? {};
  if (isTurborepo) {
    scripts = resolveScriptPorts(scripts, port);
  } else {
    scripts = removePortPlaceholders(scripts);
  }

  const pkg: PackageJson = {
    name: isTurborepo ? app.appName : ctx.projectName,
    version: '0.1.0',
    private: true,
    scripts: sortObjectKeys(scripts),
    dependencies: sortObjectKeys(merged.dependencies ?? {}),
    devDependencies: sortObjectKeys(merged.devDependencies ?? {}),
  };

  const path = isTurborepo ? `apps/${app.appName}/package.json` : 'package.json';

  return { path, content: pkg };
}

export function generatePackagePackageJson(packageName: string, config: PackageJsonConfig): GeneratedPackageJson {
  const pkg: PackageJson = {
    name: `@repo/${packageName}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: config.exports,
    scripts: config.scripts ? sortObjectKeys(config.scripts) : undefined,
    dependencies: config.dependencies ? sortObjectKeys(config.dependencies) : undefined,
    devDependencies: config.devDependencies ? sortObjectKeys(config.devDependencies) : undefined,
  };

  const cleanPkg = Object.fromEntries(Object.entries(pkg).filter(([, v]) => v !== undefined)) as PackageJson;

  return {
    path: `packages/${packageName}/package.json`,
    content: cleanPkg,
  };
}

export function generateRootPackageJson(ctx: TemplateContext): GeneratedPackageJson {
  const scripts: Record<string, string> = {
    dev: 'turbo dev',
    build: 'turbo build',
    lint: 'turbo lint',
    clean: 'turbo clean',
  };

  let devDependencies: Record<string, string> = {
    turbo: '^2.4.0',
  };

  for (const addonName of ctx.globalAddons) {
    const addon = META.addons[addonName];
    if (addon?.type === 'extra' && addon.packageJson) {
      if (addon.packageJson.devDependencies) {
        devDependencies = { ...devDependencies, ...addon.packageJson.devDependencies };
      }
      if (addon.packageJson.scripts) {
        Object.assign(scripts, addon.packageJson.scripts);
      }
    }
  }

  const pkg: PackageJson = {
    name: ctx.projectName,
    version: '0.0.0',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: sortObjectKeys(scripts),
    devDependencies: sortObjectKeys(devDependencies),
  };

  return { path: 'package.json', content: pkg };
}

export function generateAllPackageJsons(ctx: TemplateContext): GeneratedPackageJson[] {
  const results: GeneratedPackageJson[] = [];
  const isTurborepo = ctx.repo === 'turborepo';

  if (isTurborepo) {
    results.push(generateRootPackageJson(ctx));

    ctx.apps.forEach((app, index) => {
      results.push(generateAppPackageJson(app, ctx, index));
    });

    const extractedPackages = new Map<string, PackageJsonConfig>();

    for (const app of ctx.apps) {
      for (const addonName of app.addons) {
        const addon = META.addons[addonName];
        if (addon?.mono?.scope === 'pkg') {
          const pkgName = addon.mono.name;
          if (!extractedPackages.has(pkgName)) {
            extractedPackages.set(pkgName, addon.packageJson ?? {});
          }
        }
      }
    }

    const ormAddons = ctx.globalAddons.filter((n) => META.addons[n]?.type === 'orm');
    const dbAddons = ctx.globalAddons.filter((n) => META.addons[n]?.type === 'database');

    if (ormAddons.length > 0) {
      const ormAddon = META.addons[ormAddons[0]];
      if (ormAddon?.mono?.scope === 'pkg') {
        const pkgName = ormAddon.mono.name;
        let config = ormAddon.packageJson ?? {};

        for (const dbName of dbAddons) {
          const dbAddon = META.addons[dbName];
          if (dbAddon?.packageJson) {
            config = mergePackageJsonConfigs(config, dbAddon.packageJson);
          }
        }

        extractedPackages.set(pkgName, config);
      }
    }

    for (const [name, config] of extractedPackages) {
      results.push(generatePackagePackageJson(name, config));
    }
  } else {
    const firstApp = ctx.apps[0];
    if (firstApp) {
      results.push(generateAppPackageJson(firstApp, ctx, 0));
    }
  }

  return results;
}
