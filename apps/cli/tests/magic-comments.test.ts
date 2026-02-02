// ABOUTME: Unit tests for magic comments parsing
// ABOUTME: Tests @only: for skip and @dest: for destination override

import { describe, test, expect } from 'bun:test';
import {
  parseMagicComments,
  parseDestFromContent,
  parseOnlyFromContent,
  shouldSkipTemplate,
  removeAllMagicComments,
  extractFirstLine,
} from '../src/lib/magic-comments';
import type { TemplateContext } from '../src/types/ctx';

describe('extractFirstLine', () => {
  test('extracts first line from content', () => {
    const content = '{{!-- @dest:app --}}\nrest of file';
    expect(extractFirstLine(content)).toBe('{{!-- @dest:app --}}');
  });

  test('handles content without newline', () => {
    const content = '{{!-- @dest:app --}}';
    expect(extractFirstLine(content)).toBe('{{!-- @dest:app --}}');
  });

  test('handles empty content', () => {
    expect(extractFirstLine('')).toBe('');
  });
});

describe('parseMagicComments', () => {
  test('parses @dest:app', () => {
    const result = parseMagicComments('{{!-- @dest:app --}}');
    expect(result.dest).toBe('app');
  });

  test('parses @dest:package', () => {
    const result = parseMagicComments('{{!-- @dest:package --}}');
    expect(result.dest).toBe('package');
  });

  test('parses @dest:root', () => {
    const result = parseMagicComments('{{!-- @dest:root --}}');
    expect(result.dest).toBe('root');
  });

  test('parses @only:turborepo', () => {
    const result = parseMagicComments('{{!-- @only:turborepo --}}');
    expect(result.only).toBe('turborepo');
  });

  test('parses @only:single', () => {
    const result = parseMagicComments('{{!-- @only:single --}}');
    expect(result.only).toBe('single');
  });

  test('parses combined @only and @dest', () => {
    const result = parseMagicComments('{{!-- @only:turborepo @dest:package --}}');
    expect(result.only).toBe('turborepo');
    expect(result.dest).toBe('package');
  });

  test('returns empty for no magic comments', () => {
    const result = parseMagicComments('// regular comment');
    expect(result.dest).toBeUndefined();
    expect(result.only).toBeUndefined();
  });
});

describe('parseDestFromContent', () => {
  test('extracts dest from first line', () => {
    const content = '{{!-- @dest:root --}}\nrest of file';
    expect(parseDestFromContent(content)).toBe('root');
  });

  test('returns null for no dest', () => {
    const content = 'no magic comment\nrest of file';
    expect(parseDestFromContent(content)).toBeNull();
  });
});

describe('parseOnlyFromContent', () => {
  test('extracts only from first line', () => {
    const content = '{{!-- @only:turborepo --}}\nrest of file';
    expect(parseOnlyFromContent(content)).toBe('turborepo');
  });

  test('returns null for no only', () => {
    const content = '{{!-- @dest:root --}}\nrest of file';
    expect(parseOnlyFromContent(content)).toBeNull();
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

  test('@only:turborepo skips in single', () => {
    expect(shouldSkipTemplate('turborepo', singleCtx)).toBe(true);
    expect(shouldSkipTemplate('turborepo', turborepoCtx)).toBe(false);
  });

  test('@only:single skips in turborepo', () => {
    expect(shouldSkipTemplate('single', turborepoCtx)).toBe(true);
    expect(shouldSkipTemplate('single', singleCtx)).toBe(false);
  });

  test('no @only never skips', () => {
    expect(shouldSkipTemplate(null, turborepoCtx)).toBe(false);
    expect(shouldSkipTemplate(null, singleCtx)).toBe(false);
  });
});

describe('removeAllMagicComments', () => {
  test('removes @dest comment', () => {
    const content = '{{!-- @dest:root --}}\nrest of file';
    expect(removeAllMagicComments(content)).toBe('rest of file');
  });

  test('removes @only comment', () => {
    const content = '{{!-- @only:turborepo --}}\nrest of file';
    expect(removeAllMagicComments(content)).toBe('rest of file');
  });

  test('removes combined comments', () => {
    const content = '{{!-- @only:turborepo @dest:package --}}\nrest of file';
    expect(removeAllMagicComments(content)).toBe('rest of file');
  });

  test('preserves content without magic comments', () => {
    const content = 'no magic comment\nrest of file';
    expect(removeAllMagicComments(content)).toBe('no magic comment\nrest of file');
  });
});
