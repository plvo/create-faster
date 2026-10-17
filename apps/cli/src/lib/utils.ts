import type { AppContext } from '@/types/ctx';

export const MERGE_KEYS = new Set(['dependencies', 'devDependencies', 'scripts', 'exports']);

export function resolveAppPort(apps: AppContext[], appName: string): number {
  const index = apps.findIndex((a) => a.appName === appName);
  return index === -1 ? 3000 : 3000 + index;
}

export function spreadExtraKeys(target: Record<string, unknown>, config: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(config)) {
    if (!MERGE_KEYS.has(key) && value !== undefined) target[key] = value;
  }
}

export function cleanUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted = {} as T;
  for (const key of Object.keys(obj).sort()) {
    (sorted as Record<string, unknown>)[key] = obj[key];
  }
  return sorted;
}

export function usesPortPlaceholder(script: string): boolean {
  return /\{\{port\}\}/.test(script);
}

const PORT_FLAG = /(\s*)--port\s*\{\{port\}\}/g;

// A single repo leaves the port flag out and lets the runtime take its own default, which is the port of the first app.
// A turborepo keeps the flag with the app port as the default of `PORT`, so a `PORT` in the environment wins.
export function processScriptPorts(
  scripts: Record<string, string>,
  port: number,
  omitPortFlag = false,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    const flagResolved = value.replace(PORT_FLAG, omitPortFlag ? '' : '$1--port ${PORT:-{{port}}}');
    resolved[key] = flagResolved.replace(/\{\{port\}\}/g, String(port));
  }
  return resolved;
}
