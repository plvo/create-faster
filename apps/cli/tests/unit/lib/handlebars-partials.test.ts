import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { PARTIALS_DIR } from '@/lib/constants';
import { scanDirectory } from '@/lib/file-writer';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

const INLINE = '---\ninline: true\n---\n';

const FIXTURE_PARTIALS: Record<string, string> = {
  'fixture-value.hbs': `${INLINE}us.example.com\n`,
  'fixture-group/nested.hbs': `${INLINE}nested`,
  'fixture-block.hbs': 'a: 1,\nb: 2,',
  'fixture-block-trailing-lines.hbs': 'a: 1,\nb: 2,\n\n\n',
  'fixture-context.hbs': `${INLINE}{{#if (isMono)}}mono{{else}}single{{/if}} {{#if (has "database" "d1")}}d1{{/if}} {{#if (hasLibrary "posthog")}}posthog{{/if}} {{appName}}\n`,
  'fixture-hash.hbs': `${INLINE}debug: {{debug}},\n`,
  'fixture-notes.md': 'not a partial',
  'blueprints/fixture-blueprint/fixture-section.hbs': 'Section of {{projectName}}\n',
  'blueprints/org-dashboard-nextjs/fixture-inherited.hbs': 'Inherited section\n',
  'blueprints/org-dashboard-tanstack-start/fixture-inherited.hbs': 'Own section\n',
};

const FIXTURE_PARTIAL_NAMES = Object.keys(FIXTURE_PARTIALS)
  .filter((file) => file.endsWith('.hbs'))
  .map((file) => file.slice(0, -'.hbs'.length));

const ctx = {
  projectName: 'my-project',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['posthog'] }],
  project: { database: 'd1', tooling: [] },
  git: false,
  appName: 'web',
  stackName: 'nextjs',
  libraries: ['posthog'],
} as TemplateContext;

let fixtureDir: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'create-faster-partials-'));
  for (const [path, content] of Object.entries(FIXTURE_PARTIALS)) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), content);
  }
  setupTemplateEngine(fixtureDir);
});

afterAll(() => {
  for (const name of FIXTURE_PARTIAL_NAMES) Handlebars.unregisterPartial(name);
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('setupTemplateEngine: partials', () => {
  test('registers each .hbs file under its relative path without the extension', () => {
    expect(renderTemplate('[{{> fixture-value}}] [{{> fixture-group/nested}}]', ctx)).toBe(
      '[us.example.com] [nested]',
    );
  });

  test('ignores files that are not .hbs templates', () => {
    expect(() => renderTemplate('{{> fixture-notes}}', ctx)).toThrow('The partial fixture-notes could not be found');
  });

  test('drops the final line break of a partial marked inline, so it stays on its line', () => {
    expect(renderTemplate("const HOST = '{{> fixture-value}}';\n", ctx)).toBe("const HOST = 'us.example.com';\n");
  });

  test('ends an unmarked partial with exactly one line break, whatever its file ends with', () => {
    const expected = 'f({\n    a: 1,\n    b: 2,\n});\n';
    expect(renderTemplate('f({\n    {{> fixture-block}}\n});\n', ctx)).toBe(expected);
    expect(renderTemplate('f({\n    {{> fixture-block-trailing-lines}}\n});\n', ctx)).toBe(expected);
  });

  test('renders with the current context, so helpers keep working inside', () => {
    expect(renderTemplate('{{> fixture-context}}', ctx)).toBe('mono d1 posthog web');
  });

  test('merges hash parameters into the context', () => {
    expect(renderTemplate('{{> fixture-hash debug="import.meta.env.DEV"}}', ctx)).toBe('debug: import.meta.env.DEV,');
  });

  test('does not HTML-escape values rendered inside a partial', () => {
    expect(renderTemplate(`{{> fixture-hash debug="process.env.NODE_ENV === 'development'"}}`, ctx)).toBe(
      "debug: process.env.NODE_ENV === 'development',",
    );
  });

  test('registers every partial shipped in templates/partials by default', () => {
    const shipped = scanDirectory(PARTIALS_DIR).filter((file) => file.endsWith('.hbs'));
    expect(shipped.length).toBeGreaterThan(0);

    setupTemplateEngine();

    for (const file of shipped) {
      expect(Handlebars.partials[file.slice(0, -'.hbs'.length)]).toBeDefined();
    }
  });
});

describe('blueprintPartial', () => {
  const TEMPLATE = 'before\n{{> (blueprintPartial "fixture-section")}}\nafter\n';
  const asBlueprint = (blueprint?: string): TemplateContext => ({ ...ctx, blueprint }) as TemplateContext;

  test('renders the partial of the selected blueprint with the current context', () => {
    expect(renderTemplate(TEMPLATE, asBlueprint('fixture-blueprint'))).toBe('before\nSection of my-project\nafter\n');
  });

  test('renders nothing, not even the line, when the blueprint has no such partial', () => {
    expect(renderTemplate(TEMPLATE, asBlueprint('another-blueprint'))).toBe('before\nafter\n');
  });

  test('renders nothing without a blueprint', () => {
    expect(renderTemplate(TEMPLATE, asBlueprint())).toBe('before\nafter\n');
  });

  test('a blueprint that extends another inherits its partial, and its own wins', () => {
    const inherited = '{{> (blueprintPartial "fixture-inherited")}}';
    expect(renderTemplate(inherited, asBlueprint('org-dashboard-nextjs'))).toBe('Inherited section\n');
    expect(renderTemplate(inherited, asBlueprint('org-dashboard-tanstack-start'))).toBe('Own section\n');
  });
});
