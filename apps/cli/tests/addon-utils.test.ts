// ABOUTME: Tests for addon utility functions
// ABOUTME: Tests grouping, compatibility, and dependency checking

import { beforeEach, describe, expect, test } from 'bun:test';
import { META } from '../src/__meta__';
import {
  areAddonDependenciesMet,
  clearAddonGroupsCache,
  getAddonsByType,
  isAddonCompatible,
} from '../src/lib/addon-utils';

beforeEach(() => {
  clearAddonGroupsCache();
});

describe('getAddonsByType', () => {
  test('groups addons correctly', () => {
    const groups = getAddonsByType(META);

    expect(groups.module).toContain('shadcn');
    expect(groups.orm).toContain('drizzle');
    expect(groups.database).toContain('postgres');
    expect(groups.extra).toContain('biome');
  });

  test('caches result', () => {
    const groups1 = getAddonsByType(META);
    const groups2 = getAddonsByType(META);
    expect(groups1).toBe(groups2);
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

  test('addon without support.stacks is compatible with all', () => {
    expect(isAddonCompatible(META.addons.biome, 'nextjs')).toBe(true);
    expect(isAddonCompatible(META.addons.biome, 'expo')).toBe(true);
  });
});

describe('areAddonDependenciesMet', () => {
  test('drizzle requires postgres or mysql', () => {
    expect(areAddonDependenciesMet(META.addons.drizzle, ['postgres'])).toBe(true);
    expect(areAddonDependenciesMet(META.addons.drizzle, ['mysql'])).toBe(true);
    expect(areAddonDependenciesMet(META.addons.drizzle, [])).toBe(false);
  });

  test('addon without dependencies always satisfied', () => {
    expect(areAddonDependenciesMet(META.addons.biome, [])).toBe(true);
  });
});
