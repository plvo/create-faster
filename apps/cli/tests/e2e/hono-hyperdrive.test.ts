import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DatabaseContainer, type DatabaseEngine, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import { cleanupTempDir, createTempDir, getFreePort, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_WRANGLER_DEV = 180_000;

const DATABASES: DatabaseEngine[] = ['postgres', 'mysql'];

describeWithDocker('hono + hyperdrive local query e2e').each(DATABASES)('hono + cloudflare + %s', (database) => {
  const name = `hono-hd-${database}`;
  let tempDir: string;
  let projectDir: string;
  let container: DatabaseContainer;

  beforeAll(async () => {
    container = await startDatabase(database, 'hono-hyperdrive');
    tempDir = await createTempDir();
    const result = await runCli(
      [name, '--app', `${name}:hono`, '--database', database, '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);
    expect((await runCommand(['bun', 'run', 'cf-typegen'], projectDir)).exitCode).toBe(0);
  }, TIMEOUT_INSTALL + 90_000);

  afterAll(async () => {
    if (container) await removeDatabase(container.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'wrangler dev queries the database per request through the local connection string',
    async () => {
      const wranglerPath = join(projectDir, 'wrangler.jsonc');
      const wrangler = await readFile(wranglerPath, 'utf-8');
      await writeFile(
        wranglerPath,
        wrangler.replace(/"localConnectionString": "[^"]*"/, `"localConnectionString": "${container.connectionString}"`),
      );

      const appPath = join(projectDir, 'src/app.ts');
      const app = await readFile(appPath, 'utf-8');
      await writeFile(
        appPath,
        app
          .replace("import { timeout } from 'hono/timeout';", "import { timeout } from 'hono/timeout';\nimport { createDb, sql } from '@/lib/db';")
          .replace(
            'app.onError(',
            `app.get('/probe', async (c) => {
  const db = await createDb(c.env.HYPERDRIVE);
  return c.json(await db.execute(sql\`select 1 as ok\`));
});

app.onError(`,
          ),
      );

      const port = await getFreePort();
      const server = await startServer(['bunx', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port)], projectDir, {
        port,
        readyPath: '/health/1',
        readyTimeout: TIMEOUT_WRANGLER_DEV / 2,
      });
      try {
        const response = await fetch(new URL('/probe', server.url));
        expect(response.status).toBe(200);
        expect(JSON.stringify(await response.json())).toContain('"ok":1');
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_WRANGLER_DEV,
  );
});
