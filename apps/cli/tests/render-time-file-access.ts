const STATIC_PARAMS_FUNCTION = /export function generateStaticParams[\s\S]*?\n\}\n/;
const IMPORT_STATEMENT = /^import .* from .*;$/gm;
const FILE_ACCESS = /\b(?:fs|readdir|readdirSync|readFile|readFileSync|existsSync|statSync|cwd)\b/;

/** What a page does with the filesystem once its module runs, i.e. everything but `generateStaticParams`, which only runs at build. */
export function renderTimeFileAccess(source: string): string[] {
  return source
    .replace(STATIC_PARAMS_FUNCTION, '')
    .replace(IMPORT_STATEMENT, '')
    .split('\n')
    .filter((line) => FILE_ACCESS.test(line));
}
