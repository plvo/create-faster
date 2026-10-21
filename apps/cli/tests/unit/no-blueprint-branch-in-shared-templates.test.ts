import { describe, expect, test } from 'bun:test';
import { templateSources } from '../template-sources';

const OWN_BLUEPRINT_FILES = /^(blueprints|partials[\\/]blueprints)[\\/]/;
const BLUEPRINT_COMPARISON = /\(\s*(eq|ne)\s+blueprint\b/;

describe('shared templates', () => {
  test('never branch on a blueprint name', () => {
    const offenders = Object.entries(templateSources())
      .filter(([file]) => !OWN_BLUEPRINT_FILES.test(file))
      .flatMap(([file, source]) =>
        source
          .split('\n')
          .filter((line) => BLUEPRINT_COMPARISON.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      );

    expect(
      offenders,
      'A blueprint fact belongs in partials/blueprints/<blueprint>/<name>.hbs, called with {{> (blueprintPartial "<name>")}} from the shared template',
    ).toEqual([]);
  });
});
