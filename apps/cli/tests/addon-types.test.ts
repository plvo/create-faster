// ABOUTME: Type tests for unified addon architecture
// ABOUTME: Ensures MetaAddon types enforce correct mono constraints

import { describe, expect, test } from 'bun:test';
import type { AddonMono, AddonSupport, AddonType, MetaAddon, MonoScope, StackName } from '../src/types/meta';

describe('MetaAddon types', () => {
  test('AddonType includes all valid types', () => {
    const types: AddonType[] = ['module', 'orm', 'database', 'extra'];
    expect(types).toHaveLength(4);
  });

  test('MonoScope includes all valid scopes', () => {
    const scopes: MonoScope[] = ['app', 'pkg', 'root'];
    expect(scopes).toHaveLength(3);
  });

  test('AddonMono app scope has no required fields', () => {
    const mono: AddonMono = { scope: 'app' };
    expect(mono.scope).toBe('app');
  });

  test('AddonMono pkg scope requires name', () => {
    const mono: AddonMono = { scope: 'pkg', name: 'ui' };
    expect(mono.scope).toBe('pkg');
    expect(mono.name).toBe('ui');
  });

  test('AddonMono root scope has no required fields', () => {
    const mono: AddonMono = { scope: 'root' };
    expect(mono.scope).toBe('root');
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

  test('MetaAddon with pkg mono has required name', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'shadcn/ui',
      mono: { scope: 'pkg', name: 'ui' },
      packageJson: { dependencies: { 'radix-ui': '^1.4.2' } },
    };
    expect(addon.mono?.scope).toBe('pkg');
    if (addon.mono?.scope === 'pkg') {
      expect(addon.mono.name).toBe('ui');
    }
  });

  test('MetaAddon defaults mono to app when omitted', () => {
    const addon: MetaAddon = {
      type: 'module',
      label: 'TanStack Query',
      packageJson: { dependencies: { '@tanstack/react-query': '^5.90.0' } },
    };
    expect(addon.mono).toBeUndefined();
  });
});
