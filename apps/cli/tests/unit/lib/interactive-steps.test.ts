import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectInteractiveSteps, getInteractiveScript } from '@/lib/interactive-steps';
import { getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import type { TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/stack-name';

function project(repo: 'single' | 'turborepo', stacks: StackName[]): TemplateContext {
  return {
    projectName: 'demo',
    repo,
    apps: stacks.map((stackName, index) => ({
      appName: ['web', 'mobile', 'api'][index] as string,
      stackName,
      libraries: [],
    })),
    project: { tooling: [] },
    git: false,
    pm: 'npm',
  };
}

describe('collectInteractiveSteps', () => {
  test('a turborepo runs the interactive script of a stack from the directory of its app', () => {
    expect(collectInteractiveSteps(project('turborepo', ['nextjs', 'expo']))).toEqual([
      {
        description: 'Run dev:expo in a terminal of its own (mobile)',
        command: '(cd apps/mobile && npm run dev:expo)',
      },
    ]);
  });

  test('a single repo has no such step: its root runs the app script itself', () => {
    expect(collectInteractiveSteps(project('single', ['expo']))).toEqual([]);
  });

  test('stacks that declare no interactive script have no step', () => {
    expect(collectInteractiveSteps(project('turborepo', ['nextjs', 'hono']))).toEqual([]);
  });

  test('names a step per app of the stack', () => {
    const commands = collectInteractiveSteps(project('turborepo', ['expo', 'expo'])).map(({ command }) => command);
    expect(commands).toEqual(['(cd apps/web && npm run dev:expo)', '(cd apps/mobile && npm run dev:expo)']);
  });
});

describe('an interactive script the root defines', () => {
  const stack = META.stacks.nextjs;

  test('is run by the root, so it has no step of its own in a single repo and one per app in a turborepo', () => {
    Object.assign(stack, { interactiveScripts: ['analyze'] });
    try {
      expect(collectInteractiveSteps(project('single', ['nextjs']))).toEqual([]);
      expect(collectInteractiveSteps(project('turborepo', ['nextjs'])).map(({ command }) => command)).toEqual([
        '(cd apps/web && npm run analyze)',
      ]);
    } finally {
      Object.assign(stack, { interactiveScripts: undefined });
    }
  });
});

describe('getInteractiveScript', () => {
  test('is the interactive script the app defines', () => {
    expect(getInteractiveScript(project('turborepo', ['nextjs', 'expo']), 'mobile')).toBe('dev:expo');
  });

  test('is undefined for an app whose stack has none, and for an app that does not define it', () => {
    expect(getInteractiveScript(project('turborepo', ['nextjs', 'expo']), 'web')).toBeUndefined();
    expect(getInteractiveScript(project('single', ['expo']), 'web')).toBeUndefined();
  });
});

const STACKS_WITH_INTERACTIVE_SCRIPTS = Object.entries(META.stacks).filter(([, stack]) => stack.interactiveScripts);

describe('interactive scripts of a stack', () => {
  test('exist', () => {
    expect(STACKS_WITH_INTERACTIVE_SCRIPTS.length).toBeGreaterThan(0);
  });

  test.each(STACKS_WITH_INTERACTIVE_SCRIPTS)(
    'no app of %s defines a script that the turborepo root forwards through turbo',
    (stackName, stack) => {
      const ctx = project('turborepo', [stackName as StackName, stackName as StackName]);
      const forwarded = Object.entries(getRootScripts(ctx))
        .filter(([, command]) => command.startsWith('turbo '))
        .map(([script]) => script);

      for (const { scripts } of getAppScripts(ctx)) {
        for (const script of stack.interactiveScripts ?? []) {
          expect(forwarded).not.toContain(script);
          expect(scripts).toHaveProperty([script]);
        }
      }
    },
  );
});
