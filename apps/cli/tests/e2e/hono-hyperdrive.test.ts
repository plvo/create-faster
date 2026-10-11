import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
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
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_WRANGLER_DEV = 180_000;
const DATABASE_READY_TIMEOUT = 90_000;

interface DatabaseContainer {
  name: string;
  localConnectionString: string;
}

interface HyperdriveCase {
  database: 'postgres' | 'mysql';
  startContainer: (name: string, port: number) => Promise<unknown>;
  isReady: (name: string) => Promise<boolean>;
  localConnectionString: (port: number) => string;
}

const CASES: HyperdriveCase[] = [
  {
    database: 'postgres',
    startContainer: (name, port) =>
      $`docker run -d --rm --name ${name} -e POSTGRES_PASSWORD=password -e POSTGRES_DB=probe -p 127.0.0.1:${port}:5432 postgres:17-alpine`.quiet(),
    isReady: async (name) => (await $`docker exec ${name} pg_isready -U postgres -h 127.0.0.1`.quiet().nothrow()).exitCode === 0,
    localConnectionString: (port) => `postgresql://postgres:password@127.0.0.1:${port}/probe`,
  },
  {
    database: 'mysql',
    startContainer: (name, port) =>
      $`docker run -d --rm --name ${name} -e MYSQL_ROOT_PASSWORD=password -e MYSQL_DATABASE=probe -p 127.0.0.1:${port}:3306 mysql:8`.quiet(),
    isReady: async (name) =>
      (await $`docker exec ${name} mysqladmin ping -h 127.0.0.1 -uroot -ppassword`.quiet().nothrow()).exitCode === 0,
    localConnectionString: (port) => `mysql://root:password@127.0.0.1:${port}/probe`,
  },
];

const dockerAvailable = Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
if (!dockerAvailable) {
  console.warn('Skipping the Hono + Hyperdrive local query e2e: no Docker daemon reachable (`docker info` failed)');
}

async function startDatabase({ database, startContainer, isReady, localConnectionString }: HyperdriveCase): Promise<DatabaseContainer> {
  const port = await getFreePort();
  const name = `create-faster-e2e-hono-hd-${database}-${process.pid}-${port}`;
  await startContainer(name, port);

  const deadline = Date.now() + DATABASE_READY_TIMEOUT;
  while (Date.now() < deadline) {
    if (await isReady(name)) return { name, localConnectionString: localConnectionString(port) };
    await Bun.sleep(1000);
  }
  await $`docker rm -f ${name}`.quiet().nothrow();
  throw new Error(`${database} container ${name} never became ready`);
}

describe.each(CASES)('hono + cloudflare + $database through Hyperdrive', (hyperdriveCase) => {
  const { database } = hyperdriveCase;
  const name = `hono-hd-${database}`;
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, '--app', `${name}:hono`, '--database', database, '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
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
    'cf-typegen types the HYPERDRIVE binding and tsc passes',
    async () => {
      const typegen = await runCommand(['bun', 'run', 'cf-typegen'], projectDir);
      expect(typegen.exitCode).toBe(0);
      expect(await readFile(join(projectDir, 'cloudflare-env.d.ts'), 'utf-8')).toContain('HYPERDRIVE: Hyperdrive');

      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'wrangler deploy --dry-run bundles the worker with the HYPERDRIVE binding',
    async () => {
      const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('env.HYPERDRIVE');
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );

  describe.skipIf(!dockerAvailable)('local query', () => {
    let container: DatabaseContainer;

    beforeAll(async () => {
      container = await startDatabase(hyperdriveCase);
    }, DATABASE_READY_TIMEOUT + 30_000);

    afterAll(async () => {
      if (container) await $`docker rm -f ${container.name}`.quiet().nothrow();
    });

    test(
      'wrangler dev queries the database per request with the local connection string',
      async () => {
        const wranglerPath = join(projectDir, 'wrangler.jsonc');
        const wrangler = await readFile(wranglerPath, 'utf-8');
        await writeFile(
          wranglerPath,
          wrangler.replace(/"localConnectionString": "[^"]*"/, `"localConnectionString": "${container.localConnectionString}"`),
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
        const server = await startServer(
          ['bunx', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port)],
          projectDir,
          { port, readyPath: '/health/1', readyTimeout: TIMEOUT_WRANGLER_DEV / 2 },
        );
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
});
