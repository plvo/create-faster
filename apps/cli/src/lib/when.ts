import type { ProjectContext, TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/meta';

const TAG = Symbol('when');

type MatchValue = string | string[] | true;

interface WhenItem<T = unknown> {
  [TAG]: true;
  match: Partial<Record<keyof ProjectContext, MatchValue>> & {
    stack?: StackName | StackName[];
    library?: string | string[];
    repo?: 'single' | 'turborepo';
  };
  value: T;
}

function isWhenItem(v: unknown): v is WhenItem {
  return !!v && typeof v === 'object' && TAG in v;
}

export function $when<T>(match: WhenItem['match'], value: T): WhenItem<T> {
  return { [TAG]: true, match, value };
}

export function resolveConditionals<T>(data: T, ctx: TemplateContext): T {
  if (isWhenItem(data)) {
    return matches(data.match, ctx) ? resolveConditionals(data.value as T, ctx) : (undefined as T);
  }

  if (Array.isArray(data)) {
    const out = data.map((item) => resolveConditionals(item, ctx)).filter((item) => item !== undefined);
    return out as T;
  }

  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const resolved = resolveConditionals(v, ctx);
      if (resolved === undefined) continue;
      if (Array.isArray(resolved) && resolved.length === 0) continue;
      if (
        resolved !== null &&
        typeof resolved === 'object' &&
        !Array.isArray(resolved) &&
        Object.keys(resolved as Record<string, unknown>).length === 0
      )
        continue;
      out[k] = resolved;
    }
    return out as T;
  }

  return data;
}

function includesAny(haystack: string[], needles: string | string[]): boolean {
  const arr = Array.isArray(needles) ? needles : [needles];
  return arr.some((n) => haystack.includes(n));
}

function matches(match: WhenItem['match'], ctx: TemplateContext): boolean {
  for (const [key, expected] of Object.entries(match)) {
    if (expected === undefined) continue;

    if (key === 'repo') {
      if (ctx.repo !== expected) return false;
      continue;
    }

    if (key === 'stack') {
      const stacks = ctx.apps.map((a) => a.stackName);
      if (!includesAny(stacks, expected as StackName | StackName[])) return false;
      continue;
    }

    if (key === 'library') {
      const libs = ctx.apps.flatMap((a) => a.libraries);
      if (!includesAny(libs, expected as string | string[])) return false;
      continue;
    }

    // ProjectContext key
    const raw = ctx.project[key as keyof ProjectContext];

    if (expected === true) {
      if (!raw) return false;
      continue;
    }

    if (!raw) return false;

    const actuals = Array.isArray(raw) ? raw : [raw as string];
    if (!includesAny(actuals, expected as string | string[])) return false;
  }
  return true;
}
