import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { getRootScripts } from '@/lib/package-json-generator';
import { collectPostGenerateSteps } from '@/lib/post-generate';
import type { ProjectContext, TemplateContext } from '@/types/ctx';

function contextWith(project: Partial<ProjectContext>, overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [], ...project },
    git: false,
    pm: 'bun',
    ...overrides,
  };
}

function turborepoWith(project: Partial<ProjectContext>): TemplateContext {
  return contextWith(project, {
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
  });
}

describe('collectPostGenerateSteps', () => {
  test('resolves the script a selected addon declares through the selected package manager', () => {
    const commandsWith = (pm: TemplateContext['pm']) =>
      collectPostGenerateSteps(contextWith({ linter: 'prettier' }, { pm })).map(({ command }) => command);

    expect(commandsWith('bun')).toEqual(['bun run format']);
    expect(commandsWith('npm')).toEqual(['npm run format']);
    expect(commandsWith('pnpm')).toEqual(['pnpm run format']);
  });

  test('each addon names the script that leaves its own check passing', () => {
    const commandOf = (linter: string) => collectPostGenerateSteps(contextWith({ linter })).map(({ command }) => command);

    expect(commandOf('biome')).toEqual(['bun run check']);
    expect(commandOf('oxc')).toEqual(['bun run format']);
  });

  test('carries the description the spinner and the summary show', () => {
    const [step] = collectPostGenerateSteps(contextWith({ linter: 'biome' }));

    expect(step?.description).toBe(META.project.linter.options.biome?.postGenerate?.[0]?.description);
    expect(step?.description).toBeTruthy();
  });

  test('a composite addon runs the steps of the addons it composes', () => {
    const commands = collectPostGenerateSteps(contextWith({ linter: 'eslint-prettier' })).map(
      ({ command }) => command,
    );

    expect(commands).toEqual(['bun run format']);
  });

  test('an addon without a step contributes none', () => {
    expect(collectPostGenerateSteps(contextWith({ linter: 'eslint' }))).toEqual([]);
    expect(collectPostGenerateSteps(contextWith({}))).toEqual([]);
  });

  test('every declared script is defined on the generated root package.json, in a single repo and a turborepo', () => {
    const declared = Object.entries(META.project.linter.options).filter(([, addon]) => addon.postGenerate);
    expect(declared.length).toBeGreaterThan(0);

    for (const [linter, addon] of declared) {
      for (const ctx of [contextWith({ linter }), turborepoWith({ linter })]) {
        for (const { script } of addon.postGenerate ?? []) {
          expect(Object.keys(getRootScripts(ctx))).toContain(script);
        }
      }
    }
  });
});
