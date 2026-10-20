import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

/** Every value META gives a `typescript` key, wherever it is declared (stacks, libraries, addons, blueprints). */
function declaredTypeScriptRanges(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(declaredTypeScriptRanges);
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'typescript' && typeof value === 'string' ? [value] : declaredTypeScriptRanges(value),
  );
}

describe('TypeScript range', () => {
  test('every workspace of a turborepo declares the same one', () => {
    const ranges = declaredTypeScriptRanges(META);
    expect(ranges.length).toBeGreaterThan(1);
    expect(new Set(ranges).size).toBe(1);
  });
});
