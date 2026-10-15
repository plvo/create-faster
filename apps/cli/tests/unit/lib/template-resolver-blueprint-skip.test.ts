import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';
import { createFixtureTree, removeFixtureTree } from '../fixture-tree';

const FIXTURE_FILES: Record<string, string> = {
  'project/orm/drizzle/skipped.txt.hbs': '---\nblueprintSkip:\n  - fixture-blueprint\n---\nbody\n',
  'project/orm/drizzle/skipped-second.txt.hbs': '---\nblueprintSkip:\n  - other-blueprint\n  - fixture-blueprint\n---\nbody\n',
  'project/orm/drizzle/other-only.txt.hbs': '---\nblueprintSkip:\n  - other-blueprint\n---\nbody\n',
  'project/orm/drizzle/plain.txt.hbs': 'body\n',
};

let templatesDir: string;

beforeAll(() => {
  templatesDir = createFixtureTree('blueprint-skip-', FIXTURE_FILES);
});

afterAll(() => {
  removeFixtureTree(templatesDir);
});

function destinationsFor(repo: TemplateContext['repo'], blueprint?: string): string[] {
  const ctx: TemplateContext = {
    projectName: 'proj',
    repo,
    apps: [{ appName: repo === 'single' ? 'proj' : 'web', stackName: 'nextjs', libraries: [] }],
    project: { orm: 'drizzle', tooling: [] },
    git: false,
    blueprint,
  };
  return getAllTemplatesForContext(ctx, templatesDir).map((t) => t.destination.split('/').at(-1) ?? '');
}

describe('blueprintSkip', () => {
  test.each(['single', 'turborepo'] as const)('skips the file under a listed blueprint (%s)', (repo) => {
    const destinations = destinationsFor(repo, 'fixture-blueprint');
    expect(destinations).not.toContain('skipped.txt');
    expect(destinations).not.toContain('skipped-second.txt');
  });

  test('keeps files that do not list the active blueprint', () => {
    const destinations = destinationsFor('single', 'fixture-blueprint');
    expect(destinations).toContain('other-only.txt');
    expect(destinations).toContain('plain.txt');
  });

  test('generates every file without a blueprint', () => {
    const destinations = destinationsFor('single');
    expect(destinations).toEqual(
      expect.arrayContaining(['skipped.txt', 'skipped-second.txt', 'other-only.txt', 'plain.txt']),
    );
  });
});
