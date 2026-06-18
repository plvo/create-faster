import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import {
  getCategoryOptionUnavailability,
  getProjectAddon,
  isCategoryValueAllowedByLibraries,
  isLibraryCompatible,
  isRequirementMet,
  isServerRuntimeSatisfied,
} from '@/lib/addon-utils';
import type { TemplateContext } from '@/types/ctx';

describe('cloudflare-static declares its availability as META data', () => {
  const option = META.project.deployment.options['cloudflare-static'];

  test('requires a nextjs app via require.stacks', () => {
    expect(option?.require?.stacks).toEqual(['nextjs']);
  });

  test('declares it provides no server runtime', () => {
    expect(option?.providesServerRuntime).toBe(false);
  });

  test('server-dependent libraries declare needsServerRuntime', () => {
    expect(META.libraries['better-auth']?.needsServerRuntime).toBe(true);
    expect(META.libraries.trpc?.needsServerRuntime).toBe(true);
  });
});

describe('isServerRuntimeSatisfied', () => {
  const staticOption = META.project.deployment.options['cloudflare-static'];
  const serverOption = META.project.deployment.options.cloudflare;

  test('satisfied when the option provides a server runtime regardless of libraries', () => {
    const ctx = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
    } as Partial<TemplateContext>;
    expect(isServerRuntimeSatisfied(serverOption, ctx)).toBe(true);
  });

  test('satisfied for a server-less option when no library needs a runtime', () => {
    const ctx = { apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }] } as Partial<TemplateContext>;
    expect(isServerRuntimeSatisfied(staticOption, ctx)).toBe(true);
  });

  test('not satisfied for a server-less option when a library needs a runtime', () => {
    const ctxBetterAuth = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
    } as Partial<TemplateContext>;
    const ctxTrpc = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['trpc'] }],
    } as Partial<TemplateContext>;
    expect(isServerRuntimeSatisfied(staticOption, ctxBetterAuth)).toBe(false);
    expect(isServerRuntimeSatisfied(staticOption, ctxTrpc)).toBe(false);
  });
});

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

  test('stacks requirement is satisfied when any app uses a listed stack', () => {
    const ctxNextjs = { ...baseCtx, apps: [{ appName: 'web', stackName: 'nextjs' as const, libraries: [] }] };
    const ctxHono = { ...baseCtx, apps: [{ appName: 'api', stackName: 'hono' as const, libraries: [] }] };
    expect(isRequirementMet({ stacks: ['nextjs'] }, ctxNextjs)).toBe(true);
    expect(isRequirementMet({ stacks: ['nextjs'] }, ctxHono)).toBe(false);
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

describe('isCategoryValueAllowedByLibraries', () => {
  const ctxWithBetterAuth: Partial<TemplateContext> = {
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
  };

  test('allows sqlite when better-auth is selected (drizzle supports sqlite)', () => {
    expect(isCategoryValueAllowedByLibraries('database', 'sqlite', ctxWithBetterAuth)).toBe(true);
  });

  test('allows postgres and mysql when better-auth is selected', () => {
    expect(isCategoryValueAllowedByLibraries('database', 'postgres', ctxWithBetterAuth)).toBe(true);
    expect(isCategoryValueAllowedByLibraries('database', 'mysql', ctxWithBetterAuth)).toBe(true);
  });

  test('allows any value when no selected library constrains the category', () => {
    const ctx: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] }],
    };
    expect(isCategoryValueAllowedByLibraries('database', 'sqlite', ctx)).toBe(true);
  });
});

describe('getCategoryOptionUnavailability', () => {
  const staticOption = META.project.deployment.options['cloudflare-static'];
  const cloudflareOption = META.project.deployment.options.cloudflare;

  const nextjsPlain: Partial<TemplateContext> = {
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
  };
  const nextjsBetterAuth: Partial<TemplateContext> = {
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
    project: { tooling: [] },
  };
  const honoOnly: Partial<TemplateContext> = {
    apps: [{ appName: 'api', stackName: 'hono', libraries: [] }],
    project: { tooling: [] },
  };

  test('returns null when the option is available', () => {
    expect(getCategoryOptionUnavailability('deployment', 'cloudflare-static', staticOption, nextjsPlain)).toBeNull();
    expect(getCategoryOptionUnavailability('deployment', 'cloudflare', cloudflareOption, nextjsBetterAuth)).toBeNull();
  });

  test('reports the server-runtime conflict naming the blocking library', () => {
    const reason = getCategoryOptionUnavailability('deployment', 'cloudflare-static', staticOption, nextjsBetterAuth);
    expect(reason).toContain('server runtime');
    expect(reason).toContain('better-auth');
  });

  test('reports the require.stacks gap when no listed stack is present', () => {
    const reason = getCategoryOptionUnavailability('deployment', 'cloudflare-static', staticOption, honoOnly);
    expect(reason).toContain('nextjs');
  });
});
