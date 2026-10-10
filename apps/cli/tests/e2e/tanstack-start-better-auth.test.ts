import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_SERVE = 120_000;

const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e';
const PASSWORD = 'correct-horse-battery';
const CONCURRENT_SESSION_READS = 30;
const SESSION_PROBE_PATH = '/session-probe';

interface SessionResponse {
  user: { email: string };
}

interface SessionProbe {
  email: string | null;
  sameSessionObject: boolean;
}

type Runtime = 'nitro' | 'cloudflare';

interface Scenario {
  name: string;
  runtime: Runtime;
  args: string[];
  appDir: string;
  dbDir: string;
  /** False when no database server is available: only requests that never reach the database are exercised. */
  liveDatabase: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'start-auth-nitro',
    runtime: 'nitro',
    args: ['--app', 'start-auth-nitro:tanstack-start:better-auth', '--database', 'sqlite', '--orm', 'drizzle'],
    appDir: '.',
    dbDir: '.',
    liveDatabase: true,
  },
  {
    name: 'start-auth-nitro-turbo',
    runtime: 'nitro',
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
  {
    name: 'start-auth-cf-d1',
    runtime: 'cloudflare',
    args: [
      '--app',
      'start-auth-cf-d1:tanstack-start:better-auth',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ],
    appDir: '.',
    dbDir: '.',
    liveDatabase: true,
  },
  {
    name: 'start-auth-cf-d1-turbo',
    runtime: 'cloudflare',
    args: [
      '--app',
      'web:tanstack-start:better-auth',
      '--app',
      'api:hono',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ],
    appDir: 'apps/web',
    dbDir: 'packages/db',
    liveDatabase: true,
  },
];

// Test-only route: reads the session three times concurrently during one SSR pass.
// The per-request cache memoizes the promise, so all three calls resolve to the same object.
const sessionProbeRoute = `import { createFileRoute } from '@tanstack/react-router';
import { getSession } from '@/lib/auth/session';

export const Route = createFileRoute('${SESSION_PROBE_PATH}')({
  loader: async () => {
    const [first, second, third] = await Promise.all([getSession(), getSession(), getSession()]);
    return { email: first?.user.email ?? null, sameSessionObject: first === second && second === third };
  },
  component: () => <pre id="session-probe">{JSON.stringify(Route.useLoaderData())}</pre>,
});
`;

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(body),
  });
}

async function readSession(baseUrl: string, cookie: string): Promise<Response> {
  return fetch(new URL('/api/auth/get-session', baseUrl), { headers: { cookie } });
}

async function readSessionProbe(baseUrl: string, cookie: string): Promise<SessionProbe> {
  const page = await fetch(new URL(SESSION_PROBE_PATH, baseUrl), { headers: { cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const json = html.match(/<pre id="session-probe">([^<]*)<\/pre>/)?.[1] ?? '';
  return JSON.parse(json.replaceAll('&quot;', '"'));
}

async function expectAnonymousFlow(baseUrl: string): Promise<void> {
  const anonymous = await readSession(baseUrl, '');
  expect(anonymous.status, await anonymous.clone().text()).toBe(200);
  expect(await anonymous.json()).toBeNull();

  const probe = await readSessionProbe(baseUrl, '');
  expect(probe).toEqual({ email: null, sameSessionObject: true });
}

async function expectSignedInFlow(baseUrl: string): Promise<void> {
  const email = `${crypto.randomUUID()}@example.com`;
  const signUp = await postJson(baseUrl, '/api/auth/sign-up/email', { email, password: PASSWORD, name: 'E2E' });
  expect(signUp.status).toBe(200);
  const signUpCookie = cookieHeader(signUp);
  expect(signUpCookie).toContain('session_token');

  const afterSignUp = await readSession(baseUrl, signUpCookie);
  expect(((await afterSignUp.json()) as SessionResponse).user.email).toBe(email);

  const wrongPassword = await postJson(baseUrl, '/api/auth/sign-in/email', { email, password: 'wrong-password-1' });
  expect(wrongPassword.status).toBe(401);

  const signIn = await postJson(baseUrl, '/api/auth/sign-in/email', { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  const signInCookie = cookieHeader(signIn);
  const afterSignIn = await readSession(baseUrl, signInCookie);
  expect(((await afterSignIn.json()) as SessionResponse).user.email).toBe(email);

  const burst = await Promise.all(
    Array.from({ length: CONCURRENT_SESSION_READS }, () => readSession(baseUrl, signInCookie)),
  );
  for (const response of burst) {
    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user.email).toBe(email);
  }

  const probe = await readSessionProbe(baseUrl, signInCookie);
  expect(probe).toEqual({ email, sameSessionObject: true });
}

describe.each(SCENARIOS)('$name', ({ name, runtime, args, appDir, dbDir, liveDatabase }) => {
  let projectDir: string;
  let installResult: CommandResult;
  let previewPort: number;
  let server: RunningServer | undefined;

  const appPath = (...segments: string[]) => join(projectDir, appDir, ...segments);

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);

    const routePath = appPath('src/routes', `${SESSION_PROBE_PATH}.tsx`);
    await mkdir(dirname(routePath), { recursive: true });
    await writeFile(routePath, sessionProbeRoute);

    if (runtime === 'cloudflare') {
      // `vite build` snapshots .env into dist/server/.dev.vars, which `vite preview` reads: write it before building.
      previewPort = await getFreePort();
      await writeFile(
        appPath('.env'),
        `BETTER_AUTH_SECRET=${AUTH_SECRET}\nBETTER_AUTH_URL=http://127.0.0.1:${previewPort}\n`,
      );
    }
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

  if (runtime === 'cloudflare') {
    test(
      'generates and applies the local D1 migrations',
      async () => {
        const generate = await runCommand(['bun', 'run', 'db:generate'], projectDir);
        expect(generate.exitCode, generate.stderr).toBe(0);
        const migrate = await runCommand(['bun', 'run', 'db:migrate'], projectDir);
        expect(migrate.exitCode, migrate.stderr).toBe(0);
        const typegen = await runCommand(['bun', 'run', 'cf-typegen'], appPath());
        expect(typegen.exitCode, typegen.stderr).toBe(0);
      },
      TIMEOUT_BUILD,
    );
  } else if (liveDatabase) {
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

  if (runtime === 'cloudflare') {
    test(
      'wrangler deploy --dry-run succeeds',
      async () => {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], appPath());
        expect(result.exitCode, result.stderr).toBe(0);
      },
      TIMEOUT_DEPLOY_DRY_RUN,
    );
  }

  test(
    runtime === 'cloudflare'
      ? 'vite preview serves sign-up, sign-in and a burst of get-session in workerd'
      : liveDatabase
        ? 'start serves sign-up, sign-in and get-session against the sqlite database'
        : 'start serves the auth route and the session server function without a database round trip',
    async () => {
      server =
        runtime === 'cloudflare'
          ? await startServer(['bunx', 'vite', 'preview', '--port', String(previewPort)], appPath(), {
              port: previewPort,
            })
          : await startServer(['bun', 'run', 'start'], appPath(), {
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
        if (liveDatabase) await expectSignedInFlow(server.url);
      } catch (error) {
        const { stdout, stderr } = await server.stop();
        throw new Error(`${error}\nserver stdout:\n${stdout}\nserver stderr:\n${stderr}`);
      }
    },
    TIMEOUT_SERVE,
  );
});
