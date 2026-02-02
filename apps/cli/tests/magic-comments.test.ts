// ABOUTME: Unit tests for magic comments parsing
// ABOUTME: Tests the @dest: magic comment (new simplified system)

import { describe, expect, test } from 'bun:test';
import { extractFirstLine, parseMagicComments, shouldSkipTemplate } from '../src/lib/magic-comments';
import type { TemplateContext } from '../src/types/ctx';

const baseContext: TemplateContext = {
  projectName: 'test',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', modules: [] }],
  git: false,
};

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

describe('shouldSkipTemplate', () => {
  test('@dest: comments never cause skip', () => {
    const comments = parseMagicComments('{{!-- @dest:app --}}');
    expect(shouldSkipTemplate(comments, baseContext)).toBe(false);
  });

  test('empty comments never cause skip', () => {
    expect(shouldSkipTemplate([], baseContext)).toBe(false);
  });
});
