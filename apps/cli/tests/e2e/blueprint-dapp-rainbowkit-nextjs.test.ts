import { afterAll, beforeAll, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DatabaseContainer, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import {
  cleanupTempDir,
  createTempDir,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';
import { signInWithEthereum } from './siwe-probe';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_SERVER = 120_000;
const DEFAULT_APP_HOST = 'localhost:3000';

describeWithDocker('dapp-rainbowkit-nextjs blueprint e2e')('builds, serves and signs in with Ethereum', () => {
  let tempDir: string;
  let projectDir: string;
  let postgres: DatabaseContainer;
  let server: RunningServer;
  let appHost: string;

  beforeAll(async () => {
    postgres = await startDatabase('postgres', 'dapp-rainbowkit-nextjs');
    tempDir = await createTempDir();
    const result = await runCli(
      ['dapp', '--blueprint', 'dapp-rainbowkit-nextjs', '--linter', 'biome', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);

    projectDir = join(tempDir, 'dapp');
    expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);

    await writeFile(
      join(projectDir, '.env'),
      [
        `DATABASE_URL="${postgres.connectionString}?sslmode=disable"`,
        'BETTER_AUTH_SECRET="e2e-secret-e2e-secret-e2e-secret-0123"',
        `BETTER_AUTH_URL="http://${DEFAULT_APP_HOST}"`,
        'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="e2e"',
      ].join('\n'),
    );

    const push = await runCommand(['bun', 'run', 'db:push', '--force'], projectDir);
    expect(push.exitCode, push.stderr).toBe(0);
    const build = await runCommand(['bun', 'run', 'build'], projectDir);
    expect(build.exitCode, build.stdout + build.stderr).toBe(0);

    // The build saw the default origin: the one served below is only configured at runtime.
    const port = await getFreePort();
    appHost = `127.0.0.1:${port}`;
    server = await startServer(['bunx', 'next', 'start', '-p', String(port)], projectDir, {
      port,
      readyTimeout: TIMEOUT_SERVER,
      env: { BETTER_AUTH_URL: `http://${appHost}` },
    });
  }, TIMEOUT_INSTALL + TIMEOUT_BUILD + TIMEOUT_SERVER + 60_000);

  afterAll(async () => {
    await server?.stop();
    if (postgres) await removeDatabase(postgres.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'accepts a message for the host the server is configured with, on a port other than 3000',
    async () => {
      const attempt = await signInWithEthereum(projectDir, server.url, appHost);
      expect(attempt.status, JSON.stringify(attempt.body)).toBe(200);
      expect(attempt.body.user?.id).toBeTruthy();

      const session = await fetch(new URL('/api/auth/get-session', server.url), {
        headers: { cookie: attempt.sessionCookie },
      });
      const { user } = (await session.json()) as { user: { id: string } };
      expect(user.id).toBe(attempt.body.user?.id ?? '');
    },
    TIMEOUT_SERVER,
  );

  test.each([DEFAULT_APP_HOST, 'evil.example.com'])(
    'rejects a message signed for %s',
    async (domain) => {
      const attempt = await signInWithEthereum(projectDir, server.url, domain);
      expect(attempt.status).toBe(401);
      expect(attempt.body.code).toBe('UNAUTHORIZED_SIWE_MESSAGE_MISMATCH');
    },
    TIMEOUT_SERVER,
  );
});
