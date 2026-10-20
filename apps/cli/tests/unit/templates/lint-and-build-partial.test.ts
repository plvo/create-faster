import { beforeAll, describe, expect, test } from 'bun:test';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  setupTemplateEngine();
});

function render(stackName: 'nextjs' | 'hono', linter?: string): string {
  const ctx: TemplateContext = {
    projectName: 'my-project',
    repo: 'single',
    pm: 'bun',
    apps: [{ appName: 'my-project', stackName, libraries: [] }],
    project: { linter, tooling: [] },
    git: false,
  };
  return renderTemplate('      - {{> github-actions/lint-and-build}}', ctx);
}

describe('the lint-and-build workflow partial', () => {
  test('runs lint then build when the project defines both', () => {
    expect(render('nextjs', 'biome')).toBe(
      '      - name: Lint\n        run: bun run lint\n\n      - name: Build\n        run: bun run build',
    );
  });

  test('runs build alone without a lint script', () => {
    expect(render('nextjs')).toBe('      - name: Build\n        run: bun run build');
  });

  test('runs lint alone when no app declares build', () => {
    expect(render('hono', 'biome')).toBe('      - name: Lint\n        run: bun run lint');
  });
});
