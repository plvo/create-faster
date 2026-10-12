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

const SEED_PASSWORD = 'password';
const SEEDED_ADMIN = 'admin@example.com';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';

async function generateInstalledBlueprint(blueprint: string, name: string): Promise<string> {
  const tempDir = await createTempDir();
  const result = await runCli([name, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode).toBe(0);

  const projectDir = join(tempDir, name);
  const install = await runCommand(['bun', 'install'], projectDir);
  expect(install.exitCode, install.stderr).toBe(0);
  return projectDir;
}

function describeFailure(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

// better-auth checks the Drizzle schema against what its plugins write: a blueprint schema that lags a
// plugin column fails the seed, which signs users up through auth, with a SCHEMA_MISMATCH.
describe('cloudflare-fullstack: local-setup seeds through better-auth', () => {
  let projectDir: string;
  let setup: CommandResult;

  beforeAll(async () => {
    projectDir = await generateInstalledBlueprint('cloudflare-fullstack', 'bp-seed-cloudflare');
    setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('local-setup migrates the local D1 database and seeds the demo accounts', () => {
    expect(setup.exitCode, describeFailure(setup)).toBe(0);
    expect(setup.stdout).toContain('Seeding complete.');
    expect(describeFailure(setup)).not.toContain('SCHEMA_MISMATCH');
  });
});

describeWithDocker('org-dashboard blueprint e2e')('org-dashboard: local-setup, production build and sign-in', () => {
  let projectDir: string;
  let setup: CommandResult;
  let server: RunningServer;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url, ...headers },
      body: JSON.stringify(body),
    });

  const signIn = async (email: string, password: string, clientIp: string): Promise<string> => {
    const response = await post('/api/auth/sign-in/email', { email, password }, { 'x-forwarded-for': clientIp });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
  };

  beforeAll(async () => {
    projectDir = await generateInstalledBlueprint('org-dashboard', 'bp-seed-org-dashboard');
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
    'a seeded account signs in against the production build',
    async () => {
      const webDir = join(projectDir, 'apps/web');
      const port = await getFreePort();
      const appUrl = `http://127.0.0.1:${port}`;
      const envPath = join(webDir, '.env');
      const kept = (await readFile(envPath, 'utf8'))
        .split('\n')
        .filter((line) => line && !line.startsWith('BETTER_AUTH_'));
      await writeFile(envPath, `${[...kept, `BETTER_AUTH_SECRET=${AUTH_SECRET}`, `BETTER_AUTH_URL=${appUrl}`].join('\n')}\n`);

      const build = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(build.exitCode, describeFailure(build)).toBe(0);

      server = await startServer(['bunx', 'next', 'start', '-p', String(port)], webDir, {
        port,
        readyTimeout: TIMEOUT_SERVER,
      });

      const cookie = await signIn(SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.1');
      const session = await fetch(new URL('/api/auth/get-session', appUrl), { headers: { cookie } });
      expect(session.status).toBe(200);
      const body = (await session.json()) as { user: { email: string; role: string } } | null;
      expect(body?.user).toMatchObject({ email: SEEDED_ADMIN, role: 'admin' });
    },
    TIMEOUT_BUILD + TIMEOUT_SERVER,
  );

  test('public sign-up is rejected, a user created by an admin signs in', async () => {
    const signUp = await post(
      '/api/auth/sign-up/email',
      { email: 'stranger@example.com', password: 'stranger-password', name: 'Stranger' },
      { 'x-forwarded-for': '10.0.0.2' },
    );
    expect(signUp.status).toBe(400);
    expect(await signUp.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });

    const adminCookie = await signIn(SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.3');
    const created = await post(
      '/api/trpc/user.create',
      { json: { name: 'Created', email: 'created@example.com', role: 'user' } },
      { cookie: adminCookie },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const { result } = (await created.json()) as { result: { data: { json: { password: string } } } };

    await signIn('created@example.com', result.data.json.password, '10.0.0.4');
  });

  test('admin pages redirect a signed-in non-admin home and still serve an admin', async () => {
    const adminCookie = await signIn(SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.6');
    const created = await post(
      '/api/trpc/user.create',
      { json: { name: 'Member', email: 'member@example.com', role: 'user' } },
      { cookie: adminCookie },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const { result } = (await created.json()) as { result: { data: { json: { password: string } } } };
    const memberCookie = await signIn('member@example.com', result.data.json.password, '10.0.0.7');

    const sessionResponse = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie: adminCookie } });
    const { user } = (await sessionResponse.json()) as { user: { id: string } };

    for (const path of ['/admin/users', `/admin/users/${user.id}`, '/admin/roles']) {
      const forbidden = await fetch(new URL(path, server.url), { redirect: 'manual', headers: { cookie: memberCookie } });
      expect([path, forbidden.status, forbidden.headers.get('location')]).toEqual([path, 307, '/']);

      const allowed = await fetch(new URL(path, server.url), { headers: { cookie: adminCookie } });
      expect([path, allowed.status]).toEqual([path, 200]);
    }

    const users = await fetch(new URL('/admin/users', server.url), { headers: { cookie: adminCookie } });
    expect(await users.text()).toContain(SEEDED_ADMIN);

    const contacts = await fetch(new URL('/contacts', server.url), { headers: { cookie: memberCookie } });
    expect(contacts.status).toBe(200);
  });

  test('anonymous visits redirect to login, a signed-in visit to login redirects home, and the server logs no error', async () => {
    for (const path of ['/', '/contacts', '/admin/users', '/profile/account']) {
      const response = await fetch(new URL(path, server.url), { redirect: 'manual' });
      expect([path, response.status, response.headers.get('location')]).toEqual([path, 307, '/login']);
    }

    const login = await fetch(new URL('/login', server.url), {
      redirect: 'manual',
      headers: { cookie: await signIn(SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.5') },
    });
    expect([login.status, login.headers.get('location')]).toEqual([307, '/']);

    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});
