import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { TEMPLATES_DIR } from '@/lib/constants';
import { parseStackSuffix } from '@/lib/frontmatter';
import { scanTemplateFiles, VALID_STACKS } from '@/lib/template-resolver';
import { createFixtureTree, removeFixtureTree } from './fixture-tree';

const NEXT_IMPORT = /\b(?:from|import|require)\s*\(?\s*['"](next(?:\/[^'"]*)?)['"]/g;

function findNextImportsInUnsuffixedTemplates(blueprintDir: string): string[] {
  return scanTemplateFiles(blueprintDir)
    .filter((file) => !parseStackSuffix(file, VALID_STACKS).stackName)
    .flatMap((file) => {
      const content = readFileSync(join(blueprintDir, file), 'utf-8');
      return [...content.matchAll(NEXT_IMPORT)].map((match) => `${file} -> ${match[1]}`);
    });
}

const FIXTURE_FILES: Record<string, string> = {
  'leaks-static.tsx.hbs': "import Link from 'next/link';\n",
  'leaks-bare.ts.hbs': "import type { NextConfig } from 'next';\n",
  'leaks-dynamic.ts.hbs': "const navigation = await import('next/navigation');\n",
  'leaks-require.ts.hbs': "const link = require('next/link');\n",
  'leaks-reexport.ts.hbs': "export { notFound } from 'next/navigation';\n",
  'suffixed.tsx.nextjs.hbs': "import Link from 'next/link';\n",
  'other-package.tsx.hbs': "import { ThemeProvider } from 'next-themes';\nimport { x } from '@next/y';\n",
};

describe('imports of an extended blueprint', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = createFixtureTree('blueprint-extends-imports-', FIXTURE_FILES);
  });

  afterAll(() => {
    removeFixtureTree(fixtureDir);
  });

  test('the check finds next imports in unsuffixed templates only', () => {
    expect(findNextImportsInUnsuffixedTemplates(fixtureDir).sort()).toEqual([
      'leaks-bare.ts.hbs -> next',
      'leaks-dynamic.ts.hbs -> next/navigation',
      'leaks-reexport.ts.hbs -> next/navigation',
      'leaks-require.ts.hbs -> next/link',
      'leaks-static.tsx.hbs -> next/link',
    ]);
  });

  test('no extended blueprint has a next import in an unsuffixed template', () => {
    const extended = new Set(Object.values(META.blueprints).flatMap((blueprint) => blueprint.extends ?? []));
    const leaks = [...extended].flatMap((name) =>
      findNextImportsInUnsuffixedTemplates(join(TEMPLATES_DIR, 'blueprints', name)).map((leak) => `${name}/${leak}`),
    );
    expect(leaks).toEqual([]);
  });
});
