// ABOUTME: Programmatic generation of package.json files
// ABOUTME: Merges dependencies from META based on context (stacks, modules, orm, extras)

import { META } from '@/__meta__';
import type { PackageJsonConfig, StackName } from '@/types/meta';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { isModuleCompatible } from '@/types/meta';

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

export function generateAppPackageJson(app: AppContext, ctx: TemplateContext, appIndex: number): GeneratedPackageJson {
  const stack = META.stacks[app.stackName];
  const port = 3000 + appIndex;
  const isTurborepo = ctx.repo === 'turborepo';

  let merged = mergePackageJsonConfigs(stack.packageJson);

  for (const moduleName of app.modules) {
    const mod = META.modules[moduleName];
    if (!mod || !isModuleCompatible(mod, app.stackName)) continue;

    if (mod.asPackage && isTurborepo) {
      merged.dependencies = {
        ...merged.dependencies,
        [`@repo/${mod.asPackage}`]: '*',
      };
    } else {
      merged = mergePackageJsonConfigs(merged, mod.packageJson);
    }
  }

  if (ctx.orm) {
    if (isTurborepo) {
      merged.dependencies = {
        ...merged.dependencies,
        '@repo/db': '*',
      };
    } else {
      const ormConfig = META.orm.stacks[ctx.orm].packageJson;
      const dbConfig = ctx.database ? META.database.stacks[ctx.database].packageJson : undefined;
      merged = mergePackageJsonConfigs(merged, ormConfig, dbConfig);
    }
  }

  if (!isTurborepo && ctx.extras) {
    for (const extra of ctx.extras) {
      const extraConfig = META.extras.stacks[extra]?.packageJson;
      merged = mergePackageJsonConfigs(merged, extraConfig);
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

  if (ctx.extras) {
    for (const extra of ctx.extras) {
      const extraConfig = META.extras.stacks[extra]?.packageJson;
      if (extraConfig) {
        if (extraConfig.devDependencies) {
          devDependencies = { ...devDependencies, ...extraConfig.devDependencies };
        }
        if (extraConfig.scripts) {
          Object.assign(scripts, extraConfig.scripts);
        }
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
      for (const moduleName of app.modules) {
        const mod = META.modules[moduleName];
        if (mod?.asPackage && !extractedPackages.has(mod.asPackage)) {
          extractedPackages.set(mod.asPackage, mod.packageJson);
        }
      }
    }

    if (ctx.orm) {
      const ormConfig = META.orm.stacks[ctx.orm].packageJson;
      const dbConfig = ctx.database ? META.database.stacks[ctx.database].packageJson : undefined;
      const merged = mergePackageJsonConfigs(ormConfig, dbConfig);
      extractedPackages.set('db', merged);
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
