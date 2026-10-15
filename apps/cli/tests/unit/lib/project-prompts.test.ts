import { describe, expect, test } from 'bun:test';
import { shouldPromptCategory } from '@/lib/project-prompts';
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

const INTERACTIVE_WITH_FLAGS = { hasFlags: true, interactive: true };
const SCRIPTED_WITH_FLAGS = { hasFlags: true, interactive: false };
const NO_FLAGS = { hasFlags: false, interactive: true };
const NO_FLAGS_NO_TERMINAL = { hasFlags: false, interactive: false };

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
});
