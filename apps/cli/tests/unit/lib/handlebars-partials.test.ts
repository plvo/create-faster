import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { PARTIALS_DIR } from '@/lib/constants';
import { scanDirectory } from '@/lib/file-writer';
import { registerHandlebarsHelpers, registerHandlebarsPartials, renderTemplate } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

const FIXTURE_PARTIALS: Record<string, string> = {
  'fixture-value.hbs': 'us.example.com',
  'fixture-group/nested.hbs': 'nested',
  'fixture-block.hbs': 'a: 1,\nb: 2,\n',
  'fixture-context.hbs':
    '{{#if (isMono)}}mono{{else}}single{{/if}} {{#if (has "database" "d1")}}d1{{/if}} {{#if (hasLibrary "posthog")}}posthog{{/if}} {{appName}}',
  'fixture-hash.hbs': 'debug: {{debug}},',
  'fixture-notes.md': 'not a partial',
};

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
  registerHandlebarsHelpers();
  fixtureDir = mkdtempSync(join(tmpdir(), 'create-faster-partials-'));
  for (const [path, content] of Object.entries(FIXTURE_PARTIALS)) {
    mkdirSync(dirname(join(fixtureDir, path)), { recursive: true });
    writeFileSync(join(fixtureDir, path), content);
  }
  registerHandlebarsPartials(fixtureDir);
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('registerHandlebarsPartials', () => {
  test('registers each .hbs file under its relative path without the extension', () => {
    expect(renderTemplate('[{{> fixture-value}}] [{{> fixture-group/nested}}]', ctx)).toBe(
      '[us.example.com] [nested]',
    );
  });

  test('ignores files that are not .hbs templates', () => {
    expect(() => renderTemplate('{{> fixture-notes}}', ctx)).toThrow('The partial fixture-notes could not be found');
  });

  test('inserts the file content as is, so a partial without a final newline stays inline', () => {
    expect(renderTemplate("const HOST = '{{> fixture-value}}';\n", ctx)).toBe("const HOST = 'us.example.com';\n");
  });

  test('indents a partial called on its own line to the indentation of the call', () => {
    expect(renderTemplate('f({\n    {{> fixture-block}}\n});\n', ctx)).toBe('f({\n    a: 1,\n    b: 2,\n});\n');
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

    registerHandlebarsPartials();

    for (const file of shipped) {
      expect(Handlebars.partials[file.slice(0, -'.hbs'.length)]).toBeDefined();
    }
  });
});
