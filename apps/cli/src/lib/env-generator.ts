import { META } from '@/__meta__';
import { appReceivesAddon, findRuntimeAddon, getAppLibraries } from '@/lib/addon-utils';
import { collectMonoPackages } from '@/lib/package-json-generator';
import { resolveAppPort } from '@/lib/utils';
import { matches } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { EnvScope, EnvThirdParty, EnvVar, MetaAddon } from '@/types/meta';
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
  /** The only app that receives the variable, for one a blueprint declares on an app. */
  appName?: string;
  stacks?: StackName[];
  serverOnly?: boolean;
  file?: string;
  secret?: boolean;
  tasks?: string[];
  generateCommand?: string;
  thirdParty?: EnvThirdParty;
}

interface EnvToGenerate {
  name: string;
  command: string;
  paths: string[];
}

interface ThirdPartyEnv extends EnvThirdParty {
  name: string;
  paths: string[];
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

function renderEnvLine(env: CollectedEnv, ctx: TemplateContext, appName?: string): string {
  const line = resolveEnvValue(env.value, ctx, appName);
  if (env.generateCommand) return `${line} # generate with: ${env.generateCommand}`;
  if (env.thirdParty) return `${line} # ${env.thirdParty.description}: ${env.thirdParty.url}`;
  return line;
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

  const addEnv = (env: EnvVar, origin: Pick<CollectedEnv, 'source' | 'libraryName' | 'appName' | 'serverOnly'>) => {
    if (env.when && !matches(env.when, ctx)) return;
    for (const scope of resolveEnvScopes(env, packages)) {
      envs.push({
        value: env.value,
        scope,
        stacks: env.stacks,
        file: env.file,
        secret: typeof env.secret === 'object' ? matches(env.secret, ctx) : env.secret,
        tasks: env.tasks,
        generateCommand: env.generateCommand,
        thirdParty: env.thirdParty,
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
        for (const env of addon.envs) addEnv(env, { source: 'project', serverOnly: addon.serverOnly });
      }
    }
  }

  for (const app of ctx.apps) {
    for (const { name: libraryName, library } of getAppLibraries(app)) {
      for (const env of library.envs ?? []) addEnv(env, { source: 'library', libraryName });
    }
  }

  if (ctx.blueprint) {
    const blueprint = META.blueprints[ctx.blueprint];
    if (blueprint?.envs) {
      for (const env of blueprint.envs) addEnv(env, { source: 'project' });
    }
    for (const { appName, envs = [] } of blueprint?.context.apps ?? []) {
      for (const env of envs) addEnv(env, { source: 'project', appName });
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

function toEnvPath(examplePath: string): string {
  return examplePath.replace(/\.example$/, '');
}

/** The variable is written to the `.env` of the app that runs it: the file the runtime loads, not a package or dedicated file. */
function isReadFromAppEnvFile(env: CollectedEnv, ctx: TemplateContext): boolean {
  return !env.file && (ctx.repo === 'single' || env.scope === 'app');
}

function addToGroup(grouped: Map<string, string[]>, path: string, value: string): void {
  if (!grouped.has(path)) grouped.set(path, []);
  grouped.get(path)?.push(value);
}

function appAcceptsEnv(env: CollectedEnv, app: TemplateContext['apps'][number], ctx: TemplateContext): boolean {
  if (env.appName && env.appName !== app.appName) return false;
  if (!appReceivesAddon(env, app, ctx)) return false;
  if (env.source === 'library' && !app.libraries.includes(env.libraryName!)) return false;
  return !env.stacks || env.stacks.includes(app.stackName);
}

function isReceivedByProject(env: CollectedEnv, ctx: TemplateContext): boolean {
  return ctx.apps.some((app) => appAcceptsEnv(env, app, ctx));
}

function groupEnvsByDestination(envs: CollectedEnv[], ctx: TemplateContext): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const env of envs) {
    if (env.scope === 'app') {
      for (const app of ctx.apps) {
        if (!appAcceptsEnv(env, app, ctx)) continue;
        const path = resolveScopeToPath('app', ctx, app.appName, env.file);
        if (!path) continue;
        addToGroup(grouped, path, renderEnvLine(env, ctx, app.appName));
      }
    } else {
      if (!isReceivedByProject(env, ctx)) continue;
      const path = resolveScopeToPath(env.scope, ctx, undefined, env.file);
      if (!path) continue;
      addToGroup(grouped, path, renderEnvLine(env, ctx));
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
    .filter((env) => env.secret && isReadFromAppEnvFile(env, ctx) && appAcceptsEnv(env, app, ctx))
    .map((env) => extractEnvKey(env.value));

  return [...new Set(names)];
}

/** The names of the dedicated env files (`EnvVar.file`) the project receives, each once: files only a CLI loads, so they are never committed. */
export function collectEnvFileNames(ctx: TemplateContext): string[] {
  const names = collectAllEnvs(ctx)
    .filter((env) => isReceivedByProject(env, ctx))
    .flatMap((env) => (env.file ? [env.file] : []));

  return [...new Set(names)];
}

/** Whether the `.env` of the app receives the variable: a selected choice declares it and it reaches that app. */
export function collectAppReceivesEnv(ctx: TemplateContext, appName: string, name: string): boolean {
  const app = ctx.apps.find((candidate) => candidate.appName === appName);
  if (!app) return false;

  return collectAllEnvs(ctx).some(
    (env) => extractEnvKey(env.value) === name && isReadFromAppEnvFile(env, ctx) && appAcceptsEnv(env, app, ctx),
  );
}

/** The secret variables received by at least one app on one of the stacks, each listed once. */
export function collectProjectSecrets(ctx: TemplateContext, stacks: readonly StackName[]): string[] {
  const names = ctx.apps
    .filter((app) => stacks.includes(app.stackName))
    .flatMap((app) => collectAppSecrets(ctx, app.appName));

  return [...new Set(names)];
}

/** The names of the variables the project declares for a Turborepo task, each listed once, for the `env` of that task. */
export function collectTaskEnv(ctx: TemplateContext, task: string): string[] {
  const names = collectAllEnvs(ctx)
    .filter((env) => env.tasks?.includes(task) && isReceivedByProject(env, ctx))
    .map((env) => extractEnvKey(env.value));

  return [...new Set(names)];
}

function hasGenerateCommand(env: CollectedEnv): env is CollectedEnv & { generateCommand: string } {
  return env.generateCommand !== undefined;
}

/** The variables the user fills with a generated value, with the command and the `.env` of each app that reads them. */
export function collectEnvsToGenerate(ctx: TemplateContext): EnvToGenerate[] {
  const byName = new Map<string, EnvToGenerate>();

  for (const env of collectAllEnvs(ctx).filter(hasGenerateCommand)) {
    if (!isReadFromAppEnvFile(env, ctx)) continue;
    const name = extractEnvKey(env.value);
    const entry = byName.get(name) ?? { name, command: env.generateCommand, paths: [] };

    for (const app of ctx.apps.filter((candidate) => appAcceptsEnv(env, candidate, ctx))) {
      const examplePath = resolveScopeToPath(env.scope, ctx, app.appName);
      const path = examplePath ? toEnvPath(examplePath) : undefined;
      if (path && !entry.paths.includes(path)) entry.paths.push(path);
    }
    byName.set(name, entry);
  }

  return [...byName.values()].filter(({ paths }) => paths.length > 0);
}

function hasThirdParty(env: CollectedEnv): env is CollectedEnv & { thirdParty: EnvThirdParty } {
  return env.thirdParty !== undefined;
}

/** The ids of third-party accounts the project receives, with their source and the `.env` of each app that reads them. */
export function collectThirdPartyEnvs(ctx: TemplateContext): ThirdPartyEnv[] {
  const byName = new Map<string, ThirdPartyEnv>();

  for (const env of collectAllEnvs(ctx).filter(hasThirdParty)) {
    if (!isReadFromAppEnvFile(env, ctx)) continue;
    const name = extractEnvKey(env.value);
    const entry = byName.get(name) ?? { name, ...env.thirdParty, paths: [] };

    for (const app of ctx.apps.filter((candidate) => appAcceptsEnv(env, candidate, ctx))) {
      const examplePath = resolveScopeToPath(env.scope, ctx, app.appName);
      const path = examplePath ? toEnvPath(examplePath) : undefined;
      if (path && !entry.paths.includes(path)) entry.paths.push(path);
    }
    byName.set(name, entry);
  }

  return [...byName.values()].filter(({ paths }) => paths.length > 0);
}

export function collectEnvGroups(ctx: TemplateContext): EnvGroup[] {
  const files = collectEnvFiles(ctx);

  return files.map((file) => ({
    path: toEnvPath(file.destination),
    vars: file.content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => extractEnvKey(line)),
  }));
}
