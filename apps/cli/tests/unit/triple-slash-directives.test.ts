import { describe, expect, test } from 'bun:test';
import { templateSources } from '../template-sources';
import { countImportStatements, hasTripleSlashDirective, isDirectiveAtRisk } from '../triple-slash-directives';

describe('triple-slash directives in templates', () => {
  test('no template holds a directive next to imports a formatter could reorder', () => {
    const offenders = Object.entries(templateSources())
      .filter(([, source]) => isDirectiveAtRisk(source))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  test('the guard sees the directive-bearing templates it is meant to cover', () => {
    const withDirective = Object.entries(templateSources())
      .filter(([, source]) => hasTripleSlashDirective(source))
      .map(([file]) => file);

    expect(withDirective).toContain('stack/tanstack-start/src/vite-env.d.ts.hbs');
    expect(withDirective).toContain('stack/nextjs/next-env.d.ts.hbs');
  });

  describe('import statements', () => {
    test('counts default, named, namespace, type and side-effect imports', () => {
      const source = [
        "import a from 'a';",
        "import { b } from 'b';",
        "import * as c from 'c';",
        "import type { D } from 'd';",
        'import "side-effect";',
      ].join('\n');

      expect(countImportStatements(source)).toBe(5);
    });

    test('ignores comments, dynamic imports and import.meta', () => {
      const source = [
        '// import x from "x"',
        '/*',
        'import y from "y"',
        '*/',
        "const z = await import('z');",
        'const env = import.meta.env;',
      ].join('\n');

      expect(countImportStatements(source)).toBe(0);
    });

    test('flags a directive above two imports and spares a lone import', () => {
      const directive = '/// <reference types="vite/client" />';

      expect(isDirectiveAtRisk(`${directive}\nimport a from 'a';\nimport b from 'b';`)).toBe(true);
      expect(isDirectiveAtRisk(`${directive}\nimport "side-effect";`)).toBe(false);
    });
  });
});
