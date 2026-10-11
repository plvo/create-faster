import type { ProjectContext, TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/meta';

const TAG = Symbol('when');

type Negatable<T> = T | { not: T };

type MatchValue = string | string[] | true;

interface WhenItem<T = unknown> {
  [TAG]: true;
  match: Partial<Record<keyof ProjectContext, Negatable<MatchValue>>> & {
    stack?: Negatable<StackName | StackName[]>;
    library?: Negatable<string | string[]>;
    repo?: Negatable<'single' | 'turborepo'>;
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

function isNegation(expected: unknown): expected is { not: MatchValue } {
  return !!expected && typeof expected === 'object' && !Array.isArray(expected) && 'not' in expected;
}

function matchesKey(key: string, expected: MatchValue, ctx: TemplateContext): boolean {
  if (key === 'repo') return ctx.repo === expected;

  if (key === 'stack') {
    return includesAny(
      ctx.apps.map((a) => a.stackName),
      expected as StackName | StackName[],
    );
  }

  if (key === 'library') {
    return includesAny(
      ctx.apps.flatMap((a) => a.libraries),
      expected as string | string[],
    );
  }

  const raw = ctx.project[key as keyof ProjectContext];
  const actuals = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  if (actuals.length === 0) return false;
  if (expected === true) return true;

  return includesAny(actuals, expected as string | string[]);
}

function matches(match: WhenItem['match'], ctx: TemplateContext): boolean {
  for (const [key, expected] of Object.entries(match)) {
    if (expected === undefined) continue;

    const satisfied = isNegation(expected)
      ? !matchesKey(key, expected.not, ctx)
      : matchesKey(key, expected as MatchValue, ctx);
    if (!satisfied) return false;
  }
  return true;
}
