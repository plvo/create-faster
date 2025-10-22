import type { TemplateContext } from '@/types';

/**
 * Magic comments system for conditional template rendering
 *
 * Supported magic comments (must be on the first line):
 * - {{!-- @repo:turborepo --}}     → Only render in turborepo mode
 * - {{!-- @repo:single --}}        → Only render in single repo mode
 * - {{!-- @if:database --}}        → Only render if ctx.database exists
 * - {{!-- @require:git --}}        → Only render if ctx.git === true
 * - {{!-- @repo:!single --}}       → Negation: everything except single
 * - {{!-- @scope:app --}}          → Force output to app scope (overrides packageName)
 * - {{!-- @scope:package --}}      → Force output to package scope
 *
 * Multiple conditions (AND logic):
 * - {{!-- @repo:turborepo @if:database --}}
 * - {{!-- @repo:turborepo @scope:package --}}
 */

export interface MagicComment {
  type: 'repo' | 'if' | 'require' | 'scope';
  values: string[];
  negated?: boolean;
  raw: string;
}

/**
 * Extract the first line from template content
 */
export function extractFirstLine(content: string): string {
  const firstLineEnd = content.indexOf('\n');
  return firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
}

/**
 * Parse a single magic comment directive
 * @example "{{!-- @repo:turborepo --}}" → { type: 'repo', values: ['turborepo'], raw: '...' }
 */
function parseSingleDirective(directive: string): MagicComment | null {
  const match = directive.match(/@(\w+):(!?)(.+)/);

  if (!match) return null;

  const [, type, negation, valuesStr] = match; // Skip first element (full match)

  if (!type || !['repo', 'if', 'require', 'scope'].includes(type)) {
    return null;
  }

  const values = valuesStr?.split(',').map((v) => v.trim()) ?? [];
  const negated = negation === '!';

  return {
    type: type as 'repo' | 'if' | 'require' | 'scope',
    values,
    negated,
    raw: directive,
  };
}

/**
 * Parse all magic comments from the first line
 * Supports multiple directives: {{!-- @repo:turborepo @if:database --}}
 */
export function parseMagicComments(firstLine: string): MagicComment[] {
  const commentMatch = firstLine.match(/^\{\{!--\s*(.+?)\s*--\}\}/);

  if (!commentMatch) return [];

  const commentContent = commentMatch[1];

  const directives = commentContent
    ?.split(/(?=@)/) // Split before each @
    .map((d) => d.trim())
    .filter((d) => d.startsWith('@'));

  return directives?.map(parseSingleDirective).filter((c): c is MagicComment => c !== null) ?? [];
}

/**
 * Check if a single magic comment should cause the template to be skipped
 */
function shouldSkipForComment(comment: MagicComment, ctx: TemplateContext): boolean {
  switch (comment.type) {
    case 'repo': {
      const matches = comment.values.includes(ctx.repo);
      return comment.negated ? matches : !matches;
    }

    case 'if': {
      const key = comment.values[0] as keyof TemplateContext;
      const exists = key in ctx && Boolean(ctx[key]);
      return comment.negated ? exists : !exists;
    }

    case 'require': {
      const key = comment.values[0] as keyof TemplateContext;
      const value = ctx[key];
      const satisfied = value === true;
      return comment.negated ? satisfied : !satisfied;
    }

    case 'scope': {
      // @scope never causes skip, it's just a directive for output location
      return false;
    }

    default:
      return false;
  }
}

/**
 * Determine if a template should be skipped based on magic comments
 * Multiple comments are combined with AND logic
 *
 * @returns true if template should be skipped, false if it should be rendered
 */
export function shouldSkipTemplate(comments: MagicComment[], ctx: TemplateContext): boolean {
  if (comments.length === 0) return false; // No magic comments = render everywhere

  // AND logic: skip if ANY comment says to skip
  return comments.some((comment) => shouldSkipForComment(comment, ctx));
}

/**
 * Validate magic comments for common errors
 * Returns array of warning messages
 */
export function validateMagicComments(comments: MagicComment[]): string[] {
  const warnings: string[] = [];

  for (const comment of comments) {
    if (comment.values.length === 0) {
      warnings.push(`Magic comment @${comment.type} has no values`);
    }

    if (comment.type === 'repo') {
      const validRepos = ['single', 'turborepo'];
      const invalidRepos = comment.values.filter((v) => !validRepos.includes(v));
      if (invalidRepos.length > 0) {
        warnings.push(`Unknown repo type(s): ${invalidRepos.join(', ')}`);
      }
    }

    if (comment.type === 'scope') {
      const validScopes = ['app', 'package', 'root'];
      const invalidScopes = comment.values.filter((v) => !validScopes.includes(v));
      if (invalidScopes.length > 0) {
        warnings.push(`Unknown scope type(s): ${invalidScopes.join(', ')}`);
      }
    }

    if (comment.type !== 'repo' && comment.values.length > 1) {
      warnings.push(`@${comment.type} only supports a single value, got: ${comment.values.join(', ')}`);
    }
  }

  return warnings;
}

/**
 * Format magic comments into a human-readable string for logging
 */
export function formatMagicComments(comments: MagicComment[]): string {
  if (comments.length === 0) return 'none';

  return comments
    .map((c) => {
      const neg = c.negated ? '!' : '';
      return `@${c.type}:${neg}${c.values.join(',')}`;
    })
    .join(' ');
}
