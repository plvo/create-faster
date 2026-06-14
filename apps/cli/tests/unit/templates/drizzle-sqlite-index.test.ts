import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { removeFrontmatter } from '@/lib/frontmatter';
import { registerHandlebarsHelpers, renderTemplate } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  registerHandlebarsHelpers();
});

const TEMPLATE_PATH = 'project/orm/drizzle/src/index.ts.hbs';

function renderDrizzleIndex(ctx: TemplateContext): string {
  const source = join(TEMPLATES_DIR, TEMPLATE_PATH);
  const raw = readFileSync(source, 'utf-8');
  const content = removeFrontmatter(raw);
  const enriched = { ...ctx, ...ctx.apps[0] };
  return renderTemplate(content, enriched);
}

function makeSingleContext(): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'single',
    apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: [] }],
    project: { database: 'sqlite', orm: 'drizzle', tooling: [] },
    git: false,
  };
}

function makeTurboContext(): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'turborepo',
    apps: [
      { appName: 'web', stackName: 'nextjs', libraries: [] },
      { appName: 'api', stackName: 'hono', libraries: [] },
    ],
    project: { database: 'sqlite', orm: 'drizzle', tooling: [] },
    git: false,
  };
}

describe('drizzle sqlite index.ts template', () => {
  test('single repo: does not use import.meta.url (bundler-hostile)', () => {
    const rendered = renderDrizzleIndex(makeSingleContext());
    expect(rendered).not.toContain('import.meta.url');
    expect(rendered).not.toContain('new URL(');
    expect(rendered).not.toContain('fileURLToPath');
  });

  test('single repo: uses process.cwd() for path resolution', () => {
    const rendered = renderDrizzleIndex(makeSingleContext());
    expect(rendered).toContain('process.cwd()');
  });

  test('turborepo: does not use import.meta.url (bundler-hostile)', () => {
    const rendered = renderDrizzleIndex(makeTurboContext());
    expect(rendered).not.toContain('import.meta.url');
    expect(rendered).not.toContain('new URL(');
    expect(rendered).not.toContain('fileURLToPath');
  });

  test('turborepo: walks up to find turbo.json anchor', () => {
    const rendered = renderDrizzleIndex(makeTurboContext());
    expect(rendered).toContain('turbo.json');
    expect(rendered).toContain('findMonoRoot');
  });

  test('turborepo: resolves db file under packages/db', () => {
    const rendered = renderDrizzleIndex(makeTurboContext());
    expect(rendered).toContain("packages/db");
  });
});
