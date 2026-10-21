import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import {
  describeRequire,
  getCategoryOptionUnavailability,
  getProjectAddon,
  isCategoryValueAllowedByLibraries,
  isLibraryCompatible,
  isLocalFilesystemSatisfied,
  isRequirementMet,
  isServerRuntimeSatisfied,
  isSingletonDbSatisfied,
  resolveDeployAppDir,
  resolveScriptPlaceholders,
} from '@/lib/addon-utils';
import type { ProjectContext, TemplateContext } from '@/types/ctx';

describe('cloudflare-static declares its availability as META data', () => {
  const option = META.project.deployment.options['cloudflare-static'];

  test('requires a nextjs or tanstack-start app via require.stacks', () => {
    expect(option?.require?.stacks).toEqual(['nextjs', 'tanstack-start']);
  });

  test('declares it provides no server runtime', () => {
    expect(option?.providesServerRuntime).toBe(false);
  });

  test('server-dependent libraries declare needsServerRuntime', () => {
    expect(META.libraries['better-auth']?.needsServerRuntime).toBe(true);
    expect(META.libraries.trpc?.needsServerRuntime).toBe(true);
    expect(META.libraries.posthog?.needsServerRuntime).toBe(true);
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
    expect(isLibraryCompatible(META.libraries.shadcn!, 'nextjs')).toBe(true);
  });

  test('shadcn is not compatible with expo', () => {
    expect(isLibraryCompatible(META.libraries.shadcn!, 'expo')).toBe(false);
  });

  test('tanstack-query is compatible with all', () => {
    expect(isLibraryCompatible(META.libraries['tanstack-query']!, 'nextjs')).toBe(true);
    expect(isLibraryCompatible(META.libraries['tanstack-query']!, 'expo')).toBe(true);
    expect(isLibraryCompatible(META.libraries['tanstack-query']!, 'hono')).toBe(true);
  });

  test('nativewind is only compatible with expo', () => {
    expect(isLibraryCompatible(META.libraries.nativewind!, 'expo')).toBe(true);
    expect(isLibraryCompatible(META.libraries.nativewind!, 'nextjs')).toBe(false);
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

  test('deployment requirement is unmet when project.deployment is absent', () => {
    const ctx = { project: { tooling: [] }, apps: [] } as unknown as TemplateContext;
    expect(isRequirementMet({ deployment: ['cloudflare'] }, ctx)).toBe(false);
  });

  test('deployment requirement is unmet for a non-matching deployment', () => {
    const ctx = { project: { deployment: 'sst', tooling: [] }, apps: [] } as unknown as TemplateContext;
    expect(isRequirementMet({ deployment: ['cloudflare'] }, ctx)).toBe(false);
  });

  test('deployment requirement is met for a matching deployment', () => {
    const ctx = { project: { deployment: 'cloudflare', tooling: [] }, apps: [] } as unknown as TemplateContext;
    expect(isRequirementMet({ deployment: ['cloudflare'] }, ctx)).toBe(true);
  });
});

describe('isRequirementMet on a context without project answers', () => {
  const appsOnly: Partial<TemplateContext> = {
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
  };

  test('database, orm, deployment, linter and tooling requirements are unmet instead of throwing', () => {
    expect(isRequirementMet({ database: ['postgres'] }, appsOnly)).toBe(false);
    expect(isRequirementMet({ orm: ['drizzle'] }, appsOnly)).toBe(false);
    expect(isRequirementMet({ deployment: ['cloudflare'] }, appsOnly)).toBe(false);
    expect(isRequirementMet({ linter: true }, appsOnly)).toBe(false);
    expect(isRequirementMet({ tooling: ['husky'] }, appsOnly)).toBe(false);
  });

  test('requirements on apps and libraries still resolve', () => {
    expect(isRequirementMet({ stacks: ['nextjs'] }, appsOnly)).toBe(true);
    expect(isRequirementMet({ libraries: ['better-auth'] }, appsOnly)).toBe(true);
  });
});

describe('describeRequire', () => {
  const requireOf = (library: string) => META.libraries[library]?.require ?? {};
  const husky = META.project.tooling.options.husky?.require ?? {};
  const project = (overrides: Partial<ProjectContext> = {}): Partial<TemplateContext> => ({
    apps: [],
    project: { tooling: [], ...overrides },
  });

  test('husky: only the missing one of git and a linter', () => {
    expect(describeRequire(husky, { ...project({ linter: 'biome' }), git: false })).toBe('git');
    expect(describeRequire(husky, { ...project(), git: true })).toBe('a linter');
    expect(describeRequire(husky, { ...project(), git: false })).toBe('git, a linter');
    expect(describeRequire(husky, { ...project({ linter: 'biome' }), git: true })).toBe('');
  });

  test('better-auth: the database and the orm are told apart', () => {
    const betterAuth = requireOf('better-auth');

    expect(describeRequire(betterAuth, project())).toBe(
      'database: postgres or mysql or sqlite or d1, orm: drizzle or prisma',
    );
    expect(describeRequire(betterAuth, project({ database: 'postgres' }))).toBe('orm: drizzle or prisma');
    expect(describeRequire(betterAuth, project({ database: 'postgres', orm: 'drizzle' }))).toBe('');
  });

  test('a requirement set to a list the selection is outside of is listed', () => {
    expect(describeRequire({ orm: ['drizzle'] }, project({ orm: 'prisma' }))).toBe('orm: drizzle');
    expect(describeRequire({ linter: ['biome', 'oxc'] }, project({ linter: 'eslint' }))).toBe('linter: biome or oxc');
    expect(describeRequire({ linter: ['biome', 'oxc'] }, project({ linter: 'oxc' }))).toBe('');
  });

  test('cloudflare-static: the stacks of the apps', () => {
    const staticDeployment = META.project.deployment.options['cloudflare-static']?.require ?? {};
    const honoOnly: Partial<TemplateContext> = {
      apps: [{ appName: 'api', stackName: 'hono', libraries: [] }],
      project: { tooling: [] },
    };

    expect(describeRequire(staticDeployment, honoOnly)).toBe('an app on stack: nextjs or tanstack-start');
    expect(
      describeRequire(staticDeployment, {
        apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
        project: { tooling: [] },
      }),
    ).toBe('');
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

  test('returns undefined when the option is available', () => {
    expect(getCategoryOptionUnavailability('deployment', 'cloudflare-static', staticOption, nextjsPlain)).toBeUndefined();
    expect(getCategoryOptionUnavailability('deployment', 'cloudflare', cloudflareOption, nextjsBetterAuth)).toBeUndefined();
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

  test('reports the require.deployment gap for d1 when the deployment is not cloudflare', () => {
    const d1Option = META.project.database.options.d1;
    expect(getCategoryOptionUnavailability('database', 'd1', d1Option, nextjsPlain)).toContain('deployment: cloudflare');
    const sst: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [], deployment: 'sst' },
    };
    expect(getCategoryOptionUnavailability('database', 'd1', d1Option, sst)).toContain('deployment: cloudflare');
  });

  test('d1 is available when the deployment is cloudflare', () => {
    const cloudflareCtx: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [], deployment: 'cloudflare' },
    };
    expect(getCategoryOptionUnavailability('database', 'd1', META.project.database.options.d1, cloudflareCtx)).toBeUndefined();
  });

  test('d1 stays available with better-auth/trpc on cloudflare (consumers wired per-request)', () => {
    const ctx: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth', 'trpc'] }],
      project: { tooling: [], deployment: 'cloudflare' },
    };
    expect(getCategoryOptionUnavailability('database', 'd1', META.project.database.options.d1, ctx)).toBeUndefined();
  });

  test('postgres on cloudflare is disabled with a singleton-db consumer, naming it and saying why', () => {
    const ctx: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
      project: { tooling: [], deployment: 'cloudflare' },
    };
    const reason = getCategoryOptionUnavailability('database', 'postgres', META.project.database.options.postgres, ctx);
    expect(reason).toContain('better-auth');
    expect(reason).toContain('per-request binding');
    expect(reason).not.toMatch(/#\d+|issue/);
  });

  test('mysql on cloudflare is disabled when trpc is selected', () => {
    const ctx: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['trpc'] }],
      project: { tooling: [], deployment: 'cloudflare' },
    };
    expect(getCategoryOptionUnavailability('database', 'mysql', META.project.database.options.mysql, ctx)).toContain('trpc');
  });

  test('postgres + better-auth stays available off Cloudflare (singleton db works)', () => {
    const ctx: Partial<TemplateContext> = {
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
      project: { tooling: [] },
    };
    expect(getCategoryOptionUnavailability('database', 'postgres', META.project.database.options.postgres, ctx)).toBeUndefined();
  });
});

describe('isSingletonDbSatisfied', () => {
  const withLibsAndDeployment = (libraries: string[], deployment?: string): Partial<TemplateContext> => ({
    apps: [{ appName: 'web', stackName: 'nextjs', libraries }],
    project: { tooling: [], ...(deployment ? { deployment } : {}) },
  });

  test('databases declare a serverlessBinding; cloudflare provides db bindings; consumers need a singleton', () => {
    expect(META.project.database.options.postgres?.serverlessBinding).toBe('hyperdrive');
    expect(META.project.database.options.mysql?.serverlessBinding).toBe('hyperdrive');
    expect(META.project.database.options.d1?.serverlessBinding).toBe('d1');
    expect(META.project.deployment.options.cloudflare?.providesDbBindings).toBe(true);
    expect(META.libraries['better-auth']?.needsSingletonDb).toBe(true);
    expect(META.libraries.trpc?.needsSingletonDb).toBe(true);
  });

  test('false only when a binding-based db meets a binding-providing deployment and a singleton consumer', () => {
    const pg = META.project.database.options.postgres;
    expect(isSingletonDbSatisfied(pg, withLibsAndDeployment(['better-auth'], 'cloudflare'))).toBe(false);
    expect(isSingletonDbSatisfied(pg, withLibsAndDeployment(['better-auth']))).toBe(true);
    expect(isSingletonDbSatisfied(pg, withLibsAndDeployment([], 'cloudflare'))).toBe(true);
    expect(isSingletonDbSatisfied(META.project.database.options.sqlite, withLibsAndDeployment(['better-auth'], 'cloudflare'))).toBe(true);
  });

  test('a binding db with wired consumers is satisfied even with a singleton-consumer library', () => {
    expect(META.project.database.options.d1?.serverlessConsumersWired).toBe(true);
    expect(isSingletonDbSatisfied(META.project.database.options.d1, withLibsAndDeployment(['better-auth'], 'cloudflare'))).toBe(true);
    expect(isSingletonDbSatisfied(META.project.database.options.d1, withLibsAndDeployment(['trpc'], 'cloudflare'))).toBe(true);
  });
});

describe('isLocalFilesystemSatisfied', () => {
  const withDeployment = (deployment?: string): Partial<TemplateContext> => ({
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [], ...(deployment ? { deployment } : {}) },
  });

  test('sqlite declares it needs a local filesystem; Workers and Lambda deployments declare they provide none', () => {
    expect(META.project.database.options.sqlite?.needsLocalFilesystem).toBe(true);
    expect(META.project.deployment.options.cloudflare?.providesLocalFilesystem).toBe(false);
    expect(META.project.deployment.options.sst?.providesLocalFilesystem).toBe(false);
    expect(META.project.deployment.options['terraform-aws']?.providesLocalFilesystem).toBe(false);
  });

  test('false only when a filesystem database meets a deployment without a filesystem', () => {
    const sqlite = META.project.database.options.sqlite;
    expect(isLocalFilesystemSatisfied(sqlite, withDeployment('cloudflare'))).toBe(false);
    expect(isLocalFilesystemSatisfied(sqlite, withDeployment('sst'))).toBe(false);
    expect(isLocalFilesystemSatisfied(sqlite, withDeployment('terraform-aws'))).toBe(false);
    expect(isLocalFilesystemSatisfied(sqlite, withDeployment())).toBe(true);
    expect(isLocalFilesystemSatisfied(META.project.database.options.postgres, withDeployment('cloudflare'))).toBe(true);
    expect(isLocalFilesystemSatisfied(META.project.database.options.postgres, withDeployment('sst'))).toBe(true);
    expect(isLocalFilesystemSatisfied(META.project.database.options.d1, withDeployment('cloudflare'))).toBe(true);
  });

  test.each([
    ['cloudflare', 'Cloudflare Workers'],
    ['sst', 'SST'],
    ['terraform-aws', 'Terraform (AWS)'],
  ])('sqlite is disabled on %s with a reason naming the deployment, and available elsewhere', (deployment, label) => {
    const sqlite = META.project.database.options.sqlite;
    const reason = getCategoryOptionUnavailability('database', 'sqlite', sqlite, withDeployment(deployment));
    expect(reason).toContain('local filesystem');
    expect(reason).toContain(label);
    expect(getCategoryOptionUnavailability('database', 'sqlite', sqlite, withDeployment())).toBeUndefined();
  });

  test('no blueprint preset pairs a filesystem database with a deployment without a filesystem', () => {
    for (const [name, blueprint] of Object.entries(META.blueprints)) {
      const { database, deployment } = (blueprint.context.project ?? {}) as { database?: string; deployment?: string };
      const ctx = { apps: [], project: { tooling: [], ...(deployment ? { deployment } : {}) } } as Partial<TemplateContext>;
      const addon = database ? META.project.database.options[database as keyof typeof META.project.database.options] : undefined;
      expect({ name, satisfied: isLocalFilesystemSatisfied(addon, ctx) }).toEqual({ name, satisfied: true });
    }
  });
});

describe('resolveDeployAppDir picks the deployment app that consumes the db', () => {
  const ctx = (apps: TemplateContext['apps'], deployment?: string): TemplateContext =>
    ({
      projectName: 'test',
      apps,
      project: { tooling: [], ...(deployment ? { deployment } : {}) },
      repo: 'turborepo',
      git: false,
    });

  test('prefers the app carrying a singleton-db consumer over declaration order', () => {
    const apps = [
      { appName: 'api', stackName: 'hono', libraries: [] },
      { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
    ] as TemplateContext['apps'];
    expect(resolveDeployAppDir(ctx(apps, 'cloudflare'))).toBe('web');
  });

  test('falls back to the first deployment-capable app when none consume the db', () => {
    const apps = [
      { appName: 'api', stackName: 'hono', libraries: [] },
      { appName: 'web', stackName: 'nextjs', libraries: [] },
    ] as TemplateContext['apps'];
    expect(resolveDeployAppDir(ctx(apps, 'cloudflare'))).toBe('api');
  });

  test('returns undefined without a deployment', () => {
    const apps = [{ appName: 'web', stackName: 'nextjs', libraries: [] }] as TemplateContext['apps'];
    expect(resolveDeployAppDir(ctx(apps))).toBeUndefined();
  });
});

describe('resolveScriptPlaceholders substitutes generic topology tokens', () => {
  const ctx = (repo: 'single' | 'turborepo'): TemplateContext =>
    ({
      projectName: 'test',
      apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] }],
      project: { tooling: [], deployment: 'cloudflare' },
      repo,
      git: false,
    });

  test('workspaceRoot resolves relative to the repo layout', () => {
    expect(resolveScriptPlaceholders({ x: 'persist {{workspaceRoot}}/.wrangler' }, ctx('turborepo')).x).toBe(
      'persist ../../.wrangler',
    );
    expect(resolveScriptPlaceholders({ x: 'persist {{workspaceRoot}}/.wrangler' }, ctx('single')).x).toBe(
      'persist ./.wrangler',
    );
  });

  test('deployAppDir resolves to the deploy app directory', () => {
    expect(
      resolveScriptPlaceholders({ x: 'config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc' }, ctx('turborepo'))
        .x,
    ).toBe('config ../../apps/web/wrangler.jsonc');
  });
});

describe('resolveScriptPlaceholders substitutes package manager tokens', () => {
  const ctx = (pm: TemplateContext['pm']): TemplateContext => ({
    projectName: 'test',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    repo: 'single',
    pm,
    git: false,
  });

  test.each([
    ['bun', 'bun scripts/seed.ts'],
    ['npm', 'tsx scripts/seed.ts'],
    ['pnpm', 'tsx scripts/seed.ts'],
    [undefined, 'tsx scripts/seed.ts'],
  ] as const)('tsRunner under %s', (pm, expected) => {
    expect(resolveScriptPlaceholders({ x: '{{tsRunner}} scripts/seed.ts' }, ctx(pm)).x).toBe(expected);
  });

  test.each([
    ['bun', 'cd ../.. && bun run db:seed'],
    ['npm', 'cd ../.. && npm run db:seed'],
    ['pnpm', 'cd ../.. && pnpm run db:seed'],
    [undefined, 'cd ../.. && npm run db:seed'],
  ] as const)('packageManager under %s', (pm, expected) => {
    expect(resolveScriptPlaceholders({ x: 'cd ../.. && {{packageManager}} run db:seed' }, ctx(pm)).x).toBe(expected);
  });
});
