import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type DatabaseContainer, type DatabaseEngine, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import { cleanupTempDir, createTempDir, getFreePort, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_WORKERD = 180_000;
const SEEDED_USERS = 2;

const DATABASES: DatabaseEngine[] = ['postgres', 'mysql'];

async function generateProject(tempDir: string, name: string, app: string, database: DatabaseEngine, typegenScript = 'cf-typegen'): Promise<string> {
  const result = await runCli(
    [name, '--app', app, '--database', database, '--orm', 'prisma', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
    tempDir,
  );
  expect(result.exitCode).toBe(0);
  const projectDir = join(tempDir, name);
  expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);
  expect((await runCommand(['bun', 'run', typegenScript], projectDir)).exitCode).toBe(0);
  return projectDir;
}

async function pointAtContainer(projectDir: string, container: DatabaseContainer): Promise<void> {
  await writeFile(join(projectDir, '.env'), `DATABASE_URL="${container.connectionString}"\n`);
  const wranglerPath = join(projectDir, 'wrangler.jsonc');
  const wrangler = await readFile(wranglerPath, 'utf-8');
  await writeFile(wranglerPath, wrangler.replace(/"localConnectionString": "[^"]*"/, `"localConnectionString": "${container.connectionString}"`));
}

async function generateAndSeed(projectDir: string): Promise<void> {
  expect((await runCommand(['bun', 'run', 'db:generate'], projectDir)).exitCode).toBe(0);
  expect((await runCommand(['bun', 'run', 'db:push'], projectDir)).exitCode).toBe(0);
  expect((await runCommand(['bun', 'run', 'db:seed'], projectDir)).exitCode).toBe(0);
}

async function writeFileAt(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describeWithDocker('prisma + hyperdrive query e2e').each(DATABASES)('hono + cloudflare + prisma + %s', (database) => {
  const name = `hono-prisma-${database}`;
  let tempDir: string;
  let projectDir: string;
  let container: DatabaseContainer;

  beforeAll(async () => {
    container = await startDatabase(database, 'prisma-hyperdrive-hono');
    tempDir = await createTempDir();
    projectDir = await generateProject(tempDir, name, `${name}:hono`, database);
    await pointAtContainer(projectDir, container);
    await generateAndSeed(projectDir);

    const appPath = join(projectDir, 'src/app.ts');
    const app = await readFile(appPath, 'utf-8');
    await writeFile(
      appPath,
      app
        .replace("import { timeout } from 'hono/timeout';", "import { timeout } from 'hono/timeout';\nimport { createDb } from '@/lib/db';")
        .replace(
          'app.onError(',
          `app.get('/probe', async (c) => {
  const db = await createDb(c.env.HYPERDRIVE);
  return c.json({ users: await db.user.count() });
});

app.onError(`,
        ),
    );
  }, TIMEOUT_INSTALL + 120_000);

  afterAll(async () => {
    if (container) await removeDatabase(container.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'type-checks against the generated Worker client',
    async () => {
      expect((await runCommand(['bunx', 'tsc', '--noEmit'], projectDir)).exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'wrangler deploy --dry-run bundles the Worker with the Prisma query compiler',
    async () => {
      const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('env.HYPERDRIVE');
    },
    TIMEOUT_BUILD,
  );

  test(
    'wrangler dev queries the seeded database per request through Hyperdrive',
    async () => {
      const port = await getFreePort();
      const server = await startServer(['bunx', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port)], projectDir, {
        port,
        readyPath: '/probe',
        readyTimeout: TIMEOUT_WORKERD / 2,
      });
      try {
        const response = await fetch(new URL('/probe', server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ users: SEEDED_USERS });
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_WORKERD,
  );
});

describeWithDocker('prisma + hyperdrive on the full-stack frameworks')('postgres + cloudflare + prisma', () => {
  let tempDir: string;
  let container: DatabaseContainer;

  beforeAll(async () => {
    container = await startDatabase('postgres', 'prisma-hyperdrive-fullstack');
    tempDir = await createTempDir();
  }, 120_000);

  afterAll(async () => {
    if (container) await removeDatabase(container.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  // `wrangler dev` of an OpenNext build answers 500 on every route (opennextjs-cloudflare#1355), so the build and the
  // deployable bundle are the proof for Next.js.
  test(
    'nextjs: builds with OpenNext and the Worker bundle ships the Prisma query compiler',
    async () => {
      const projectDir = await generateProject(tempDir, 'next-prisma-pg', 'web:nextjs', 'postgres', 'cf:typegen');
      await pointAtContainer(projectDir, container);
      expect((await runCommand(['bun', 'run', 'db:generate'], projectDir)).exitCode).toBe(0);
      expect((await runCommand(['bunx', 'tsc', '--noEmit'], projectDir)).exitCode).toBe(0);
      expect((await runCommand(['bun', 'run', 'build:cf'], projectDir)).exitCode).toBe(0);
      const dryRun = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stdout).toContain('env.HYPERDRIVE');
    },
    TIMEOUT_INSTALL + TIMEOUT_BUILD * 2,
  );

  test(
    'tanstack-start: vite preview answers a Prisma query in workerd',
    async () => {
      const projectDir = await generateProject(tempDir, 'start-prisma-pg', 'web:tanstack-start', 'postgres');
      await pointAtContainer(projectDir, container);
      await generateAndSeed(projectDir);
      await writeFileAt(
        join(projectDir, 'src/routes/api/probe.ts'),
        `import { createFileRoute } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import { createDb } from '@/lib/db';

export const Route = createFileRoute('/api/probe')({
  server: {
    handlers: {
      GET: async () => {
        const db = await createDb(env.HYPERDRIVE);
        return Response.json({ users: await db.user.count() });
      },
    },
  },
});
`,
      );
      expect((await runCommand(['bun', 'run', 'build'], projectDir)).exitCode).toBe(0);

      const port = await getFreePort();
      const server = await startServer(['bunx', 'vite', 'preview', '--port', String(port), '--host', '127.0.0.1'], projectDir, {
        port,
        readyPath: '/api/probe',
        readyTimeout: TIMEOUT_WORKERD / 2,
      });
      try {
        const response = await fetch(new URL('/api/probe', server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ users: SEEDED_USERS });
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_INSTALL + TIMEOUT_BUILD + TIMEOUT_WORKERD,
  );
});
