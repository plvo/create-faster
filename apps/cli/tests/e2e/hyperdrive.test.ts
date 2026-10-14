import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type DatabaseContainer, type DatabaseEngine, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import { cleanupTempDir, createTempDir, getFreePort, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_WORKERD = 180_000;
const SEEDED_USERS = 2;

type Orm = 'drizzle' | 'prisma';
type Stack = 'hono' | 'nextjs' | 'tanstack-start';

const DATABASES: DatabaseEngine[] = ['postgres', 'mysql'];
const ORMS: Orm[] = ['drizzle', 'prisma'];

/** What a probe route asks the database per ORM, and what a healthy answer looks like. */
interface OrmProbe {
  imports: string[];
  /** Expression evaluated with `db` in scope, serialised as the response body. */
  query: string;
  /** Steps that create the schema and the seeded rows the query reads. */
  prepare(projectDir: string): Promise<void>;
  expectBody(body: unknown): void;
}

async function runPrismaSetup(projectDir: string): Promise<void> {
  for (const script of ['db:generate', 'db:push', 'db:seed']) {
    expect((await runCommand(['bun', 'run', script], projectDir)).exitCode, script).toBe(0);
  }
}

const PROBES: Record<Orm, OrmProbe> = {
  drizzle: {
    imports: ['createDb', 'sql'],
    query: 'await db.execute(sql`select 1 as ok`)',
    prepare: async () => {},
    expectBody: (body) => expect(JSON.stringify(body)).toContain('"ok":1'),
  },
  prisma: {
    imports: ['createDb'],
    query: '{ users: await db.user.count() }',
    prepare: runPrismaSetup,
    expectBody: (body) => expect(body).toEqual({ users: SEEDED_USERS }),
  },
};

async function generateProject(tempDir: string, name: string, stack: Stack, database: DatabaseEngine, orm: Orm): Promise<string> {
  const result = await runCli(
    [name, '--app', `${name}:${stack}`, '--database', database, '--orm', orm, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
    tempDir,
  );
  expect(result.exitCode).toBe(0);
  const projectDir = join(tempDir, name);
  expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);
  return projectDir;
}

async function pointAtContainer(projectDir: string, container: DatabaseContainer): Promise<void> {
  await writeFile(join(projectDir, '.env'), `DATABASE_URL="${container.connectionString}"\n`);
  const wranglerPath = join(projectDir, 'wrangler.jsonc');
  const wrangler = await readFile(wranglerPath, 'utf-8');
  await writeFile(wranglerPath, wrangler.replace(/"localConnectionString": "[^"]*"/, `"localConnectionString": "${container.connectionString}"`));
}

async function writeFileAt(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function addHonoProbe(projectDir: string, orm: Orm): Promise<void> {
  const { imports, query } = PROBES[orm];
  const appPath = join(projectDir, 'src/app.ts');
  const app = await readFile(appPath, 'utf-8');
  await writeFile(
    appPath,
    app
      .replace("import { timeout } from 'hono/timeout';", `import { timeout } from 'hono/timeout';\nimport { ${imports.join(', ')} } from '@/lib/db';`)
      .replace(
        'app.onError(',
        `app.get('/probe', async (c) => {
  const db = await createDb(c.env.HYPERDRIVE);
  return c.json(${query});
});

app.onError(`,
      ),
  );
}

async function addStartProbe(projectDir: string, orm: Orm): Promise<void> {
  const { imports, query } = PROBES[orm];
  await writeFileAt(
    join(projectDir, 'src/routes/api/probe.ts'),
    `import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { ${imports.join(', ')} } from '@/lib/db';

export const Route = createFileRoute('/api/probe')({
  server: {
    handlers: {
      GET: async () => {
        const db = await createDb(env.HYPERDRIVE);
        return Response.json(${query});
      },
    },
  },
});
`,
  );
}

async function expectProbeAnswer(command: string[], projectDir: string, path: string, orm: Orm): Promise<void> {
  const port = await getFreePort();
  const server = await startServer([...command, '--port', String(port)], projectDir, { port, readyPath: path, readyTimeout: TIMEOUT_WORKERD / 2 });
  try {
    const response = await fetch(new URL(path, server.url));
    expect(response.status).toBe(200);
    PROBES[orm].expectBody(await response.json());
  } finally {
    await server.stop();
  }
}

describeWithDocker('hono + hyperdrive local query e2e').each(ORMS.flatMap((orm) => DATABASES.map((database) => [orm, database] as const)))(
  'hono + cloudflare + %s + %s',
  (orm, database) => {
    const name = `hono-hd-${orm}-${database}`;
    let tempDir: string;
    let projectDir: string;
    let container: DatabaseContainer;

    beforeAll(async () => {
      container = await startDatabase(database, 'hono-hyperdrive');
      tempDir = await createTempDir();
      projectDir = await generateProject(tempDir, name, 'hono', database, orm);
      await pointAtContainer(projectDir, container);
      await PROBES[orm].prepare(projectDir);
      await addHonoProbe(projectDir, orm);
    }, TIMEOUT_INSTALL + 120_000);

    afterAll(async () => {
      if (container) await removeDatabase(container.name);
      if (tempDir) await cleanupTempDir(tempDir);
    });

    test(
      'type-checks against the generated Worker bindings',
      async () => {
        expect((await runCommand(['bunx', 'tsc', '--noEmit'], projectDir)).exitCode).toBe(0);
      },
      TIMEOUT_BUILD,
    );

    test(
      'wrangler deploy --dry-run bundles the Worker with the Hyperdrive binding',
      async () => {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('env.HYPERDRIVE');
      },
      TIMEOUT_BUILD,
    );

    test(
      'wrangler dev queries the database per request through the local connection string',
      async () => {
        await expectProbeAnswer(['bunx', 'wrangler', 'dev', '--ip', '127.0.0.1'], projectDir, '/probe', orm);
      },
      TIMEOUT_WORKERD,
    );
  },
);

describeWithDocker('full-stack frameworks + hyperdrive e2e').each(ORMS)('postgres + cloudflare + %s', (orm) => {
  let tempDir: string;
  let container: DatabaseContainer;

  beforeAll(async () => {
    container = await startDatabase('postgres', 'hyperdrive-fullstack');
    tempDir = await createTempDir();
  }, 120_000);

  afterAll(async () => {
    if (container) await removeDatabase(container.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  // `wrangler dev` of an OpenNext build answers 500 on every route (opennextjs-cloudflare#1355), so the type-check, the
  // build and the deployable bundle are the proof for Next.js.
  test(
    'nextjs: builds with OpenNext and the Worker bundle declares the Hyperdrive binding',
    async () => {
      const projectDir = await generateProject(tempDir, `next-hd-${orm}`, 'nextjs', 'postgres', orm);
      await pointAtContainer(projectDir, container);
      await PROBES[orm].prepare(projectDir);
      expect((await runCommand(['bunx', 'tsc', '--noEmit'], projectDir)).exitCode).toBe(0);
      expect((await runCommand(['bun', 'run', 'build:cf'], projectDir)).exitCode).toBe(0);
      const dryRun = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stdout).toContain('env.HYPERDRIVE');
    },
    TIMEOUT_INSTALL + TIMEOUT_BUILD * 2,
  );

  test(
    'tanstack-start: vite preview answers a query in workerd',
    async () => {
      const projectDir = await generateProject(tempDir, `start-hd-${orm}`, 'tanstack-start', 'postgres', orm);
      await pointAtContainer(projectDir, container);
      await PROBES[orm].prepare(projectDir);
      await addStartProbe(projectDir, orm);
      expect((await runCommand(['bun', 'run', 'build'], projectDir)).exitCode).toBe(0);
      await expectProbeAnswer(['bunx', 'vite', 'preview', '--host', '127.0.0.1'], projectDir, '/api/probe', orm);
    },
    TIMEOUT_INSTALL + TIMEOUT_BUILD + TIMEOUT_WORKERD,
  );
});
