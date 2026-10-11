import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ServerOutput } from './helpers';

export type EvlogRuntime = 'nitro' | 'workerd';

interface WideEvent {
  path: string;
  errorMessage?: string;
  raw: string;
}

const EVENT_FLUSH_DELAY = 1_000;
const USE_LOGGER_FIELD = /probeLogger["']?:\s*["']from-use-logger["']/;

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
import { useLogger } from '@/lib/evlog';
import { probeFn } from '@/probe-fn';

export const Route = createFileRoute('/api/probe')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const kind = new URL(request.url).searchParams.get('kind');
        if (kind === 'rpc-url') return Response.json({ url: (probeFn as unknown as { url: string }).url });
        if (kind === 'use-logger') {
          useLogger().set({ probeLogger: 'from-use-logger' });
          return Response.json({ ok: true });
        }
        if (kind === 'evlog-error') throw createError({ message: 'payment required', status: 402, why: 'no card', fix: 'add a card' });
        throw new Error('route boom');
      },
    },
  },
});
`,
};

export async function writeEvlogProbe(appDir: string): Promise<void> {
  for (const [relativePath, content] of Object.entries(PROBE_FILES)) {
    const filePath = join(appDir, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

export async function exerciseEvlogProbe(baseUrl: string): Promise<void> {
  expect((await fetch(`${baseUrl}/`)).status).toBe(200);

  expect((await fetch(`${baseUrl}/api/probe?kind=route-error`)).status).toBe(500);

  const evlogError = await fetch(`${baseUrl}/api/probe?kind=evlog-error`);
  expect(evlogError.status).toBe(402);
  const body = (await evlogError.json()) as { message: string; data: { why: string; fix: string } };
  expect(body.message).toBe('payment required');
  expect(body.data).toEqual({ why: 'no card', fix: 'add a card' });

  expect((await fetch(`${baseUrl}/probe-loader`)).status).toBe(500);

  const { url: rpcUrl } = (await (await fetch(`${baseUrl}/api/probe?kind=rpc-url`)).json()) as { url: string };
  const rpc = await fetch(new URL(rpcUrl, baseUrl), {
    method: 'POST',
    headers: { 'x-tsr-serverFn': 'true', Origin: new URL(baseUrl).origin, 'Sec-Fetch-Site': 'same-origin' },
  });
  expect(rpc.status).toBe(200);
  expect(await rpc.text()).toContain('server fn boom');

  expect((await fetch(`${baseUrl}/api/probe?kind=use-logger`)).status).toBe(200);

  await Bun.sleep(EVENT_FLUSH_DELAY);
}

function parseNitroEvents(logs: string): WideEvent[] {
  return logs
    .split('\n')
    .filter((line) => line.startsWith('{"method"'))
    .map((line) => {
      const event = JSON.parse(line) as { path: string; error?: { message: string } };
      return { path: event.path, errorMessage: event.error?.message, raw: line };
    });
}

// workerd prints each event with util.inspect: top-level braces sit at column 0, nested ones are indented.
function parseWorkerdEvents(logs: string): WideEvent[] {
  const blocks = logs.replace(/\x1b\[[0-9;]*m/g, '').match(/^\{\n {2}method: [\s\S]*?^\}/gm) ?? [];
  return blocks.map((raw) => ({
    path: raw.match(/^ {2}path: '([^']+)'/m)?.[1] ?? '',
    errorMessage: raw.match(/^ {4}message: '([^']*)'/m)?.[1],
    raw,
  }));
}

export function expectEvlogProbeEvents(output: ServerOutput, runtime: EvlogRuntime, service: string): void {
  // Events at level error go to stderr, the others to stdout.
  const logs = `${output.stdout}\n${output.stderr}`;
  const events = runtime === 'nitro' ? parseNitroEvents(logs) : parseWorkerdEvents(logs);
  const on = (pathPrefix: string): WideEvent[] => events.filter((event) => event.path.startsWith(pathPrefix));

  expect(events.find((event) => event.path === '/')?.raw).toContain(service);

  const onApiProbe = on('/api/probe').map((event) => event.errorMessage);
  expect(onApiProbe).toContain('route boom');
  expect(onApiProbe).toContain('payment required');

  expect(on('/probe-loader').map((event) => event.errorMessage)).toContain('server fn boom');
  expect(on('/_serverFn/').map((event) => event.errorMessage)).toContain('server fn boom');
  expect(on('/api/probe').some((event) => USE_LOGGER_FIELD.test(event.raw))).toBe(true);
}
