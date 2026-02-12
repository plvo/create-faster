import { execSync } from 'node:child_process';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
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

function stripInternalDeps(deps: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(deps).filter(([key]) => !key.startsWith('@repo/')));
}

function filterInternalDeps(
  deps: Record<string, string> | undefined,
  existingPackages: Set<string>,
): Record<string, string> | undefined {
  if (!deps) return undefined;

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(deps)) {
    if (key.startsWith('@repo/')) {
      const pkgName = key.replace('@repo/', '');
      if (existingPackages.has(pkgName)) {
        filtered[key] = value;
      }
    } else {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function generateAppPackageJson(app: AppContext, ctx: TemplateContext, appIndex: number): GeneratedPackageJson {
  const stack = META.stacks[app.stackName];
  const port = 3000 + appIndex;
  const isTurborepo = ctx.repo === 'turborepo';

  let merged = mergePackageJsonConfigs(stack.packageJson);

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
        merged = mergePackageJsonConfigs(merged, library.appPackageJson);
      }
    } else {
      merged = mergePackageJsonConfigs(merged, library.packageJson, library.appPackageJson);
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
        merged = mergePackageJsonConfigs(merged, ormAddon.packageJson);
      }
    }
  }

  if (ctx.project.database && !isTurborepo) {
    const dbAddon = META.project.database.options[ctx.project.database];
    if (dbAddon) {
      merged = mergePackageJsonConfigs(merged, dbAddon.packageJson);
    }
  }

  // Process tooling (always goes to root in turborepo, or app in single)
  if (!isTurborepo) {
    for (const toolingName of ctx.project.tooling) {
      const toolingAddon = META.project.tooling.options[toolingName];
      if (toolingAddon) {
        merged = mergePackageJsonConfigs(merged, toolingAddon.packageJson);
      }
    }
  }

  // Process linter addon
  if (ctx.project.linter) {
    const linterAddon = META.project.linter.options[ctx.project.linter];
    if (linterAddon) {
      const packageName = getProjectAddonPackageName(linterAddon);
      if (packageName && isTurborepo) {
        merged.devDependencies = {
          ...merged.devDependencies,
          [`@repo/${packageName}`]: '*',
        };
        if (linterAddon.appPackageJson) {
          merged = mergePackageJsonConfigs(merged, linterAddon.appPackageJson);
        }
      } else if (!isTurborepo) {
        merged = mergePackageJsonConfigs(merged, linterAddon.packageJson, linterAddon.appPackageJson);
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

  let dependencies = merged.dependencies ?? {};
  let devDependencies = merged.devDependencies ?? {};

  if (!isTurborepo) {
    dependencies = stripInternalDeps(dependencies);
    devDependencies = stripInternalDeps(devDependencies);
  }

  const packageManager = !isTurborepo && ctx.pm ? getPackageManager(ctx.pm) : undefined;

  const pkg: PackageJson = {
    name: isTurborepo ? app.appName : ctx.projectName,
    version: '0.1.0',
    private: true,
    packageManager,
    scripts: sortObjectKeys(scripts),
    dependencies: sortObjectKeys(dependencies),
    devDependencies: sortObjectKeys(devDependencies),
  };

  const path = isTurborepo ? `apps/${app.appName}/package.json` : 'package.json';

  return { path, content: pkg };
}

export function generatePackagePackageJson(
  packageName: string,
  config: PackageJsonConfig,
  existingPackages: Set<string>,
): GeneratedPackageJson {
  const devDeps = { ...config.devDependencies, '@repo/config': '*' };

  const filteredDeps = filterInternalDeps(config.dependencies, existingPackages);
  const filteredDevDeps = filterInternalDeps(devDeps, existingPackages);

  const pkg: PackageJson = {
    name: `@repo/${packageName}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: config.exports,
    scripts: config.scripts ? sortObjectKeys(config.scripts) : undefined,
    dependencies: filteredDeps ? sortObjectKeys(filteredDeps) : undefined,
    devDependencies: filteredDevDeps ? sortObjectKeys(filteredDevDeps) : undefined,
  };

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
    lint: 'turbo lint',
    clean: 'turbo clean',
  };

  let devDependencies: Record<string, string> = {
    turbo: '^2.4.0',
  };

  const packageManager: string = getPackageManager(ctx.pm ?? 'npm');

  // Add tooling to root package.json
  for (const toolingName of ctx.project.tooling) {
    const toolingAddon = META.project.tooling.options[toolingName];
    if (toolingAddon?.packageJson) {
      if (toolingAddon.packageJson.devDependencies) {
        devDependencies = { ...devDependencies, ...toolingAddon.packageJson.devDependencies };
      }
      if (toolingAddon.packageJson.scripts) {
        Object.assign(scripts, toolingAddon.packageJson.scripts);
      }
    }
  }

  // Add root-scoped linter to root package.json (biome)
  if (ctx.project.linter) {
    const linterAddon = META.project.linter.options[ctx.project.linter];
    if (linterAddon?.mono?.scope === 'root' && linterAddon.packageJson) {
      if (linterAddon.packageJson.devDependencies) {
        devDependencies = { ...devDependencies, ...linterAddon.packageJson.devDependencies };
      }
      if (linterAddon.packageJson.scripts) {
        for (const [name, cmd] of Object.entries(linterAddon.packageJson.scripts)) {
          if (!(name in scripts)) {
            scripts[name] = cmd;
          }
        }
      }
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

    // Collect linter package (eslint-config)
    if (ctx.project.linter) {
      const linterAddon = META.project.linter.options[ctx.project.linter];
      if (linterAddon?.mono?.scope === 'pkg') {
        const pkgName = linterAddon.mono.name;
        extractedPackages.set(pkgName, linterAddon.packageJson ?? {});
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

    const existingPackages = new Set<string>(['config']);
    for (const name of extractedPackages.keys()) {
      existingPackages.add(name);
    }

    for (const [name, config] of extractedPackages) {
      results.push(generatePackagePackageJson(name, config, existingPackages));
    }
  } else {
    const firstApp = ctx.apps[0];
    if (firstApp) {
      results.push(generateAppPackageJson(firstApp, ctx, 0));
    }
  }

  return results;
}
