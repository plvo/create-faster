import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import {
  arePromptsSuppressed,
  expectedCategoryPrompts,
  isGitPrompted,
  isPackageManagerPrompted,
  shouldPromptCategory,
} from '@/lib/project-prompts';
import type { ProjectCategoryName } from '@/types/meta';
import type { TemplateContext } from '@/types/ctx';

type Project = TemplateContext['project'];

const META_ORDER = Object.keys(META.project) as ProjectCategoryName[];
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

describe('expectedCategoryPrompts', () => {
  test('lists every category in META order when nothing is answered', () => {
    expect(expectedCategoryPrompts(META_ORDER, contextWith(), NO_FLAGS)).toEqual(META_ORDER);
  });

  test('counts the orm while the database that satisfies it is still to be asked', () => {
    const asked = expectedCategoryPrompts(META_ORDER, contextWith(), INTERACTIVE_WITH_FLAGS);

    expect(asked).toContain('orm');
  });

  test('counts the orm while the database that satisfies it is being answered', () => {
    const asked = expectedCategoryPrompts(['orm', 'linter'], contextWith(), INTERACTIVE_WITH_FLAGS, ['database']);

    expect(asked).toEqual(['orm', 'linter']);
  });

  test('leaves the orm out when no database is answered or asked', () => {
    const mode = { ...INTERACTIVE_WITH_FLAGS, noSelection: ['database' as const] };

    expect(expectedCategoryPrompts(META_ORDER, contextWith(), mode)).not.toContain('orm');
  });

  test('leaves out the categories a flag answered and the ones prompts are suppressed for', () => {
    const ctx = contextWith({ database: 'postgres', linter: 'biome' });

    expect(expectedCategoryPrompts(META_ORDER, ctx, INTERACTIVE_WITH_FLAGS)).toEqual([
      'deployment',
      'orm',
      'tooling',
    ]);
    expect(expectedCategoryPrompts(META_ORDER, ctx, SCRIPTED_WITH_FLAGS)).toEqual([]);
  });

  test('keeps to the categories it is given', () => {
    expect(expectedCategoryPrompts(['linter'], contextWith(), NO_FLAGS)).toEqual(['linter']);
  });
});

describe('isGitPrompted and isPackageManagerPrompted', () => {
  test('are asked when no flag answers them, in an interactive terminal', () => {
    expect(isGitPrompted({}, INTERACTIVE_WITH_FLAGS)).toBe(true);
    expect(isPackageManagerPrompted({}, INTERACTIVE_WITH_FLAGS)).toBe(true);
  });

  test('are not asked once a flag answers them', () => {
    expect(isGitPrompted({ git: false }, INTERACTIVE_WITH_FLAGS)).toBe(false);
    expect(isPackageManagerPrompted({ pm: 'npm' }, INTERACTIVE_WITH_FLAGS)).toBe(false);
    expect(isPackageManagerPrompted({ skipInstall: true }, INTERACTIVE_WITH_FLAGS)).toBe(false);
  });

  test('are not asked when prompts are suppressed', () => {
    expect(isGitPrompted({}, SCRIPTED_WITH_FLAGS)).toBe(false);
    expect(isPackageManagerPrompted({}, SCRIPTED_WITH_FLAGS)).toBe(false);
  });
});
