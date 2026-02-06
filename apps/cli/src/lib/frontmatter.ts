// ABOUTME: Parses YAML frontmatter from template files using gray-matter
// ABOUTME: Handles path resolution config, repo filtering, and stack suffix detection

import matter from 'gray-matter';
import type { TemplateContext } from '@/types/ctx';
import type { MonoScope } from '@/types/meta';

export interface TemplateFrontmatter {
  path?: string;
  mono?: {
    scope?: MonoScope;
    path?: string;
  };
  only?: 'mono' | 'single';
}

export interface ParsedTemplate {
  data: TemplateFrontmatter;
  content: string;
}

export interface StackSuffixResult {
  stackName: string | null;
  cleanFilename: string;
}

const KNOWN_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'mjs',
  'cjs',
  'css',
  'scss',
  'html',
  'md',
  'mdx',
  'yaml',
  'yml',
  'toml',
  'xml',
  'svg',
  'txt',
  'env',
  'example',
  'config',
  'lock',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
]);

export function parseFrontmatter(rawContent: string): ParsedTemplate {
  const { data, content } = matter(rawContent);

  return {
    data: data as TemplateFrontmatter,
    content,
  };
}

export function readFrontmatterFile(filepath: string): ParsedTemplate {
  const { data, content } = matter.read(filepath);

  return {
    data: data as TemplateFrontmatter,
    content,
  };
}

export function shouldSkipTemplate(only: string | undefined, ctx: TemplateContext): boolean {
  if (!only) return false;

  if (only === 'mono') return ctx.repo !== 'turborepo';
  if (only === 'single') return ctx.repo !== 'single';

  return false;
}

export function removeFrontmatter(rawContent: string): string {
  const { content } = matter(rawContent);
  return content;
}

export function parseStackSuffix(filename: string, validStacks: string[]): StackSuffixResult {
  if (!filename.endsWith('.hbs')) {
    return { stackName: null, cleanFilename: filename };
  }

  const withoutHbs = filename.slice(0, -4);
  const lastDotIndex = withoutHbs.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return { stackName: null, cleanFilename: filename };
  }

  const possibleStack = withoutHbs.slice(lastDotIndex + 1);
  const beforeStack = withoutHbs.slice(0, lastDotIndex);

  if (KNOWN_EXTENSIONS.has(possibleStack)) {
    return { stackName: null, cleanFilename: filename };
  }

  if (validStacks.includes(possibleStack)) {
    return { stackName: possibleStack, cleanFilename: `${beforeStack}.hbs` };
  }

  // Check if this looks like a stack suffix attempt (has file extension before it)
  const hasExtensionBefore = beforeStack.includes('.') && KNOWN_EXTENSIONS.has(beforeStack.split('.').pop() ?? '');

  // Check if the suffix is a partial match for any valid stack (e.g., "next" for "nextjs")
  const isPartialMatch = validStacks.some(
    (stack) => stack.startsWith(possibleStack) || possibleStack.startsWith(stack),
  );

  if (hasExtensionBefore && !isPartialMatch) {
    throw new Error(
      `Unknown stack suffix "${possibleStack}" in template "${filename}". ` + `Valid stacks: ${validStacks.join(', ')}`,
    );
  }

  return { stackName: null, cleanFilename: filename };
}
