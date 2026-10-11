import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AUTH_SECRET,
  expectAnonymousFlow,
  expectAnonymousSession,
  expectAuthApiFlow,
  expectMixedUsersKeepTheirOwnSession,
  expectSignedInFlow,
  expectTrpcAnonymousSession,
  expectTrpcReadsWithoutRefreshing,
  writeSessionProbeRoute,
  writeTrpcSessionProbe,
} from './auth-probe';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';
import {
  expectAnonymousTrpcSession,
  expectClientBundleWithoutServerCode,
  expectDateSurvivesHydration,
  expectSignedInTrpcSession,
  expectTrpcServesProcedures,
  readStartTrpcSession,
  SERVER_MARKER,
  type TrpcProbeOptions,
  writeTrpcProbe,
} from './trpc-probe';

// better-auth on TanStack Start served by Nitro, alone and next to a Next.js app in one turborepo: the auth
// route, the cached getSession server function and its per-user isolation, and the per-app auth instance.
// Each app owns its cookie plugin, so the Next.js server bundle carries no Start code, and the Next.js tRPC
// context reads sessions through a cookie-less instance that never refreshes them.
// With tRPC on the Start app: procedures over the API route and in a streamed SSR render, a Date kept through
// hydration, the protected procedure, the session shared with getSession, and no server code in the client.

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_SERVE = 120_000;

const COOKIE_ORDER_WARNING = 'should be placed last in the plugins array';
const START_ONLY_MARKERS = ['@tanstack/react-start', 'tanstack-start-cookies'];
const START_TRPC: TrpcProbeOptions = { auth: true, query: true };

interface Scenario {
  name: string;
  args: string[];
  startAppDir?: string;
  nextAppDir?: string;
  dbDir: string;
  /** False when no database server is available: only requests that never reach the database are exercised. */
  liveDatabase: boolean;
  /** The Start app also has trpc and tanstack-query. */
  startTrpc?: boolean;
}

const MIXED_APPS = ['--app', 'web:nextjs:better-auth,trpc', '--app', 'admin:tanstack-start:better-auth,trpc,tanstack-query'];

const SCENARIOS: Scenario[] = [
  {
    name: 'start-auth-nitro',
    args: ['--app', 'start-auth-nitro:tanstack-start:better-auth', '--database', 'sqlite', '--orm', 'drizzle'],
    startAppDir: '.',
    dbDir: '.',
    liveDatabase: true,
  },
  {
    name: 'start-trpc-nitro',
    args: [
      '--app',
      'start-trpc-nitro:tanstack-start:better-auth,trpc,tanstack-query',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ],
    startAppDir: '.',
    dbDir: '.',
    liveDatabase: true,
    startTrpc: true,
  },
  {
    name: 'start-auth-nitro-turbo',
    args: [
      '--app',
      'web:tanstack-start:better-auth',
      '--app',
      'api:hono',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ],
    startAppDir: 'apps/web',
    dbDir: 'packages/db',
    liveDatabase: true,
  },
  {
    name: 'mixed-auth-sqlite',
    args: [...MIXED_APPS, '--database', 'sqlite', '--orm', 'drizzle'],
    nextAppDir: 'apps/web',
    startAppDir: 'apps/admin',
    dbDir: 'packages/db',
    liveDatabase: true,
    startTrpc: true,
  },
  {
    name: 'mixed-auth-postgres',
    args: [...MIXED_APPS, '--database', 'postgres', '--orm', 'drizzle'],
    nextAppDir: 'apps/web',
    startAppDir: 'apps/admin',
    dbDir: 'packages/db',
    liveDatabase: false,
    startTrpc: true,
  },
];

async function filesContaining(dir: string, needles: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name.endsWith('.map')) continue;
    const path = join(entry.parentPath, entry.name);
    const content = await readFile(path, 'utf8');
    if (needles.some((needle) => content.includes(needle))) matches.push(path);
  }
  return matches;
}

describe.each(SCENARIOS)(
  '$name',
  ({ name, args, startAppDir, nextAppDir, dbDir, liveDatabase, startTrpc }) => {
    let projectDir: string;
    let installResult: CommandResult;
    const servers: RunningServer[] = [];

    const appPath = (appDir: string) => join(projectDir, appDir);
    const dbPath = () => join(projectDir, dbDir, 'db.sqlite');
    const serverEnv = (port: number): Record<string, string> => ({
      PORT: String(port),
      DATABASE_URL: liveDatabase ? `file:${dbPath()}` : 'postgresql://postgres:password@127.0.0.1:1/unused',
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    });

    beforeAll(async () => {
      const tempDir = await createTempDir();
      const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode).toBe(0);

      projectDir = join(tempDir, name);
      installResult = await runCommand(['bun', 'install'], projectDir);
      if (startAppDir) await writeSessionProbeRoute(appPath(startAppDir));
      if (nextAppDir) await writeTrpcSessionProbe(projectDir);
      if (startAppDir && startTrpc) await writeTrpcProbe(projectDir, appPath(startAppDir), START_TRPC);
    }, TIMEOUT_INSTALL + 30_000);

    afterAll(async () => {
      await Promise.all(servers.map((server) => server.stop()));
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

    if (startAppDir && startTrpc) {
      test('the Start client assets carry neither the tRPC router nor the db schema', async () => {
        const output = join(appPath(startAppDir), '.output');
        await expectClientBundleWithoutServerCode(join(output, 'public'), join(output, 'server'), [
          SERVER_MARKER,
          'user_sessions',
        ]);
      });
    }

    if (nextAppDir) {
      test(
        'the Next.js server output does not bundle the TanStack Start cookie plugin',
        async () => {
          expect(await filesContaining(join(appPath(nextAppDir), '.next/server'), START_ONLY_MARKERS)).toEqual([]);
        },
        TIMEOUT_TYPECHECK,
      );
    }

    test(
      'type-checks',
      async () => {
        for (const appDir of [startAppDir, nextAppDir]) {
          if (!appDir) continue;
          const result = await runCommand(['bunx', 'tsc', '--noEmit'], appPath(appDir));
          expect(result.exitCode, result.stdout).toBe(0);
        }
      },
      TIMEOUT_TYPECHECK,
    );

    if (startAppDir) {
      test(
        `${
          liveDatabase
            ? 'start serves sign-up, sign-in, get-session and per-user cached sessions against the sqlite database'
            : 'start serves the auth route and the session server function without a database round trip'
        }${startTrpc ? ', and the tRPC procedures' : ''}`,
        async () => {
          const port = await getFreePort();
          const server = await startServer(['bun', 'run', 'start'], appPath(startAppDir), {
            port,
            env: serverEnv(port),
          });
          servers.push(server);

          await expectServesPageWithClientScript(server.url);
          await expectAnonymousFlow(server.url);
          if (liveDatabase) {
            await expectSignedInFlow(server.url);
            await expectMixedUsersKeepTheirOwnSession(server.url);
          }
          if (startTrpc) {
            await expectTrpcServesProcedures(server.url, START_TRPC);
            await expectDateSurvivesHydration(server.url);
            await expectAnonymousTrpcSession(server.url, START_TRPC);
            if (liveDatabase) {
              const user = await expectAuthApiFlow(server.url);
              await expectSignedInTrpcSession(server.url, user, START_TRPC);
              await expectTrpcReadsWithoutRefreshing(server.url, dbPath(), user, readStartTrpcSession);
            }
          }

          const { stdout, stderr } = await server.stop();
          expect(`${stdout}\n${stderr}`).not.toContain(COOKIE_ORDER_WARNING);
        },
        TIMEOUT_SERVE,
      );
    }

    if (nextAppDir) {
      test(
        liveDatabase
          ? 'the Next.js app signs up, signs in, and its tRPC context reads sessions without refreshing them'
          : 'the Next.js app answers anonymous session requests through the route and the tRPC context',
        async () => {
          const port = await getFreePort();
          const server = await startServer(['bunx', 'next', 'start', '--port', String(port)], appPath(nextAppDir), {
            port,
            env: serverEnv(port),
          });
          servers.push(server);

          expect((await fetch(server.url)).status).toBe(200);
          await expectAnonymousSession(server.url);
          await expectTrpcAnonymousSession(server.url);
          if (liveDatabase) {
            const user = await expectAuthApiFlow(server.url);
            await expectTrpcReadsWithoutRefreshing(server.url, dbPath(), user);
          }

          const { stdout, stderr } = await server.stop();
          expect(`${stdout}\n${stderr}`).not.toContain(COOKIE_ORDER_WARNING);
        },
        TIMEOUT_SERVE,
      );
    }
  },
);
