import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CSRF_PROBE_PATH = '/api/csrf-probe';

// Test-only route. The page calls the server function so the build registers it; the counter lives on globalThis
// because the route and the server function handler are bundled as separate modules.
const csrfProbeRoute = `import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

const counter = globalThis as { csrfProbeCalls?: number };

const recordCall = createServerFn({ method: 'POST' }).handler(async () => {
  counter.csrfProbeCalls = (counter.csrfProbeCalls ?? 0) + 1;
  return counter.csrfProbeCalls;
});

export const Route = createFileRoute('${CSRF_PROBE_PATH}')({
  component: () => <button onClick={() => recordCall()}>record</button>,
  server: {
    handlers: {
      GET: () =>
        Response.json({ url: (recordCall as unknown as { url: string }).url, calls: counter.csrfProbeCalls ?? 0 }),
    },
  },
});
`;

export async function writeCsrfProbeRoute(appDir: string): Promise<void> {
  const routePath = join(appDir, 'src/routes', `${CSRF_PROBE_PATH}.tsx`);
  await mkdir(dirname(routePath), { recursive: true });
  await writeFile(routePath, csrfProbeRoute);
}

interface CsrfProbe {
  url: string;
  calls: number;
}

async function readCsrfProbe(appUrl: string): Promise<CsrfProbe> {
  const response = await fetch(new URL(CSRF_PROBE_PATH, appUrl));
  expect(response.status).toBe(200);
  return (await response.json()) as CsrfProbe;
}

async function callServerFn(appUrl: string, serverFnUrl: string, headers: Record<string, string>): Promise<Response> {
  return fetch(new URL(serverFnUrl, appUrl), { method: 'POST', headers: { 'x-tsr-serverFn': 'true', ...headers } });
}

export async function expectServerFnsRejectCrossSiteRequests(appUrl: string): Promise<void> {
  const { url: serverFnUrl } = await readCsrfProbe(appUrl);
  const callsBefore = (await readCsrfProbe(appUrl)).calls;

  const crossSite = await callServerFn(appUrl, serverFnUrl, {
    Origin: 'https://evil.example',
    'Sec-Fetch-Site': 'cross-site',
  });
  expect(crossSite.status).toBe(403);
  expect((await readCsrfProbe(appUrl)).calls).toBe(callsBefore);

  const sameOrigin = await callServerFn(appUrl, serverFnUrl, {
    Origin: new URL(appUrl).origin,
    'Sec-Fetch-Site': 'same-origin',
  });
  expect(sameOrigin.status).toBe(200);
  expect((await readCsrfProbe(appUrl)).calls).toBe(callsBefore + 1);
}
