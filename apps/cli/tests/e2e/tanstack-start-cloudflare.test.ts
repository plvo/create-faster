import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectIngestProxiesToPostHog,
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
const TIMEOUT_PREVIEW = 90_000;

interface D1Probe {
  appDir: string;
  dbImport: string;
}

interface Scenario {
  name: string;
  args: string[];
  startAppDirs: string[];
  workerDirs: string[];
  d1Probe?: D1Probe;
  ingestProbe?: boolean;
}

const PROBE_ROUTE_PATH = '/api/d1-probe';
const PROBE_BURST = 20;

// No generated route imports src/lib/server.ts, so a build alone tree-shakes the module-scope db away.
// This route is test-only: it forces the db into the Worker bundle and queries it.
const probeRoute = (dbImport: string): string => `import { createFileRoute } from '@tanstack/react-router';
import { userTable } from '${dbImport}';
import { db } from '@/lib/server';

export const Route = createFileRoute('${PROBE_ROUTE_PATH}')({
  server: {
    handlers: {
      GET: async () => {
        await db.insert(userTable).values({ username: crypto.randomUUID(), email: \`\${crypto.randomUUID()}@example.com\` });
        const rows = await db.select().from(userTable);
        return Response.json({ count: rows.length });
      },
    },
  },
});
`;

async function expectProbeAnswers(url: string): Promise<void> {
  const responses = await Promise.all(
    Array.from({ length: PROBE_BURST }, () => fetch(new URL(PROBE_ROUTE_PATH, url))),
  );
  for (const response of responses) {
    expect(response.status).toBe(200);
    const body = (await response.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  }
}

const SCENARIOS: Scenario[] = [
  {
    name: 'tanstack-start-cloudflare',
    args: ['--app', 'tanstack-start-cloudflare:tanstack-start'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-d1',
    args: ['--app', 'tanstack-start-cloudflare-d1:tanstack-start', '--database', 'd1', '--orm', 'drizzle'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
    d1Probe: { appDir: '.', dbImport: '@/lib/db' },
  },
  {
    name: 'tanstack-start-cloudflare-postgres',
    args: ['--app', 'tanstack-start-cloudflare-postgres:tanstack-start', '--database', 'postgres', '--orm', 'drizzle'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-turborepo',
    args: ['--app', 'web:tanstack-start', '--app', 'admin:tanstack-start'],
    startAppDirs: ['apps/web', 'apps/admin'],
    workerDirs: ['apps/web', 'apps/admin'],
  },
  {
    name: 'tanstack-start-cloudflare-turborepo-d1',
    args: ['--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle'],
    startAppDirs: ['apps/web'],
    workerDirs: ['apps/web', 'apps/api'],
    d1Probe: { appDir: 'apps/web', dbImport: '@repo/db' },
  },
  {
    name: 'tanstack-start-cloudflare-posthog',
    args: ['--app', 'tanstack-start-cloudflare-posthog:tanstack-start:posthog,next-themes'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
    ingestProbe: true,
  },
];

describe.each(SCENARIOS)('$name', ({ name, args, startAppDirs, workerDirs, d1Probe, ingestProbe }) => {
  let projectDir: string;
  let installResult: CommandResult;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, ...args, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
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

  if (d1Probe) {
    test(
      'migrates the local D1 database with the generated scripts',
      async () => {
        const routePath = join(projectDir, d1Probe.appDir, 'src/routes', `${PROBE_ROUTE_PATH}.ts`);
        await mkdir(dirname(routePath), { recursive: true });
        await writeFile(routePath, probeRoute(d1Probe.dbImport));

        const generate = await runCommand(['bun', 'run', 'db:generate'], projectDir);
        expect(generate.exitCode).toBe(0);
        const migrate = await runCommand(['bun', 'run', 'db:migrate'], projectDir);
        expect(migrate.exitCode).toBe(0);
      },
      TIMEOUT_BUILD,
    );
  }

  test(
    'generates the worker types',
    async () => {
      for (const dir of startAppDirs) {
        const result = await runCommand(['bun', 'run', 'cf-typegen'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'wrangler deploy --dry-run succeeds',
    async () => {
      for (const dir of workerDirs) {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );

  test(
    'vite preview serves the built app in workerd (and answers a D1 query or proxies /ingest when selected)',
    async () => {
      for (const dir of startAppDirs) {
        const port = await getFreePort();
        const server = await startServer(['bunx', 'vite', 'preview', '--port', String(port)], join(projectDir, dir), {
          port,
        });
        servers.push(server);
        await expectServesPageWithClientScript(server.url);
        if (d1Probe?.appDir === dir) await expectProbeAnswers(server.url);
        if (ingestProbe) await expectIngestProxiesToPostHog(server.url);
      }
    },
    TIMEOUT_PREVIEW,
  );

  test(
    'type-checks',
    async () => {
      for (const dir of startAppDirs) {
        const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_TYPECHECK,
  );
});
