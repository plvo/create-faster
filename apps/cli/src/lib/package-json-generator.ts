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

function spreadExtraKeys(pkg: PackageJson, config: PackageJsonConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!MERGE_KEYS.has(key) && value !== undefined) pkg[key] = value;
  }
}

function cleanUndefined(pkg: PackageJson): PackageJson {
  return Object.fromEntries(Object.entries(pkg).filter(([, v]) => v !== undefined)) as PackageJson;
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

function processScriptPorts(scripts: Record<string, string>, port?: number): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = port
      ? value.replace(/\{\{port\}\}/g, String(port))
      : value.replace(/\s*--port\s*\{\{port\}\}/g, '');
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

function getMonoPackageName(addon: MetaAddon): string | null {
  return addon.mono?.scope === 'pkg' ? addon.mono.name : null;
}

function addRepoRef(
  config: PackageJsonConfig,
  addon: MetaAddon,
  depType: 'dependencies' | 'devDependencies' = 'dependencies',
): boolean {
  const name = getMonoPackageName(addon);
  if (!name) return false;
  config[depType] = { ...(config[depType] as Record<string, string>), [`@repo/${name}`]: '*' };
  return true;
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

  for (const libraryName of app.libraries) {
    const library = META.libraries[libraryName];
    if (!library || !isLibraryCompatible(library, app.stackName)) continue;

    if (isTurborepo && addRepoRef(merged, library)) {
      if (library.appPackageJson) {
        merged = mergeResolved(ctx, merged, library.appPackageJson);
      }
    } else {
      merged = mergeResolved(ctx, merged, library.packageJson, library.appPackageJson);
    }
  }

  if (ctx.project.orm) {
    const ormAddon = META.project.orm.options[ctx.project.orm];
    if (ormAddon) {
      if (!(isTurborepo && addRepoRef(merged, ormAddon))) {
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

  if (!isTurborepo) {
    for (const toolingName of ctx.project.tooling) {
      const toolingAddon = META.project.tooling.options[toolingName];
      if (toolingAddon) {
        merged = mergeResolved(ctx, merged, toolingAddon.packageJson);
      }
    }
  }

  if (ctx.project.linter) {
    const parts = resolveCompositeAddons('linter', ctx.project.linter);
    for (const { addon } of parts) {
      if (isTurborepo && addRepoRef(merged, addon, 'devDependencies')) {
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

  const scripts = processScriptPorts(merged.scripts ?? {}, isTurborepo ? port : undefined);
  const packageManager = !isTurborepo && ctx.pm ? getPackageManager(ctx.pm) : undefined;

  const pkg: PackageJson = {
    name: isTurborepo ? app.appName : ctx.projectName,
    version: '0.1.0',
    private: true,
    type: stack.moduleType,
    packageManager,
    scripts: sortObjectKeys(scripts),
    dependencies: sortObjectKeys(merged.dependencies ?? {}),
    devDependencies: sortObjectKeys(merged.devDependencies ?? {}),
  };

  spreadExtraKeys(pkg, merged);

  const path = isTurborepo ? `apps/${app.appName}/package.json` : 'package.json';

  return { path, content: cleanUndefined(pkg) };
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

  spreadExtraKeys(pkg, resolved);

  return {
    path: `packages/${packageName}/package.json`,
    content: cleanUndefined(pkg),
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

  const rootConfigs: PackageJsonConfig[] = [];

  for (const toolingName of ctx.project.tooling) {
    const toolingAddon = META.project.tooling.options[toolingName];
    if (toolingAddon?.packageJson) rootConfigs.push(toolingAddon.packageJson);
  }

  let hasAppLintScript = false;
  if (ctx.project.linter) {
    const parts = resolveCompositeAddons('linter', ctx.project.linter);
    for (const { addon } of parts) {
      if (addon.mono?.scope === 'root' && addon.packageJson) rootConfigs.push(addon.packageJson);
      if (addon.appPackageJson?.scripts?.lint) hasAppLintScript = true;
    }
  }

  const merged = mergeResolved(ctx, ...rootConfigs);
  devDependencies = { ...devDependencies, ...(merged.devDependencies ?? {}) };
  Object.assign(scripts, merged.scripts ?? {});
  if (hasAppLintScript) scripts.lint = 'turbo lint';

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

  spreadExtraKeys(pkg, merged);

  return { path: 'package.json', content: cleanUndefined(pkg) };
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

    if (ctx.project.orm) {
      const ormAddon = META.project.orm.options[ctx.project.orm];
      if (ormAddon?.mono?.scope === 'pkg') {
        const pkgName = ormAddon.mono.name;
        let config = ormAddon.packageJson ?? {};

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
