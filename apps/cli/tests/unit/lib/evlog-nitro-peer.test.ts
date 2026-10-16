import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { generateAllPackageJsons, generateAppPackageJson, generateRootPackageJson } from '@/lib/package-json-generator';
import type { AppContext, TemplateContext } from '@/types/ctx';

// evlog@2.32.0 declares the optional peer `nitro@^3.0.260311-beta` (unchanged since 2.28.0). npm matches a
// prerelease only against a range naming a prerelease of the same major.minor.patch, so it rejects the nitro the
// stack installs. The only nitro inside the peer has published advisories, hence the npm `overrides`.
const EVLOG_NITRO_PEER = '^3.0.260311-beta';
const EVLOG_VERSION_OF_PEER = '2.32.0';

const START_WITH_EVLOG: AppContext = { appName: 'web', stackName: 'tanstack-start', libraries: ['evlog'] };
const START: AppContext = { appName: 'admin', stackName: 'tanstack-start', libraries: [] };
const HONO_WITH_EVLOG: AppContext = { appName: 'api', stackName: 'hono', libraries: ['evlog'] };

function context(apps: AppContext[], changes: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'project',
    repo: apps.length > 1 ? 'turborepo' : 'single',
    apps,
    project: { tooling: [] },
    pm: 'npm',
    git: false,
    ...changes,
  };
}

function appPackageJsons(ctx: TemplateContext) {
  return ctx.apps.map((app, index) => generateAppPackageJson(app, ctx, index).content);
}

function rootOverrides(ctx: TemplateContext) {
  return generateRootPackageJson(ctx).content.overrides;
}

const STACK_NITRO = appPackageJsons(context([START]))[0]?.devDependencies?.nitro as string;

describe('the evlog nitro peer, as npm sees it', () => {
  test('the peer was read from an evlog release the generated range still resolves to', () => {
    const evlogRange = META.libraries.evlog?.packageJson?.dependencies?.evlog as string;

    expect(Bun.semver.satisfies(EVLOG_VERSION_OF_PEER, evlogRange)).toBe(true);
  });

  test('the nitro of the stack is outside the peer, which is why npm needs the override', () => {
    expect(Bun.semver.satisfies(STACK_NITRO.replace(/^\^/, ''), EVLOG_NITRO_PEER)).toBe(false);
  });
});

describe('npm overrides for the evlog nitro peer', () => {
  test('single repo: the app package.json overrides evlog nitro with the range the app installs', () => {
    const [app] = appPackageJsons(context([START_WITH_EVLOG]));

    expect(app?.overrides).toEqual({ evlog: { nitro: STACK_NITRO } });
    expect(app?.devDependencies?.nitro).toBe(STACK_NITRO);
  });

  test('turborepo: only the root package.json overrides, with the range every Start app installs', () => {
    const ctx = context([START_WITH_EVLOG, START]);

    expect(rootOverrides(ctx)).toEqual({ evlog: { nitro: STACK_NITRO } });
    for (const app of appPackageJsons(ctx)) {
      expect(app.overrides).toBeUndefined();
      expect(app.devDependencies?.nitro).toBe(STACK_NITRO);
    }
  });

  test('turborepo without evlog has no overrides', () => {
    expect(rootOverrides(context([START, { ...START, appName: 'docs' }]))).toBeUndefined();
  });

  test('evlog alone on a stack without Nitro has no overrides', () => {
    expect(appPackageJsons(context([HONO_WITH_EVLOG]))[0]?.overrides).toBeUndefined();
  });

  test('evlog on Hono next to a Start app without evlog gets the override, which is harmless there', () => {
    const ctx = context([HONO_WITH_EVLOG, START]);

    expect(rootOverrides(ctx)).toEqual({ evlog: { nitro: STACK_NITRO } });
    expect(appPackageJsons(ctx).map((app) => app.devDependencies?.nitro)).toEqual([undefined, STACK_NITRO]);
  });

  test.each(['bun', 'pnpm'] as const)('%s does not get the npm overrides', (pm) => {
    expect(appPackageJsons(context([START_WITH_EVLOG], { pm }))[0]?.overrides).toBeUndefined();
    expect(rootOverrides(context([START_WITH_EVLOG, START], { pm }))).toBeUndefined();
  });

  test.each(['cloudflare', 'cloudflare-static'])('%s has no Nitro, so nothing to override', (deployment) => {
    const ctx = context([START_WITH_EVLOG], { project: { tooling: [], deployment } });

    expect(generateAllPackageJsons(ctx).map(({ content }) => content.overrides)).toEqual([undefined]);
    expect(appPackageJsons(ctx)[0]?.devDependencies?.nitro).toBeUndefined();
  });
});
