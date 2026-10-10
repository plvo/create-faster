import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AUTH_SECRET,
  expectAnonymousFlow,
  expectMixedUsersKeepTheirOwnSession,
  expectSignedInFlow,
  writeSessionProbeRoute,
} from './auth-probe';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

// Nitro scenarios live here rather than in tanstack-start-modules.test.ts: that file builds one project
// without a database, while these need a live sqlite database and a Turborepo variant. The Cloudflare D1
// scenarios are in tanstack-start-cloudflare.test.ts.

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_SERVE = 120_000;

interface Scenario {
  name: string;
  args: string[];
  appDir: string;
  dbDir: string;
  /** False when no database server is available: only requests that never reach the database are exercised. */
  liveDatabase: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'start-auth-nitro',
    args: ['--app', 'start-auth-nitro:tanstack-start:better-auth', '--database', 'sqlite', '--orm', 'drizzle'],
    appDir: '.',
    dbDir: '.',
    liveDatabase: true,
  },
  {
    name: 'start-auth-nitro-turbo',
    args: [
      '--app',
      'web:tanstack-start:better-auth',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ],
    appDir: 'apps/web',
    dbDir: 'packages/db',
    liveDatabase: false,
  },
];

describe.each(SCENARIOS)('$name', ({ name, args, appDir, dbDir, liveDatabase }) => {
  let projectDir: string;
  let installResult: CommandResult;
  let server: RunningServer | undefined;

  const appPath = (...segments: string[]) => join(projectDir, appDir, ...segments);

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
    await writeSessionProbeRoute(appPath());
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  if (liveDatabase) {
    test(
      'db:push creates the local sqlite database',
      async () => {
        await copyFile(join(projectDir, dbDir, '.env.example'), join(projectDir, dbDir, '.env'));
        const result = await runCommand(['bun', 'run', 'db:push', '--force'], join(projectDir, dbDir));
        expect(result.exitCode, result.stderr).toBe(0);
      },
      TIMEOUT_DB,
    );
  }

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode, result.stderr).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], appPath());
      expect(result.exitCode, result.stdout).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    liveDatabase
      ? 'start serves sign-up, sign-in, get-session and per-user cached sessions against the sqlite database'
      : 'start serves the auth route and the session server function without a database round trip',
    async () => {
      server = await startServer(['bun', 'run', 'start'], appPath(), {
        env: (port) => ({
          DATABASE_URL: liveDatabase
            ? `file:${join(projectDir, dbDir, 'db.sqlite')}`
            : 'postgresql://postgres:password@127.0.0.1:1/unused',
          BETTER_AUTH_SECRET: AUTH_SECRET,
          BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
        }),
      });

      try {
        await expectServesPageWithClientScript(server.url);
        await expectAnonymousFlow(server.url);
        if (liveDatabase) {
          await expectSignedInFlow(server.url);
          await expectMixedUsersKeepTheirOwnSession(server.url);
        }
      } catch (error) {
        const { stdout, stderr } = await server.stop();
        throw new Error(`${error}\nserver stdout:\n${stdout}\nserver stderr:\n${stderr}`);
      }
    },
    TIMEOUT_SERVE,
  );
});
