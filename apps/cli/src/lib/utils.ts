export const MERGE_KEYS = new Set(['dependencies', 'devDependencies', 'scripts', 'exports']);

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

export function processScriptPorts(scripts: Record<string, string>, port?: number): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    resolved[key] = port
      ? value.replace(/\{\{port\}\}/g, String(port))
      : value.replace(/\s*--port\s*\{\{port\}\}/g, '');
  }
  return resolved;
}
