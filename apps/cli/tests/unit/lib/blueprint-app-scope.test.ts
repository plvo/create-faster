import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { getBlueprintAppContexts } from '@/lib/addon-utils';
import {
  collectAppSecrets,
  collectEnvFiles,
  collectEnvGroups,
  collectEnvsToGenerate,
  collectProjectSecrets,
  collectTaskEnv,
  collectThirdPartyEnvs,
} from '@/lib/env-generator';
import { collectFirstRunSteps } from '@/lib/first-run';
import { collectInstallScripts } from '@/lib/install-scripts';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';
import type { MetaBlueprint } from '@/types/meta';

const BLUEPRINT_NAME = 'stub-scoped-blueprint';

const STUB_BLUEPRINT: MetaBlueprint = {
  label: 'stub',
  hint: 'stub',
  category: 'stub',
  context: {
    apps: [
      {
        appName: 'web',
        stackName: 'nextjs',
        libraries: [],
        packageJson: { dependencies: { 'web-only-dependency': '^1.0.0', 'overridden-dependency': '^2.0.0' } },
        installScripts: { 'web-only-native': false },
        envs: [
          { value: 'WEB_ONLY=1', monoScope: ['app'], tasks: ['seed'] },
          { value: 'WEB_SECRET=', monoScope: ['app'], secret: true, generateCommand: 'make-secret' },
          {
            value: 'WEB_ACCOUNT_ID=',
            monoScope: ['app'],
            thirdParty: { description: 'web account', url: 'https://example.test', whenBlank: 'nothing runs' },
          },
          { value: 'WEB_ROOT_FILE=1', monoScope: ['root'], file: 'seed' },
        ],
      },
      { appName: 'job', stackName: 'node', libraries: [] },
    ],
    project: {},
  },
  packageJson: { dependencies: { 'shared-dependency': '^1.0.0', 'overridden-dependency': '^1.0.0' } },
  installScripts: { 'shared-native': true },
  envs: [{ value: 'SHARED=1', monoScope: ['app'] }],
};

function turborepo(): TemplateContext {
  return {
    projectName: 'scoped',
    repo: 'turborepo',
    apps: getBlueprintAppContexts(STUB_BLUEPRINT),
    project: { tooling: [] },
    blueprint: BLUEPRINT_NAME,
    git: false,
    pm: 'bun',
  };
}

function contentOf(ctx: TemplateContext, destination: string): string | undefined {
  return collectEnvFiles(ctx).find((file) => file.destination === destination)?.content;
}

describe('blueprint app scope', () => {
  beforeAll(() => {
    Object.assign(META.blueprints, { [BLUEPRINT_NAME]: STUB_BLUEPRINT });
  });

  afterAll(() => {
    delete (META.blueprints as Record<string, unknown>)[BLUEPRINT_NAME];
  });

  describe('package.json', () => {
    test('an app dependency lands in that app only, the blueprint ones in every app', () => {
      const ctx = turborepo();
      const [web, job] = ctx.apps.map((app, index) => generateAppPackageJson(app, ctx, index).content);

      expect(web?.dependencies).toMatchObject({ 'web-only-dependency': '^1.0.0', 'shared-dependency': '^1.0.0' });
      expect(job?.dependencies).toMatchObject({ 'shared-dependency': '^1.0.0' });
      expect(job?.dependencies).not.toHaveProperty('web-only-dependency');
    });

    test('the app wins over the blueprint on the same dependency', () => {
      const ctx = turborepo();
      const [web, job] = ctx.apps.map((app, index) => generateAppPackageJson(app, ctx, index).content);

      expect(web?.dependencies?.['overridden-dependency']).toBe('^2.0.0');
      expect(job?.dependencies?.['overridden-dependency']).toBe('^1.0.0');
    });

    test('a single repo app takes its own dependencies too', () => {
      const ctx: TemplateContext = { ...turborepo(), repo: 'single', apps: turborepo().apps.slice(0, 1) };
      const web = generateAppPackageJson(ctx.apps[0]!, ctx, 0).content;

      expect(web.dependencies).toMatchObject({ 'web-only-dependency': '^1.0.0', 'shared-dependency': '^1.0.0' });
    });
  });

  describe('environment variables', () => {
    test('an app variable is written to the .env.example of that app only', () => {
      const ctx = turborepo();

      expect(contentOf(ctx, 'apps/web/.env.example')).toContain('WEB_ONLY=1');
      expect(contentOf(ctx, 'apps/web/.env.example')).toContain('SHARED=1');
      expect(contentOf(ctx, 'apps/job/.env.example')).toBe('SHARED=1\n');
    });

    test('a single repo writes the variables of its app to the one .env.example', () => {
      const ctx: TemplateContext = { ...turborepo(), repo: 'single', apps: turborepo().apps.slice(0, 1) };

      expect(contentOf(ctx, '.env.example')).toContain('WEB_ONLY=1');
    });

    test('a variable that is not app scoped is written once, whatever app declares it', () => {
      const ctx = turborepo();

      expect(contentOf(ctx, '.env.seed.example')).toBe('WEB_ROOT_FILE=1\n');
      expect(collectEnvFiles({ ...ctx, apps: ctx.apps.slice(1) }).map((file) => file.destination)).not.toContain(
        '.env.seed.example',
      );
    });

    test('the secrets, generated values and third-party ids of an app are not the other apps', () => {
      const ctx = turborepo();

      expect(collectAppSecrets(ctx, 'web')).toEqual(['WEB_SECRET']);
      expect(collectAppSecrets(ctx, 'job')).toEqual([]);
      expect(collectProjectSecrets(ctx, ['node'])).toEqual([]);
      expect(collectProjectSecrets(ctx, ['nextjs'])).toEqual(['WEB_SECRET']);
      expect(collectEnvsToGenerate(ctx)).toEqual([
        { name: 'WEB_SECRET', command: 'make-secret', paths: ['apps/web/.env'] },
      ]);
      expect(collectThirdPartyEnvs(ctx).map(({ name, paths }) => ({ name, paths }))).toEqual([
        { name: 'WEB_ACCOUNT_ID', paths: ['apps/web/.env'] },
      ]);
    });

    test('a task variable of an app is listed only when that app is generated', () => {
      const ctx = turborepo();

      expect(collectTaskEnv(ctx, 'seed')).toEqual(['WEB_ONLY']);
      expect(collectTaskEnv({ ...ctx, apps: ctx.apps.slice(1) }, 'seed')).toEqual([]);
    });

    test('the first run copies the env files of the apps that have one', () => {
      const ctx = turborepo();
      const copy = collectFirstRunSteps(ctx)[0];

      expect(copy?.commands).toEqual([
        'cp apps/web/.env.example apps/web/.env',
        'cp apps/job/.env.example apps/job/.env',
        'cp .env.seed.example .env.seed',
      ]);
      expect(collectEnvGroups(ctx).map(({ path }) => path)).toEqual(['apps/web/.env', 'apps/job/.env', '.env.seed']);
    });
  });

  test('an app brings its own install-script rulings, merged with the blueprint ones', () => {
    const ctx = turborepo();

    expect(collectInstallScripts(ctx)).toMatchObject({ 'shared-native': true, 'web-only-native': false });
    expect(collectInstallScripts({ ...ctx, apps: ctx.apps.slice(1) })).not.toHaveProperty('web-only-native');
  });

  test('the apps of the context carry no META data', () => {
    const [web] = getBlueprintAppContexts(STUB_BLUEPRINT);

    expect(web).toEqual({ appName: 'web', stackName: 'nextjs', libraries: [] });
  });
});
