// ABOUTME: Tests for addon utility functions
// ABOUTME: Tests compatibility checking for libraries and requirement validation

import { describe, test, expect } from 'bun:test';
import { META } from '../src/__meta__';
import { isLibraryCompatible, getProjectAddon, isRequirementMet } from '../src/lib/addon-utils';
import type { TemplateContext } from '../src/types/ctx';

describe('isLibraryCompatible', () => {
  test('shadcn is compatible with nextjs', () => {
    expect(isLibraryCompatible(META.libraries.shadcn, 'nextjs')).toBe(true);
  });

  test('shadcn is not compatible with expo', () => {
    expect(isLibraryCompatible(META.libraries.shadcn, 'expo')).toBe(false);
  });

  test('tanstack-query is compatible with all', () => {
    expect(isLibraryCompatible(META.libraries['tanstack-query'], 'nextjs')).toBe(true);
    expect(isLibraryCompatible(META.libraries['tanstack-query'], 'expo')).toBe(true);
    expect(isLibraryCompatible(META.libraries['tanstack-query'], 'hono')).toBe(true);
  });

  test('nativewind is only compatible with expo', () => {
    expect(isLibraryCompatible(META.libraries.nativewind, 'expo')).toBe(true);
    expect(isLibraryCompatible(META.libraries.nativewind, 'nextjs')).toBe(false);
  });
});

describe('getProjectAddon', () => {
  test('gets addon from database category', () => {
    const addon = getProjectAddon('database', 'postgres');
    expect(addon?.label).toBe('PostgreSQL');
  });

  test('gets addon from orm category', () => {
    const addon = getProjectAddon('orm', 'drizzle');
    expect(addon?.label).toBe('Drizzle');
  });

  test('gets addon from tooling category', () => {
    const addon = getProjectAddon('tooling', 'biome');
    expect(addon?.label).toBe('Biome');
  });

  test('returns undefined for unknown addon', () => {
    const addon = getProjectAddon('database', 'unknown');
    expect(addon).toBeUndefined();
  });

  test('returns undefined for unknown category', () => {
    const addon = getProjectAddon('unknown', 'postgres');
    expect(addon).toBeUndefined();
  });
});

describe('isRequirementMet', () => {
  const baseCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: false,
  };

  test('no require means always satisfied', () => {
    expect(isRequirementMet(undefined, baseCtx)).toBe(true);
    expect(isRequirementMet({}, baseCtx)).toBe(true);
  });

  test('git requirement checks ctx.git', () => {
    expect(isRequirementMet({ git: true }, { ...baseCtx, git: false })).toBe(false);
    expect(isRequirementMet({ git: true }, { ...baseCtx, git: true })).toBe(true);
  });

  test('orm requirement checks ctx.project.orm', () => {
    const ctxWithDrizzle = { ...baseCtx, project: { orm: 'drizzle', tooling: [] } };
    const ctxWithPrisma = { ...baseCtx, project: { orm: 'prisma', tooling: [] } };
    const ctxNoOrm = baseCtx;

    expect(isRequirementMet({ orm: ['drizzle', 'prisma'] }, ctxWithDrizzle)).toBe(true);
    expect(isRequirementMet({ orm: ['drizzle', 'prisma'] }, ctxWithPrisma)).toBe(true);
    expect(isRequirementMet({ orm: ['drizzle', 'prisma'] }, ctxNoOrm)).toBe(false);
  });

  test('database requirement checks ctx.project.database', () => {
    const ctxWithDb = { ...baseCtx, project: { database: 'postgres', tooling: [] } };
    expect(isRequirementMet({ database: ['postgres'] }, ctxWithDb)).toBe(true);
    expect(isRequirementMet({ database: ['mysql'] }, ctxWithDb)).toBe(false);
  });

  test('libraries requirement checks any app has library', () => {
    const ctxWithLib = {
      ...baseCtx,
      apps: [{ appName: 'web', stackName: 'nextjs' as const, libraries: ['shadcn'] }],
    };
    expect(isRequirementMet({ libraries: ['shadcn'] }, ctxWithLib)).toBe(true);
    expect(isRequirementMet({ libraries: ['mdx'] }, ctxWithLib)).toBe(false);
  });
});
