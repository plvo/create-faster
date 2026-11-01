import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, getFreePort, type RunningServer, runCommand, startServer } from './helpers';
import { cookieHeaderOf } from './set-cookie';

const SEED_PASSWORD = 'password';
export const SEEDED_ADMIN = 'admin@example.com';
export const SEEDED_MEMBER = 'user@example.com';
export const SEEDED_READER = 'manager@example.com';
export const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';
const TIMEOUT_SERVER = 120_000;

export function describeFailure(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

export const post = (server: RunningServer, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(new URL(path, server.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url, ...headers },
    body: JSON.stringify(body),
  });

export const signIn = async (server: RunningServer, email: string, clientIp: string, password = SEED_PASSWORD): Promise<string> => {
  const response = await post(server, '/api/auth/sign-in/email', { email, password }, { 'x-forwarded-for': clientIp });
  expect(response.status, await response.clone().text()).toBe(200);
  return cookieHeaderOf(response);
};

export const redirectOf = async (server: RunningServer, path: string, cookie?: string): Promise<{ status: number; location: URL | null }> => {
  const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const location = response.headers.get('location');
  return { status: response.status, location: location ? new URL(location, server.url) : null };
};

// Builds the generated project and starts the production server of its web app on a free port, signed against it.
export async function buildAndStartWeb(projectDir: string): Promise<RunningServer> {
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

interface TrpcResult<T> {
  status: number;
  data: T;
}

// The tRPC endpoint speaks superjson: an input travels as { json }, a result comes back under result.data.json.
// A mutation is a POST; a query is a GET with its input in the URL, wrapped as superjson wraps it.
export async function callTrpc<T>(server: RunningServer, procedure: string, cookie: string, input: unknown): Promise<TrpcResult<T>> {
  const response = await post(server, `/api/trpc/${procedure}`, { json: input }, { cookie });
  const body = (await response.json()) as { result?: { data: { json: T } } };
  return { status: response.status, data: body.result?.data.json as T };
}

export async function queryTrpc<T>(server: RunningServer, procedure: string, cookie: string, input?: unknown): Promise<TrpcResult<T>> {
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

export async function firstContact(server: RunningServer, cookie: string): Promise<Contact> {
  const { status, data: contacts } = await queryTrpc<Contact[]>(server, 'contact.list', cookie);
  expect(status).toBe(200);
  const [contact] = contacts;
  if (!contact) throw new Error('the seed created no contact');
  return contact;
}

const idsOf = (rows: { id: string }[]): string[] => rows.map((row) => row.id);

const linksIn = (html: string, prefix: string): string[] =>
  [...new Set([...html.matchAll(new RegExp(`href="${prefix}/([^"/]+)"`, 'g'))].map((match) => match[1] ?? ''))];

// A statement run by psql in the database container of the project. It sits inside double quotes of the container's
// shell, so it holds no double quote, dollar sign or backtick.
async function psql(projectDir: string, statement: string): Promise<void> {
  const result = await runCommand(
    ['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U postgres -d "$POSTGRES_DB" -c "${statement}"`],
    projectDir,
  );
  expect(result.exitCode, describeFailure(result)).toBe(0);
}

// The rows a statement selects, one array of columns per row, as psql prints them unaligned. The same restrictions as psql.
async function psqlRows(projectDir: string, statement: string): Promise<string[][]> {
  const result = await runCommand(
    ['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U postgres -d "$POSTGRES_DB" -At -F '|' -c "${statement}"`],
    projectDir,
  );
  expect(result.exitCode, describeFailure(result)).toBe(0);
  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('|'));
}

interface PagingContext {
  server: () => RunningServer;
  projectDir: () => string;
}

// Enough rows for three pages of ten, created in groups that share a creation time so the order has to be stable.
const EXTRA_ROWS = 25;

// The paging of the contacts and users lists against the production server and the seeded Docker database: the
// tRPC procedures, and the HTML the server renders for a page of the URL.
export function describePaging({ server, projectDir }: PagingContext): void {
  describe('pagination', () => {
    const sql = (statement: string): Promise<void> => psql(projectDir(), statement);

    beforeAll(async () => {
      const created = `timestamp '2030-01-01 00:00:00' + ((i / 5) || ' minutes')::interval`;
      await sql(
        `insert into contacts (id, first_name, last_name, email, created_at) select 'page-contact-' || i, 'Paged', 'Contact ' || i, 'paged' || i || '@example.com', ${created} from generate_series(1, ${EXTRA_ROWS}) as i`,
      );
      await sql(
        `insert into users (id, name, email, role, created_at) select 'page-user-' || i, 'Paged User ' || i, 'paged-user' || i || '@example.com', 'user', ${created} from generate_series(1, ${EXTRA_ROWS}) as i`,
      );
    });

    const readPages = async <T extends { id: string }>(
      list: string,
      count: string,
      cookie: string,
      pageSize: number,
    ): Promise<{ pages: T[][]; total: number }> => {
      const total = await queryTrpc<number>(server(), count, cookie);
      expect([count, total.status]).toEqual([count, 200]);
      const pages: T[][] = [];
      for (let page = 1; page <= Math.ceil(total.data / pageSize); page++) {
        const next = await queryTrpc<T[]>(server(), list, cookie, { page, pageSize });
        expect([list, page, next.status]).toEqual([list, page, 200]);
        pages.push(next.data);
      }
      return { pages, total: total.data };
    };

    const LISTS = [
      { list: 'contact.list', count: 'contact.count' },
      { list: 'user.list', count: 'user.count' },
    ] as const;

    test('the contact and user lists return one page, and the count the total, covering every row once in a stable order', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.2.1.1');
      for (const { list, count } of LISTS) {
        const { pages, total } = await readPages<{ id: string }>(list, count, admin, 10);
        expect(total, list).toBeGreaterThanOrEqual(EXTRA_ROWS);
        expect(pages.length, list).toBeGreaterThanOrEqual(3);
        for (const page of pages.slice(0, -1)) expect(page, list).toHaveLength(10);
        const ids = pages.flatMap(idsOf);
        expect(ids, list).toHaveLength(total);
        expect(new Set(ids).size, list).toBe(total);

        const again = await readPages<{ id: string }>(list, count, admin, 10);
        expect(again.pages.flatMap(idsOf), list).toEqual(ids);

        const everything = await readPages<{ id: string }>(list, count, admin, 100);
        expect(everything.pages.flatMap(idsOf), list).toEqual(ids);
      }
    });

    test('an invalid page or page size reads the default page and a page past the end is empty', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.2.1.2');
      for (const { list } of LISTS) {
        const first = await queryTrpc<{ id: string }[]>(server(), list, admin, { page: 1, pageSize: 10 });
        for (const input of [{ page: 0, pageSize: 10 }, { page: -1, pageSize: 10 }, { page: 1, pageSize: 5000 }, { page: 'x', pageSize: 10 }, {}]) {
          const result = await queryTrpc<{ id: string }[]>(server(), list, admin, input);
          expect([list, JSON.stringify(input), result.status]).toEqual([list, JSON.stringify(input), 200]);
          expect(idsOf(result.data), JSON.stringify(input)).toEqual(idsOf(first.data));
        }
        const past = await queryTrpc<{ id: string }[]>(server(), list, admin, { page: 99, pageSize: 10 });
        expect(past.data).toEqual([]);
      }
    });

    test('the contacts page shows the page the URL names, with its range and total', async () => {
      const cookie = await signIn(server(), SEEDED_MEMBER, '10.2.1.3');
      const { pages, total } = await readPages<Contact>('contact.list', 'contact.count', cookie, 10);
      expect(pages.length).toBeGreaterThanOrEqual(3);

      for (const [index, rows] of pages.entries()) {
        const html = await (await fetch(new URL(`/contacts?page=${index + 1}`, server().url), { headers: { cookie } })).text();
        expect(linksIn(html, '/contacts').sort(), `page ${index + 1}`).toEqual(idsOf(rows).sort());
        const first = index * 10 + 1;
        expect(html, `page ${index + 1}`).toContain(`Showing ${first}–${first + rows.length - 1} of ${total} contacts`);
      }

      const sized = await (await fetch(new URL('/contacts?pageSize=50', server().url), { headers: { cookie } })).text();
      expect(linksIn(sized, '/contacts')).toHaveLength(Math.min(50, total));
    });

    test('a contacts page past the end says so and offers the way back', async () => {
      const cookie = await signIn(server(), SEEDED_MEMBER, '10.2.1.4');
      const html = await (await fetch(new URL('/contacts?page=99', server().url), { headers: { cookie } })).text();
      expect(html).toContain('Go to the last page');
      expect(html).toMatch(/\d+ contacts in total/);
      expect(linksIn(html, '/contacts')).toEqual([]);

      const invalid = await (await fetch(new URL('/contacts?page=abc&pageSize=7', server().url), { headers: { cookie } })).text();
      expect(linksIn(invalid, '/contacts')).toHaveLength(10);
    });

    test('the users page pages the same way and stays admin only', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.2.1.5');
      const { pages, total } = await readPages<User>('user.list', 'user.count', admin, 10);
      for (const [index, rows] of pages.entries()) {
        const html = await (await fetch(new URL(`/admin/users?page=${index + 1}`, server().url), { headers: { cookie: admin } })).text();
        expect(linksIn(html, '/admin/users').sort(), `page ${index + 1}`).toEqual(idsOf(rows).sort());
        const first = index * 10 + 1;
        expect(html, `page ${index + 1}`).toContain(`Showing ${first}–${first + rows.length - 1} of ${total} users`);
      }

      const past = await (await fetch(new URL('/admin/users?page=99', server().url), { headers: { cookie: admin } })).text();
      expect(past).toContain('Go to the last page');

      const member = await signIn(server(), SEEDED_MEMBER, '10.2.1.6');
      for (const procedure of ['user.list', 'user.count']) {
        expect([procedure, (await queryTrpc(server(), procedure, member, procedure === 'user.list' ? { page: 1, pageSize: 10 } : undefined)).status]).toEqual([
          procedure,
          403,
        ]);
      }
      const redirect = await redirectOf(server(), '/admin/users?page=2', member);
      expect([redirect.status, redirect.location?.pathname]).toEqual([307, '/']);
    });
  });
}

export interface SearchGroup {
  type: string;
  label: string;
  items: { id: string; title: string; subtitle: string; href: string }[];
}

export const titlesOf = (groups: SearchGroup[], type: string): string[] =>
  groups.find((group) => group.type === type)?.items.map((item) => item.title) ?? [];

// The palette search against the production server and the seeded Docker database: the real Postgres matches the text,
// and the real Better Auth decides which types a role may read.
export function describeSearch({ server, projectDir }: PagingContext): void {
  describe('palette search', () => {
    const sql = (statement: string): Promise<void> => psql(projectDir(), statement);

    const records = async (cookie: string, query: string): Promise<SearchGroup[]> => {
      const result = await queryTrpc<SearchGroup[]>(server(), 'search.records', cookie, { query });
      expect([query, result.status]).toEqual([query, 200]);
      return result.data;
    };

    beforeAll(async () => {
      await sql(
        `insert into contacts (id, first_name, last_name, email, company) values ('srch-zelda', 'Zelda', 'Quirk', 'zelda@quirk.example', 'Quirk Labs'), ('srch-percent', 'Pct', '50% Off', null, null), ('srch-plain', 'Pct', '50 Off', null, null), ('srch-underscore', 'Plan_b', 'Notes', null, null), ('srch-letter', 'PlanXb', 'Notes', null, null)`,
      );
      await sql(
        `insert into contacts (id, first_name, last_name, created_at) select 'srch-bulk-' || i, 'Bulkrow', 'Number ' || i, timestamp '2031-01-01 00:00:00' + (i || ' minutes')::interval from generate_series(1, 8) as i`,
      );
      await sql(
        `insert into users (id, name, email, email_verified, role) values ('srch-user', 'Quirkly Person', 'quirkly@example.com', false, 'user')`,
      );
    });

    test('an administrator finds contacts and users, each with the page that opens it, whatever the case', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.4.1.1');
      const groups = await records(admin, 'QUIRK');
      expect(groups.map((group) => [group.type, group.label])).toEqual([
        ['contacts', 'Contacts'],
        ['users', 'Users'],
      ]);
      expect(groups[0]?.items).toEqual([
        { id: 'srch-zelda', title: 'Zelda Quirk', subtitle: 'zelda@quirk.example', href: '/contacts/srch-zelda' },
      ]);
      expect(groups[1]?.items).toEqual([
        { id: 'srch-user', title: 'Quirkly Person', subtitle: 'quirkly@example.com', href: '/admin/users/srch-user' },
      ]);
      expect(titlesOf(await records(admin, 'zelda qu'), 'contacts')).toEqual(['Zelda Quirk']);
      expect(titlesOf(await records(admin, 'quirk labs'), 'contacts')).toEqual(['Zelda Quirk']);
    });

    test('% and _ match themselves, as the contacts list would show them', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.4.1.2');
      expect(titlesOf(await records(admin, '50%'), 'contacts')).toEqual(['Pct 50% Off']);
      expect(await records(admin, '%%')).toEqual([]);
      expect(titlesOf(await records(admin, 'n_b'), 'contacts')).toEqual(['Plan_b Notes']);
      expect(await records(admin, '__')).toEqual([]);
    });

    test('a type returns five items at most, the newest first', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.4.1.3');
      expect(titlesOf(await records(admin, 'bulkrow'), 'contacts')).toEqual([
        'Bulkrow Number 8',
        'Bulkrow Number 7',
        'Bulkrow Number 6',
        'Bulkrow Number 5',
        'Bulkrow Number 4',
      ]);
    });

    test('a text under two characters, or nothing, returns no group', async () => {
      const admin = await signIn(server(), SEEDED_ADMIN, '10.4.1.4');
      expect(await records(admin, 'q')).toEqual([]);
      expect(await records(admin, '   ')).toEqual([]);
    });

    test.each([
      ['a user', SEEDED_MEMBER, '10.4.1.5'],
      ['a manager', SEEDED_READER, '10.4.1.6'],
    ])('%s finds contacts and no users, although a user matches', async (_role, email, ip) => {
      const cookie = await signIn(server(), email, ip);
      const groups = await records(cookie, 'quirk');
      expect(groups.map((group) => group.type)).toEqual(['contacts']);
      expect(await records(cookie, 'quirkly')).toEqual([]);
    });

    test('a role that cannot read contacts gets no group, as the contacts list refuses it', async () => {
      const cookie = await signIn(server(), SEEDED_MEMBER, '10.4.1.7');
      try {
        await sql(`update users set role = 'guest' where email = '${SEEDED_MEMBER}'`);
        expect(await records(cookie, 'quirk')).toEqual([]);
        const list = await queryTrpc(server(), 'contact.list', cookie, { page: 1, pageSize: 10 });
        expect(list.status).toBe(403);
      } finally {
        await sql(`update users set role = 'user' where email = '${SEEDED_MEMBER}'`);
      }
    });

    test('an anonymous request is refused', async () => {
      const result = await queryTrpc(server(), 'search.records', '', { query: 'quirk' });
      expect(result.status).toBe(401);
    });
  });
}

// A role the real application never ships: everything below creates and removes its own.
const AUDITOR = 'auditor';

// Values a request could send as a role that are not the id of one existing role. Each is something better-auth's `admin`
// plugin stores or treats as a role of some kind: it splits `user.role` on `,`, so `user,admin` is an administrator to it
// and nothing to the permission engine.
const NOT_ONE_EXISTING_ROLE: unknown[] = ['user,admin', 'admin,user', ['user', 'admin'], 'Admin', ' admin', 'ghost', 'constructor', '__proto__', ''];

interface MutationResult {
  status: number;
  message?: string;
  data?: unknown;
}

// What the test writes into the generated project to race the guarded writes: two administrators who demote, ban or
// remove each other at once, and an assignment against a delete of the same role, over the real pool of the project.
// It prints the violations it saw, which are none when the writes hold.
const RACE_SCRIPT = `import { assignRole, claimBan, removeAccount } from '@repo/auth/role-assignment';
import { deleteRoleUnlessHeld } from '@repo/auth/role-store';
import { and, db, eq, inArray, roleTable, sql, userTable } from '@repo/db';

const REPETITIONS = Number(process.env.RACE_REPETITIONS ?? 20);
const writes = {
  demote: (id: string) => assignRole(db, id, 'user'),
  ban: (id: string) => claimBan(db, id),
  remove: (id: string) => removeAccount(db, id),
};
const violations: string[] = [];

const administrators = async () =>
  (await db.select({ id: userTable.id }).from(userTable).where(and(eq(userTable.role, 'admin'), sql\`not coalesce(banned, false)\`))).map((row) => row.id);

async function main() {
  // The seeded administrator would remain after any race, so it is a plain user while the accounts race.
  await db.update(userTable).set({ role: 'user' }).where(eq(userTable.email, 'admin@example.com'));
  try {
    for (const first of Object.keys(writes) as (keyof typeof writes)[]) {
      for (const second of Object.keys(writes) as (keyof typeof writes)[]) {
        for (let attempt = 0; attempt < REPETITIONS; attempt++) {
          const ids = ['race-a', 'race-b'];
          await db.delete(userTable).where(inArray(userTable.id, ids));
          await db.insert(userTable).values(ids.map((id) => ({ id, name: id, email: id + '@race.example', role: 'admin' })));
          const results = await Promise.allSettled([writes[first]('race-b'), writes[second]('race-a')]);
          const remaining = await administrators();
          const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
          if (remaining.length !== 1 || fulfilled !== 1) violations.push(first + '/' + second + ' #' + attempt + ': ' + fulfilled + ' went through, ' + remaining.length + ' administrators remain');
        }
      }
    }

    for (let attempt = 0; attempt < REPETITIONS * 3; attempt++) {
      await db.delete(userTable).where(eq(userTable.id, 'race-holder'));
      await db.delete(roleTable).where(eq(roleTable.id, 'race-role'));
      await db.insert(roleTable).values({ id: 'race-role', label: 'Race' });
      await db.insert(userTable).values({ id: 'race-holder', name: 'holder', email: 'holder@race.example', role: 'user' });
      await Promise.allSettled([assignRole(db, 'race-holder', 'race-role'), deleteRoleUnlessHeld(db, 'race-role')]);
      const [holder] = await db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, 'race-holder'));
      const [role] = await db.select({ id: roleTable.id }).from(roleTable).where(eq(roleTable.id, 'race-role'));
      if (holder?.role === 'race-role' && !role) violations.push('assign/delete #' + attempt + ': the account holds a role that was deleted');
    }
  } finally {
    await db.delete(userTable).where(inArray(userTable.id, ['race-a', 'race-b', 'race-holder']));
    await db.delete(roleTable).where(eq(roleTable.id, 'race-role'));
    await db.update(userTable).set({ role: 'admin' }).where(eq(userTable.email, 'admin@example.com'));
  }
}

main()
  .then(() => {
    console.log('RACE_VIOLATIONS ' + JSON.stringify(violations));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

// What the roles of the database do on the served project and its real PostgreSQL: the matrix, a revocation at the next
// request, the values that must never become a role, and two requests that race. Every test restores what it changed.
export function describeRoles({ server, projectDir, rendersMatrixOnServer }: PagingContext & { rendersMatrixOnServer: boolean }): void {
  describe('roles', () => {
    let clientNumber = 0;
    const nextIp = (): string => `10.5.${Math.floor(clientNumber / 200)}.${(clientNumber++ % 200) + 1}`;
    const sql = (statement: string): Promise<void> => psql(projectDir(), statement);
    const rows = (statement: string): Promise<string[][]> => psqlRows(projectDir(), statement);
    const roleOf = async (email: string): Promise<string | undefined> => (await rows(`select role from users where email = '${email}'`))[0]?.[0];
    const idOf = async (email: string): Promise<string> => String((await rows(`select id from users where email = '${email}'`))[0]?.[0]);
    const signedIn = (email: string): Promise<string> => signIn(server(), email, nextIp());

    const permissionsOf = (cookie: string): Promise<{ status: number; data: string[] }> => queryTrpc<string[]>(server(), 'permissions.mine', cookie);

    // A tRPC mutation is a POST with its input wrapped as superjson wraps it, and a refusal carries its message.
    const mutate = async (procedure: string, cookie: string, input: unknown): Promise<MutationResult> => {
      const response = await post(server(), `/api/trpc/${procedure}`, { json: input }, { cookie });
      const body = (await response.json()) as { result?: { data: { json: unknown } }; error?: { json: { message: string } } };
      return { status: response.status, message: body.error?.json.message, data: body.result?.data.json };
    };

    // A POST to the Better Auth endpoints, as a browser sends it.
    const authPost = async (path: string, cookie: string, body: unknown): Promise<{ status: number; message?: string }> => {
      const response = await post(server(), `/api/auth${path}`, body, { cookie, 'x-forwarded-for': nextIp() });
      const answer = (await response.json().catch(() => null)) as { message?: string } | null;
      return { status: response.status, message: answer?.message };
    };

    interface Matrix {
      roles: { id: string; permissions: string[]; holders: number; deletable: boolean }[];
    }
    const matrixOf = async (cookie: string): Promise<Matrix> => {
      const answer = await queryTrpc<Matrix>(server(), 'roles.matrix', cookie);
      expect(answer.status).toBe(200);
      return answer.data;
    };

    // What a refusal that failed to refuse would leave behind, restored whatever the assertions found.
    const restoreDefaults = async (): Promise<void> => {
      await sql(`delete from users where email like 'stray%@example.com'`);
      await sql(`update users set role = 'user' where email = '${SEEDED_MEMBER}'`);
      await sql(`update users set role = 'manager' where email = '${SEEDED_READER}'`);
      await sql(`update users set role = 'admin', banned = false where email = '${SEEDED_ADMIN}'`);
      await sql(`delete from role_permissions where role_id not in ('user', 'manager')`);
      await sql(`delete from roles where id not in ('user', 'manager')`);
      await sql(`delete from role_permissions where role_id = 'manager' and action <> 'read'`);
      await sql(`delete from role_permissions where role_id = 'user' and action not in ('create', 'read', 'update', 'delete')`);
      await sql(`insert into role_permissions (role_id, resource, action) select 'user', 'contact', a from unnest(array['create', 'read', 'update', 'delete']) as a on conflict do nothing`);
      await sql(`insert into role_permissions (role_id, resource, action) values ('manager', 'contact', 'read') on conflict do nothing`);
    };

    afterEach(restoreDefaults);

    test('local-setup wrote the default roles, and the command run again changes nothing', async () => {
      expect(await rows('select id, label from roles order by id')).toEqual([
        ['manager', 'Manager'],
        ['user', 'User'],
      ]);
      expect(await rows('select role_id, action from role_permissions order by role_id, action')).toEqual([
        ['manager', 'read'],
        ['user', 'create'],
        ['user', 'delete'],
        ['user', 'read'],
        ['user', 'update'],
      ]);

      await sql(`delete from role_permissions where role_id = 'user' and action = 'delete'`);
      const again = await runCommand(['bun', 'run', 'db:roles'], projectDir());
      expect(again.exitCode, describeFailure(again)).toBe(0);
      expect(again.stdout).toContain('already has roles');
      expect(await rows(`select action from role_permissions where role_id = 'user' order by action`)).toEqual([['create'], ['read'], ['update']]);
    });

    test('the server resolves the permission list of each caller, from the rows of the database', async () => {
      expect((await permissionsOf(await signedIn(SEEDED_MEMBER))).data.sort()).toEqual(['contact.create', 'contact.delete', 'contact.read', 'contact.update']);
      expect((await permissionsOf(await signedIn(SEEDED_READER))).data).toEqual(['contact.read']);
      expect((await permissionsOf(await signedIn(SEEDED_ADMIN))).data).toEqual(expect.arrayContaining(['contact.read', 'user.list', 'session.list']));
      expect((await permissionsOf('')).status).toBe(401);
    });

    test('a stored row naming user or session is no part of what the caller may do', async () => {
      await sql(`insert into role_permissions (role_id, resource, action) values ('manager', 'user', 'list'), ('manager', 'session', 'list'), ('manager', 'contact', 'explode')`);
      const cookie = await signedIn(SEEDED_READER);
      expect((await permissionsOf(cookie)).data).toEqual(['contact.read']);
      expect((await queryTrpc(server(), 'user.list', cookie, { page: 1, pageSize: 10 })).status).toBe(403);
    });

    test('only the literal admin role manages roles, over HTTP', async () => {
      for (const email of [SEEDED_MEMBER, SEEDED_READER]) {
        const cookie = await signedIn(email);
        expect((await queryTrpc(server(), 'roles.matrix', cookie)).status).toBe(403);
        expect((await queryTrpc(server(), 'user.assignableRoles', cookie)).status).toBe(403);
        expect((await mutate('roles.create', cookie, { id: AUDITOR, label: 'Auditor' })).status).toBe(403);
        expect((await mutate('roles.setPermission', cookie, { id: 'manager', permission: 'contact.delete', granted: true })).status).toBe(403);
        expect((await mutate('roles.remove', cookie, { id: 'manager' })).status).toBe(403);
      }
      expect((await mutate('roles.create', '', { id: AUDITOR, label: 'Auditor' })).status).toBe(401);
      expect(await rows(`select id from roles where id = '${AUDITOR}'`)).toEqual([]);
    });

    test('a role is created, granted, held and revoked, and a user holding it is refused at the very next request', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      expect((await mutate('roles.create', admin, { id: AUDITOR, label: 'Auditor' })).status).toBe(200);
      expect((await mutate('roles.setPermission', admin, { id: AUDITOR, permission: 'contact.read', granted: true })).status).toBe(200);
      expect((await matrixOf(admin)).roles.find((role) => role.id === AUDITOR)).toMatchObject({ permissions: ['contact.read'], holders: 0 });

      const memberId = await idOf(SEEDED_MEMBER);
      expect((await mutate('user.setRole', admin, { id: memberId, role: AUDITOR })).status).toBe(200);
      const member = await signedIn(SEEDED_MEMBER);
      expect((await permissionsOf(member)).data).toEqual(['contact.read']);
      expect((await queryTrpc(server(), 'contact.count', member)).status).toBe(200);

      expect((await mutate('roles.setPermission', admin, { id: AUDITOR, permission: 'contact.read', granted: false })).status).toBe(200);
      expect((await queryTrpc(server(), 'contact.count', member)).status).toBe(403);
      expect((await permissionsOf(member)).data).toEqual([]);

      expect((await mutate('roles.setPermission', admin, { id: AUDITOR, permission: 'contact.read', granted: true })).status).toBe(200);
      expect((await queryTrpc(server(), 'contact.count', member)).status).toBe(200);
    });

    test('the first render of the sidebar follows the role, and a role without the permission answers 404 for its page', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      expect((await mutate('roles.create', admin, { id: AUDITOR, label: 'Auditor' })).status).toBe(200);
      expect((await mutate('roles.setPermission', admin, { id: AUDITOR, permission: 'contact.read', granted: true })).status).toBe(200);
      await sql(`update users set role = '${AUDITOR}' where email = '${SEEDED_MEMBER}'`);
      const member = await signedIn(SEEDED_MEMBER);
      const linksOf = async (path: string, cookie: string): Promise<string[]> => {
        const response = await fetch(new URL(path, server().url), { headers: { cookie } });
        expect([path, response.status]).toEqual([path, 200]);
        const html = await response.text();
        const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).filter((anchor) => anchor.includes('data-sidebar="menu-button"'));
        return [...new Set(anchors.map((anchor) => /href="([^"]+)"/.exec(anchor)?.[1] ?? ''))];
      };
      expect(await linksOf('/contacts', member)).toEqual(['/', '/contacts']);
      expect(await linksOf('/contacts', admin)).toEqual(['/', '/contacts', '/admin/users', '/admin/roles']);

      await sql(`delete from role_permissions where role_id = '${AUDITOR}'`);
      expect(await linksOf('/profile/account', member)).toEqual(['/']);
      expect((await fetch(new URL('/contacts', server().url), { headers: { cookie: member } })).status).toBe(404);
    });

    test('a role someone holds is refused, with the reason, and a free one is deleted with its permissions', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      await mutate('roles.create', admin, { id: AUDITOR, label: 'Auditor' });
      await mutate('roles.setPermission', admin, { id: AUDITOR, permission: 'contact.read', granted: true });
      await mutate('user.setRole', admin, { id: await idOf(SEEDED_MEMBER), role: AUDITOR });

      const refused = await mutate('roles.remove', admin, { id: AUDITOR });
      expect(refused.status).toBe(409);
      expect(refused.message).toContain('1 account holds this role');
      expect(await rows(`select count(*) from role_permissions where role_id = '${AUDITOR}'`)).toEqual([['1']]);

      await mutate('user.setRole', admin, { id: await idOf(SEEDED_MEMBER), role: 'user' });
      expect((await mutate('roles.remove', admin, { id: AUDITOR })).status).toBe(200);
      expect(await rows(`select count(*) from roles where id = '${AUDITOR}'`)).toEqual([['0']]);
      expect(await rows(`select count(*) from role_permissions where role_id = '${AUDITOR}'`)).toEqual([['0']]);
    });

    test('a grant outside the code vocabulary, admin and the reserved ids are refused, and nothing is written', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      for (const permission of ['user.list', 'user.delete', 'session.revoke', 'contact.explode', 'contact', '']) {
        expect([permission, (await mutate('roles.setPermission', admin, { id: 'manager', permission, granted: true })).status]).toEqual([permission, 400]);
      }
      for (const id of ['admin', 'user', 'constructor', 'toString', 'Auditor', 'with space', 'a'.repeat(41)]) {
        expect([id, (await mutate('roles.create', admin, { id, label: 'Label' })).status]).toEqual([id, 400]);
      }
      expect((await mutate('roles.setPermission', admin, { id: 'admin', permission: 'contact.read', granted: true })).status).toBe(400);
      expect((await mutate('roles.remove', admin, { id: 'admin' })).status).toBe(400);
      expect((await mutate('roles.remove', admin, { id: 'user' })).status).toBe(400);
      expect(await rows('select count(*) from role_permissions')).toEqual([['5']]);
      expect(await rows('select id from roles order by id')).toEqual([['manager'], ['user']]);
    });

    test('a role is exactly one id that exists, whichever endpoint writes it, and an administrator cannot change their own', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      const memberId = await idOf(SEEDED_MEMBER);
      for (const role of NOT_ONE_EXISTING_ROLE) {
        expect([role, (await authPost('/admin/set-role', admin, { userId: memberId, role })).status]).toEqual([role, 400]);
        expect([role, (await authPost('/admin/update-user', admin, { userId: memberId, data: { role } })).status]).toEqual([role, 400]);
        expect([role, (await mutate('user.setRole', admin, { id: memberId, role: role as string })).status]).toEqual([role, 400]);
      }
      expect(await roleOf(SEEDED_MEMBER)).toBe('user');
      expect((await mutate('user.setRole', admin, { id: await idOf(SEEDED_ADMIN), role: 'user' })).message).toBe('You cannot change your own role');
      expect(await roleOf(SEEDED_ADMIN)).toBe('admin');

      expect((await authPost('/admin/set-role', admin, { userId: memberId, role: 'manager' })).status).toBe(200);
      expect(await roleOf(SEEDED_MEMBER)).toBe('manager');
    });

    test('the raw create-user endpoint takes admin or the default role only, so a role cannot be deleted under the account', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      const create = (email: string, role: unknown) => authPost('/admin/create-user', admin, { email, password: 'password', name: 'Stray', role });
      expect((await create('stray-manager@example.com', 'manager')).status).toBe(400);
      expect((await create('stray-ghost@example.com', 'ghost')).status).toBe(400);
      expect((await create('stray-list@example.com', ['admin'])).status).toBe(400);
      expect(await rows(`select email from users where email like 'stray%'`)).toEqual([]);
      expect((await create('stray-user@example.com', 'user')).status).toBe(200);
      expect(await roleOf('stray-user@example.com')).toBe('user');
    });

    test('the dashboard creates the account on the default role and then gives it the chosen one', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      await mutate('roles.create', admin, { id: AUDITOR, label: 'Auditor' });
      expect((await mutate('user.create', admin, { name: 'Stray', email: 'stray-audit@example.com', role: AUDITOR })).status).toBe(200);
      expect(await roleOf('stray-audit@example.com')).toBe(AUDITOR);
      const half = await mutate('user.create', admin, { name: 'Stray', email: 'stray-half@example.com', role: 'ghost' });
      expect(half.status).toBe(400);
      expect(await roleOf('stray-half@example.com')).toBe('user');
    });

    test('an administrator cannot ban, remove or demote themselves, so the sole administrator stays', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      const adminId = await idOf(SEEDED_ADMIN);
      expect((await authPost('/admin/ban-user', admin, { userId: adminId })).message).toBe('You cannot ban yourself');
      expect((await authPost('/admin/remove-user', admin, { userId: adminId })).message).toBe('You cannot remove yourself');
      expect((await authPost('/admin/set-role', admin, { userId: adminId, role: 'user' })).message).toBe('You cannot change your own role');
      expect(await rows(`select count(*) from users where role = 'admin' and not coalesce(banned, false)`)).toEqual([['1']]);
    });

    test.skipIf(!rendersMatrixOnServer)('the roles page renders the matrix from the database, with a labelled box for each stored role', async () => {
      const admin = await signedIn(SEEDED_ADMIN);
      const response = await fetch(new URL('/admin/roles', server().url), { headers: { cookie: admin } });
      expect(response.status).toBe(200);
      // React separates the text nodes of `{label} may {name}` with comments.
      const html = (await response.text()).replaceAll('<!-- -->', '');
      expect(html).toContain('Permissions granted to each role');
      expect(html).toContain('Manager may contact.read');
      expect(html).toContain('User may contact.delete');
      expect(html).toContain('Delete role Manager');
      expect(html).not.toContain('Manager may user.list');
      expect(html).not.toContain('Delete role User');
      expect(html).not.toContain('Delete role Admin');

      const manager = await redirectOf(server(), '/admin/roles', await signedIn(SEEDED_READER));
      expect([manager.status, manager.location?.pathname]).toEqual([307, '/']);
    });

    test('two requests at once, over the real pool of the project, never leave zero administrators or a deleted role held', async () => {
      const script = join(projectDir(), 'race.ts');
      await writeFile(script, RACE_SCRIPT);
      try {
        const result = await runCommand(['bun', '--env-file=apps/web/.env', 'race.ts'], projectDir(), { RACE_REPETITIONS: '15' });
        expect(result.exitCode, describeFailure(result)).toBe(0);
        const line = result.stdout.split('\n').find((candidate) => candidate.startsWith('RACE_VIOLATIONS '));
        expect(JSON.parse(line?.slice('RACE_VIOLATIONS '.length) ?? '["the script printed nothing"]')).toEqual([]);
      } finally {
        await rm(script, { force: true });
      }
    }, 240_000);
  });
}
