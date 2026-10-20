import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, relative, sep } from 'node:path';
import { format } from 'node:util';
import { expect, test } from 'bun:test';
import { $, Glob } from 'bun';
import { PLAIN_OUTPUT_ENV } from '../plain-output-env';
import { CTRL_C, DOWN, ENTER, runOnPseudoTerminal } from '../pseudo-terminal';

export const PNPM_AVAILABLE = Boolean(Bun.which('pnpm'));

/** A test that needs pnpm: skipped, and titled as such, when pnpm is not installed. */
export function pnpmTest(title: string, run: () => Promise<void>): void {
  test.skipIf(!PNPM_AVAILABLE)(PNPM_AVAILABLE ? title : `${title} (skipped: pnpm is not installed)`, run);
}

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

export async function runCli(args: string[], cwd: string, env?: Record<string, string>): Promise<CliResult> {
  const cliPath = join(import.meta.dir, '../../src/index.ts');

  try {
    const result = await $`${process.execPath} run ${cliPath} ${args} < /dev/null`
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

export interface TurboTask {
  dependsOn?: string[];
  cache?: boolean;
}

/** Generates a turborepo without git or install and reads its root scripts and `turbo.json` tasks. */
export async function generateTurborepo(tempDir: string, name: string, args: string[], pm = 'bun') {
  const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', pm], tempDir);
  expect(result.exitCode).toBe(0);
  const projectPath = join(tempDir, name);
  const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
  const turbo = await readJsonFile<{ tasks: Record<string, TurboTask> }>(join(projectPath, 'turbo.json'));
  return { projectPath, scripts: pkg.scripts, tasks: turbo.tasks };
}

/** Every marker appears in the text, each after the previous one. */
export function expectInOrder(text: string, markers: string[]): void {
  let from = 0;
  for (const marker of markers) {
    const at = text.indexOf(marker, from);
    expect(at, `"${marker}" after offset ${from}`).toBeGreaterThanOrEqual(0);
    from = at + marker.length;
  }
}

/** Whether any of the glob patterns matches the file path. */
export function matchesAny(patterns: string[], file: string): boolean {
  return patterns.some((pattern) => new Glob(pattern).match(file));
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

/** Whether a package.json `exports` key (`./components/*`) covers a subpath (`./components/ui/card`). */
export function matchesExportKey(key: string, subpath: string): boolean {
  if (!key.includes('*')) return key === subpath;
  const [prefix = '', suffix = ''] = key.split('*');
  return subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= prefix.length + suffix.length;
}

/** The target a package.json `exports` map gives a subpath, with its `*` filled in; undefined when none covers it. */
export function resolveExportTarget(exports: Record<string, string>, subpath: string): string | undefined {
  for (const [key, target] of Object.entries(exports)) {
    if (!matchesExportKey(key, subpath)) continue;
    const [prefix = '', suffix = ''] = key.split('*');
    return target.replace('*', subpath.slice(prefix.length, subpath.length - suffix.length));
  }
  return undefined;
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

const DOWN_THEN_ENTER = `${DOWN}${ENTER}`;

interface PromptAnswer {
  prompt: string;
  keys: string;
}

export const accept = (prompt: string): PromptAnswer => ({ prompt, keys: ENTER });
export const pickFirstOption = (prompt: string): PromptAnswer => ({ prompt, keys: DOWN_THEN_ENTER });
export const interrupt = (prompt: string): PromptAnswer => ({ prompt, keys: CTRL_C });

/** Runs the CLI on a pseudo-terminal and answers each expected prompt as it appears. */
export function runCliOnTerminal(
  args: string[],
  cwd: string,
  expectedPrompts: PromptAnswer[],
  env?: Record<string, string>,
): ReturnType<typeof runOnPseudoTerminal> {
  const cliPath = join(import.meta.dir, '../../src/index.ts');
  return runOnPseudoTerminal([process.execPath, 'run', cliPath, ...args], cwd, expectedPrompts, { env });
}

/**
 * Writes a generated TypeScript file as an ES module and imports it. `imports` rewrites module specifiers to
 * paths relative to `target` (stand-ins for packages the test environment does not install). JSX of a `tsx`
 * file compiles to `createElement` and `Fragment` calls on the stand-in registered for `react`. `define` replaces
 * expressions at transpile time (`process.env.NODE_ENV`, which Bun otherwise inlines with the value of the test run).
 */
export async function evaluateGeneratedModule<T>(
  source: string,
  target: string,
  imports: Record<string, string> = {},
  loader: 'ts' | 'tsx' = 'ts',
  define: Record<string, string> = {},
): Promise<T> {
  const jsx = { compilerOptions: { jsx: 'react', jsxFactory: '__jsx', jsxFragmentFactory: '__fragment' } } as const;
  const compiled = new Bun.Transpiler({ loader, tsconfig: jsx, define }).transformSync(source);
  const js =
    loader === 'tsx'
      ? `import { createElement as __jsx, Fragment as __fragment } from "react";\n${compiled}`
      : compiled;
  const rewritten = js.replace(/(from|import)\s*(["'])([^"']+)\2/g, (match, keyword: string, _quote, specifier: string) =>
    imports[specifier] ? `${keyword} "${imports[specifier]}"` : match,
  );
  await Bun.write(target, rewritten);
  return import(target);
}

interface EvaluatedNextConfig {
  output?: string;
  images?: { unoptimized?: boolean };
}

/**
 * Evaluates a generated `next.config.ts` the way `next dev` (`development`) and `next build` (`production`) load it,
 * with the MDX plugin as a pass-through. Each call writes the module to its own directory under `directory`, so each
 * load is fresh.
 */
export async function evaluateNextConfig(
  source: string,
  directory: string,
  nodeEnv: 'development' | 'production',
): Promise<EvaluatedNextConfig> {
  const workDirectory = await mkdtemp(join(directory, 'next-config-'));
  const mdxPlugin = join(workDirectory, 'mdx-plugin.mjs');
  await Bun.write(mdxPlugin, 'export default () => (config) => config;');
  const module = await evaluateGeneratedModule<{ default: EvaluatedNextConfig }>(
    source,
    join(workDirectory, 'next.config.mjs'),
    { '@next/mdx': mdxPlugin },
    'ts',
    { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
  );
  return module.default;
}

/**
 * Source of a stand-in `react` module for `evaluateGeneratedModule` with the `tsx` loader: JSX compiles to
 * `createElement` calls that build `{ type, props }` objects, rendered by `renderElementTree`.
 */
export const REACT_ELEMENT_STUB = `export const Fragment = Symbol.for('fragment');
export const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });`;

/**
 * Source of a stand-in `react` module with the hooks a generated component calls, on top of `REACT_ELEMENT_STUB`.
 * Hook state lives in slots read in call order, like React's: `resetState` starts from nothing, `beginRender` starts
 * a re-render that keeps the slots, and effects wait for `flushEffects`, as React runs them after a commit.
 * `globalThis.__serverRender` makes `useSyncExternalStore` answer with the server snapshot, and the subscribe
 * functions it receives are pushed to `globalThis.__subscriptions` when a test sets that array.
 */
export const REACT_HOOKS_STUB = `${REACT_ELEMENT_STUB}
let slots = [];
let next = 0;
let effects = [];
export const beginRender = () => { next = 0; };
export const resetState = () => { slots = []; next = 0; effects = []; };
export const flushEffects = () => { const pending = effects; effects = []; for (const effect of pending) effect(); };
export const useState = (initial) => {
  const store = slots;
  const index = next++;
  if (!(index in store)) store[index] = initial;
  return [store[index], (value) => { store[index] = typeof value === 'function' ? value(store[index]) : value; }];
};
export const useRef = (initial) => {
  const index = next++;
  if (!(index in slots)) slots[index] = { current: initial };
  return slots[index];
};
export const useEffect = (effect) => { effects.push(effect); };
export const useSyncExternalStore = (subscribe, getSnapshot, getServerSnapshot) => {
  globalThis.__subscriptions?.push(subscribe);
  return globalThis.__serverRender ? getServerSnapshot() : getSnapshot();
};
export const cache = (fn) => fn;
export const Suspense = ({ children }) => children[0];
export default { useState, useRef, useEffect, useSyncExternalStore, createElement, Fragment };`;

/** Every file under a directory, recursively, as absolute paths. */
export async function filesUnder(root: string, skippedDirectories: readonly string[] = []): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const isSkipped = (entry: { parentPath: string }) =>
    relative(root, entry.parentPath)
      .split(sep)
      .some((segment) => skippedDirectories.includes(segment));
  return entries.filter((entry) => entry.isFile() && !isSkipped(entry)).map((entry) => join(entry.parentPath, entry.name));
}

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
