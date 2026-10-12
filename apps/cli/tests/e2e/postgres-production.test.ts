import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type DatabaseContainer, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  getFreePort,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_SERVER = 120_000;
const SSL_REFUSED = 'The server does not support SSL connections';
// A copied local URL pointed at a remote host: `.invalid` never resolves, the warning comes first.
const REMOTE_URL_WITHOUT_TLS = 'postgresql://postgres:password@db.invalid:5432/postgres?sslmode=disable';
const REMOTE_TLS_WARNING = 'DATABASE_URL sets sslmode=disable for db.invalid in production';
const ANY_TLS_WARNING = 'DATABASE_URL sets sslmode=disable for';

type Orm = 'drizzle' | 'prisma';
type ProbedStack = 'nextjs' | 'tanstack-start' | 'hono';
type ServerMode = 'dev' | 'start';

interface ProbedApp {
  dir: string;
  stack: ProbedStack;
}

interface Topology {
  name: string;
  orm: Orm;
  args: string[];
  dbPackageDir: string;
  dbImport: string;
  apps: ProbedApp[];
}

interface DbQuery {
  imports: string;
  rows: string;
}

interface StackProbe {
  path: string;
  source: (dbImport: string, query: DbQuery) => string;
  command: Record<ServerMode, (port: number) => string[]>;
  readyPath: string;
}

interface ProbeResult {
  status: number;
  body: string;
  serverOutput: string;
}

// `select 1` through the generated client, which needs no schema.
const DB_QUERIES: Record<Orm, DbQuery> = {
  drizzle: { imports: 'db, sql', rows: '(await db.execute(sql`select 1 as ok`)).rows' },
  prisma: { imports: 'prisma', rows: 'await prisma.$queryRaw`select 1 as ok`' },
};

// Test-only routes: the generated apps have no route that queries the database.
const STACK_PROBES: Record<ProbedStack, StackProbe> = {
  nextjs: {
    path: 'src/app/api/db-probe/route.ts',
    source: (dbImport, { imports, rows }) => `import { ${imports} } from '${dbImport}';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ rows: ${rows} });
}
`,
    // The turborepo app scripts pin their own port, so next runs with the test's port.
    command: {
      dev: (port) => ['bunx', 'next', 'dev', '--port', String(port)],
      start: (port) => ['bunx', 'next', 'start', '--port', String(port)],
    },
    readyPath: '/',
  },
  'tanstack-start': {
    path: 'src/routes/api.db-probe.ts',
    source: (dbImport, { imports, rows }) => `import { createFileRoute } from '@tanstack/react-router'
import { ${imports} } from '${dbImport}'

export const Route = createFileRoute('/api/db-probe')({
  server: {
    handlers: {
      GET: async () => Response.json({ rows: ${rows} }),
    },
  },
})
`,
    command: {
      dev: (port) => ['bunx', 'vite', 'dev', '--port', String(port)],
      start: () => ['bun', 'run', 'start'],
    },
    readyPath: '/',
  },
  hono: {
    path: 'src/index.ts',
    source: (dbImport, { imports, rows }) => `import { ${imports} } from '${dbImport}';
import app from './app';

app.get('/api/db-probe', async (c) => c.json({ rows: ${rows} }));

export default app;
`,
    command: {
      dev: () => ['bun', 'run', 'dev'],
      start: () => ['bun', 'run', 'start'],
    },
    readyPath: '/health/1',
  },
};

const TURBO_APPS: ProbedApp[] = [
  { dir: 'apps/web', stack: 'nextjs' },
  { dir: 'apps/start', stack: 'tanstack-start' },
  { dir: 'apps/api', stack: 'hono' },
];
const TURBO_ARGS = ['--app', 'web:nextjs', '--app', 'start:tanstack-start', '--app', 'api:hono'];

const TOPOLOGIES: Topology[] = [
  {
    name: 'pg-prod-drizzle-next',
    orm: 'drizzle',
    args: ['--app', 'pg-prod-drizzle-next:nextjs'],
    dbPackageDir: '.',
    dbImport: '@/lib/db',
    apps: [{ dir: '.', stack: 'nextjs' }],
  },
  {
    name: 'pg-prod-drizzle-start',
    orm: 'drizzle',
    args: ['--app', 'pg-prod-drizzle-start:tanstack-start'],
    dbPackageDir: '.',
    dbImport: '@/lib/db',
    apps: [{ dir: '.', stack: 'tanstack-start' }],
  },
  {
    name: 'pg-prod-drizzle-turbo',
    orm: 'drizzle',
    args: TURBO_ARGS,
    dbPackageDir: 'packages/db',
    dbImport: '@repo/db',
    apps: TURBO_APPS,
  },
  {
    name: 'pg-prod-prisma-next',
    orm: 'prisma',
    args: ['--app', 'pg-prod-prisma-next:nextjs'],
    dbPackageDir: '.',
    dbImport: '@/lib/db',
    apps: [{ dir: '.', stack: 'nextjs' }],
  },
  {
    name: 'pg-prod-prisma-turbo',
    orm: 'prisma',
    args: TURBO_ARGS,
    dbPackageDir: 'packages/db',
    dbImport: '@repo/db',
    apps: TURBO_APPS,
  },
];

async function readGeneratedDatabaseUrl(envExamplePath: string): Promise<string> {
  const content = await readFile(envExamplePath, 'utf-8');
  const databaseUrl = content.match(/^DATABASE_URL="([^"]+)"/m)?.[1];
  if (!databaseUrl) throw new Error(`No DATABASE_URL in ${envExamplePath}`);
  return databaseUrl;
}

/** The generated URL pointed at the container: credentials and query string stay as generated. */
function pointAtContainer(generatedUrl: string, containerUrl: string): string {
  const url = new URL(generatedUrl);
  const container = new URL(containerUrl);
  url.host = container.host;
  url.pathname = container.pathname;
  return url.toString();
}

async function callDbProbe(appDir: string, app: ProbedApp, mode: ServerMode, databaseUrl: string): Promise<ProbeResult> {
  const probe = STACK_PROBES[app.stack];
  const port = await getFreePort();
  const server = await startServer(probe.command[mode](port), appDir, {
    port,
    readyPath: probe.readyPath,
    readyTimeout: TIMEOUT_SERVER,
    // No NODE_ENV here: each stack's own dev and start commands decide it.
    env: { PORT: String(port), DATABASE_URL: databaseUrl },
  });
  try {
    const response = await fetch(new URL('/api/db-probe', server.url));
    const body = await response.text();
    const { stdout, stderr } = await server.stop();
    return { status: response.status, body, serverOutput: `${stdout}\n${stderr}` };
  } finally {
    await server.stop();
  }
}

describeWithDocker('postgres production e2e').each(TOPOLOGIES)(
  '$name',
  ({ name, orm, args, dbPackageDir, dbImport, apps }) => {
    let tempDir: string;
    let projectDir: string;
    let localUrl: string;
    let postgres: DatabaseContainer;
    let installResult: CommandResult;

    beforeAll(async () => {
      tempDir = await createTempDir();
      const result = await runCli(
        [name, ...args, '--database', 'postgres', '--orm', orm, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      projectDir = join(tempDir, name);

      for (const app of apps) {
        const probe = STACK_PROBES[app.stack];
        const probePath = join(projectDir, app.dir, probe.path);
        await mkdir(dirname(probePath), { recursive: true });
        await writeFile(probePath, probe.source(dbImport, DB_QUERIES[orm]));
      }

      postgres = await startDatabase('postgres', 'postgres-production');
      const generatedUrl = await readGeneratedDatabaseUrl(join(projectDir, dbPackageDir, '.env.example'));
      localUrl = pointAtContainer(generatedUrl, postgres.connectionString);
      await writeFile(join(projectDir, dbPackageDir, '.env'), `DATABASE_URL="${localUrl}"\n`);

      installResult = await runCommand(['bun', 'install'], projectDir);
    }, TIMEOUT_INSTALL + 120_000);

    afterAll(async () => {
      if (postgres) await removeDatabase(postgres.name);
      if (tempDir) await cleanupTempDir(tempDir);
    });

    test(
      'installs dependencies',
      () => {
        expect(installResult.exitCode).toBe(0);
      },
      TIMEOUT_INSTALL,
    );

    if (orm === 'prisma') {
      test(
        'generates the Prisma client',
        async () => {
          const result = await runCommand(['bun', 'run', 'db:generate'], join(projectDir, dbPackageDir));
          expect(result.exitCode, result.stderr).toBe(0);
        },
        TIMEOUT_DB,
      );
    }

    test(
      'db:push applies the schema through the generated local DATABASE_URL',
      async () => {
        const push = ['bun', 'run', 'db:push', ...(orm === 'drizzle' ? ['--force'] : [])];
        const result = await runCommand(push, join(projectDir, dbPackageDir));
        expect(result.exitCode, result.stderr).toBe(0);
      },
      TIMEOUT_DB,
    );

    test.each(apps)(
      '$dir dev server queries the database through the generated local DATABASE_URL',
      async (app) => {
        const { status, body, serverOutput } = await callDbProbe(join(projectDir, app.dir), app, 'dev', localUrl);
        expect(status, `${body}\n${serverOutput}`).toBe(200);
        expect(JSON.parse(body)).toEqual({ rows: [{ ok: 1 }] });
      },
      TIMEOUT_SERVER,
    );

    test(
      'builds',
      async () => {
        const result = await runCommand(['bun', 'run', 'build'], projectDir);
        expect(result.exitCode, result.stderr).toBe(0);
      },
      TIMEOUT_BUILD,
    );

    test('the generated local DATABASE_URL disables TLS', () => {
      expect(new URL(localUrl).searchParams.get('sslmode')).toBe('disable');
    });

    test.each(apps)(
      '$dir production server reaches the non-TLS database: sslmode=disable in DATABASE_URL wins over the TLS default',
      async (app) => {
        const { status, body, serverOutput } = await callDbProbe(join(projectDir, app.dir), app, 'start', localUrl);
        expect(status, `${body}\n${serverOutput}`).toBe(200);
        expect(JSON.parse(body)).toEqual({ rows: [{ ok: 1 }] });
        expect(serverOutput).not.toContain(ANY_TLS_WARNING);
      },
      TIMEOUT_SERVER,
    );

    test.each(apps)(
      '$dir production server requires TLS by default: a DATABASE_URL without sslmode fails against the non-TLS database',
      async (app) => {
        const { status, serverOutput } = await callDbProbe(
          join(projectDir, app.dir),
          app,
          'start',
          postgres.connectionString,
        );
        expect(status).toBe(500);
        expect(serverOutput).toContain(SSL_REFUSED);
      },
      TIMEOUT_SERVER,
    );

    test.each(apps)(
      '$dir production server warns when DATABASE_URL disables TLS for a remote host',
      async (app) => {
        const { status, serverOutput } = await callDbProbe(join(projectDir, app.dir), app, 'start', REMOTE_URL_WITHOUT_TLS);
        expect(status).toBe(500);
        expect(serverOutput).toContain(REMOTE_TLS_WARNING);
      },
      TIMEOUT_SERVER,
    );
  },
);
