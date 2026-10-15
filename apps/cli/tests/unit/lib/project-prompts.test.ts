import { describe, expect, test } from 'bun:test';
import { arePromptsSuppressed, shouldPromptCategory } from '@/lib/project-prompts';
import type { ProjectCategoryName } from '@/types/meta';
import type { TemplateContext } from '@/types/ctx';

type Project = TemplateContext['project'];

const ALL_CATEGORIES: ProjectCategoryName[] = ['database', 'orm', 'deployment', 'linter', 'tooling'];

function contextWith(project: Partial<Project> = {}): Omit<TemplateContext, 'repo'> {
  return {
    projectName: 'demo',
    apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [], ...project },
    git: false,
  };
}

const INTERACTIVE_WITH_FLAGS = { hasFlags: true, interactive: true, skipPrompts: false, noSelection: [] };
const SCRIPTED_WITH_FLAGS = { hasFlags: true, interactive: false, skipPrompts: false, noSelection: [] };
const NO_FLAGS = { hasFlags: false, interactive: true, skipPrompts: false, noSelection: [] };
const NO_FLAGS_NO_TERMINAL = { hasFlags: false, interactive: false, skipPrompts: false, noSelection: [] };

describe('shouldPromptCategory', () => {
  test('asks a category no flag answered in an interactive terminal', () => {
    const ctx = contextWith({ database: 'postgres' });

    expect(shouldPromptCategory('deployment', ctx, INTERACTIVE_WITH_FLAGS)).toBe(true);
    expect(shouldPromptCategory('linter', ctx, INTERACTIVE_WITH_FLAGS)).toBe(true);
    expect(shouldPromptCategory('tooling', ctx, INTERACTIVE_WITH_FLAGS)).toBe(true);
  });

  test('skips a category a flag answered', () => {
    const ctx = contextWith({
      database: 'postgres',
      orm: 'drizzle',
      deployment: 'sst',
      linter: 'biome',
      tooling: ['husky'],
    });

    for (const category of ALL_CATEGORIES) {
      expect(shouldPromptCategory(category, ctx, INTERACTIVE_WITH_FLAGS)).toBe(false);
    }
  });

  test('asks nothing outside an interactive terminal once any flag is passed', () => {
    const ctx = contextWith({ database: 'postgres' });

    for (const category of ALL_CATEGORIES) {
      expect(shouldPromptCategory(category, ctx, SCRIPTED_WITH_FLAGS)).toBe(false);
    }
  });

  test('asks every category when no flag is passed, terminal or not', () => {
    const ctx = contextWith({ database: 'postgres' });

    expect(shouldPromptCategory('orm', ctx, NO_FLAGS)).toBe(true);
    expect(shouldPromptCategory('deployment', ctx, NO_FLAGS)).toBe(true);
    expect(shouldPromptCategory('deployment', ctx, NO_FLAGS_NO_TERMINAL)).toBe(true);
  });

  test('does not ask a category whose requirement is unmet', () => {
    const ctx = contextWith();

    expect(shouldPromptCategory('orm', ctx, INTERACTIVE_WITH_FLAGS)).toBe(false);
    expect(shouldPromptCategory('orm', ctx, NO_FLAGS)).toBe(false);
  });

  test('asks the orm once a database answers its requirement', () => {
    expect(shouldPromptCategory('orm', contextWith({ database: 'postgres' }), INTERACTIVE_WITH_FLAGS)).toBe(true);
  });

  test('asks nothing when prompts are skipped, in an interactive terminal too', () => {
    const ctx = contextWith({ database: 'postgres' });

    for (const category of ALL_CATEGORIES) {
      expect(shouldPromptCategory(category, ctx, { ...INTERACTIVE_WITH_FLAGS, skipPrompts: true })).toBe(false);
    }
  });

  test('skips a category a flag answered with no selection and asks the others', () => {
    const ctx = contextWith({ database: 'postgres' });
    const mode = { ...INTERACTIVE_WITH_FLAGS, noSelection: ['linter' as const] };

    expect(shouldPromptCategory('linter', ctx, mode)).toBe(false);
    expect(shouldPromptCategory('deployment', ctx, mode)).toBe(true);
  });
});

describe('arePromptsSuppressed', () => {
  test('is true for skipped prompts and for flags without a terminal only', () => {
    expect(arePromptsSuppressed(INTERACTIVE_WITH_FLAGS)).toBe(false);
    expect(arePromptsSuppressed({ ...INTERACTIVE_WITH_FLAGS, skipPrompts: true })).toBe(true);
    expect(arePromptsSuppressed(SCRIPTED_WITH_FLAGS)).toBe(true);
    expect(arePromptsSuppressed(NO_FLAGS_NO_TERMINAL)).toBe(false);
  });
});
