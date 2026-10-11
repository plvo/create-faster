import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'create-faster-test-'));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const cliPath = join(import.meta.dir, '../../src/index.ts');

  try {
    const result = await $`bun run ${cliPath} ${args}`.cwd(cwd).quiet();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error: unknown) {
    const e = error as { exitCode?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      exitCode: e.exitCode ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

export interface SstHandler {
  /** Handler as written in sst.config.ts, e.g. `apps/api/src/index.handler`. */
  ref: string;
  /** Source file SST bundles for it, or undefined when none exists. */
  file: string | undefined;
  exportName: string;
}

// Node.js handler strings in sst.config.ts: `handler: '...'` (Function, queue subscriber),
// `function: '...'` (Cron) and the target of `.route('...', '...')` (ApiGatewayV2).
const SST_HANDLER_PATTERNS = [/\bhandler:\s*'([^']+)'/g, /\bfunction:\s*'([^']+)'/g, /\.route\(\s*'[^']*',\s*'([^']+)'/g];

// Extensions SST's Node.js runtime tries, in this order, to find a handler's file.
const SST_HANDLER_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export async function readSstHandlers(projectPath: string): Promise<SstHandler[]> {
  const config = await readTextFile(join(projectPath, 'sst.config.ts'));
  const refs = SST_HANDLER_PATTERNS.flatMap((pattern) => [...config.matchAll(pattern)].map((match) => match[1] ?? ''));

  return Promise.all(
    refs.map(async (ref) => {
      const separator = ref.lastIndexOf('.');
      const base = join(projectPath, ref.slice(0, separator));
      const candidates = SST_HANDLER_EXTENSIONS.map((extension) => base + extension);
      const exists = await Promise.all(candidates.map(fileExists));
      return { ref, file: candidates[exists.indexOf(true)], exportName: ref.slice(separator + 1) };
    }),
  );
}

export async function exportedNames(file: string): Promise<string[]> {
  return new Bun.Transpiler({ loader: 'ts' }).scan(await readTextFile(file)).exports;
}
