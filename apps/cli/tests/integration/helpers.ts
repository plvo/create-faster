import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { format } from 'node:util';
import { expect, test } from 'bun:test';
import { $ } from 'bun';
import { PLAIN_OUTPUT_ENV } from '../plain-output-env';

export const PNPM_AVAILABLE = Boolean(Bun.which('pnpm'));

/** A test that needs pnpm: skipped, and titled as such, when pnpm is not installed. */
export function pnpmTest(title: string, run: () => Promise<void>): void {
  test.skipIf(!PNPM_AVAILABLE)(PNPM_AVAILABLE ? title : `${title} (skipped: pnpm is not installed)`, run);
}

interface CliResult {
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

export async function runCli(args: string[], cwd: string, env?: Record<string, string>): Promise<CliResult> {
  const cliPath = join(import.meta.dir, '../../src/index.ts');

  try {
    const result = await $`${process.execPath} run ${cliPath} ${args}`
      .cwd(cwd)
      .env({ ...process.env, ...PLAIN_OUTPUT_ENV, ...env })
      .quiet();
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
  /** Seconds. */
  timeout: number;
}

interface HclBlock {
  type: string;
  label: string;
  /** String and number attributes, numbers kept as written. */
  attributes: Record<string, string>;
}

// Top-level blocks such as `module "api" {` ... `}`, closed by a `}` at the start of a line.
const HCL_BLOCK = /^(\w+)(?: "([^"]+)")? \{\n([\s\S]*?)^\}/gm;
const HCL_LITERAL_ATTRIBUTE = /^\s*(\w+)\s*=\s*(?:"([^"]*)"|(\d+))\s*$/gm;
const HCL_INTERPOLATION = /\$\{([^}]+)\}/g;

function parseHclBlocks(source: string): HclBlock[] {
  return [...source.matchAll(HCL_BLOCK)].map(([, type = '', label = '', body = '']) => ({
    type,
    label,
    attributes: Object.fromEntries(
      [...body.matchAll(HCL_LITERAL_ATTRIBUTE)].map(([, key, text, number]) => [key, text ?? number]),
    ),
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
  const resolveReference = (reference: string): string => {
    if (reference === 'path.module') return infraDir;
    const local = reference.startsWith('local.') ? locals[reference.slice('local.'.length)] : undefined;
    if (local === undefined) throw new Error(`Cannot resolve \${${reference}} in ${join(infraDir, 'main.tf')}`);
    return interpolate(local);
  };
  const interpolate = (value: string): string =>
    value.replace(HCL_INTERPOLATION, (_, reference: string) => resolveReference(reference));

  return main
    .filter(({ type, attributes }) => type === 'module' && attributes.source === './modules/lambda')
    .map(({ label, attributes }) => {
      const config = { ...defaults, ...attributes };
      const read = (key: string): string => {
        const value = config[key];
        if (value === undefined) throw new Error(`Lambda module "${label}" sets no ${key} and has no default for it`);
        return value;
      };
      return {
        name: label,
        sourceDir: normalize(interpolate(read('source_dir'))),
        handler: read('handler'),
        runtime: read('runtime'),
        timeout: Number(read('timeout')),
      };
    });
}

export async function exportedNames(file: string): Promise<string[]> {
  return new Bun.Transpiler({ loader: 'ts' }).scan(await readTextFile(file)).exports;
}

const BUILD_TIME_DEV = "const isDev = process.env.NODE_ENV === 'development';";

interface ErrorShape {
  message: string;
  code: number;
  data: { code: string; httpStatus: number; path?: string; stack?: string };
}

type ErrorFormatter = (opts: { shape: ErrorShape; error: { code: string } }) => ErrorShape;

/** Runs the errorFormatter of a generated init.ts, with isDev set as the build would set it. */
function generatedErrorFormatter(init: string, isDev: boolean): ErrorFormatter {
  const source = init.match(/errorFormatter: (\(\{ shape, error \}\) => \{[\s\S]*?\n {2}\}),\n\}\);/)?.[1];
  expect(source).toBeDefined();
  return new Function('isDev', `return (${source});`)(isDev) as ErrorFormatter;
}

const internalErrorShape = (): ErrorShape => ({
  message: "select * from users where email = 'leak@example.com'",
  code: -32603,
  data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'probe.fail', stack: 'Error: select * from users' },
});

/** The formatter of a generated init.ts hides internals outside development and keeps them in development. */
export function expectFormatterHidesInternals(init: string): void {
  expect(init).toContain(BUILD_TIME_DEV);
  expect(init).toContain('  isDev,');

  const production = generatedErrorFormatter(init, false);
  expect(production({ shape: internalErrorShape(), error: { code: 'INTERNAL_SERVER_ERROR' } })).toEqual({
    message: 'Internal server error',
    code: -32603,
    data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'probe.fail' },
  });
  const badRequest = production({
    shape: { message: 'Too small', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400, stack: 'Error: x' } },
    error: { code: 'BAD_REQUEST' },
  });
  expect(badRequest).toEqual({ message: 'Too small', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } });

  const development = generatedErrorFormatter(init, true);
  expect(development({ shape: internalErrorShape(), error: { code: 'INTERNAL_SERVER_ERROR' } })).toEqual(
    internalErrorShape(),
  );
}

const DEV_EXPRESSIONS = ['import.meta.env.DEV', "process.env.NODE_ENV === 'development'"];

type TrpcError = Error & { code: string };
type OnError = (opts: { path: string | undefined; error: TrpcError }) => void;

type Rethrow = (error: unknown) => void;

/**
 * Runs the onError of a generated tRPC server call site, with the development expression set as the runtime would
 * and `unstable_rethrow` (Next.js) bound to `rethrow`.
 */
function generatedOnError(
  handler: string,
  isDev: boolean,
  log: (...args: unknown[]) => void,
  rethrow: Rethrow = () => {},
): OnError {
  const source = handler.match(/onError: (\(\{ path, error \}\) => \{[\s\S]*?\n\s*\}),/)?.[1];
  expect(source).toBeDefined();
  const devExpression = DEV_EXPRESSIONS.find((expression) => source?.includes(expression));
  expect(devExpression).toBeDefined();
  const runnable = (source as string).replace(devExpression as string, 'isDev');
  return new Function('console', 'isDev', 'unstable_rethrow', `return (${runnable});`)(
    { error: log },
    isDev,
    rethrow,
  ) as OnError;
}

const trpcError = (code: string, message: string): TrpcError => Object.assign(new Error(message), { code });

/** The onError of a generated tRPC server call site always logs unexpected errors and logs the expected ones only in development. */
export function expectOnErrorLogsInternals(handler: string): void {
  const logged = (isDev: boolean, path: string | undefined, error: TrpcError): string[] => {
    const lines: string[] = [];
    generatedOnError(handler, isDev, (...args) => lines.push(format(...args)))({ path, error });
    return lines;
  };

  for (const isDev of [false, true]) {
    const error = trpcError('INTERNAL_SERVER_ERROR', "select * from users where email = 'a@b.c'");
    const lines = logged(isDev, 'user.list', error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tRPC failed on user.list');
    expect(lines[0]).toContain(error.message);
    expect(lines[0]).toContain(error.stack?.split('\n')[1]?.trim() ?? 'no stack');
  }

  expect(logged(false, 'user.me', trpcError('UNAUTHORIZED', 'UNAUTHORIZED'))).toEqual([]);
  expect(logged(false, undefined, trpcError('BAD_REQUEST', 'Too small'))).toEqual([]);
  expect(logged(true, 'user.me', trpcError('UNAUTHORIZED', 'UNAUTHORIZED'))).toEqual([
    'tRPC failed on user.me: UNAUTHORIZED',
  ]);
}

/** The onError of a generated Next.js server call site logs nothing for the errors `unstable_rethrow` hands back to the framework. */
export function expectOnErrorSkipsFrameworkErrors(handler: string): void {
  expect(handler).toContain("import { unstable_rethrow } from 'next/navigation';");

  const frameworkError = trpcError('INTERNAL_SERVER_ERROR', 'Dynamic server usage: used `headers`');
  const rethrowFrameworkError: Rethrow = (error) => {
    if (error === frameworkError) throw error;
  };
  const logged = (isDev: boolean, error: TrpcError): string[] => {
    const lines: string[] = [];
    generatedOnError(handler, isDev, (...args) => lines.push(format(...args)), rethrowFrameworkError)({
      path: 'user.list',
      error,
    });
    return lines;
  };

  for (const isDev of [false, true]) {
    expect(logged(isDev, frameworkError)).toEqual([]);
    expect(logged(isDev, trpcError('INTERNAL_SERVER_ERROR', 'connection refused'))).toHaveLength(1);
  }
}

const PRINTED_SCRIPT = /(?:cd ([\w/<>-]+) && )?(?:bun|npm|pnpm) run ([\w:-]+)(?![\w:/.-])/g;

async function scriptsOf(directory: string): Promise<Record<string, string>> {
  return (await readJsonFile<{ scripts: Record<string, string> }>(join(directory, 'package.json'))).scripts;
}

/**
 * The `<pm> run <script>` commands a document prints that no package.json defines: the one of the directory it
 * names with `cd <dir> &&` (the project root otherwise), or of any app for the `cd apps/<app> &&` placeholder.
 */
export async function printedScriptsMissingFrom(projectPath: string, document: string): Promise<string[]> {
  const missing: string[] = [];

  for (const [call, directory = '.', script = ''] of document.matchAll(PRINTED_SCRIPT)) {
    if (directory.includes('<app>')) {
      const apps = await readdir(join(projectPath, 'apps'));
      const appScripts = await Promise.all(apps.map((app) => scriptsOf(join(projectPath, 'apps', app))));
      if (!appScripts.some((scripts) => script in scripts)) missing.push(call);
    } else if (!(script in (await scriptsOf(join(projectPath, directory))))) {
      missing.push(call);
    }
  }

  return missing;
}

const ENTER = '\r';
const DOWN_THEN_ENTER = '\x1b[B\r';
const TERMINAL_RUN_TIMEOUT_MS = 60_000;

interface PromptAnswer {
  prompt: string;
  keys: string;
}

export const accept = (prompt: string): PromptAnswer => ({ prompt, keys: ENTER });
export const pickFirstOption = (prompt: string): PromptAnswer => ({ prompt, keys: DOWN_THEN_ENTER });

/** Runs the CLI on a pseudo-terminal and answers each expected prompt as it appears. */
export async function runCliOnTerminal(args: string[], cwd: string, expectedPrompts: PromptAnswer[]) {
  const cliPath = join(import.meta.dir, '../../src/index.ts');
  let output = '';

  const proc = Bun.spawn([process.execPath, 'run', cliPath, ...args], {
    cwd,
    env: { ...process.env, ...PLAIN_OUTPUT_ENV },
    terminal: {
      cols: 120,
      rows: 40,
      data: (_terminal, chunk) => {
        output += new TextDecoder().decode(chunk);
      },
    },
  });

  const runName = `create-faster ${args.join(' ')}`;
  const deadline = Date.now() + TERMINAL_RUN_TIMEOUT_MS;
  const timeoutMessage = (waitingFor: string) =>
    `"${runName}" did not ${waitingFor} within ${TERMINAL_RUN_TIMEOUT_MS} ms. Output:\n${output}`;

  try {
    let searchFrom = 0;
    for (const { prompt, keys } of expectedPrompts) {
      while (output.indexOf(prompt, searchFrom) === -1) {
        if (Date.now() > deadline) throw new Error(timeoutMessage(`show the prompt "${prompt}"`));
        await Bun.sleep(50);
      }
      searchFrom = output.length;
      await Bun.sleep(100);
      proc.terminal?.write(keys);
    }
    let stopWaiting = () => {};
    const deadlineReached = new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), Math.max(deadline - Date.now(), 0));
      stopWaiting = () => clearTimeout(timer);
    });
    const exitCode = await Promise.race([proc.exited, deadlineReached]);
    stopWaiting();
    if (exitCode === null) throw new Error(timeoutMessage('exit'));
    return { exitCode, output };
  } finally {
    proc.kill();
  }
}

/**
 * Writes a generated TypeScript file as an ES module and imports it. `imports` rewrites module specifiers to
 * paths relative to `target` (stand-ins for packages the test environment does not install). JSX of a `tsx`
 * file compiles to `createElement` and `Fragment` calls on the stand-in registered for `react`.
 */
export async function evaluateGeneratedModule<T>(
  source: string,
  target: string,
  imports: Record<string, string> = {},
  loader: 'ts' | 'tsx' = 'ts',
): Promise<T> {
  const jsx = { compilerOptions: { jsx: 'react', jsxFactory: '__jsx', jsxFragmentFactory: '__fragment' } } as const;
  const compiled = new Bun.Transpiler({ loader, tsconfig: jsx }).transformSync(source);
  const js =
    loader === 'tsx'
      ? `import { createElement as __jsx, Fragment as __fragment } from "react";\n${compiled}`
      : compiled;
  const rewritten = js.replace(/from\s+(["'])([^"']+)\1/g, (match, _quote, specifier: string) =>
    imports[specifier] ? `from "${imports[specifier]}"` : match,
  );
  await Bun.write(target, rewritten);
  return import(target);
}

/**
 * Source of a stand-in `react` module for `evaluateGeneratedModule` with the `tsx` loader: JSX compiles to
 * `createElement` calls that build `{ type, props }` objects, rendered by `renderElementTree`.
 */
export const REACT_ELEMENT_STUB = `export const Fragment = Symbol.for('fragment');
export const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });`;

export interface RenderedElement {
  tag: string;
  props: Record<string, unknown>;
  children: RenderedChild[];
}
export type RenderedChild = RenderedElement | string;

const isRenderedElement = (child: RenderedChild): child is RenderedElement => typeof child !== 'string';

/**
 * Renders the element objects `REACT_ELEMENT_STUB` builds into a tree of host elements and text: components
 * (functions, possibly async) are called with their props, fragments are flattened, and empty values are dropped.
 */
export async function renderElementTree(node: unknown): Promise<RenderedChild[]> {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) {
    const rendered: RenderedChild[] = [];
    for (const item of node) rendered.push(...(await renderElementTree(item)));
    return rendered;
  }
  const { type, props } = node as { type: unknown; props: Record<string, unknown> };
  if (typeof type === 'function') return renderElementTree(await (type as (props: unknown) => unknown)(props));
  const children = await renderElementTree(props.children);
  return typeof type === 'string' ? [{ tag: type, props, children }] : children;
}

/** Every element of a rendered tree, in document order. */
export function elementsOf(children: RenderedChild[]): RenderedElement[] {
  return children.filter(isRenderedElement).flatMap((element) => [element, ...elementsOf(element.children)]);
}

/** The text a screen reader reads: aria-hidden subtrees (icons) are skipped. */
export function textOf(child: RenderedChild): string {
  if (!isRenderedElement(child)) return child;
  return child.props['aria-hidden'] === 'true' ? '' : child.children.map(textOf).join('');
}
