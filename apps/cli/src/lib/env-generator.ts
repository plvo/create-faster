import { META } from '@/__meta__';
import { findRuntimeAddon, isLibraryCompatible } from '@/lib/addon-utils';
import { collectMonoPackages } from '@/lib/package-json-generator';
import { resolveAppPort } from '@/lib/utils';
import { matches } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { EnvScope, EnvVar, MetaAddon } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

interface EnvFileOutput {
  destination: string;
  content: string;
}

interface EnvGroup {
  path: string;
  vars: string[];
}

interface CollectedEnv {
  value: string;
  scope: EnvScope;
  source: 'project' | 'library';
  libraryName?: string;
  stacks?: StackName[];
  file?: string;
  secret?: boolean;
}

/** The URL the app is reached at in development: `http://localhost:{port}` unless a tooling addon provides it. */
export function resolveAppUrl(ctx: TemplateContext, appName: string): string {
  const port = resolveAppPort(ctx.apps, appName);
  const runtimeAddon = findRuntimeAddon(ctx);
  return runtimeAddon?.runtime?.resolveAppUrl
    ? runtimeAddon.runtime.resolveAppUrl({
        projectName: ctx.projectName,
        appName,
        isTurborepo: ctx.repo === 'turborepo',
        port,
      })
    : `http://localhost:${port}`;
}

function resolveEnvValue(value: string, ctx: TemplateContext, appName?: string): string {
  let resolved = value.replace(/\{\{projectName\}\}/g, ctx.projectName);
  if (ctx.dbPort !== undefined) {
    resolved = resolved.replace(/\{\{dbPort\}\}/g, String(ctx.dbPort));
  }
  if (appName) {
    resolved = resolved.replace(/\{\{appPort\}\}/g, String(resolveAppPort(ctx.apps, appName)));
    resolved = resolved.replace(/\{\{appUrl\}\}/g, resolveAppUrl(ctx, appName));
  }
  return resolved;
}

function extractEnvKey(value: string): string {
  const [key = ''] = value.split('=');
  return key.trim();
}

function resolveEnvScopes(env: EnvVar, packages: Map<string, unknown>): EnvScope[] {
  const scopes = env.monoScope.filter((scope) => typeof scope !== 'object' || packages.has(scope.pkg));
  return scopes.length > 0 ? scopes : ['app'];
}

function collectAllEnvs(ctx: TemplateContext): CollectedEnv[] {
  const envs: CollectedEnv[] = [];
  const packages = collectMonoPackages(ctx);

  const addEnv = (env: EnvVar, origin: Pick<CollectedEnv, 'source' | 'libraryName'>) => {
    if (env.when && !matches(env.when, ctx)) return;
    for (const scope of resolveEnvScopes(env, packages)) {
      envs.push({
        value: env.value,
        scope,
        stacks: env.stacks,
        file: env.file,
        secret: typeof env.secret === 'object' ? matches(env.secret, ctx) : env.secret,
        ...origin,
      });
    }
  };

  for (const [, category] of Object.entries(META.project)) {
    for (const [optionName, addon] of Object.entries(category.options) as [string, MetaAddon][]) {
      const isSelected =
        ctx.project.database === optionName ||
        ctx.project.orm === optionName ||
        ctx.project.deployment === optionName ||
        ctx.project.tooling.includes(optionName);

      if (isSelected && addon.envs) {
        for (const env of addon.envs) addEnv(env, { source: 'project' });
      }
    }
  }

  for (const app of ctx.apps) {
    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (!library?.envs || !isLibraryCompatible(library, app.stackName)) continue;

      for (const env of library.envs) addEnv(env, { source: 'library', libraryName });
    }
  }

  if (ctx.blueprint) {
    const blueprint = META.blueprints[ctx.blueprint];
    if (blueprint?.envs) {
      for (const env of blueprint.envs) addEnv(env, { source: 'project' });
    }
  }

  return envs;
}

function resolveScopeToPath(scope: EnvScope, ctx: TemplateContext, appName?: string, file?: string): string | null {
  const filename = file ? `.env.${file}.example` : '.env.example';

  if (ctx.repo === 'single') {
    return filename;
  }

  if (scope === 'root') {
    return filename;
  }

  if (scope === 'app') {
    if (!appName) return null;
    return `apps/${appName}/${filename}`;
  }

  if (typeof scope === 'object' && 'pkg' in scope) {
    return `packages/${scope.pkg}/${filename}`;
  }

  return null;
}

function addToGroup(grouped: Map<string, string[]>, path: string, value: string): void {
  if (!grouped.has(path)) grouped.set(path, []);
  grouped.get(path)?.push(value);
}

function appAcceptsEnv(env: CollectedEnv, app: TemplateContext['apps'][number]): boolean {
  if (env.source === 'library' && !app.libraries.includes(env.libraryName!)) return false;
  return !env.stacks || env.stacks.includes(app.stackName);
}

function groupEnvsByDestination(envs: CollectedEnv[], ctx: TemplateContext): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const env of envs) {
    if (env.scope === 'app') {
      for (const app of ctx.apps) {
        if (!appAcceptsEnv(env, app)) continue;
        const path = resolveScopeToPath('app', ctx, app.appName, env.file);
        if (!path) continue;
        addToGroup(grouped, path, resolveEnvValue(env.value, ctx, app.appName));
      }
    } else {
      if (env.stacks && !ctx.apps.some((app) => appAcceptsEnv(env, app))) continue;
      const path = resolveScopeToPath(env.scope, ctx, undefined, env.file);
      if (!path) continue;
      addToGroup(grouped, path, resolveEnvValue(env.value, ctx));
    }
  }

  return grouped;
}

function dedupeByKey(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const key = extractEnvKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }

  return result;
}

export function collectEnvFiles(ctx: TemplateContext): EnvFileOutput[] {
  const allEnvs = collectAllEnvs(ctx);
  if (allEnvs.length === 0) return [];

  const grouped = groupEnvsByDestination(allEnvs, ctx);
  const files: EnvFileOutput[] = [];

  for (const [destination, lines] of grouped) {
    const deduped = dedupeByKey(lines);
    if (deduped.length === 0) continue;
    files.push({ destination, content: `${deduped.join('\n')}\n` });
  }

  return files;
}

/** The names of the secret variables the app reads at runtime: those of its `.env`, the ones a Worker must be given. */
export function collectAppSecrets(ctx: TemplateContext, appName: string): string[] {
  const app = ctx.apps.find((candidate) => candidate.appName === appName);
  if (!app) return [];

  const names = collectAllEnvs(ctx)
    .filter(
      (env) => env.secret && !env.file && (ctx.repo === 'single' || env.scope === 'app') && appAcceptsEnv(env, app),
    )
    .map((env) => extractEnvKey(env.value));

  return [...new Set(names)];
}

/** The secret variables received by at least one app on one of the stacks, each listed once. */
export function collectProjectSecrets(ctx: TemplateContext, stacks: readonly StackName[]): string[] {
  const names = ctx.apps
    .filter((app) => stacks.includes(app.stackName))
    .flatMap((app) => collectAppSecrets(ctx, app.appName));

  return [...new Set(names)];
}

export function collectEnvGroups(ctx: TemplateContext): EnvGroup[] {
  const files = collectEnvFiles(ctx);

  return files.map((file) => ({
    path: file.destination.replace(/\.example$/, ''),
    vars: file.content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => extractEnvKey(line)),
  }));
}
