import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
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
const TIMEOUT_WRANGLER_DEV = 120_000;

const CLOUDFLARE_PROJECTS = [
  { name: 'hono-cloudflare', app: 'hono-cloudflare:hono' },
  { name: 'hono-lambda-cloudflare', app: 'hono-lambda-cloudflare:hono:aws-lambda' },
];

describe.each(CLOUDFLARE_PROJECTS)('$name', ({ name, app }) => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, '--app', app, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
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
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'wrangler deploy --dry-run succeeds',
    async () => {
      const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );

  test(
    'wrangler dev serves the app in workerd',
    async () => {
      const port = await getFreePort();
      const server = await startServer(
        ['bunx', 'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port)],
        projectDir,
        {
          port,
          readyPath: '/health/1',
          readyTimeout: TIMEOUT_WRANGLER_DEV / 2,
        },
      );
      try {
        const response = await fetch(new URL('/health/1', server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, message: 'Health check', data: { id: '1' } });
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_WRANGLER_DEV,
  );
});
