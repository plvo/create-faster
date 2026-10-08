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

export interface RunningServer {
  url: string;
  stop: () => Promise<void>;
}

const SERVER_READY_TIMEOUT = 30_000;
const SERVER_POLL_INTERVAL = 250;

// bun test sets NODE_ENV=test; a user's shell does not, and builds depend on it.
function userShellEnv(): Record<string, string | undefined> {
  const { NODE_ENV: _testRunnerMode, ...env } = process.env;
  return env;
}

async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function isResponding(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function startServer(args: string[], cwd: string): Promise<RunningServer> {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(args, {
    cwd,
    env: { ...userShellEnv(), CI: '1', PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stop = async () => {
    proc.kill();
    await proc.exited;
  };

  const deadline = Date.now() + SERVER_READY_TIMEOUT;
  while (Date.now() < deadline && proc.exitCode === null) {
    if (await isResponding(url)) return { url, stop };
    await Bun.sleep(SERVER_POLL_INTERVAL);
  }

  await stop();
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
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
