import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  getFreePort,
  runCli,
  runCommand,
  startServer,
} from './helpers';
import { describeWithDocker, type PostgresContainer, removePostgres, startPostgres } from './postgres-container';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_START = 60_000;

const CONTAINER_LABEL = 'create-faster-e2e=postgres-production';

type ProbedStack = 'nextjs' | 'tanstack-start';

interface ProbedApp {
  dir: string;
  stack: ProbedStack;
}

interface Topology {
  name: string;
  args: string[];
  dbPackageDir: string;
  dbImport: string;
  apps: ProbedApp[];
}

interface DbProbe {
  path: string;
  source: (dbImport: string) => string;
  start: (port: number) => string[];
}

// Test-only routes: the generated apps have no route that queries the database.
const DB_PROBES: Record<ProbedStack, DbProbe> = {
  nextjs: {
    path: 'src/app/api/db-probe/route.ts',
    source: (dbImport) => `import { db, sql } from '${dbImport}';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await db.execute(sql\`select 1 as ok\`);
  return Response.json({ rows });
}
`,
    // The turborepo start script pins its own port, so next start runs with the test's port instead.
    start: (port) => ['bunx', 'next', 'start', '--port', String(port)],
  },
  'tanstack-start': {
    path: 'src/routes/api.db-probe.ts',
    source: (dbImport) => `import { createFileRoute } from '@tanstack/react-router'
import { db, sql } from '${dbImport}'

export const Route = createFileRoute('/api/db-probe')({
  server: {
    handlers: {
      GET: async () => {
        const { rows } = await db.execute(sql\`select 1 as ok\`)
        return Response.json({ rows })
      },
    },
  },
})
`,
    start: () => ['bun', 'run', 'start'],
  },
};

const TOPOLOGIES: Topology[] = [
  {
    name: 'pg-prod-nextjs',
    args: ['--app', 'pg-prod-nextjs:nextjs'],
    dbPackageDir: '.',
    dbImport: '@/lib/db',
    apps: [{ dir: '.', stack: 'nextjs' }],
  },
  {
    name: 'pg-prod-start',
    args: ['--app', 'pg-prod-start:tanstack-start'],
    dbPackageDir: '.',
    dbImport: '@/lib/db',
    apps: [{ dir: '.', stack: 'tanstack-start' }],
  },
  {
    name: 'pg-prod-turbo',
    args: ['--app', 'web:nextjs', '--app', 'start:tanstack-start'],
    dbPackageDir: 'packages/db',
    dbImport: '@repo/db',
    apps: [
      { dir: 'apps/web', stack: 'nextjs' },
      { dir: 'apps/start', stack: 'tanstack-start' },
    ],
  },
];

async function readGeneratedDatabaseUrl(envExamplePath: string): Promise<string> {
  const content = await readFile(envExamplePath, 'utf-8');
  const databaseUrl = content.match(/^DATABASE_URL="([^"]+)"/m)?.[1];
  if (!databaseUrl) throw new Error(`No DATABASE_URL in ${envExamplePath}`);
  return databaseUrl;
}

describeWithDocker('postgres production').each(TOPOLOGIES)('$name', ({ name, args, dbPackageDir, dbImport, apps }) => {
  let tempDir: string;
  let projectDir: string;
  let databaseUrl: string;
  let postgres: PostgresContainer;
  let installResult: CommandResult;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [name, ...args, '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, name);

    for (const app of apps) {
      const probe = DB_PROBES[app.stack];
      const probePath = join(projectDir, app.dir, probe.path);
      await mkdir(dirname(probePath), { recursive: true });
      await writeFile(probePath, probe.source(dbImport));
    }

    databaseUrl = await readGeneratedDatabaseUrl(join(projectDir, dbPackageDir, '.env.example'));
    const { port, pathname } = new URL(databaseUrl);
    postgres = await startPostgres({ label: CONTAINER_LABEL, port: Number(port), database: pathname.slice(1) });

    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 60_000);

  afterAll(async () => {
    if (postgres) await removePostgres(postgres.name);
    if (tempDir) await cleanupTempDir(tempDir);
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
      expect(result.exitCode, result.stderr).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test.each(apps)(
    '$dir production server queries the local database through the generated DATABASE_URL',
    async ({ dir, stack }) => {
      const port = await getFreePort();
      const server = await startServer(DB_PROBES[stack].start(port), join(projectDir, dir), {
        port,
        // A deployed server runs with NODE_ENV=production, whether or not its start script sets it.
        env: { PORT: String(port), DATABASE_URL: databaseUrl, NODE_ENV: 'production' },
      });
      try {
        const response = await fetch(new URL('/api/db-probe', server.url));
        const body = await response.text();
        const serverOutput = response.ok ? '' : JSON.stringify(await server.stop(), null, 2);
        expect(response.status, `${body}\n${serverOutput}`).toBe(200);
        expect(JSON.parse(body)).toEqual({ rows: [{ ok: 1 }] });
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );
});
