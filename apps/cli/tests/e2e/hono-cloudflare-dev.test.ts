import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, getFreePort, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DEV = 120_000;

const BINDING_ROUTE = `import app from './app';

app.get('/binding', async (c) => {
  const { results } = await c.env.DB.prepare('select 1 as one').all<{ one: number }>();
  return c.json({ rows: results });
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
    await writeFile(join(projectDir, 'src/index.ts'), BINDING_ROUTE);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'bun run dev serves a route that reads c.env.DB',
    async () => {
      const port = await getFreePort();
      const server = await startServer(['bun', 'run', 'dev', '--ip', '127.0.0.1', '--port', String(port)], projectDir, {
        port,
        readyPath: '/health/1',
        readyTimeout: TIMEOUT_DEV / 2,
      });
      try {
        const response = await fetch(new URL('/binding', server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ rows: [{ one: 1 }] });
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_DEV,
  );
});
