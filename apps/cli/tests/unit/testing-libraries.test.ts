import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('Testing libraries', () => {
  const cases = [
    { key: 'vitest', stacks: ['nextjs', 'tanstack-start'], testScript: 'test' },
    { key: 'vitest-node', stacks: ['hono', 'node'], testScript: 'test' },
    { key: 'playwright', stacks: ['nextjs', 'tanstack-start'], testScript: 'test:e2e' },
    { key: 'jest-expo', stacks: ['expo'], testScript: 'test' },
  ] as const;

  for (const { key, stacks, testScript } of cases) {
    test(`${key} exists in the Testing category`, () => {
      const lib = META.libraries[key];
      expect(lib).toBeDefined();
      expect(lib.category).toBe('Testing');
    });

    test(`${key} supports ${stacks.join(', ')}`, () => {
      const lib = META.libraries[key];
      expect(lib.support?.stacks).toEqual([...stacks]);
    });

    test(`${key} declares its ${testScript} script`, () => {
      const lib = META.libraries[key];
      const scripts = lib.packageJson?.scripts ?? {};
      expect(Object.keys(scripts)).toContain(testScript);
    });
  }

  test('vitest keeps the test script when combined with playwright', () => {
    expect(META.libraries.vitest.packageJson?.scripts?.test).toBe('vitest run');
    expect(META.libraries.playwright.packageJson?.scripts?.test).toBeUndefined();
  });

  test('vitest and vitest-node have disjoint stack support', () => {
    const react = META.libraries.vitest.support?.stacks as string[];
    const node = META.libraries['vitest-node'].support?.stacks as string[];
    expect(react.some((s) => node.includes(s))).toBe(false);
  });
});
