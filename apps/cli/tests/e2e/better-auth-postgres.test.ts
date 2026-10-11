import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import {
  cleanupTempDir,
  createTempDir,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_SERVER = 120_000;
const POSTGRES_READY_TIMEOUT = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CREDENTIALS = { name: 'E2E User', email: 'e2e@example.com', password: 'password-e2e' };

interface PostgresContainer {
  name: string;
  databaseUrl: string;
}

async function startPostgres(): Promise<PostgresContainer> {
  const port = await getFreePort();
  const name = `create-faster-e2e-pg-${process.pid}-${port}`;
  await $`docker run -d --rm --name ${name} -e POSTGRES_PASSWORD=password -p 127.0.0.1:${port}:5432 postgres:17-alpine`.quiet();

  const deadline = Date.now() + POSTGRES_READY_TIMEOUT;
  while (Date.now() < deadline) {
    const ready = await $`docker exec ${name} pg_isready -U postgres -h 127.0.0.1`.quiet().nothrow();
    if (ready.exitCode === 0) {
      return { name, databaseUrl: `postgresql://postgres:password@127.0.0.1:${port}/postgres` };
    }
    await Bun.sleep(500);
  }
  await removePostgres(name);
  throw new Error(`Postgres container ${name} never became ready`);
}

async function removePostgres(name: string): Promise<void> {
  await $`docker rm -f ${name}`.quiet().nothrow();
}

async function postJson(url: string, path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(new URL(path, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

describe.each(['drizzle', 'prisma'])('nextjs + better-auth + %s + postgres', (orm) => {
  let tempDir: string;
  let projectDir: string;
  let postgres: PostgresContainer;
  let server: RunningServer;

  beforeAll(async () => {
    postgres = await startPostgres();
    tempDir = await createTempDir();
    const projectName = `auth-${orm}-pg`;
    const result = await runCli(
      [
        projectName,
        '--app',
        `${projectName}:nextjs:better-auth`,
        '--database',
        'postgres',
        '--orm',
        orm,
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, projectName);
    expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);

    const port = await getFreePort();
    const appUrl = `http://127.0.0.1:${port}`;
    const env = {
      DATABASE_URL: postgres.databaseUrl,
      BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123',
      BETTER_AUTH_URL: appUrl,
    };
    await writeFile(
      join(projectDir, '.env'),
      `${Object.entries(env)
        .map(([key, value]) => `${key}="${value}"`)
        .join('\n')}\n`,
    );

    if (orm === 'prisma') expect((await runCommand(['bun', 'run', 'db:generate'], projectDir)).exitCode).toBe(0);
    const push = await runCommand(['bun', 'run', 'db:push', ...(orm === 'drizzle' ? ['--force'] : [])], projectDir);
    expect(push.exitCode, push.stderr).toBe(0);

    server = await startServer(['bunx', 'next', 'dev', '-p', String(port)], projectDir, {
      port,
      readyTimeout: TIMEOUT_SERVER,
      env,
    });
  }, TIMEOUT_INSTALL + TIMEOUT_SERVER + 60_000);

  afterAll(async () => {
    await server?.stop();
    if (postgres) await removePostgres(postgres.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test(
    'signs up and reads the session',
    async () => {
      const signUp = await postJson(server.url, '/api/auth/sign-up/email', CREDENTIALS);
      expect(signUp.status, await signUp.clone().text()).toBe(200);
      const { user } = (await signUp.json()) as { user: { id: string; email: string } };
      expect(user.email).toBe(CREDENTIALS.email);
      expect(user.id).toMatch(UUID_PATTERN);

      const session = await fetch(new URL('/api/auth/get-session', server.url), {
        headers: { cookie: sessionCookie(signUp) },
      });
      expect(session.status).toBe(200);
      const body = (await session.json()) as { user: { id: string; email: string } } | null;
      expect(body?.user.id).toBe(user.id);
    },
    TIMEOUT_SERVER,
  );
});
