import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { removeFrontmatter } from '@/lib/frontmatter';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  setupTemplateEngine();
});

function renderShowcaseLayout(libraries: string[]): string {
  const ctx: TemplateContext = {
    projectName: 'my-project',
    repo: 'single',
    apps: [{ appName: 'my-project', stackName: 'nextjs', libraries }],
    project: { tooling: [] },
    git: false,
    blueprint: 'showcase-nextjs',
  };
  const raw = readFileSync(join(TEMPLATES_DIR, 'blueprints/showcase-nextjs/src/app/layout.tsx.hbs'), 'utf-8');
  return renderTemplate(removeFrontmatter(raw), { ...ctx, ...ctx.apps[0] });
}

describe('showcase-nextjs layout: tanstack-devtools', () => {
  test('loads the devtools component only in development when the library is selected', () => {
    const layout = renderShowcaseLayout(['shadcn', 'mdx', 'posthog', 'tanstack-devtools']);
    expect(layout).not.toContain('@tanstack/react-devtools');
    expect(layout).not.toContain('@tanstack/react-query-devtools');
    expect(layout).toContain("process.env.NODE_ENV === 'development'");
    expect(layout).toContain("await import('@/components/devtools')");
    expect(layout).toContain('<Devtools />');
  });

  test('mentions no devtools when the library is not selected', () => {
    const layout = renderShowcaseLayout(['shadcn', 'mdx', 'posthog']);
    expect(layout).not.toContain('Devtools');
  });
});
