const TRIPLE_SLASH_DIRECTIVE = /^\/\/\/\s*<reference/m;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^[ \t]*\/\/.*$/gm;
const IMPORT_STATEMENT = /^import\s+(?:type\s+)?[\w$*{'"]/gm;

export function hasTripleSlashDirective(source: string): boolean {
  return TRIPLE_SLASH_DIRECTIVE.test(source);
}

/**
 * Counts the import statements of a source file, a Handlebars template included (every branch counts).
 * Whole-line comments are dropped first; prose inside a template literal or JSX text that starts a line with
 * `import` can still count, which only makes a guard fail loudly, never pass silently.
 */
export function countImportStatements(source: string): number {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '').match(IMPORT_STATEMENT)?.length ?? 0;
}

/** A formatter that sorts imports carries a leading comment with the import it precedes, so two or more imports are enough to move a directive. */
export function isDirectiveAtRisk(source: string): boolean {
  return hasTripleSlashDirective(source) && countImportStatements(source) > 1;
}
