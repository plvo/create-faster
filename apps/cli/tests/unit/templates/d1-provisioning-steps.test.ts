import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

const WITHOUT_ORM: TemplateContext = {
  projectName: 'demo',
  repo: 'single',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
  project: { database: 'd1', deployment: 'cloudflare', tooling: [] },
  git: false,
  pm: 'bun',
};

function renderWithRootScripts(scripts: string[]): string {
  Handlebars.registerHelper('hasRootScript', (name: string) => scripts.includes(name));
  return renderTemplate('{{> cloudflare/d1-provisioning deploy="Production"}}', WITHOUT_ORM);
}

const stepLines = (doc: string): string[] =>
  doc
    .split('\n')
    .filter((line) => /^\d+\. /.test(line))
    .map((line) => line.replace(/^(\d+\.) (\w+(?: \w+)?).*/, '$1 $2'));

describe('cloudflare/d1-provisioning: each migration step follows the root scripts it prints', () => {
  beforeAll(() => {
    setupTemplateEngine();
  });

  afterEach(() => {
    setupTemplateEngine();
  });

  test.each([
    ['no migration script', [], ['1. Create the', '2. Copy the', '3. Deploy']],
    [
      'only db:migrate:remote',
      ['db:migrate:remote'],
      ['1. Create the', '2. Copy the', '3. Apply the', '4. Deploy'],
    ],
    [
      'db:generate and db:migrate',
      ['db:generate', 'db:migrate'],
      ['1. Create the', '2. Copy the', '3. Generate the', '4. Deploy'],
    ],
    [
      'db:generate, db:migrate and db:migrate:remote',
      ['db:generate', 'db:migrate', 'db:migrate:remote'],
      ['1. Create the', '2. Copy the', '3. Generate the', '4. Apply the', '5. Deploy'],
    ],
    ['db:generate alone', ['db:generate'], ['1. Create the', '2. Copy the', '3. Deploy']],
    ['db:migrate alone', ['db:migrate'], ['1. Create the', '2. Copy the', '3. Deploy']],
  ])('%s', (_, scripts, expected) => {
    expect(stepLines(renderWithRootScripts(scripts))).toEqual(expected);
  });

  test('a step prints the scripts it renders for', () => {
    const doc = renderWithRootScripts(['db:generate', 'db:migrate', 'db:migrate:remote']);
    expect(doc).toContain('bun run db:generate\n   bun run db:migrate\n   ```');
    expect(doc).toContain('bun run db:migrate:remote\n   ```');
  });
});
