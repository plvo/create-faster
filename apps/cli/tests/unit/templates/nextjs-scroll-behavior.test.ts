import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';

const ROOT_LAYOUT = /\/src\/app\/layout\.tsx(\.[a-z-]+)?\.hbs$/;

function rootLayoutTemplates(): string[] {
  return readdirSync(TEMPLATES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => ROOT_LAYOUT.test(path));
}

describe('Next.js root layout templates', () => {
  const layouts = rootLayoutTemplates();

  test('finds the root layouts of the stack and of the blueprints', () => {
    expect(layouts.length).toBeGreaterThanOrEqual(8);
  });

  test.each(layouts.map((path) => [relative(TEMPLATES_DIR, path), path]))(
    '%s sets data-scroll-behavior wherever it smooths scrolling',
    (_name, path) => {
      const source = readFileSync(path, 'utf-8');
      if (source.includes('scroll-smooth')) expect(source).toContain("data-scroll-behavior='smooth'");
    },
  );
});
