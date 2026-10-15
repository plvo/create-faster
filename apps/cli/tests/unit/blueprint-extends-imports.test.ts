import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { TEMPLATES_DIR } from '@/lib/constants';
import { parseStackSuffix } from '@/lib/frontmatter';
import { scanTemplateFiles } from '@/lib/template-resolver';

const NEXT_IMPORT = /\b(?:from|import)\s*\(?\s*['"](next(?:\/[^'"]*)?)['"]/g;
const STACKS = Object.keys(META.stacks);

function findNextImportsInUnsuffixedTemplates(blueprintDir: string): string[] {
  return scanTemplateFiles(blueprintDir)
    .filter((file) => !parseStackSuffix(file, STACKS).stackName)
    .flatMap((file) => {
      const content = readFileSync(join(blueprintDir, file), 'utf-8');
      return [...content.matchAll(NEXT_IMPORT)].map((match) => `${file} -> ${match[1]}`);
    });
}

const FIXTURE_FILES: Record<string, string> = {
  'leaks-static.tsx.hbs': "import Link from 'next/link';\n",
  'leaks-bare.ts.hbs': "import type { NextConfig } from 'next';\n",
  'leaks-dynamic.ts.hbs': "const navigation = await import('next/navigation');\n",
  'leaks-reexport.ts.hbs': "export { notFound } from 'next/navigation';\n",
  'suffixed.tsx.nextjs.hbs': "import Link from 'next/link';\n",
  'other-package.tsx.hbs': "import { ThemeProvider } from 'next-themes';\nimport { x } from '@next/y';\n",
};

describe('imports of an extended blueprint', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'blueprint-extends-imports-'));
    for (const [relative, content] of Object.entries(FIXTURE_FILES)) {
      const file = join(fixtureDir, relative);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test('the check finds next imports in unsuffixed templates only', () => {
    expect(findNextImportsInUnsuffixedTemplates(fixtureDir).sort()).toEqual([
      'leaks-bare.ts.hbs -> next',
      'leaks-dynamic.ts.hbs -> next/navigation',
      'leaks-reexport.ts.hbs -> next/navigation',
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
