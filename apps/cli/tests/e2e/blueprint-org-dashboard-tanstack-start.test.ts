import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeWithDocker } from './docker-database';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_SETUP = 240_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_SERVER = 120_000;

const BLUEPRINT = 'org-dashboard-tanstack-start';
const SEED_PASSWORD = 'password';
const SEEDED_ADMIN = 'admin@example.com';
const SEEDED_MEMBER = 'user@example.com';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';

function describeFailure(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

const post = (server: RunningServer, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL(path, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url, ...headers },
    body: JSON.stringify(body),
  });

const signIn = async (server: RunningServer, email: string, clientIp: string): Promise<string> => {
  const response = await post(server, '/api/auth/sign-in/email', { email, password: SEED_PASSWORD }, { 'x-forwarded-for': clientIp });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
};

const redirectOf = async (server: RunningServer, path: string, cookie?: string): Promise<{ status: number; location: URL | null }> => {
  const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const location = response.headers.get('location');
  return { status: response.status, location: location ? new URL(location, server.url) : null };
};

async function buildAndStartWeb(projectDir: string): Promise<RunningServer> {
  const webDir = join(projectDir, 'apps/web');
  const port = await getFreePort();
  const envPath = join(webDir, '.env');
  const kept = (await readFile(envPath, 'utf8')).split('\n').filter((line) => line && !line.startsWith('BETTER_AUTH_'));
  await writeFile(
    envPath,
    `${[...kept, `BETTER_AUTH_SECRET=${AUTH_SECRET}`, `BETTER_AUTH_URL=http://127.0.0.1:${port}`].join('\n')}\n`,
  );

  const build = await runCommand(['bun', 'run', 'build'], projectDir);
  expect(build.exitCode, describeFailure(build)).toBe(0);

  return startServer(['bun', 'run', 'start'], webDir, { port, env: { PORT: String(port) }, readyTimeout: TIMEOUT_SERVER });
}

describeWithDocker(`${BLUEPRINT} blueprint e2e`)(`${BLUEPRINT}: local-setup, production build and sign-in`, () => {
  let projectDir: string;
  let setup: CommandResult;
  let server: RunningServer;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const name = 'bp-org-dashboard-start';
    const result = await runCli([name, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    const install = await runCommand(['bun', 'install'], projectDir);
    expect(install.exitCode, install.stderr).toBe(0);
    setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) {
      await runCommand(['docker', 'compose', 'down', '--volumes'], projectDir);
      await cleanupTempDir(join(projectDir, '..'));
    }
  });

  test('local-setup starts the database, applies the schema and seeds the demo accounts', () => {
    expect(setup.exitCode, describeFailure(setup)).toBe(0);
    expect(setup.stdout).toContain('Seeding complete.');
    expect(describeFailure(setup)).not.toContain('SCHEMA_MISMATCH');
  });

  test(
    'a seeded account signs in against the Nitro production server',
    async () => {
      server = await buildAndStartWeb(projectDir);

      const cookie = await signIn(server, SEEDED_ADMIN, '10.2.0.1');
      const session = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie } });
      expect(session.status).toBe(200);
      const body = (await session.json()) as { user: { email: string; role: string } } | null;
      expect(body?.user).toMatchObject({ email: SEEDED_ADMIN, role: 'admin' });
    },
    TIMEOUT_BUILD + TIMEOUT_SERVER,
  );

  test('public sign-up is rejected', async () => {
    const signUp = await post(
      server,
      '/api/auth/sign-up/email',
      { email: 'stranger@example.com', password: 'stranger-password', name: 'Stranger' },
      { 'x-forwarded-for': '10.2.0.2' },
    );
    expect(signUp.status).toBe(400);
    expect(await signUp.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
  });

  test('an anonymous visitor is redirected to the login page, which remembers the page asked for', async () => {
    for (const path of ['/', '/profile', '/profile/account', '/profile/sessions']) {
      const { status, location } = await redirectOf(server, path);
      expect([path, status, location?.pathname, location?.searchParams.get('redirectTo')]).toEqual([path, 307, '/login', path]);
    }

    const login = await fetch(new URL('/login', server.url), { redirect: 'manual' });
    expect(login.status).toBe(200);
  });

  test('a signed-in visit to the login page ends on the dashboard, whatever redirectTo asks for', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.3');
    const direct = await redirectOf(server, '/login', cookie);
    expect([direct.status, direct.location?.pathname]).toEqual([307, '/']);

    // The router rewrites a search value that validateSearch changed before the layouts run, so a hostile
    // destination first lands on the cleaned login URL and is then sent home.
    const hostile = await fetch(new URL('/login?redirectTo=https%3A%2F%2Fevil.example', server.url), { headers: { cookie } });
    expect([hostile.status, new URL(hostile.url).pathname]).toEqual([200, '/']);
  });

  test('a member sees the dashboard and /profile lands on the account tab', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.4');

    const home = await fetch(new URL('/', server.url), { headers: { cookie } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Total Contacts');

    const profile = await redirectOf(server, '/profile', cookie);
    expect([profile.status, profile.location?.pathname]).toEqual([307, '/profile/account']);

    for (const tab of ['account', 'security', 'sessions', 'preferences']) {
      const page = await fetch(new URL(`/profile/${tab}`, server.url), { headers: { cookie } });
      expect([tab, page.status]).toEqual([tab, 200]);
    }
  });

  test('a signed-in user whose role lacks a permission gets a 404 on the page that needs it, not on the others', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.6');
    const setRole = async (role: string): Promise<void> => {
      const update = await runCommand(
        [
          'docker',
          'compose',
          'exec',
          '-T',
          'postgres',
          'sh',
          '-c',
          `psql -U postgres -d "$POSTGRES_DB" -c "update users set role = '${role}' where email = '${SEEDED_MEMBER}'"`,
        ],
        projectDir,
      );
      expect(update.exitCode, describeFailure(update)).toBe(0);
    };

    await setRole('ghost');
    try {
      const home = await fetch(new URL('/', server.url), { redirect: 'manual', headers: { cookie } });
      expect(home.status).toBe(404);
      expect(await home.text()).toContain('Page not found');

      const profile = await fetch(new URL('/profile/account', server.url), { redirect: 'manual', headers: { cookie } });
      expect(profile.status).toBe(200);
    } finally {
      await setRole('user');
    }
  });

  test('an unknown page answers not found and the server logs no error', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.5');
    const missing = await fetch(new URL('/no-such-page', server.url), { headers: { cookie } });
    expect(missing.status).toBe(404);

    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});
