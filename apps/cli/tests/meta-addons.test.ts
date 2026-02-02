// ABOUTME: Validation tests for META with unified addons
// ABOUTME: Ensures all addons have required fields and valid references

import { describe, test, expect, beforeEach } from 'bun:test';
import { META } from '../src/__meta__';
import {
  getAddonsByType,
  isAddonCompatible,
  areAddonDependenciesMet,
  clearAddonGroupsCache,
} from '../src/lib/addon-utils';

beforeEach(() => {
  clearAddonGroupsCache();
});

describe('META.addons validation', () => {
  test('all addons have type and label', () => {
    for (const [name, addon] of Object.entries(META.addons)) {
      expect(addon.type, `${name} should have type`).toBeDefined();
      expect(addon.label, `${name} should have label`).toBeDefined();
    }
  });

  test('package destinations have required name', () => {
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.destination?.target === 'package') {
        expect(addon.destination.name, `${name} package destination needs name`).toBeDefined();
      }
    }
  });

  test('addon dependencies reference existing addons', () => {
    const addonNames = Object.keys(META.addons);
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.support?.addons) {
        for (const dep of addon.support.addons) {
          expect(addonNames, `${name} depends on non-existent addon: ${dep}`).toContain(dep);
        }
      }
    }
  });

  test('stack references are valid', () => {
    const stackNames = Object.keys(META.stacks);
    for (const [name, addon] of Object.entries(META.addons)) {
      if (addon.support?.stacks && addon.support.stacks !== 'all') {
        for (const stack of addon.support.stacks) {
          expect(stackNames, `${name} references non-existent stack: ${stack}`).toContain(stack);
        }
      }
    }
  });
});

describe('getAddonsByType', () => {
  test('groups addons correctly', () => {
    const groups = getAddonsByType(META);

    expect(groups.module).toContain('shadcn');
    expect(groups.orm).toContain('drizzle');
    expect(groups.database).toContain('postgres');
    expect(groups.extra).toContain('biome');
  });
});

describe('isAddonCompatible', () => {
  test('shadcn is compatible with nextjs', () => {
    expect(isAddonCompatible(META.addons.shadcn, 'nextjs')).toBe(true);
  });

  test('shadcn is not compatible with expo', () => {
    expect(isAddonCompatible(META.addons.shadcn, 'expo')).toBe(false);
  });

  test('tanstack-query is compatible with all', () => {
    expect(isAddonCompatible(META.addons['tanstack-query'], 'nextjs')).toBe(true);
    expect(isAddonCompatible(META.addons['tanstack-query'], 'expo')).toBe(true);
    expect(isAddonCompatible(META.addons['tanstack-query'], 'hono')).toBe(true);
  });
});

describe('areAddonDependenciesMet', () => {
  test('drizzle requires postgres or mysql', () => {
    expect(areAddonDependenciesMet(META.addons.drizzle, ['postgres'])).toBe(true);
    expect(areAddonDependenciesMet(META.addons.drizzle, ['mysql'])).toBe(true);
    expect(areAddonDependenciesMet(META.addons.drizzle, [])).toBe(false);
  });
});
