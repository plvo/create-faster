import { join, relative } from 'node:path';
import { filesUnder, readTextFile } from './helpers';

const SKIPPED_DIRECTORIES = ['node_modules', '.git', '.next', '.turbo', '.wrangler', '.open-next', 'dist'];
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const JSX_FILE = /\.[jt]sx$/;
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)['"]([^'"]+)['"]/g;
const PROCESS_ENV_READS = [
  /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bprocess\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /(?<![\w.])env\.([A-Z][A-Z0-9_]*)\b/g,
];
const IMPORT_META_ENV_READ = /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;

interface EnvRead {
  name: string;
  /** `import.meta.env` is filled by the bundler, `process.env` (and a Worker `env`) by the runtime. */
  source: 'import.meta.env' | 'process.env';
}

/** Every file under a directory, relative to it, without dependency and build directories. */
export async function listFiles(directory: string): Promise<string[]> {
  return (await filesUnder(directory, SKIPPED_DIRECTORIES)).map((file) => relative(directory, file));
}

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

/** The environment variables a source file reads. */
export function envReads(source: string): EnvRead[] {
  const namesOf = (patterns: RegExp[]) => [
    ...new Set(patterns.flatMap((pattern) => [...source.matchAll(pattern)].map(([, name = '']) => name))),
  ];
  return [
    ...namesOf(PROCESS_ENV_READS).map((name): EnvRead => ({ name, source: 'process.env' })),
    ...namesOf([IMPORT_META_ENV_READ]).map((name): EnvRead => ({ name, source: 'import.meta.env' })),
  ];
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
    files
      .filter((file) => SCRIPT_FILE.test(file))
      .map(async (file) => ({ file, source: await readTextFile(join(project, file)) })),
  );
}
