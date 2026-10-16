import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectFirstRunSteps } from '@/lib/first-run';
import type { TemplateContext } from '@/types/ctx';
import type { EnvVar, FirstRunStep, MetaAddon, MetaBlueprint } from '@/types/meta';

const postgres = META.project.database.options.postgres as MetaAddon;
const ADDON_ENVS: EnvVar[] = [{ value: 'SIGNING_KEY=', monoScope: ['app'], generateCommand: 'make-a-key' }];
const ADDON_STEPS: FirstRunStep[] = [{ description: 'Start the thing', commands: [{ command: 'start-the-thing' }] }];

function withAddon<T>(run: () => T): T {
  const previous = { envs: postgres.envs, firstRun: postgres.firstRun };
  postgres.envs = ADDON_ENVS;
  postgres.firstRun = ADDON_STEPS;
  try {
    return run();
  } finally {
    postgres.envs = previous.envs;
    postgres.firstRun = previous.firstRun;
  }
}

function singleRepo(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
    project: { database: 'postgres', tooling: [] },
    git: false,
    pm: 'bun',
    ...overrides,
  };
}

describe('collectFirstRunSteps order', () => {
  test('copies the env files, then generates the variables, then runs the addon steps', () => {
    const steps = withAddon(() => collectFirstRunSteps(singleRepo()));

    expect(steps).toEqual([
      { description: 'Set up environment variables', commands: ['cp .env.example .env'] },
      { description: 'Generate SIGNING_KEY and set it in .env', commands: ['make-a-key'] },
      { description: 'Start the thing', commands: ['start-the-thing'] },
    ]);
  });

  test('a blueprint with its own first-run steps replaces the addon steps and keeps the generate step', () => {
    const blueprint = META.blueprints['org-dashboard-nextjs'] as MetaBlueprint;
    const ctx = singleRepo({
      repo: 'turborepo',
      blueprint: 'org-dashboard-nextjs',
      apps: blueprint.context.apps.map((app) => ({ ...app, libraries: [...app.libraries] })),
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    });

    const descriptions = collectFirstRunSteps(ctx).map((step) => step.description);

    expect(descriptions).toEqual([
      'Set up environment variables',
      'Generate BETTER_AUTH_SECRET and set it in apps/web/.env',
      ...(blueprint.firstRun ?? []).map((step) => step.description),
    ]);
  });

  test('several apps that read the variable share one generated value', () => {
    const ctx = singleRepo({
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'admin', stackName: 'nextjs', libraries: [] },
      ],
    });

    const generate = withAddon(() => collectFirstRunSteps(ctx)).find((step) => step.commands.includes('make-a-key'));

    expect(generate?.description).toBe(
      'Generate SIGNING_KEY once and set the same value in apps/web/.env, apps/admin/.env',
    );
  });
});
