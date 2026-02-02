// ABOUTME: Type tests for META structure
// ABOUTME: Ensures META conforms to expected types

import { describe, expect, test } from 'bun:test';
import type { MetaModule, MetaStack, PackageJsonConfig } from '../src/types/meta';

describe('Meta types', () => {
  test('PackageJsonConfig accepts valid config', () => {
    const config: PackageJsonConfig = {
      dependencies: { react: '^19.0.0' },
      devDependencies: { typescript: '^5' },
      scripts: { dev: 'next dev' },
      exports: { '.': './src/index.ts' },
    };
    expect(config.dependencies?.react).toBe('^19.0.0');
  });

  test('MetaStack requires type and label', () => {
    const stack: MetaStack = {
      type: 'app',
      label: 'Next.js',
      packageJson: {
        dependencies: { next: '^16.0.0' },
      },
    };
    expect(stack.type).toBe('app');
  });

  test('MetaModule accepts stacks array or "all"', () => {
    const moduleWithArray: MetaModule = {
      label: 'shadcn',
      stacks: ['nextjs', 'tanstack-start'],
      packageJson: {},
    };
    expect(moduleWithArray.stacks).toContain('nextjs');

    const moduleWithAll: MetaModule = {
      label: 'TanStack Query',
      stacks: 'all',
      packageJson: {},
    };
    expect(moduleWithAll.stacks).toBe('all');
  });

  test('MetaModule accepts optional asPackage and singlePath', () => {
    const module: MetaModule = {
      label: 'shadcn',
      stacks: ['nextjs'],
      asPackage: 'ui',
      singlePath: 'src/components/ui/',
      packageJson: {},
    };
    expect(module.asPackage).toBe('ui');
    expect(module.singlePath).toBe('src/components/ui/');
  });
});
