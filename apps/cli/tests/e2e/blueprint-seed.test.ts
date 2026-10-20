import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describeWithDocker } from './docker-database';
import {
  type CommandResult,
  cleanupTempDir,
  generateInstalledProject,
  getFreePort,
  type RunningServer,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_SETUP = 240_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_SERVER = 120_000;

const SEED_PASSWORD = 'password';
const SEEDED_ADMIN = 'admin@example.com';
const SEEDED_MEMBER = 'user@example.com';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';
const UNKNOWN_ID = 'no-such-record';

function describeFailure(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

const post = (server: RunningServer, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL(path, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url, ...headers },
    body: JSON.stringify(body),
  });

const signIn = async (server: RunningServer, email: string, password: string, clientIp: string): Promise<string> => {
  const response = await post(server, '/api/auth/sign-in/email', { email, password }, { 'x-forwarded-for': clientIp });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
};

// The tRPC endpoint speaks superjson: a query is a GET with its input in the URL, wrapped as superjson wraps it.
async function queryTrpc<T>(server: RunningServer, procedure: string, cookie: string, input?: unknown): Promise<T> {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await fetch(new URL(`/api/trpc/${procedure}${query}`, server.url), { headers: { cookie } });
  expect([procedure, response.status]).toEqual([procedure, 200]);
  const body = (await response.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

async function redirectPathOf(server: RunningServer, path: string, cookie?: string): Promise<string | null> {
  const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const location = response.headers.get('location');
  return response.status === 307 && location ? new URL(location, server.url).pathname : null;
}

async function pointWebAuthAt(webDir: string, appUrl: string): Promise<void> {
  const envPath = join(webDir, '.env');
  const kept = (await readFile(envPath, 'utf8')).split('\n').filter((line) => line && !line.startsWith('BETTER_AUTH_'));
  await writeFile(envPath, `${[...kept, `BETTER_AUTH_SECRET=${AUTH_SECRET}`, `BETTER_AUTH_URL=${appUrl}`].join('\n')}\n`);
}

async function buildAndStartWeb(projectDir: string): Promise<RunningServer> {
  const webDir = join(projectDir, 'apps/web');
  const port = await getFreePort();
  await pointWebAuthAt(webDir, `http://127.0.0.1:${port}`);

  const build = await runCommand(['bun', 'run', 'build'], projectDir);
  expect(build.exitCode, describeFailure(build)).toBe(0);

  return startServer(['bunx', 'next', 'start', '-p', String(port)], webDir, { port, readyTimeout: TIMEOUT_SERVER });
}

describe('cloudflare-fullstack-nextjs blueprint e2e', () => {
  let projectDir: string;
  let setup: CommandResult;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('bp-seed-cloudflare', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  // better-auth checks the Drizzle schema against what its plugins write: a blueprint schema that lags a
  // plugin column fails the seed, which signs users up through auth, with a SCHEMA_MISMATCH.
  describe('local-setup seeds through better-auth', () => {
    test('local-setup migrates the local D1 database and seeds the demo accounts', () => {
      expect(setup.exitCode, describeFailure(setup)).toBe(0);
      expect(setup.stdout).toContain('Seeding complete.');
      expect(describeFailure(setup)).not.toContain('SCHEMA_MISMATCH');
    });
  });

  // The deploy notes promote the first admin of a deployed app with a remote D1 command. The same command, aimed
  // at the local database the setup seeded, has to find the account and change its role.
  describe('first admin promotion of the deploy notes', () => {
    const PROMOTED_ACCOUNT = 'manager@example.com';

    test('the documented command promotes an existing account to admin', async () => {
      const notes = await readFile(join(projectDir, 'docs/agents/cloudflare-deploy.md'), 'utf8');
      const documented = notes.match(/\(cd apps\/web && (bunx wrangler d1 execute DB --remote --command "[^"\n]*")\)/)?.[1];
      expect(documented, 'a promote command in cloudflare-deploy.md').toBeDefined();

      const webDir = join(projectDir, 'apps/web');
      const localState = join(projectDir, '.wrangler');
      const roleOf = async (): Promise<string> => {
        const query = await runCommand(
          ['bunx', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', localState, '--json', '--command', `SELECT role FROM users WHERE email = '${PROMOTED_ACCOUNT}'`],
          webDir,
        );
        expect(query.exitCode, describeFailure(query)).toBe(0);
        const [statement] = JSON.parse(query.stdout) as { results: { role: string }[] }[];
        return statement?.results[0]?.role ?? 'no such account';
      };
      expect(await roleOf()).toBe('manager');

      const promote = documented!
        .replace('<your email>', PROMOTED_ACCOUNT.toUpperCase())
        .replace('--remote', `--local --persist-to ${localState}`);
      const result = await runCommand(['sh', '-c', promote], webDir);
      expect(result.exitCode, describeFailure(result)).toBe(0);

      expect(await roleOf()).toBe('admin');
    }, TIMEOUT_SETUP);
  });

  // Client components render on the server without the request cookies, so a protected query they read has to be
  // prefetched by the page: a hard reload of an admin page answered 500 "You must be logged in" otherwise.
  describe('dashboard pages on a hard reload', () => {
    let server: RunningServer;

    afterAll(async () => {
      await server?.stop();
    });

    test(
      'a signed-in admin gets a 200 on every page, an anonymous visitor and a non-admin are redirected, and the server logs no error',
      async () => {
        const webDir = join(projectDir, 'apps/web');
        const port = await getFreePort();
        await pointWebAuthAt(webDir, `http://127.0.0.1:${port}`);
        server = await startServer(['bunx', 'next', 'dev', '-p', String(port)], webDir, {
          port,
          readyPath: '/login',
          readyTimeout: TIMEOUT_SERVER,
        });

        const cookie = await signIn(server, SEEDED_ADMIN, SEED_PASSWORD, '10.0.1.1');
        const sessionResponse = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie } });
        const { user } = (await sessionResponse.json()) as { user: { id: string } };
        const userPage = `/admin/users/${user.id}`;

        const pages = ['/', '/admin/users', userPage, '/admin/roles', '/profile/account', '/profile/security', '/profile/sessions', '/profile/preferences'];
        for (const path of pages) {
          const response = await fetch(new URL(path, server.url), { headers: { cookie } });
          expect([path, response.status]).toEqual([path, 200]);
        }

        // The sidebar shows the email on every page; the back link is rendered by the user page alone, from the prefetched user.
        const detail = await fetch(new URL(userPage, server.url), { headers: { cookie } });
        expect(await detail.text()).toContain('Back to users');

        // An id that matches no user answers the not-found page, not a 200 that fails in the browser.
        const missing = await fetch(new URL(`/admin/users/${UNKNOWN_ID}`, server.url), { headers: { cookie } });
        expect(missing.status).toBe(404);
        expect(await missing.text()).toContain('Page not found');

        for (const path of ['/', '/admin/users', userPage]) {
          expect([path, await redirectPathOf(server, path)]).toEqual([path, '/login']);
        }

        const memberCookie = await signIn(server, SEEDED_MEMBER, SEED_PASSWORD, '10.0.1.2');
        for (const path of ['/admin/users', userPage, `/admin/users/${UNKNOWN_ID}`, '/admin/roles']) {
          expect([path, await redirectPathOf(server, path, memberCookie)]).toEqual([path, '/']);
        }

        // The seed gives the admin 30 users and 24 documents to see: three pages of ten of each, on the server.
        const pagesOf = async <T extends { id: string }>(list: string, input: Record<string, unknown> = {}): Promise<T[][]> => {
          const pages: T[][] = [];
          for (let page = 1; page <= 4; page++) pages.push(await queryTrpc<T[]>(server, list, cookie, { ...input, page, pageSize: 10 }));
          return pages;
        };
        const idsOf = (pages: { id: string }[][]) => pages.flat().map((row) => row.id);

        expect(await queryTrpc<number>(server, 'users.count', cookie)).toBe(30);
        const userPages = await pagesOf<{ id: string; name: string }>('users.list');
        expect(userPages.map((page) => page.length)).toEqual([10, 10, 10, 0]);
        expect(new Set(idsOf(userPages)).size).toBe(30);

        const byName = await pagesOf<{ id: string; name: string }>('users.list', { sort: 'name' });
        const names = byName.flat().map((row) => row.name);
        expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        expect(idsOf(byName).sort()).toEqual(idsOf(userPages).sort());

        const matches = await queryTrpc<{ email: string }[]>(server, 'users.list', cookie, { search: 'MANAGER', pageSize: 100 });
        expect(await queryTrpc<number>(server, 'users.count', cookie, { search: 'MANAGER' })).toBe(matches.length);
        expect(matches.map((row) => row.email)).toContain('manager@example.com');
        expect(matches.length).toBeLessThan(30);

        // The table is drawn in the browser, once the session says the viewer may list users: the page itself answers.
        const listed = await fetch(new URL('/admin/users?page=3&pageSize=25&sort=-name&search=a', server.url), { headers: { cookie } });
        expect(listed.status).toBe(200);

        expect(await queryTrpc<number>(server, 'documents.count', cookie)).toBe(24);
        const documentPages = await pagesOf<{ id: string }>('documents.list');
        expect(documentPages.map((page) => page.length)).toEqual([10, 10, 4, 0]);
        expect(new Set(idsOf(documentPages)).size).toBe(24);
        const documentsPage = await (await fetch(new URL('/?page=3', server.url), { headers: { cookie } })).text();
        expect(documentsPage).toContain('Showing 21–24 of 24 documents');

        // A rejected query logs after the response is sent: wait for a late line before the server is stopped.
        await Bun.sleep(1_000);
        const { stdout, stderr } = await server.stop();
        expect(`${stdout}\n${stderr}`).not.toMatch(/⨯|tRPC failed/);
      },
      TIMEOUT_SERVER * 3,
    );
  });
});

describeWithDocker('org-dashboard-nextjs blueprint e2e')('org-dashboard-nextjs: local-setup, production build and sign-in', () => {
  let projectDir: string;
  let setup: CommandResult;
  let server: RunningServer;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('bp-seed-org-dashboard', ['--blueprint', 'org-dashboard-nextjs']);
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
      server = await buildAndStartWeb(projectDir);
      const appUrl = server.url;

      const cookie = await signIn(server, SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.1');
      const session = await fetch(new URL('/api/auth/get-session', appUrl), { headers: { cookie } });
      expect(session.status).toBe(200);
      const body = (await session.json()) as { user: { email: string; role: string } } | null;
      expect(body?.user).toMatchObject({ email: SEEDED_ADMIN, role: 'admin' });
    },
    TIMEOUT_BUILD + TIMEOUT_SERVER,
  );

  test('public sign-up is rejected, a user created by an admin signs in', async () => {
    const signUp = await post(server, 
      '/api/auth/sign-up/email',
      { email: 'stranger@example.com', password: 'stranger-password', name: 'Stranger' },
      { 'x-forwarded-for': '10.0.0.2' },
    );
    expect(signUp.status).toBe(400);
    expect(await signUp.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });

    const adminCookie = await signIn(server, SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.3');
    const created = await post(server, 
      '/api/trpc/user.create',
      { json: { name: 'Created', email: 'created@example.com', role: 'user' } },
      { cookie: adminCookie },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const { result } = (await created.json()) as { result: { data: { json: { password: string } } } };

    await signIn(server, 'created@example.com', result.data.json.password, '10.0.0.4');
  });

  test('admin pages redirect a signed-in non-admin home and still serve an admin', async () => {
    const adminCookie = await signIn(server, SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.6');
    const created = await post(server, 
      '/api/trpc/user.create',
      { json: { name: 'Member', email: 'member@example.com', role: 'user' } },
      { cookie: adminCookie },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const { result } = (await created.json()) as { result: { data: { json: { password: string } } } };
    const memberCookie = await signIn(server, 'member@example.com', result.data.json.password, '10.0.0.7');

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

    for (const path of [`/admin/users/${UNKNOWN_ID}`, `/contacts/${UNKNOWN_ID}`]) {
      const missing = await fetch(new URL(path, server.url), { headers: { cookie: adminCookie } });
      expect([path, missing.status]).toEqual([path, 404]);
      expect(await missing.text(), path).toContain('Page not found');
    }

    const contacts = await fetch(new URL('/contacts', server.url), { headers: { cookie: memberCookie } });
    expect(contacts.status).toBe(200);
  });

  test('anonymous visits redirect to login, a signed-in visit to login redirects home, and the server logs no error', async () => {
    for (const path of ['/', '/contacts', '/admin/users', '/profile/account']) {
      const response = await fetch(new URL(path, server.url), { redirect: 'manual' });
      const loginUrl = path === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(path)}`;
      expect([path, response.status, response.headers.get('location')]).toEqual([path, 307, loginUrl]);
    }

    const login = await fetch(new URL('/login', server.url), {
      redirect: 'manual',
      headers: { cookie: await signIn(server, SEEDED_ADMIN, SEED_PASSWORD, '10.0.0.5') },
    });
    expect([login.status, login.headers.get('location')]).toEqual([307, '/']);

    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});

describeWithDocker('multitenant-saas-nextjs blueprint e2e')('multitenant-saas-nextjs: signup and invitation on the production build', () => {
  let projectDir: string;
  let server: RunningServer;

  beforeAll(async () => {
    projectDir = await generateInstalledProject('bp-seed-multitenant-saas', ['--blueprint', 'multitenant-saas-nextjs']);
    const setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
    expect(setup.exitCode, describeFailure(setup)).toBe(0);
    server = await buildAndStartWeb(projectDir);
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP + TIMEOUT_BUILD + TIMEOUT_SERVER);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) {
      await runCommand(['docker', 'compose', 'down', '--volumes'], projectDir);
      await cleanupTempDir(join(projectDir, '..'));
    }
  });

  test('a signed-in user is redirected away from signup while an invitee can still accept an invitation', async () => {
    const anonymous = await fetch(new URL('/signup', server.url), { redirect: 'manual' });
    expect(anonymous.status).toBe(200);

    const ownerCookie = await signIn(server, 'owner@example.com', SEED_PASSWORD, '10.1.0.1');
    const signedIn = await fetch(new URL('/signup', server.url), { redirect: 'manual', headers: { cookie: ownerCookie } });
    expect([signedIn.status, signedIn.headers.get('location')]).toEqual([307, '/']);

    const signUp = await post(
      server,
      '/api/auth/sign-up/email',
      { email: 'invitee@example.com', password: 'invitee-password', name: 'Invitee' },
      { 'x-forwarded-for': '10.1.0.2' },
    );
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const inviteeCookie = await signIn(server, 'invitee@example.com', 'invitee-password', '10.1.0.3');

    const invited = await post(
      server,
      '/api/trpc/invitation.create',
      { json: { email: 'invitee@example.com', role: 'member' } },
      { cookie: ownerCookie },
    );
    expect(invited.status, await invited.clone().text()).toBe(200);
    const { result } = (await invited.json()) as { result: { data: { json: { id: string } } } };
    const invitationId = result.data.json.id;

    const page = await fetch(new URL(`/accept-invitation/${invitationId}`, server.url), {
      redirect: 'manual',
      headers: { cookie: inviteeCookie },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Join');

    const accepted = await post(server, '/api/auth/organization/accept-invitation', { invitationId }, { cookie: inviteeCookie });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
  });

  test('pages that prefetch redirect a forged cookie to login and a user without an organization to onboarding', async () => {
    const forgedCookie = 'better-auth.session_token=forged-token.forged-signature';
    for (const path of ['/profile/account', '/profile/sessions', '/projects']) {
      const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: { cookie: forgedCookie } });
      expect([path, response.status, response.headers.get('location')]).toEqual([path, 307, '/login']);
    }

    const signUp = await post(
      server,
      '/api/auth/sign-up/email',
      { email: 'drifter@example.com', password: 'drifter-password', name: 'Drifter' },
      { 'x-forwarded-for': '10.1.0.4' },
    );
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const drifterCookie = await signIn(server, 'drifter@example.com', 'drifter-password', '10.1.0.5');
    for (const path of ['/profile/account', '/profile/sessions']) {
      const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: { cookie: drifterCookie } });
      expect([path, response.status, response.headers.get('location')]).toEqual([path, 307, '/onboarding']);
    }

    const ownerCookie = await signIn(server, 'owner@example.com', SEED_PASSWORD, '10.1.0.6');
    for (const path of ['/profile/account', '/profile/sessions']) {
      const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: { cookie: ownerCookie } });
      expect([path, response.status]).toEqual([path, 200]);
    }
  });

  test('the server logs no error', async () => {
    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});
