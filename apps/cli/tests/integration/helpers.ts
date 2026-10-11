import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
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
const SST_HANDLER_PATTERNS = [
  /\bhandler:\s*'([^']+)'/g,
  /\bfunction:\s*'([^']+)'/g,
  /\.route\(\s*'[^']*',\s*'([^']+)'/g,
];

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

export interface TerraformLambda {
  /** Name of the `./modules/lambda` module block in infra/main.tf, e.g. `api`. */
  name: string;
  /** Directory Terraform zips as the function's code. */
  sourceDir: string;
  /** e.g. `index.handler`. */
  handler: string;
  /** e.g. `nodejs22.x`. */
  runtime: string;
}

interface HclBlock {
  type: string;
  label: string;
  attributes: Record<string, string>;
}

// Top-level blocks such as `module "api" {` ... `}`, closed by a `}` at the start of a line.
const HCL_BLOCK = /^(\w+)(?: "([^"]+)")? \{\n([\s\S]*?)^\}/gm;
const HCL_STRING_ATTRIBUTE = /^\s*(\w+)\s*=\s*"([^"]*)"\s*$/gm;
const HCL_INTERPOLATION = /\$\{([^}]+)\}/g;

function parseHclBlocks(source: string): HclBlock[] {
  return [...source.matchAll(HCL_BLOCK)].map(([, type = '', label = '', body = '']) => ({
    type,
    label,
    attributes: Object.fromEntries([...body.matchAll(HCL_STRING_ATTRIBUTE)].map(([, key, value]) => [key, value])),
  }));
}

/** Reads the Lambda functions infra/main.tf declares through `./modules/lambda`, with the module's defaults. */
export async function readTerraformLambdas(projectPath: string): Promise<TerraformLambda[]> {
  const infraDir = join(projectPath, 'infra');
  const main = parseHclBlocks(await readTextFile(join(infraDir, 'main.tf')));
  const variables = parseHclBlocks(await readTextFile(join(infraDir, 'modules/lambda/variables.tf')));

  const locals: Record<string, string> = Object.fromEntries(
    main.filter(({ type }) => type === 'locals').flatMap(({ attributes }) => Object.entries(attributes)),
  );
  const defaults: Record<string, string> = Object.fromEntries(
    variables.flatMap(({ type, label, attributes }) =>
      type === 'variable' && attributes.default !== undefined ? [[label, attributes.default]] : [],
    ),
  );
  const interpolate = (value: string): string =>
    value.replace(HCL_INTERPOLATION, (_, reference: string) =>
      reference === 'path.module' ? infraDir : interpolate(locals[reference.replace(/^local\./, '')] ?? ''),
    );

  return main
    .filter(({ type, attributes }) => type === 'module' && attributes.source === './modules/lambda')
    .map(({ label, attributes }) => {
      const config = { ...defaults, ...attributes };
      return {
        name: label,
        sourceDir: normalize(interpolate(config.source_dir ?? '')),
        handler: config.handler ?? '',
        runtime: config.runtime ?? '',
      };
    });
}

export async function exportedNames(file: string): Promise<string[]> {
  return new Bun.Transpiler({ loader: 'ts' }).scan(await readTextFile(file)).exports;
}
