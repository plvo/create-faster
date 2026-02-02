// ABOUTME: Unit tests for magic comments parsing
// ABOUTME: Tests the @dest: magic comment for destination override

import { describe, expect, test } from 'bun:test';
import {
  extractFirstLine,
  parseDestFromContent,
  parseMagicComments,
  removeDestMagicComment,
} from '../src/lib/magic-comments';

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
    const comments = parseMagicComments('{{!-- @dest:app --}}');
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('dest');
    expect(comments[0].values).toEqual(['app']);
  });

  test('parses @dest:pkg', () => {
    const comments = parseMagicComments('{{!-- @dest:pkg --}}');
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('dest');
    expect(comments[0].values).toEqual(['pkg']);
  });

  test('parses @dest:root', () => {
    const comments = parseMagicComments('{{!-- @dest:root --}}');
    expect(comments).toHaveLength(1);
    expect(comments[0].type).toBe('dest');
    expect(comments[0].values).toEqual(['root']);
  });

  test('returns empty array for no magic comments', () => {
    const comments = parseMagicComments('// regular comment');
    expect(comments).toHaveLength(0);
  });

  test('returns empty array for empty string', () => {
    const comments = parseMagicComments('');
    expect(comments).toHaveLength(0);
  });
});

describe('parseDestFromContent', () => {
  test('extracts dest type from content', () => {
    const content = '{{!-- @dest:app --}}\nrest of file';
    expect(parseDestFromContent(content)).toBe('app');
  });

  test('returns null for no magic comment', () => {
    const content = '// regular content\nrest of file';
    expect(parseDestFromContent(content)).toBeNull();
  });
});

describe('removeDestMagicComment', () => {
  test('removes @dest: comment from content', () => {
    const content = '{{!-- @dest:app --}}\nrest of file';
    expect(removeDestMagicComment(content)).toBe('rest of file');
  });

  test('preserves content without magic comment', () => {
    const content = 'no magic comment\nrest of file';
    expect(removeDestMagicComment(content)).toBe('no magic comment\nrest of file');
  });
});
