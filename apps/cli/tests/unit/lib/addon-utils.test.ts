import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { getProjectAddon, isLibraryCompatible, isRequirementMet } from '@/lib/addon-utils';
import type { TemplateContext } from '@/types/ctx';

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

  test('gets addon from linter category', () => {
    const addon = getProjectAddon('linter', 'biome');
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

  test('linter: true is satisfied when any linter is selected', () => {
    const ctxBiome = { ...baseCtx, project: { linter: 'biome', tooling: [] } };
    const ctxEslint = { ...baseCtx, project: { linter: 'eslint', tooling: [] } };
    expect(isRequirementMet({ linter: true }, ctxBiome)).toBe(true);
    expect(isRequirementMet({ linter: true }, ctxEslint)).toBe(true);
  });

  test('linter: true fails when no linter is selected', () => {
    expect(isRequirementMet({ linter: true }, baseCtx)).toBe(false);
  });

  test('linter: string[] is satisfied when the exact linter matches', () => {
    const ctxBiome = { ...baseCtx, project: { linter: 'biome', tooling: [] } };
    expect(isRequirementMet({ linter: ['biome'] }, ctxBiome)).toBe(true);
    expect(isRequirementMet({ linter: ['eslint'] }, ctxBiome)).toBe(false);
  });

  test('husky require is satisfied with git + linter', () => {
    const ctx = { ...baseCtx, git: true, project: { linter: 'biome', tooling: [] } };
    expect(isRequirementMet({ git: true, linter: true }, ctx)).toBe(true);
  });

  test('husky require fails when git is present but linter is missing', () => {
    const ctx = { ...baseCtx, git: true };
    expect(isRequirementMet({ git: true, linter: true }, ctx)).toBe(false);
  });

  test('husky require fails when linter is present but git is missing', () => {
    const ctx = { ...baseCtx, project: { linter: 'biome', tooling: [] } };
    expect(isRequirementMet({ git: true, linter: true }, ctx)).toBe(false);
  });
});
