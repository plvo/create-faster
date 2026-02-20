import { execSync } from 'node:child_process';
import { META, type ProjectCategoryName } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { resolveConditionals } from '@/lib/when';
import type { AppContext, PackageManager, TemplateContext } from '@/types/ctx';
import type { MetaAddon, PackageJsonConfig } from '@/types/meta';

export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  type?: string;
  packageManager?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
  syncpack?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GeneratedPackageJson {
  path: string;
  content: PackageJson;
}

const MERGE_KEYS = new Set(['dependencies', 'devDependencies', 'scripts', 'exports']);

function spreadExtraKeys(pkg: PackageJson, extras: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) {
      pkg[key] = value;
    }
  }
}

function mergeResolved(ctx: TemplateContext, ...configs: (PackageJsonConfig | undefined)[]): PackageJsonConfig {
  return mergePackageJsonConfigs(...configs.map((c) => (c ? resolveConditionals(c, ctx) : undefined)));
}

export function mergePackageJsonConfigs(...configs: (PackageJsonConfig | undefined)[]): PackageJsonConfig {
  const result: PackageJsonConfig = {};

  for (const config of configs) {
    if (!config) continue;

    for (const [key, value] of Object.entries(config)) {
      if (MERGE_KEYS.has(key)) {
        result[key] = {
          ...(result[key] as Record<string, string> | undefined),
          ...(value as Record<string, string>),
        };
      } else {
        result[key] = value;
      }
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

function getLibraryPackageName(libraryName: string): string | null {
  const library = META.libraries[libraryName];
  if (library?.mono?.scope === 'pkg') {
    return library.mono.name;
  }
  return null;
}

function getProjectAddonPackageName(addon: MetaAddon): string | null {
  if (addon.mono?.scope === 'pkg') {
    return addon.mono.name;
  }
  return null;
}

function resolveCompositeAddons(
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

export function generateAppPackageJson(app: AppContext, ctx: TemplateContext, appIndex: number): GeneratedPackageJson {
  const stack = META.stacks[app.stackName];
  const port = 3000 + appIndex;
  const isTurborepo = ctx.repo === 'turborepo';

  let merged = mergeResolved(ctx, stack.packageJson);

  // Process per-app libraries
  for (const libraryName of app.libraries) {
    const library = META.libraries[libraryName];
    if (!library || !isLibraryCompatible(library, app.stackName)) continue;

    const packageName = getLibraryPackageName(libraryName);
    if (packageName && isTurborepo) {
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${packageName}`]: '*',
      };
      if (library.appPackageJson) {
        merged = mergeResolved(ctx, merged, library.appPackageJson);
      }
    } else {
      merged = mergeResolved(ctx, merged, library.packageJson, library.appPackageJson);
    }
  }

  // Process project addons (database, orm)
  if (ctx.project.orm) {
    const ormAddon = META.project.orm.options[ctx.project.orm];
    if (ormAddon) {
      const packageName = getProjectAddonPackageName(ormAddon);
      if (packageName && isTurborepo) {
        merged.dependencies = {
          ...merged.dependencies,
          [`@repo/${packageName}`]: '*',
        };
      } else {
        merged = mergeResolved(ctx, merged, ormAddon.packageJson);
      }
    }
  }

  if (ctx.project.database && !isTurborepo) {
    const dbAddon = META.project.database.options[ctx.project.database];
    if (dbAddon) {
      merged = mergeResolved(ctx, merged, dbAddon.packageJson);
    }
  }

  // Process tooling (always goes to root in turborepo, or app in single)
  if (!isTurborepo) {
    for (const toolingName of ctx.project.tooling) {
      const toolingAddon = META.project.tooling.options[toolingName];
      if (toolingAddon) {
        merged = mergeResolved(ctx, merged, toolingAddon.packageJson);
      }
    }
  }

  // Process linter addon (with composite expansion)
  if (ctx.project.linter) {
    const parts = resolveCompositeAddons('linter', ctx.project.linter);
    for (const { addon } of parts) {
      const packageName = getProjectAddonPackageName(addon);
      if (packageName && isTurborepo) {
        merged.devDependencies = {
          ...merged.devDependencies,
          [`@repo/${packageName}`]: '*',
        };
        if (addon.appPackageJson) {
          merged = mergeResolved(ctx, merged, addon.appPackageJson);
        }
      } else if (!isTurborepo) {
        merged = mergeResolved(ctx, merged, addon.packageJson, addon.appPackageJson);
      }
    }
  }

  if (isTurborepo) {
    merged.devDependencies = {
      ...merged.devDependencies,
      '@repo/config': '*',
    };
  }

  let scripts = merged.scripts ?? {};
  if (isTurborepo) {
    scripts = resolveScriptPorts(scripts, port);
  } else {
    scripts = removePortPlaceholders(scripts);
  }

  const dependencies = merged.dependencies ?? {};
  const devDependencies = merged.devDependencies ?? {};

  const packageManager = !isTurborepo && ctx.pm ? getPackageManager(ctx.pm) : undefined;

  const pkg: PackageJson = {
    name: isTurborepo ? app.appName : ctx.projectName,
    version: '0.1.0',
    private: true,
    type: stack.moduleType,
    packageManager,
    scripts: sortObjectKeys(scripts),
    dependencies: sortObjectKeys(dependencies),
    devDependencies: sortObjectKeys(devDependencies),
  };

  const extraForApp: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (!MERGE_KEYS.has(key)) {
      extraForApp[key] = value as unknown;
    }
  }
  spreadExtraKeys(pkg, extraForApp);

  const path = isTurborepo ? `apps/${app.appName}/package.json` : 'package.json';

  return { path, content: pkg };
}

export function generatePackagePackageJson(
  packageName: string,
  config: PackageJsonConfig,
  ctx: TemplateContext,
): GeneratedPackageJson {
  const resolved = mergeResolved(ctx, config);
  const deps = resolved.dependencies;
  const devDeps = { ...resolved.devDependencies, '@repo/config': '*' };

  const pkg: PackageJson = {
    name: `@repo/${packageName}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: resolved.exports,
    scripts: resolved.scripts ? sortObjectKeys(resolved.scripts) : undefined,
    dependencies: deps ? sortObjectKeys(deps) : undefined,
    devDependencies: sortObjectKeys(devDeps),
  };

  const extraForPkg: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (!MERGE_KEYS.has(key)) {
      extraForPkg[key] = value as unknown;
    }
  }
  spreadExtraKeys(pkg, extraForPkg);

  const cleanPkg = Object.fromEntries(Object.entries(pkg).filter(([, v]) => v !== undefined)) as PackageJson;

  return {
    path: `packages/${packageName}/package.json`,
    content: cleanPkg,
  };
}

export function getPackageManager(pm: NonNullable<PackageManager>): string {
  const pmVersion = execSync(`${pm} --version`, { stdio: 'pipe' }).toString().trim();
  return `${pm}@${pmVersion}`;
}

export function generateRootPackageJson(ctx: TemplateContext): GeneratedPackageJson {
  const scripts: Record<string, string> = {
    dev: 'turbo dev',
    build: 'turbo build',
    clean: 'rimraf "**/.turbo" "**/.next" "**/dist" "**/generated" "**/node_modules"',
    'versions:list': 'syncpack list-mismatches',
    'versions:fix': 'syncpack fix',
  };

  let devDependencies: Record<string, string> = {
    rimraf: '^6.0.1',
    syncpack: '^13.0.0',
    turbo: '^2.4.0',
  };

  const packageManager: string = getPackageManager(ctx.pm ?? 'npm');

  // Add tooling to root package.json
  const extraConfig: PackageJsonConfig = {};
  for (const toolingName of ctx.project.tooling) {
    const toolingAddon = META.project.tooling.options[toolingName];
    if (toolingAddon?.packageJson) {
      const resolved = mergeResolved(ctx, toolingAddon.packageJson);
      if (resolved.devDependencies) {
        devDependencies = { ...devDependencies, ...resolved.devDependencies };
      }
      if (resolved.scripts) {
        Object.assign(scripts, resolved.scripts);
      }
      for (const [key, value] of Object.entries(resolved)) {
        if (!MERGE_KEYS.has(key)) {
          extraConfig[key] = value;
        }
      }
    }
  }

  // Add root-scoped linter deps to root package.json (with composite expansion)
  if (ctx.project.linter) {
    const parts = resolveCompositeAddons('linter', ctx.project.linter);
    let hasAppLintScript = false;

    for (const { addon } of parts) {
      if (addon.mono?.scope === 'root' && addon.packageJson) {
        const resolved = mergeResolved(ctx, addon.packageJson);
        if (resolved.devDependencies) {
          devDependencies = { ...devDependencies, ...resolved.devDependencies };
        }
        if (resolved.scripts) {
          Object.assign(scripts, resolved.scripts);
        }
      }
      if (addon.appPackageJson?.scripts?.lint) {
        hasAppLintScript = true;
      }
    }

    if (hasAppLintScript) {
      scripts.lint = 'turbo lint';
    }
  }

  const pkg: PackageJson = {
    name: ctx.projectName,
    version: '0.0.0',
    private: true,
    packageManager,
    workspaces: ['apps/*', 'packages/*'],
    scripts: sortObjectKeys(scripts),
    devDependencies: sortObjectKeys(devDependencies),
    syncpack: {
      dependencyTypes: ['!local'],
      lintFormatting: false,
    },
  };

  spreadExtraKeys(pkg, extraConfig);

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

    // Collect library packages
    for (const app of ctx.apps) {
      for (const libraryName of app.libraries) {
        const library = META.libraries[libraryName];
        if (library?.mono?.scope === 'pkg') {
          const pkgName = library.mono.name;
          if (!extractedPackages.has(pkgName)) {
            extractedPackages.set(pkgName, library.packageJson ?? {});
          }
        }
      }
    }

    // Collect linter packages (with composite expansion)
    if (ctx.project.linter) {
      const parts = resolveCompositeAddons('linter', ctx.project.linter);
      for (const { addon } of parts) {
        if (addon.mono?.scope === 'pkg') {
          const pkgName = addon.mono.name;
          const existing = extractedPackages.get(pkgName);
          if (existing) {
            extractedPackages.set(pkgName, mergePackageJsonConfigs(existing, addon.packageJson ?? {}));
          } else {
            extractedPackages.set(pkgName, addon.packageJson ?? {});
          }
        }
      }
    }

    // Collect ORM package with database deps merged
    if (ctx.project.orm) {
      const ormAddon = META.project.orm.options[ctx.project.orm];
      if (ormAddon?.mono?.scope === 'pkg') {
        const pkgName = ormAddon.mono.name;
        let config = ormAddon.packageJson ?? {};

        // Merge database dependencies into ORM package
        if (ctx.project.database) {
          const dbAddon = META.project.database.options[ctx.project.database];
          if (dbAddon?.packageJson) {
            config = mergePackageJsonConfigs(config, dbAddon.packageJson);
          }
        }

        extractedPackages.set(pkgName, config);
      }
    }

    for (const [name, config] of extractedPackages) {
      results.push(generatePackagePackageJson(name, config, ctx));
    }
  } else {
    const firstApp = ctx.apps[0];
    if (firstApp) {
      results.push(generateAppPackageJson(firstApp, ctx, 0));
    }
  }

  return results;
}
