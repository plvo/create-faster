import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  parseFrontmatter,
  parseStackSuffix,
  readFrontmatterFile,
  removeFrontmatter,
  shouldSkipTemplate,
} from '@/lib/frontmatter';
import type { TemplateContext } from '@/types/ctx';

const TEMPLATES_DIR = join(import.meta.dir, '../../../templates');

describe('parseFrontmatter', () => {
  test('parses path field', () => {
    const content = '---\npath: src/lib/db/schema.ts\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.path).toBe('src/lib/db/schema.ts');
  });

  test('parses mono.scope field', () => {
    const content = '---\nmono:\n  scope: root\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.mono?.scope).toBe('root');
  });

  test('parses mono.path field', () => {
    const content = '---\nmono:\n  scope: pkg\n  path: src/schema.ts\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.mono?.scope).toBe('pkg');
    expect(result.data.mono?.path).toBe('src/schema.ts');
  });

  test('parses only field', () => {
    const content = '---\nonly: mono\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data.only).toBe('mono');
  });

  test('returns empty data for no frontmatter', () => {
    const content = 'just template content';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.content).toBe('just template content');
  });

  test('separates content from frontmatter', () => {
    const content = '---\nonly: mono\n---\ntemplate content here';
    const result = parseFrontmatter(content);
    expect(result.content).toBe('template content here');
  });

  test('handles empty frontmatter', () => {
    const content = '---\n---\ntemplate content';
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
  });
});

describe('shouldSkipTemplate', () => {
  const turborepoCtx: TemplateContext = {
    projectName: 'test',
    repo: 'turborepo',
    apps: [],
    globalAddons: [],
    git: true,
  };

  const singleCtx: TemplateContext = {
    projectName: 'test',
    repo: 'single',
    apps: [],
    globalAddons: [],
    git: true,
  };

  test('only:mono skips in single repo', () => {
    expect(shouldSkipTemplate('mono', singleCtx)).toBe(true);
    expect(shouldSkipTemplate('mono', turborepoCtx)).toBe(false);
  });

  test('only:single skips in turborepo', () => {
    expect(shouldSkipTemplate('single', turborepoCtx)).toBe(true);
    expect(shouldSkipTemplate('single', singleCtx)).toBe(false);
  });

  test('no only value never skips', () => {
    expect(shouldSkipTemplate(undefined, turborepoCtx)).toBe(false);
    expect(shouldSkipTemplate(undefined, singleCtx)).toBe(false);
  });
});

describe('removeFrontmatter', () => {
  test('removes frontmatter from content', () => {
    const content = '---\nonly: mono\n---\nrest of file';
    expect(removeFrontmatter(content)).toBe('rest of file');
  });

  test('preserves content without frontmatter', () => {
    const content = 'no frontmatter\nrest of file';
    expect(removeFrontmatter(content)).toBe('no frontmatter\nrest of file');
  });

  test('handles empty frontmatter', () => {
    const content = '---\n---\nrest of file';
    expect(removeFrontmatter(content)).toBe('rest of file');
  });
});

describe('readFrontmatterFile', () => {
  test('reads and parses frontmatter from file', () => {
    const filepath = join(TEMPLATES_DIR, 'project/orm/drizzle/tsconfig.json.hbs');
    const result = readFrontmatterFile(filepath);
    expect(result.data.only).toBe('mono');
    expect(result.content).toContain('"extends"');
  });

  test('reads file without frontmatter', () => {
    const filepath = join(TEMPLATES_DIR, 'stack/nextjs/src/app/page.tsx.hbs');
    const result = readFrontmatterFile(filepath);
    expect(result.data).toEqual({});
    expect(result.content).toContain('export default function');
  });

  test('throws on non-existent file', () => {
    expect(() => readFrontmatterFile('/nonexistent/file.hbs')).toThrow();
  });
});

describe('parseStackSuffix', () => {
  const validStacks = ['nextjs', 'expo', 'hono', 'tanstack-start'];

  test('detects stack suffix in filename', () => {
    const result = parseStackSuffix('route.ts.nextjs.hbs', validStacks);
    expect(result.stackName).toBe('nextjs');
    expect(result.cleanFilename).toBe('route.ts.hbs');
  });

  test('returns null for no stack suffix', () => {
    const result = parseStackSuffix('page.tsx.hbs', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('page.tsx.hbs');
  });

  test('detects tanstack-start suffix', () => {
    const result = parseStackSuffix('route.ts.tanstack-start.hbs', validStacks);
    expect(result.stackName).toBe('tanstack-start');
    expect(result.cleanFilename).toBe('route.ts.hbs');
  });

  test('does not match partial stack names', () => {
    const result = parseStackSuffix('route.ts.next.hbs', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('route.ts.next.hbs');
  });

  test('errors on unknown stack-like suffix', () => {
    expect(() => parseStackSuffix('route.ts.foobar.hbs', validStacks)).toThrow();
  });

  test('does not confuse dotfiles', () => {
    const result = parseStackSuffix('__env.example.hbs', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('__env.example.hbs');
  });

  test('handles files without .hbs extension', () => {
    const result = parseStackSuffix('icon.png', validStacks);
    expect(result.stackName).toBeNull();
    expect(result.cleanFilename).toBe('icon.png');
  });
});
