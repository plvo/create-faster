// ABOUTME: Magic comment parser for template destination override
// ABOUTME: Supports only @dest:app|pkg|root for explicit file placement

export type DestType = 'app' | 'pkg' | 'root';

export interface MagicComment {
  type: 'dest';
  values: string[];
  raw: string;
}

export function extractFirstLine(content: string): string {
  const firstLineEnd = content.indexOf('\n');
  return firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
}

export function parseMagicComments(firstLine: string): MagicComment[] {
  const commentMatch = firstLine.match(/^\{\{!--\s*@dest:(app|pkg|root)\s*--\}\}/);

  if (!commentMatch || !commentMatch[1]) return [];

  return [
    {
      type: 'dest',
      values: [commentMatch[1]],
      raw: commentMatch[0],
    },
  ];
}

export function parseDestFromContent(content: string): DestType | null {
  const firstLine = extractFirstLine(content);
  const comments = parseMagicComments(firstLine);
  const firstComment = comments[0];
  if (!firstComment) return null;
  return firstComment.values[0] as DestType;
}

export function removeDestMagicComment(content: string): string {
  return content.replace(/^\{\{!--\s*@dest:(app|pkg|root)\s*--\}\}\n?/, '');
}
