import { expect } from 'bun:test';
import { type AddressInfo, createServer } from 'node:net';
import { $ } from 'bun';

export type { CliResult } from '../integration/helpers';
export { cleanupTempDir, createTempDir, fileExists, runCli } from '../integration/helpers';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ServerOutput {
  stdout: string;
  stderr: string;
}

export interface RunningServer {
  url: string;
  stop: () => Promise<ServerOutput>;
}

const SERVER_READY_TIMEOUT = 30_000;
const SERVER_POLL_INTERVAL = 250;
const SERVER_PROBE_TIMEOUT = 2_000;

// bun test sets NODE_ENV=test; a user's shell does not, and builds depend on it.
function userShellEnv(): Record<string, string | undefined> {
  const { NODE_ENV: _testRunnerMode, ...env } = process.env;
  return env;
}

export async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function isPortFree(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise<boolean>((resolve) => {
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function isResponding(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SERVER_PROBE_TIMEOUT) });
    return response.ok;
  } catch {
    return false;
  }
}

export interface StartServerOptions {
  /** Port the server must pick by itself. Without it, a free port is handed over through PORT. */
  port?: number;
  readyTimeout?: number;
  env?: Record<string, string>;
}

export async function startServer(
  args: string[],
  cwd: string,
  { port: ownPort, readyTimeout = SERVER_READY_TIMEOUT, env: extraEnv = {} }: StartServerOptions = {},
): Promise<RunningServer> {
  if (ownPort !== undefined && !(await isPortFree(ownPort))) {
    throw new Error(`Port ${ownPort} is already in use, so the server's own port cannot be tested`);
  }

  const port = ownPort ?? (await getFreePort());
  const url = `http://127.0.0.1:${port}`;
  const env = { ...userShellEnv(), CI: '1', ...(ownPort === undefined && { PORT: String(port) }), ...extraEnv };
  // detached makes the command a process group leader, so stop() also reaches the server behind a wrapper like `bun run`.
  const proc = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe', detached: true });
  const output = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(
    ([stdout, stderr]) => ({ stdout, stderr }),
  );

  const stop = async (): Promise<ServerOutput> => {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // the process group is already gone
    }
    await proc.exited;
    return output;
  };

  const deadline = Date.now() + readyTimeout;
  while (Date.now() < deadline && proc.exitCode === null) {
    if (await isResponding(url)) return { url, stop };
    await Bun.sleep(SERVER_POLL_INTERVAL);
  }

  const { stdout, stderr } = await stop();
  throw new Error(`Server "${args.join(' ')}" never answered on ${url}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

export async function expectServesPageWithClientScript(url: string): Promise<void> {
  const page = await fetch(url);
  expect(page.status).toBe(200);

  const scriptPath = (await page.text()).match(/"(\/assets\/[^"]+\.js)"/)?.[1] ?? '';
  expect(scriptPath).toStartWith('/assets/');

  const script = await fetch(new URL(scriptPath, url));
  expect(script.status).toBe(200);
  expect(script.headers.get('content-type')).toContain('javascript');
}

export async function runCommand(args: string[], cwd: string): Promise<CommandResult> {
  try {
    const result = await $`${args}`
      .cwd(cwd)
      .env({ ...userShellEnv(), CI: '1', NEXT_TELEMETRY_DISABLED: '1' })
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

const POSTHOG_FLAGS_URL = 'https://us.i.posthog.com/flags/?v=2';
const POSTHOG_EVENT_URL = 'https://us.i.posthog.com/e/';
const FAKE_TOKEN = 'phc_create_faster_e2e_fake_token';

interface Ingestion {
  path: string;
  headers: Record<string, string>;
  body: BodyInit;
  directUrl: string;
}

const eventPayload = JSON.stringify({ api_key: FAKE_TOKEN, event: 'e2e', distinct_id: 'e2e' });

const INGESTIONS: Ingestion[] = [
  {
    path: '/ingest/flags/?v=2',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: FAKE_TOKEN, distinct_id: 'e2e' }),
    directUrl: POSTHOG_FLAGS_URL,
  },
  {
    path: '/ingest/e/',
    headers: { 'content-type': 'text/plain' },
    body: eventPayload,
    directUrl: POSTHOG_EVENT_URL,
  },
  {
    path: '/ingest/e/?compression=gzip-js',
    headers: { 'content-type': 'text/plain' },
    body: Bun.gzipSync(eventPayload) as BodyInit,
    directUrl: `${POSTHOG_EVENT_URL}?compression=gzip-js`,
  },
];

async function snapshot(response: Response): Promise<{ status: number; body: string }> {
  return { status: response.status, body: await response.text() };
}

// Needs outbound access to PostHog: the proxy is only proven by reaching the real upstream.
export async function expectIngestProxiesToPostHog(appUrl: string): Promise<void> {
  const asset = await fetch(new URL('/ingest/static/array.js', appUrl));
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toContain('javascript');
  expect((await asset.text()).length).toBeGreaterThan(10_000);

  for (const { path, headers, body, directUrl } of INGESTIONS) {
    const init = { method: 'POST', headers, body };
    const direct = await snapshot(await fetch(directUrl, init));
    const proxied = await snapshot(await fetch(new URL(path, appUrl), init));
    expect(proxied).toEqual(direct);
  }
}
