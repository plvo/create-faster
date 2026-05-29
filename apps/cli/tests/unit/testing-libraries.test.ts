import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('Testing libraries', () => {
  const cases = [
    { key: 'vitest', stacks: ['nextjs', 'tanstack-start'] },
    { key: 'vitest-node', stacks: ['hono', 'node'] },
    { key: 'playwright', stacks: ['nextjs', 'tanstack-start'] },
    { key: 'jest-expo', stacks: ['expo'] },
  ] as const;

  for (const { key, stacks } of cases) {
    test(`${key} exists in the Testing category`, () => {
      const lib = META.libraries[key];
      expect(lib).toBeDefined();
      expect(lib.category).toBe('Testing');
    });

    test(`${key} supports ${stacks.join(', ')}`, () => {
      const lib = META.libraries[key];
      expect(lib.support?.stacks).toEqual([...stacks]);
    });

    test(`${key} declares a test script`, () => {
      const lib = META.libraries[key];
      const scripts = lib.packageJson?.scripts ?? {};
      expect(Object.keys(scripts)).toContain('test');
    });
  }

  test('vitest and vitest-node have disjoint stack support', () => {
    const react = META.libraries.vitest.support?.stacks as string[];
    const node = META.libraries['vitest-node'].support?.stacks as string[];
    expect(react.some((s) => node.includes(s))).toBe(false);
  });
});
