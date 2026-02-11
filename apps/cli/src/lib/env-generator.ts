import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { EnvScope, EnvVar } from '@/types/meta';

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
}

function resolveAppPort(apps: AppContext[], appName: string): number {
  const index = apps.findIndex((a) => a.appName === appName);
  return index === -1 ? 3000 : 3000 + index;
}

function resolveEnvValue(value: string, ctx: TemplateContext, appName?: string): string {
  let resolved = value.replace(/\{\{projectName\}\}/g, ctx.projectName);
  if (appName) {
    const port = resolveAppPort(ctx.apps, appName);
    resolved = resolved.replace(/\{\{appPort\}\}/g, String(port));
  }
  return resolved;
}

function extractEnvKey(value: string): string {
  return value.split('=')[0].trim();
}

function collectAllEnvs(ctx: TemplateContext): CollectedEnv[] {
  const envs: CollectedEnv[] = [];

  for (const [, category] of Object.entries(META.project)) {
    for (const [optionName, addon] of Object.entries(category.options)) {
      const isSelected =
        ctx.project.database === optionName ||
        ctx.project.orm === optionName ||
        ctx.project.tooling.includes(optionName);

      if (isSelected && addon.envs) {
        for (const env of addon.envs) {
          for (const scope of env.monoScope) {
            envs.push({ value: env.value, scope, source: 'project' });
          }
        }
      }
    }
  }

  for (const app of ctx.apps) {
    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (!library?.envs || !isLibraryCompatible(library, app.stackName)) continue;

      for (const env of library.envs) {
        for (const scope of env.monoScope) {
          envs.push({ value: env.value, scope, source: 'library', libraryName });
        }
      }
    }
  }

  return envs;
}

function resolveScopeToPath(scope: EnvScope, ctx: TemplateContext, appName?: string): string | null {
  if (ctx.repo === 'single') {
    return '.env.example';
  }

  if (scope === 'root') {
    return '.env.example';
  }

  if (scope === 'app') {
    if (!appName) return null;
    return `apps/${appName}/.env.example`;
  }

  if (typeof scope === 'object' && 'pkg' in scope) {
    return `packages/${scope.pkg}/.env.example`;
  }

  return null;
}

function groupEnvsByDestination(envs: CollectedEnv[], ctx: TemplateContext): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const env of envs) {
    if (env.scope === 'app') {
      if (env.source === 'library') {
        for (const app of ctx.apps) {
          if (!app.libraries.includes(env.libraryName!)) continue;
          const path = resolveScopeToPath('app', ctx, app.appName);
          if (!path) continue;
          const resolved = resolveEnvValue(env.value, ctx, app.appName);
          if (!grouped.has(path)) grouped.set(path, []);
          grouped.get(path)!.push(resolved);
        }
      } else {
        for (const app of ctx.apps) {
          const path = resolveScopeToPath('app', ctx, app.appName);
          if (!path) continue;
          const resolved = resolveEnvValue(env.value, ctx, app.appName);
          if (!grouped.has(path)) grouped.set(path, []);
          grouped.get(path)!.push(resolved);
        }
      }
    } else {
      const path = resolveScopeToPath(env.scope, ctx);
      if (!path) continue;
      const resolved = resolveEnvValue(env.value, ctx);
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path)!.push(resolved);
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

export function collectEnvGroups(ctx: TemplateContext): EnvGroup[] {
  const files = collectEnvFiles(ctx);

  return files.map((file) => ({
    path: file.destination.replace('.env.example', '.env'),
    vars: file.content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => extractEnvKey(line)),
  }));
}
