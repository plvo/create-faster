import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { getBlueprintAppContexts, getBlueprintSeed } from '@/lib/addon-utils';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';
import type { BlueprintSeed, MetaBlueprint } from '@/types/meta';
import { isBlueprintTemplate } from '../blueprint-template-source';

const SEED_DESTINATION = /(?:^|\/)seed\.[cm]?[jt]s$/;
const REPO_TYPES = ['single', 'turborepo'] as const;

const BLUEPRINTS = Object.entries(META.blueprints) as [string, MetaBlueprint][];

/** Whether a template of the blueprint chain, or of its own folder, is written at a seed destination. */
function shipsSeed(name: string, blueprint: MetaBlueprint): boolean {
  return REPO_TYPES.some((repo) => {
    const ctx: TemplateContext = {
      projectName: 'proj',
      repo,
      apps: getBlueprintAppContexts(blueprint),
      project: { ...blueprint.context.project, tooling: [] },
      git: false,
      pm: 'bun',
      blueprint: name,
    };
    return getAllTemplatesForContext(ctx).some(
      (template) => isBlueprintTemplate(template.source, name) && SEED_DESTINATION.test(template.destination),
    );
  });
}

const shippers = BLUEPRINTS.filter(([name, blueprint]) => shipsSeed(name, blueprint));

describe('the seed of a blueprint', () => {
  test('some blueprints ship their own seed, the inherited ones included', () => {
    const names = shippers.map(([name]) => name);
    expect(names).toContain('org-dashboard-nextjs');
    expect(names).toContain('org-dashboard-tanstack-start');
  });

  test.each(shippers)('"%s" ships its own seed and declares what it does', (_name, blueprint) => {
    expect(blueprint.seed).toBeDefined();
  });

  test.each(BLUEPRINTS.filter(([name]) => !shippers.some(([shipper]) => shipper === name)))(
    '"%s" ships no seed and declares none',
    (_name, blueprint) => {
      expect(blueprint.seed).toBeUndefined();
    },
  );

  test.each(shippers.filter(([, blueprint]) => blueprint.seed?.deletes !== 'never'))(
    '"%s" lists the rows it deletes, the users among them',
    (_name, blueprint) => {
      expect(blueprint.seed?.rows).toContain('users');
    },
  );

  test('cloudflare-payload-nextjs declares a seed that deletes nothing and says where it lives', () => {
    const seed = (META.blueprints['cloudflare-payload-nextjs'] as MetaBlueprint).seed;
    expect(seed?.deletes).toBe('never');
    expect(seed?.file).toBe('apps/web/scripts/seed.ts');
  });
});

describe('BlueprintSeed', () => {
  test('allows a target only with a reset, and requires one there', () => {
    // @ts-expect-error a seed that always deletes has no target to refuse a remote database with
    const always: BlueprintSeed = { rows: ['users'], deletes: 'always', target: 'local-only' };
    // @ts-expect-error a seed that deletes with --reset says where it may run
    const withReset: BlueprintSeed = { rows: ['users'], deletes: 'with-reset' };
    // @ts-expect-error a seed that never deletes has no target to refuse a remote database with
    const never: BlueprintSeed = { rows: ['pages'], deletes: 'never', target: 'local-only' };

    expect([always.deletes, withReset.deletes, never.deletes]).toEqual(['always', 'with-reset', 'never']);
  });
});

describe('getBlueprintSeed', () => {
  const ctx = (blueprint?: string): TemplateContext => ({
    projectName: 'proj',
    repo: 'single',
    apps: [],
    project: { tooling: [] },
    git: false,
    blueprint,
  });

  test('reads the seed of the selected blueprint', () => {
    expect(getBlueprintSeed(ctx('multitenant-saas-nextjs'))).toBe((META.blueprints['multitenant-saas-nextjs'] as MetaBlueprint).seed);
  });

  test('is undefined without a blueprint, and for a blueprint that declares none', () => {
    expect(getBlueprintSeed(ctx())).toBeUndefined();
    expect(getBlueprintSeed(ctx('dapp-rainbowkit-nextjs'))).toBeUndefined();
  });
});
