import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 240_000;
const TIMEOUT_DEV = 120_000;

// The port of a single-repo app when nothing overrides it.
const DEFAULT_APP_PORT = 3000;

const USERS_ROUTE = `import { createDb, userTable } from '@/lib/db';
import app from './app';

app.get('/users', async (c) => {
  const db = createDb(c.env.DB);
  return c.json({ users: await db.select().from(userTable) });
});

export default app;
`;

describe('Hono on cloudflare with D1: the dev script', () => {
  let tempDir: string;
  let projectDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [
        'hono-cloudflare-dev',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);

    projectDir = join(tempDir, 'hono-cloudflare-dev');
    const install = await runCommand(['bun', 'install'], projectDir);
    expect(install.exitCode, install.stderr).toBe(0);

    await writeFile(join(projectDir, 'src/index.ts'), USERS_ROUTE);
    for (const script of ['db:generate', 'db:migrate']) {
      const step = await runCommand(['bun', 'run', script], projectDir);
      expect(step.exitCode, `${script}\n${step.stdout}\n${step.stderr}`).toBe(0);
    }
  }, TIMEOUT_INSTALL + 60_000);

  afterAll(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
  });

  // The table only exists in the state `db:migrate` wrote with `--persist-to`, so a row query proves `dev` reads the same state.
  async function expectUsersTableThroughBinding(baseUrl: string): Promise<void> {
    const response = await fetch(new URL('/users', baseUrl));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: [] });
  }

  test(
    'bun run dev listens on the app port with no flag and reads the migrated table through c.env.DB',
    async () => {
      const server = await startServer(['bun', 'run', 'dev'], projectDir, {
        port: DEFAULT_APP_PORT,
        readyPath: '/health/1',
        readyTimeout: TIMEOUT_DEV / 2,
      });
      try {
        await expectUsersTableThroughBinding(server.url);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_DEV,
  );

  test(
    'bun run dev listens on the PORT it is given, as under portless',
    async () => {
      const server = await startServer(['bun', 'run', 'dev'], projectDir, {
        readyPath: '/health/1',
        readyTimeout: TIMEOUT_DEV / 2,
      });
      try {
        await expectUsersTableThroughBinding(server.url);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_DEV,
  );
});
