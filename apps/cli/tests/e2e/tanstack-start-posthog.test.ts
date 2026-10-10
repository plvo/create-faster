import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_SERVE = 90_000;

const POSTHOG_FLAGS_URL = 'https://us.i.posthog.com/flags/?v=2';
const FLAGS_BODY = JSON.stringify({ api_key: 'phc_create_faster_e2e_fake_token', distinct_id: 'e2e' });

// Needs outbound access to PostHog: the proxy is only proven by reaching the real upstream.
async function expectProxiesToPostHog(url: string): Promise<void> {
  const asset = await fetch(new URL('/ingest/static/array.js', url));
  expect(asset.status).toBe(200);
  expect(asset.headers.get('content-type')).toContain('javascript');
  expect((await asset.text()).length).toBeGreaterThan(10_000);

  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: FLAGS_BODY };
  const direct = await fetch(POSTHOG_FLAGS_URL, init);
  const proxied = await fetch(new URL('/ingest/flags/?v=2', url), init);
  expect(direct.status).toBe(401);
  expect(proxied.status).toBe(direct.status);
  expect(await proxied.json()).toEqual(await direct.json());
}

interface Scenario {
  name: string;
  args: string[];
  serve: (port: number) => string[];
  onCloudflare: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'tanstack-start-posthog-nitro',
    args: ['--app', 'tanstack-start-posthog-nitro:tanstack-start:posthog,next-themes,evlog'],
    serve: () => ['bun', 'run', 'start'],
    onCloudflare: false,
  },
  {
    name: 'tanstack-start-posthog-cloudflare',
    args: ['--app', 'tanstack-start-posthog-cloudflare:tanstack-start:posthog,next-themes', '--deployment', 'cloudflare'],
    serve: (port) => ['bunx', 'vite', 'preview', '--port', String(port)],
    onCloudflare: true,
  },
];

describe.each(SCENARIOS)('$name', ({ name, args, serve, onCloudflare }) => {
  let projectDir: string;
  let installResult: CommandResult;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
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
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  if (onCloudflare) {
    test(
      'wrangler deploy --dry-run succeeds',
      async () => {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_DEPLOY_DRY_RUN,
    );
  }

  test(
    'serves the page and proxies /ingest to PostHog',
    async () => {
      const port = await getFreePort();
      const server = await startServer(serve(port), projectDir, onCloudflare ? { port } : {});
      servers.push(server);
      await expectServesPageWithClientScript(server.url);
      await expectProxiesToPostHog(server.url);
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
