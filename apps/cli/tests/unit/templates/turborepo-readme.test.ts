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

function renderReadme(ctx: TemplateContext): string {
  const raw = readFileSync(join(TEMPLATES_DIR, 'repo/turborepo/README.md.hbs'), 'utf-8');
  return renderTemplate(removeFrontmatter(raw), ctx);
}

describe('turborepo README start script', () => {
  const ctx: TemplateContext = {
    projectName: 'demo',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: false,
  };

  test('lists start when the root package.json defines it', () => {
    expect(renderReadme(ctx)).toContain('- `start` - Start all apps in production mode');
  });

  test('omits start when no app has a start script', () => {
    const noStart: TemplateContext = {
      ...ctx,
      apps: [{ appName: 'web', stackName: 'tanstack-start', libraries: [] }],
      project: { deployment: 'cloudflare', tooling: [] },
    };
    expect(renderReadme(noStart)).not.toContain('- `start`');
  });
});

describe('turborepo README db package section', () => {
  const ctx: TemplateContext = {
    projectName: 'demo',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
    project: { database: 'postgres', tooling: [] },
    git: false,
    blueprint: 'org-dashboard',
  };

  test('does not print an empty ORM when the db package exists without an ORM', () => {
    const readme = renderReadme(ctx);

    expect(readme).toContain('### `packages/db`');
    expect(readme).toContain('Uses shared database package (`packages/db`).');
    expect(readme).not.toContain('ORM');
  });

  test('names the ORM when the project has one', () => {
    const readme = renderReadme({ ...ctx, project: { ...ctx.project, orm: 'drizzle' } });

    expect(readme).toContain('Uses shared database package (`packages/db`) with drizzle ORM.');
    expect(readme).toContain('- **ORM**: drizzle');
  });
});
