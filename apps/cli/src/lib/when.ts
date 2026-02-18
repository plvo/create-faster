import { META, type ProjectCategoryName } from '@/__meta__';
import type { ProjectContext, TemplateContext } from '@/types/ctx';

const TAG = Symbol('when');

interface WhenItem<T = unknown> {
  [TAG]: true;
  match: Partial<Record<keyof ProjectContext, string>>;
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

function expandSelection(category: string, selected: string): string[] {
  const addon = META.project[category as ProjectCategoryName]?.options[selected];
  return addon?.compose ?? [selected];
}

function matches(match: WhenItem['match'], ctx: TemplateContext): boolean {
  for (const [category, expected] of Object.entries(match)) {
    if (!expected) continue;

    const raw = ctx.project[category as keyof ProjectContext];
    if (!raw) return false;

    const actuals = Array.isArray(raw)
      ? raw.flatMap((v) => expandSelection(category, v))
      : expandSelection(category, raw);

    if (!actuals.includes(expected)) return false;
  }
  return true;
}
