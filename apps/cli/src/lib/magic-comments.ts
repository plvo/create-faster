// ABOUTME: Magic comment parser for template processing
// ABOUTME: Supports @only:turborepo|single for skip and @dest:app|package|root for destination

import type { TemplateContext } from '@/types/ctx';

export type DestType = 'app' | 'package' | 'root';
export type OnlyType = 'turborepo' | 'single';

export interface ParsedMagicComments {
  dest?: DestType;
  only?: OnlyType;
}

const MAGIC_COMMENT_REGEX = /^\{\{!--\s*((?:@(?:dest|only):[a-z]+\s*)+)--\}\}/;
const DEST_REGEX = /@dest:(app|package|root)/;
const ONLY_REGEX = /@only:(turborepo|single)/;

export function extractFirstLine(content: string): string {
  const firstLineEnd = content.indexOf('\n');
  return firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
}

export function parseMagicComments(firstLine: string): ParsedMagicComments {
  const result: ParsedMagicComments = {};

  const commentMatch = firstLine.match(MAGIC_COMMENT_REGEX);
  if (!commentMatch) return result;

  const innerContent = commentMatch[1];

  const destMatch = innerContent.match(DEST_REGEX);
  if (destMatch) {
    result.dest = destMatch[1] as DestType;
  }

  const onlyMatch = innerContent.match(ONLY_REGEX);
  if (onlyMatch) {
    result.only = onlyMatch[1] as OnlyType;
  }

  return result;
}

export function parseMagicCommentsFromContent(content: string): ParsedMagicComments {
  const firstLine = extractFirstLine(content);
  return parseMagicComments(firstLine);
}

export function shouldSkipTemplate(only: OnlyType | null, ctx: TemplateContext): boolean {
  if (!only) return false;
  return only !== ctx.repo;
}

export function removeAllMagicComments(content: string): string {
  return content.replace(/^\{\{!--\s*(?:@(?:dest|only):[a-z]+\s*)+--\}\}\n?/, '');
}
