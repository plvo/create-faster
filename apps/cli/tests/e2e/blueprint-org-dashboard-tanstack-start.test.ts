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
const SEEDED_READER = 'manager@example.com';
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

const signIn = async (server: RunningServer, email: string, clientIp: string, password = SEED_PASSWORD): Promise<string> => {
  const response = await post(server, '/api/auth/sign-in/email', { email, password }, { 'x-forwarded-for': clientIp });
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

interface TrpcResult<T> {
  status: number;
  data: T;
}

// The tRPC endpoint speaks superjson: an input travels as { json }, a result comes back under result.data.json.
async function callTrpc<T>(server: RunningServer, procedure: string, cookie: string, input: unknown): Promise<TrpcResult<T>> {
  const response = await post(server, `/api/trpc/${procedure}`, { json: input }, { cookie });
  const body = (await response.json()) as { result?: { data: { json: T } } };
  return { status: response.status, data: body.result?.data.json as T };
}

// A mutation is a POST; a query is a GET with its input in the URL, wrapped as superjson wraps it.
async function queryTrpc<T>(server: RunningServer, procedure: string, cookie: string, input?: unknown): Promise<TrpcResult<T>> {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await fetch(new URL(`/api/trpc/${procedure}${query}`, server.url), { headers: { cookie } });
  const body = (await response.json()) as { result?: { data: { json: T } } };
  return { status: response.status, data: body.result?.data.json as T };
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface User {
  id: string;
  email: string;
}

interface Page<T> {
  items: T[];
  total: number;
}

async function firstContact(server: RunningServer, cookie: string): Promise<Contact> {
  const { status, data } = await queryTrpc<Page<Contact>>(server, 'contact.list', cookie);
  expect(status).toBe(200);
  const [contact] = data.items;
  if (!contact) throw new Error('the seed created no contact');
  return contact;
}

const idsOf = (rows: { id: string }[]): string[] => rows.map((row) => row.id);

const linksIn = (html: string, prefix: string): string[] =>
  [...new Set([...html.matchAll(new RegExp(`href="${prefix}/([^"/]+)"`, 'g'))].map((match) => match[1] ?? ''))];

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

  test('a member lists the contacts and opens one', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.7');
    const contact = await firstContact(server, cookie);

    const list = await fetch(new URL('/contacts', server.url), { headers: { cookie } });
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain('New Contact');
    expect(listHtml).toContain(`href="/contacts/${contact.id}"`);
    expect(listHtml).toContain(contact.firstName);

    const detail = await fetch(new URL(`/contacts/${contact.id}`, server.url), { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain(contact.firstName);
    expect(detailHtml).toContain(contact.lastName);
    expect(detailHtml).toContain('href="/contacts"');
    expect(detailHtml).toContain('>Edit<');

    const missing = await fetch(new URL('/contacts/no-such-contact', server.url), { headers: { cookie } });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('Page not found');
  });

  test('a read-only role opens the contacts without the buttons that write', async () => {
    const cookie = await signIn(server, SEEDED_READER, '10.2.0.8');
    const contact = await firstContact(server, cookie);

    const list = await fetch(new URL('/contacts', server.url), { headers: { cookie } });
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain(contact.firstName);
    expect(listHtml).not.toContain('New Contact');

    const detail = await fetch(new URL(`/contacts/${contact.id}`, server.url), { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain(contact.lastName);
    expect(detailHtml).not.toContain('>Edit<');
    expect(detailHtml).not.toContain('>Delete<');
  });

  test('an admin opens the user administration pages and creates a user who then signs in', async () => {
    const cookie = await signIn(server, SEEDED_ADMIN, '10.2.0.9');

    const users = await fetch(new URL('/admin/users', server.url), { headers: { cookie } });
    expect(users.status).toBe(200);
    const usersHtml = await users.text();
    expect(usersHtml).toContain('Create User');
    expect(usersHtml).toContain(SEEDED_MEMBER);

    const bare = await fetch(new URL('/admin', server.url), { headers: { cookie } });
    expect(bare.status).toBe(404);
    expect(await bare.text()).toContain('Page not found');
    const missingUser = await fetch(new URL('/admin/users/no-such-user', server.url), { headers: { cookie } });
    expect(missingUser.status).toBe(404);
    expect(await missingUser.text()).toContain('Page not found');
    const roles = await fetch(new URL('/admin/roles', server.url), { headers: { cookie } });
    expect(roles.status).toBe(200);
    expect(await roles.text()).toContain('packages/auth/src/permissions.ts');

    const created = await callTrpc<{ user: { id: string; email: string; role: string }; password: string }>(
      server,
      'user.create',
      cookie,
      { name: 'Created Colleague', email: 'colleague@example.com', role: 'manager' },
    );
    expect(created.status).toBe(200);
    expect(created.data.user).toMatchObject({ email: 'colleague@example.com', role: 'manager' });

    const detail = await fetch(new URL(`/admin/users/${created.data.user.id}`, server.url), { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailHtml = await detail.text();
    expect(detailHtml).toContain('Created Colleague');
    expect(detailHtml).toContain('colleague@example.com');

    const colleague = await signIn(server, 'colleague@example.com', '10.2.0.10', created.data.password);
    const session = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie: colleague } });
    expect(((await session.json()) as { user: { role: string } }).user.role).toBe('manager');
  });

  test('a member is redirected away from every admin page and cannot call the admin procedures', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.11');
    for (const path of ['/admin', '/admin/users', '/admin/roles', '/admin/users/any-user-id']) {
      const { status, location } = await redirectOf(server, path, cookie);
      expect([path, status, location?.pathname]).toEqual([path, 307, '/']);
    }

    const create = await callTrpc(server, 'user.create', cookie, { name: 'Intruder', email: 'intruder@example.com', role: 'admin' });
    expect(create.status).toBe(403);
  });

  test('an anonymous visitor is redirected to the login page from the contacts and admin pages', async () => {
    for (const path of ['/contacts', '/admin', '/admin/users', '/admin/roles']) {
      const { status, location } = await redirectOf(server, path);
      expect([path, status, location?.pathname, location?.searchParams.get('redirectTo')]).toEqual([path, 307, '/login', path]);
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

      const contact = await firstContact(server, await signIn(server, SEEDED_ADMIN, '10.2.0.12'));
      for (const path of ['/contacts', `/contacts/${contact.id}`]) {
        const page = await fetch(new URL(path, server.url), { redirect: 'manual', headers: { cookie } });
        expect([path, page.status]).toEqual([path, 404]);
        expect(await page.text()).toContain('Page not found');
      }

      const profile = await fetch(new URL('/profile/account', server.url), { redirect: 'manual', headers: { cookie } });
      expect(profile.status).toBe(200);
    } finally {
      await setRole('user');
    }
  });

  describe('pagination', () => {
    // Enough rows for three pages of ten, created in groups that share a creation time so the order has to be stable.
    const EXTRA_ROWS = 25;
    const sql = async (statement: string): Promise<void> => {
      const result = await runCommand(
        ['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U postgres -d "$POSTGRES_DB" -c "${statement}"`],
        projectDir,
      );
      expect(result.exitCode, describeFailure(result)).toBe(0);
    };

    beforeAll(async () => {
      const created = `timestamp '2030-01-01 00:00:00' + ((i / 5) || ' minutes')::interval`;
      await sql(
        `insert into contacts (id, first_name, last_name, email, created_at) select 'page-contact-' || i, 'Paged', 'Contact ' || i, 'paged' || i || '@example.com', ${created} from generate_series(1, ${EXTRA_ROWS}) as i`,
      );
      await sql(
        `insert into users (id, name, email, role, created_at) select 'page-user-' || i, 'Paged User ' || i, 'paged-user' || i || '@example.com', 'user', ${created} from generate_series(1, ${EXTRA_ROWS}) as i`,
      );
    });

    const readPages = async <T extends { id: string }>(procedure: string, cookie: string, pageSize: number): Promise<{ pages: T[][]; total: number }> => {
      const first = await queryTrpc<Page<T>>(server, procedure, cookie, { page: 1, pageSize });
      expect(first.status).toBe(200);
      const pages = [first.data.items];
      for (let page = 2; page <= Math.ceil(first.data.total / pageSize); page++) {
        const next = await queryTrpc<Page<T>>(server, procedure, cookie, { page, pageSize });
        expect([procedure, page, next.status]).toEqual([procedure, page, 200]);
        expect(next.data.total).toBe(first.data.total);
        pages.push(next.data.items);
      }
      return { pages, total: first.data.total };
    };

    test('the contact and user lists return one page and the total, covering every row once in a stable order', async () => {
      const admin = await signIn(server, SEEDED_ADMIN, '10.2.1.1');
      for (const [procedure, extra] of [
        ['contact.list', EXTRA_ROWS],
        ['user.list', EXTRA_ROWS],
      ] as const) {
        const { pages, total } = await readPages<{ id: string }>(procedure, admin, 10);
        expect(total, procedure).toBeGreaterThanOrEqual(extra);
        expect(pages.length, procedure).toBeGreaterThanOrEqual(3);
        for (const page of pages.slice(0, -1)) expect(page, procedure).toHaveLength(10);
        const ids = pages.flatMap(idsOf);
        expect(ids, procedure).toHaveLength(total);
        expect(new Set(ids).size, procedure).toBe(total);

        const again = await readPages<{ id: string }>(procedure, admin, 10);
        expect(again.pages.flatMap(idsOf), procedure).toEqual(ids);

        const everything = await readPages<{ id: string }>(procedure, admin, 100);
        expect(everything.pages.flatMap(idsOf), procedure).toEqual(ids);
      }
    });

    test('an invalid page or page size reads the default page and a page past the end is empty', async () => {
      const admin = await signIn(server, SEEDED_ADMIN, '10.2.1.2');
      for (const procedure of ['contact.list', 'user.list']) {
        const first = await queryTrpc<Page<{ id: string }>>(server, procedure, admin, { page: 1, pageSize: 10 });
        for (const input of [{ page: 0, pageSize: 10 }, { page: -1, pageSize: 10 }, { page: 1, pageSize: 5000 }, { page: 'x', pageSize: 10 }, {}]) {
          const result = await queryTrpc<Page<{ id: string }>>(server, procedure, admin, input);
          expect([procedure, JSON.stringify(input), result.status]).toEqual([procedure, JSON.stringify(input), 200]);
          expect(idsOf(result.data.items), JSON.stringify(input)).toEqual(idsOf(first.data.items));
        }
        const past = await queryTrpc<Page<{ id: string }>>(server, procedure, admin, { page: 99, pageSize: 10 });
        expect(past.data).toEqual({ items: [], total: first.data.total });
      }
    });

    test('the contacts page shows the page the URL names, with its range and total', async () => {
      const cookie = await signIn(server, SEEDED_MEMBER, '10.2.1.3');
      const { pages, total } = await readPages<Contact>('contact.list', cookie, 10);
      expect(pages.length).toBeGreaterThanOrEqual(3);

      for (const [index, rows] of pages.entries()) {
        const html = await (await fetch(new URL(`/contacts?page=${index + 1}`, server.url), { headers: { cookie } })).text();
        expect(linksIn(html, '/contacts').sort(), `page ${index + 1}`).toEqual(idsOf(rows).sort());
        const first = index * 10 + 1;
        expect(html, `page ${index + 1}`).toContain(`Showing ${first}\u2013${first + rows.length - 1} of ${total} contacts`);
      }

      const sized = await (await fetch(new URL('/contacts?pageSize=50', server.url), { headers: { cookie } })).text();
      expect(linksIn(sized, '/contacts')).toHaveLength(Math.min(50, total));
    });

    test('a contacts page past the end says so and offers the way back', async () => {
      const cookie = await signIn(server, SEEDED_MEMBER, '10.2.1.4');
      const html = await (await fetch(new URL('/contacts?page=99', server.url), { headers: { cookie } })).text();
      expect(html).toContain('Go to the last page');
      expect(linksIn(html, '/contacts')).toEqual([]);

      const invalid = await (await fetch(new URL('/contacts?page=abc&pageSize=7', server.url), { headers: { cookie } })).text();
      expect(linksIn(invalid, '/contacts')).toHaveLength(10);
    });

    test('the users page pages the same way and stays admin only', async () => {
      const admin = await signIn(server, SEEDED_ADMIN, '10.2.1.5');
      const { pages, total } = await readPages<User>('user.list', admin, 10);
      for (const [index, rows] of pages.entries()) {
        const html = await (await fetch(new URL(`/admin/users?page=${index + 1}`, server.url), { headers: { cookie: admin } })).text();
        expect(linksIn(html, '/admin/users').sort(), `page ${index + 1}`).toEqual(idsOf(rows).sort());
        const first = index * 10 + 1;
        expect(html, `page ${index + 1}`).toContain(`Showing ${first}\u2013${first + rows.length - 1} of ${total} users`);
      }

      const past = await (await fetch(new URL('/admin/users?page=99', server.url), { headers: { cookie: admin } })).text();
      expect(past).toContain('Go to the last page');

      const member = await signIn(server, SEEDED_MEMBER, '10.2.1.6');
      expect((await queryTrpc(server, 'user.list', member, { page: 1, pageSize: 10 })).status).toBe(403);
      const redirect = await redirectOf(server, '/admin/users?page=2', member);
      expect([redirect.status, redirect.location?.pathname]).toEqual([307, '/']);
    });
  });

  test('an unknown page answers not found and the server logs no error', async () => {
    const cookie = await signIn(server, SEEDED_MEMBER, '10.2.0.5');
    const missing = await fetch(new URL('/no-such-page', server.url), { headers: { cookie } });
    expect(missing.status).toBe(404);

    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});
