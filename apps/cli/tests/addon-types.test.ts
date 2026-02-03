// ABOUTME: Type tests for unified addon architecture
// ABOUTME: Ensures MetaAddon types enforce correct destination constraints

import { describe, expect, test } from 'bun:test';
import type { AddonDestination, AddonSupport, AddonType, MetaAddon, StackName } from '../src/types/meta';

describe('MetaAddon types', () => {
  test('AddonType includes all valid types', () => {
    const types: AddonType[] = ['module', 'orm', 'database', 'extra'];
    expect(types).toHaveLength(4);
  });

  test('AddonDestination app target has no required fields', () => {
    const dest: AddonDestination = { target: 'app' };
    expect(dest.target).toBe('app');
  });

  test('AddonDestination package target requires name', () => {
    const dest: AddonDestination = {
      target: 'package',
      name: 'ui',
      singlePath: 'src/components/ui/',
    };
    expect(dest.target).toBe('package');
    expect(dest.name).toBe('ui');
  });

  test('AddonDestination root target has no required fields', () => {
    const dest: AddonDestination = { target: 'root' };
    expect(dest.target).toBe('root');
  });

  test('AddonSupport accepts stacks array or all', () => {
    const supportArray: AddonSupport = { stacks: ['nextjs', 'expo'] };
    const supportAll: AddonSupport = { stacks: 'all' };
    expect(supportArray.stacks).toContain('nextjs');
    expect(supportAll.stacks).toBe('all');
  });

  test('AddonSupport accepts addon dependencies', () => {
    const support: AddonSupport = {
      stacks: 'all',
      addons: ['postgres', 'mysql'],
    };
    expect(support.addons).toContain('postgres');
  });

  test('MetaAddon with package destination has required name', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'shadcn/ui',
      destination: { target: 'package', name: 'ui', singlePath: 'src/components/ui/' },
      packageJson: { dependencies: { 'radix-ui': '^1.4.2' } },
    };
    expect(addon.destination?.target).toBe('package');
    if (addon.destination?.target === 'package') {
      expect(addon.destination.name).toBe('ui');
    }
  });

  test('MetaAddon defaults destination to app when omitted', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'TanStack Query',
      packageJson: { dependencies: { '@tanstack/react-query': '^5.90.0' } },
    };
    expect(addon.destination).toBeUndefined();
  });
});
