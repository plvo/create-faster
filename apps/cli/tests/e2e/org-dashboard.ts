import { beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, getFreePort, type RunningServer, runCommand, startServer } from './helpers';

const SEED_PASSWORD = 'password';
export const SEEDED_ADMIN = 'admin@example.com';
export const SEEDED_MEMBER = 'user@example.com';
export const SEEDED_READER = 'manager@example.com';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';
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
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
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
    const sql = async (statement: string): Promise<void> => {
      const result = await runCommand(
        ['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U postgres -d "$POSTGRES_DB" -c "${statement}"`],
        projectDir(),
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
