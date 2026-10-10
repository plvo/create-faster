import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  type ServerOutput,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_SERVE = 120_000;
const EVENT_FLUSH_DELAY = 1_000;

interface Scenario {
  name: string;
  args: string[];
  runtime: 'nitro' | 'workerd';
}

interface WideEvent {
  path: string;
  errorMessage?: string;
  raw: string;
}

const SCENARIOS: Scenario[] = [
  { name: 'tanstack-start-evlog-nitro', args: [], runtime: 'nitro' },
  { name: 'tanstack-start-evlog-workers', args: ['--deployment', 'cloudflare'], runtime: 'workerd' },
];

// Test-only files: the generated app has no server function nor failing route to observe.
const PROBE_FILES: Record<string, string> = {
  'src/probe-fn.ts': `import { createServerFn } from '@tanstack/react-start';

export const probeFn = createServerFn({ method: 'POST' }).handler(async () => {
  throw new Error('server fn boom');
});
`,
  // The click handler keeps probeFn in the client manifest, which is what makes it callable over RPC.
  'src/routes/probe-rpc.tsx': `import { createFileRoute } from '@tanstack/react-router';
import { probeFn } from '@/probe-fn';

export const Route = createFileRoute('/probe-rpc')({
  component: () => (
    <button type="button" onClick={() => probeFn()}>
      call
    </button>
  ),
});
`,
  'src/routes/probe-loader.tsx': `import { createFileRoute } from '@tanstack/react-router';
import { probeFn } from '@/probe-fn';

export const Route = createFileRoute('/probe-loader')({
  loader: () => probeFn(),
  component: () => <div>unreachable</div>,
});
`,
  'src/routes/api/probe.ts': `import { createFileRoute } from '@tanstack/react-router';
import { createError } from 'evlog';
import { probeFn } from '@/probe-fn';

export const Route = createFileRoute('/api/probe')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kind = new URL(request.url).searchParams.get('kind');
        if (kind === 'rpc-url') return Response.json({ url: (probeFn as unknown as { url: string }).url });
        if (kind === 'evlog-error') throw createError({ message: 'payment required', status: 402, why: 'no card', fix: 'add a card' });
        throw new Error('route boom');
      },
    },
  },
});
`,
};

const WORKERS_ONLY_PROBE_FILES: Record<string, string> = {
  'src/routes/api/probe-logger.ts': `import { createFileRoute } from '@tanstack/react-router';
import { useLogger } from '@/lib/evlog';

export const Route = createFileRoute('/api/probe-logger')({
  server: {
    handlers: {
      GET: async () => {
        useLogger().set({ probeLogger: 'from-async-local-storage' });
        return Response.json({ ok: true });
      },
    },
  },
});
`,
};

function parseNitroEvents(stdout: string): WideEvent[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{"method"'))
    .map((line) => {
      const event = JSON.parse(line) as { path: string; error?: { message: string } };
      return { path: event.path, errorMessage: event.error?.message, raw: line };
    });
}

// workerd prints each event with util.inspect: top-level braces sit at column 0, nested ones are indented.
function parseWorkerdEvents(stdout: string): WideEvent[] {
  const blocks = stdout.replace(/\x1b\[[0-9;]*m/g, '').match(/^\{\n {2}method: [\s\S]*?^\}/gm) ?? [];
  return blocks.map((raw) => ({
    path: raw.match(/^ {2}path: '([^']+)'/m)?.[1] ?? '',
    errorMessage: raw.match(/^ {4}message: '([^']*)'/m)?.[1],
    raw,
  }));
}

function eventsFor(output: ServerOutput, runtime: Scenario['runtime'], pathPrefix: string): WideEvent[] {
  // Events at level error go to stderr, the others to stdout.
  const logs = `${output.stdout}\n${output.stderr}`;
  const events = runtime === 'nitro' ? parseNitroEvents(logs) : parseWorkerdEvents(logs);
  return events.filter((event) => event.path.startsWith(pathPrefix));
}

describe.each(SCENARIOS)('$name', ({ name, args, runtime }) => {
  let projectDir: string;
  let installResult: CommandResult;
  let server: RunningServer | undefined;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, '--app', `${name}:tanstack-start:evlog`, ...args, '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds with the probe routes',
    async () => {
      const files = { ...PROBE_FILES, ...(runtime === 'workerd' && WORKERS_ONLY_PROBE_FILES) };
      for (const [relativePath, content] of Object.entries(files)) {
        const filePath = join(projectDir, relativePath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content);
      }
      if (runtime === 'workerd') {
        const typegen = await runCommand(['bun', 'run', 'cf-typegen'], projectDir);
        expect(typegen.exitCode).toBe(0);
      }
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  if (runtime === 'workerd') {
    test(
      'wrangler deploy --dry-run bundles the custom server entry',
      async () => {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_DEPLOY_DRY_RUN,
    );
  }

  test(
    'puts requests and errors on the wide events',
    async () => {
      const port = await getFreePort();
      server =
        runtime === 'nitro'
          ? await startServer(['bun', 'run', 'start'], projectDir)
          : await startServer(['bunx', 'vite', 'preview', '--port', String(port)], projectDir, { port });
      const base = server.url;

      expect((await fetch(`${base}/`)).status).toBe(200);

      const route = await fetch(`${base}/api/probe?kind=route-error`);
      expect(route.status).toBe(500);

      const evlogError = await fetch(`${base}/api/probe?kind=evlog-error`);
      expect(evlogError.status).toBe(402);
      const body = (await evlogError.json()) as { message: string; data: { why: string; fix: string } };
      expect(body.message).toBe('payment required');
      expect(body.data).toEqual({ why: 'no card', fix: 'add a card' });

      const loader = await fetch(`${base}/probe-loader`);
      expect(loader.status).toBe(500);

      const { url: rpcUrl } = (await (await fetch(`${base}/api/probe?kind=rpc-url`)).json()) as { url: string };
      const rpc = await fetch(new URL(rpcUrl, base), { method: 'POST', headers: { 'x-tsr-serverFn': 'true' } });
      expect(rpc.status).toBe(200);
      expect(await rpc.text()).toContain('server fn boom');

      if (runtime === 'workerd') {
        expect((await fetch(`${base}/api/probe-logger`)).status).toBe(200);
      }

      await Bun.sleep(EVENT_FLUSH_DELAY);
      const output = await server.stop();
      server = undefined;

      const home = eventsFor(output, runtime, '/').find((event) => event.path === '/');
      expect(home?.raw).toContain(name);

      const onApiProbe = eventsFor(output, runtime, '/api/probe').map((event) => event.errorMessage);
      expect(onApiProbe).toContain('route boom');
      expect(onApiProbe).toContain('payment required');

      const onLoader = eventsFor(output, runtime, '/probe-loader').map((event) => event.errorMessage);
      expect(onLoader).toContain('server fn boom');

      const onRpc = eventsFor(output, runtime, '/_serverFn/').map((event) => event.errorMessage);
      expect(onRpc).toContain('server fn boom');

      if (runtime === 'workerd') {
        const onLogger = eventsFor(output, runtime, '/api/probe-logger');
        expect(onLogger[0]?.raw).toContain("probeLogger: 'from-async-local-storage'");
      }
    },
    TIMEOUT_SERVE,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );
});
