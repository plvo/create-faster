import { expect } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const NODE_ENV_PROBE_PATH = '/api/node-env-probe';

// Test-only route. The build replaces a literal `process.env.NODE_ENV`, so the probe copies `process.env`
// first: that is how a server dependency left external, or code reading the variable dynamically, sees it.
const nodeEnvProbeRoute = `import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('${NODE_ENV_PROBE_PATH}')({
  server: {
    handlers: {
      GET: () => Response.json({ nodeEnv: Object.fromEntries(Object.entries(process.env)).NODE_ENV ?? null }),
    },
  },
});
`;

export async function writeNodeEnvProbeRoute(appDir: string): Promise<void> {
  const routePath = join(appDir, 'src/routes', `${NODE_ENV_PROBE_PATH}.ts`);
  await mkdir(dirname(routePath), { recursive: true });
  await writeFile(routePath, nodeEnvProbeRoute);
}

export async function expectServerNodeEnv(url: string, expected: 'production' | 'development'): Promise<void> {
  const response = await fetch(new URL(NODE_ENV_PROBE_PATH, url));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ nodeEnv: expected });
}
