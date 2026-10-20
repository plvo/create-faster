import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readTextFile } from './helpers';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.next', '.turbo', '.wrangler', '.open-next', 'dist']);
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const JSX_FILE = /\.[jt]sx$/;
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)['"]([^'"]+)['"]/g;
const ENV_READS = [
  /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bprocess\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /(?<![\w.])env\.([A-Z][A-Z0-9_]*)\b/g,
];

/** Every file under a directory, relative to it, without dependency and build directories. */
export async function listFiles(directory: string, skipped: ReadonlySet<string> = new Set()): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (SKIPPED_DIRECTORIES.has(entry.name) || skipped.has(relative(directory, path))) continue;
      if (entry.isDirectory()) await walk(path);
      else found.push(relative(directory, path));
    }
  }

  await walk(directory);
  return found;
}

const isScriptFile = (file: string): boolean => SCRIPT_FILE.test(file);
export const isJsxFile = (file: string): boolean => JSX_FILE.test(file);

/** The packages a source file imports: not relative paths, aliases or Node built-ins. */
export function importedPackages(source: string): string[] {
  const names = [...source.matchAll(IMPORT_SPECIFIER)].flatMap(([, specifier = '']) => {
    if (/^(?:\.|\/|@\/|~|node:|bun:)/.test(specifier)) return [];
    const [scopeOrName = '', second] = specifier.split('/');
    return [scopeOrName.startsWith('@') ? `${scopeOrName}/${second}` : scopeOrName];
  });
  return [...new Set(names)];
}

/** The environment variables a source file reads (`process.env.X`, `import.meta.env.X`, `env.X`). */
export function envReads(source: string): string[] {
  return [...new Set(ENV_READS.flatMap((pattern) => [...source.matchAll(pattern)].map(([, name = '']) => name)))];
}

/** The variable names a `.env` example declares. */
export function declaredVariables(example: string): string[] {
  return example
    .split('\n')
    .map((line) => line.split('=')[0]?.trim() ?? '')
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

export async function readScriptFiles(project: string, files: string[]): Promise<{ file: string; source: string }[]> {
  return Promise.all(
    files.filter(isScriptFile).map(async (file) => ({ file, source: await readTextFile(join(project, file)) })),
  );
}
