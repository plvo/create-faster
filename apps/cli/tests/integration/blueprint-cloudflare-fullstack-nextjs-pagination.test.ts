import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  cleanupTempDir,
  createSqliteTable,
  createTempDir,
  evaluateGeneratedModule,
  expectServedBy,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-fullstack-nextjs';
const API = 'packages/api/src';

interface PageParams {
  page: number;
  pageSize: number;
}

interface UserListParams extends PageParams {
  search: string;
  sort: string;
}

interface Pagination {
  PAGE_KEYS: readonly string[];
  DEFAULT_PAGE_SIZE: number;
  COUNT_STALE_TIME: number;
  parsePageParams: (search: unknown) => PageParams;
  queryStringWith: (current: string | URLSearchParams, owned: readonly string[], search: Record<string, unknown>) => string;
}

interface UserListControls extends UserListParams {
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSearch: (search: string) => void;
  setSort: (sort: string) => void;
}

interface UserList {
  USER_SORTS: readonly string[];
  DEFAULT_USER_SORT: string;
  MAX_SEARCH_LENGTH: number;
  USER_LIST_KEYS: readonly string[];
  parseUserListParams: (search: unknown) => UserListParams;
  userListSearch: (search: Record<string, unknown>) => Partial<UserListParams>;
  userListControls: (params: UserListParams, write: (search: Partial<UserListParams>, mode: 'push' | 'replace') => void) => UserListControls;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
}

interface DocumentRow {
  id: string;
  userId: string;
  createdAt: Date;
}

interface Caller {
  users: {
    list: (input?: unknown) => Promise<UserRow[]>;
    count: (input?: unknown) => Promise<number>;
    get: (input: { id: string }) => Promise<Record<string, unknown> | null>;
  };
  documents: {
    list: (input?: unknown) => Promise<DocumentRow[]>;
    count: () => Promise<number>;
  };
}

interface LoggedQuery {
  query: string;
  params: unknown[];
}

interface TestDatabase {
  caller: (role: string, userId?: string) => Caller;
  queries: LoggedQuery[];
  plan: (query: LoggedQuery) => string;
}

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  sqliteCore: Bun.resolveSync('drizzle-orm/sqlite-core', import.meta.dir),
};

const STUBS: Record<string, string> = {
  // A real tRPC instance: the procedures of the generated routers are the ones tRPC runs.
  'trpc.mjs': `import { initTRPC } from '${REAL.trpcServer}';
const t = initTRPC.context().create();
export const router = t.router;
export const protectedProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;`,
  // The generated middleware runs for real; every signed-in user holds every permission, only the role of the
  // caller varies, so the admin gate and the owner filter are what the tests tell apart. What a role holds is
  // decided by the generated engine, which blueprint-cloudflare-fullstack-nextjs-roles.test.ts runs on a database.
  'auth.mjs': 'export const createAuth = () => ({ api: {} });',
  'permissions.mjs': "export const ADMIN_ROLE = 'admin';",
  // The admin and the manager read every document, the others their own: the scope the defaults give, by permission.
  'role-permissions.mjs': `export const permissionsOf = async (_db, role) => [
  'document.create', 'document.read', 'document.update', 'document.delete',
  ...(role === 'admin' || role === 'manager' ? ['document.read-any', 'document.delete-any'] : []),
];
export const isGranted = (granted, resource, action) => granted.includes(resource + '.' + action);`,
  'db.mjs': `export * from '${REAL.drizzle}';
export * from './schema.mjs';`,
};

const FIRST_NAMES = ['Ada', 'Brian', 'Cleo', 'Dmitri', 'Esme', 'Farid', 'Gita', 'Hugo', 'Ines'];
const LAST_NAMES = ['Archer', 'Baker', 'Chen'];
const pad = (index: number) => String(index).padStart(2, '0');

// Three users are created in the same second, so only a tie-break on the id keeps a page boundary stable.
const USERS: UserRow[] = FIRST_NAMES.flatMap((first, firstIndex) =>
  LAST_NAMES.map((last, lastIndex) => {
    const index = firstIndex * LAST_NAMES.length + lastIndex;
    return {
      id: `u${pad(index)}`,
      name: `${first} ${last}`,
      email: `${first}.${last}@example.com`.toLowerCase(),
      role: index % 9 === 0 ? 'admin' : index % 4 === 0 ? 'manager' : 'user',
      createdAt: new Date((1_700_000_000 + Math.floor(index / 3)) * 1000),
    };
  }),
);

const DOCUMENTS: DocumentRow[] = Array.from({ length: 25 }, (_, index) => ({
  id: `d${pad(index)}`,
  userId: index % 5 === 0 ? 'u01' : 'u02',
  createdAt: new Date((1_700_000_000 + Math.floor(index / 4)) * 1000),
}));

const byTime = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

const SORTED: Record<string, (rows: UserRow[]) => UserRow[]> = {
  '-createdAt': (rows) => [...rows].sort(byTime),
  name: (rows) => [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)),
  '-name': (rows) => [...rows].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : a.id < b.id ? 1 : -1)),
  email: (rows) => [...rows].sort((a, b) => (a.email < b.email ? -1 : 1)),
  '-email': (rows) => [...rows].sort((a, b) => (a.email < b.email ? 1 : -1)),
};

// The index each order of the users list reads: the newest first order, the two name orders and the two email orders.
const USER_SORT_INDEX: Record<string, string> = {
  '-createdAt': 'users_created_at_id_idx',
  name: 'users_name_id_idx',
  '-name': 'users_name_id_idx',
  email: 'users_email_unique',
  '-email': 'users_email_unique',
};

describe(`${BLUEPRINT} pagination, search and sort`, () => {
  let tempDir: string;
  let project: string;
  let stubs: string;
  let pagination: Pagination;
  let userList: UserList;
  let schema: Record<string, SQLiteTable>;
  let createCaller: (appRouter: unknown) => (ctx: unknown) => Caller;
  let appRouter: unknown;

  const databaseWith = (users: UserRow[], documents: DocumentRow[] = []): TestDatabase => {
    const sqlite = new Database(':memory:');
    const userTable = schema.userTable as SQLiteTable;
    const documentTable = schema.documentTable as SQLiteTable;
    createSqliteTable(sqlite, userTable);
    createSqliteTable(sqlite, documentTable);
    const queries: LoggedQuery[] = [];
    const db = drizzle(sqlite, {
      logger: { logQuery: (query, params) => queries.push({ query, params }) },
    });
    for (const user of users) {
      sqlite.run(
        'INSERT INTO users (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
        [user.id, user.name, user.email, user.role, user.createdAt.getTime() / 1000, user.createdAt.getTime() / 1000],
      );
    }
    for (const document of documents) {
      sqlite.run(
        'INSERT INTO documents (id, user_id, title, r2_key, size, mime_type, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
        [document.id, document.userId, document.id, document.id, 'text/plain', document.createdAt.getTime() / 1000, document.createdAt.getTime() / 1000],
      );
    }
    queries.length = 0;
    return {
      caller: (role, userId = 'u00') => createCaller(appRouter)({ db, headers: new Headers(), session: { user: { id: userId, role } } }),
      queries,
      plan: ({ query, params }) =>
        sqlite
          .query(`EXPLAIN QUERY PLAN ${query}`)
          .all(...(params as never[]))
          .map((row) => (row as { detail: string }).detail)
          .join(' | '),
    };
  };

  const pagesOf = async (list: (input: unknown) => Promise<UserRow[]>, input: Record<string, unknown>): Promise<UserRow[]> => {
    const rows: UserRow[] = [];
    for (let page = 1; page < 50; page++) {
      const next = await list({ ...input, page });
      if (next.length === 0) break;
      rows.push(...next);
    }
    return rows;
  };

  const orderedQuery = (queries: LoggedQuery[]): LoggedQuery => {
    const query = queries.find(({ query: sql }) => /order by/i.test(sql));
    if (!query) throw new Error('no ordered query was logged');
    return query;
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, BLUEPRINT);

    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    const generated = async <T>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    pagination = await generated<Pagination>(`${API}/pagination.ts`, 'pagination.mjs', { zod: REAL.zod });
    userList = await generated<UserList>(`${API}/user-list.ts`, 'user-list.mjs', { zod: REAL.zod, './pagination': './pagination.mjs' });
    schema = await generated<Record<string, SQLiteTable>>('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/sqlite-core': REAL.sqliteCore,
    });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/text-match.ts`, 'text-match.mjs', { '@repo/db': './db.mjs' });
    await generated(`${API}/document-scope.ts`, 'document-scope.mjs', { '@repo/db': './db.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', {
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@trpc/server': REAL.trpcServer,
      '../trpc': './trpc.mjs',
    });

    const imports = {
      zod: REAL.zod,
      '@trpc/server': REAL.trpcServer,
      '@repo/db': './db.mjs',
      '@repo/auth/auth': './auth.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../document-scope': './document-scope.mjs',
      '../page-query': './page-query.mjs',
      '../text-match': './text-match.mjs',
      '../pagination': './pagination.mjs',
      '../user-list': './user-list.mjs',
    };
    const { usersRouter } = await generated<{ usersRouter: unknown }>(`${API}/router/users.ts`, 'users-router.mjs', imports);
    const { documentsRouter } = await generated<{ documentsRouter: unknown }>(`${API}/router/documents.ts`, 'documents-router.mjs', imports);
    const trpc = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => unknown;
      createCallerFactory: (router: unknown) => (ctx: unknown) => Caller;
    };
    appRouter = trpc.router({ users: usersRouter, documents: documentsRouter });
    createCaller = trpc.createCallerFactory;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('user list parameters', () => {
    test('absent parameters are the first page, newest first, with no search', () => {
      const defaults = { page: 1, pageSize: pagination.DEFAULT_PAGE_SIZE, search: '', sort: userList.DEFAULT_USER_SORT };
      expect(userList.parseUserListParams({})).toEqual(defaults);
      expect(userList.parseUserListParams(undefined)).toEqual(defaults);
      expect(userList.DEFAULT_USER_SORT).toBe('-createdAt');
    });

    test('the page rules are the ones of the shared pagination module', () => {
      for (const page of ['0', '-3', '1.5', 'abc', '10001']) {
        expect(userList.parseUserListParams({ page, pageSize: '25' }).page, page).toBe(1);
      }
      expect(userList.parseUserListParams({ pageSize: '7' }).pageSize).toBe(pagination.DEFAULT_PAGE_SIZE);
      expect(userList.parseUserListParams({ page: '3', pageSize: '50' })).toMatchObject({ page: 3, pageSize: 50 });
    });

    test('strings from a query string and the first value of a repeated parameter give one search and sort', () => {
      expect(userList.parseUserListParams({ search: ['ada', 'bob'], sort: ['name', 'email'] })).toMatchObject({
        search: 'ada',
        sort: 'name',
      });
    });

    test('a sort the table does not offer is the default one, so a URL never picks a column to order by', () => {
      for (const sort of ['password', 'role', 'createdAt', '-banned', 'name;drop table users', '', null, {}]) {
        expect(userList.parseUserListParams({ sort }).sort, String(sort)).toBe(userList.DEFAULT_USER_SORT);
      }
      for (const sort of userList.USER_SORTS) expect(userList.parseUserListParams({ sort }).sort).toBe(sort);
      expect(userList.USER_SORTS).toEqual(['-createdAt', 'name', '-name', 'email', '-email']);
    });

    test('a search keeps the text as typed, up to a bounded length', () => {
      expect(userList.parseUserListParams({ search: '  ada ' }).search).toBe('  ada ');
      expect(userList.parseUserListParams({ search: 'x'.repeat(userList.MAX_SEARCH_LENGTH + 400) }).search).toHaveLength(
        userList.MAX_SEARCH_LENGTH,
      );
      for (const search of [null, 42, {}, undefined]) expect(userList.parseUserListParams({ search }).search, String(search)).toBe('');
    });

    test('the search of a URL keeps only what differs from the defaults, and a blank search is no search', () => {
      expect(userList.userListSearch({})).toEqual({});
      expect(userList.userListSearch({ page: 1, pageSize: 10, search: '', sort: '-createdAt' })).toEqual({});
      expect(userList.userListSearch({ page: '2', search: 'ada ', sort: 'name', other: 'kept out' })).toEqual({
        page: 2,
        search: 'ada ',
        sort: 'name',
      });
      expect(userList.userListSearch({ search: '   ' })).toEqual({});
      expect(userList.userListSearch({ sort: 'bogus', search: '' })).toEqual({});
    });

    test('a change of the search or the sort goes back to page one, a change of page keeps both', () => {
      const written: [Partial<UserListParams>, string][] = [];
      const controls = userList.userListControls(
        { page: 3, pageSize: 25, search: 'ada', sort: 'name' },
        (search, mode) => written.push([search, mode]),
      );
      controls.setPage(4);
      controls.setPage(1);
      controls.setPageSize(50);
      controls.setSearch('bob');
      controls.setSearch('');
      controls.setSort('-email');
      controls.setSort('-createdAt');
      expect(written).toEqual([
        [{ page: 4, pageSize: 25, search: 'ada', sort: 'name' }, 'push'],
        [{ pageSize: 25, search: 'ada', sort: 'name' }, 'push'],
        [{ pageSize: 50, search: 'ada', sort: 'name' }, 'push'],
        [{ pageSize: 25, search: 'bob', sort: 'name' }, 'replace'],
        [{ pageSize: 25, sort: 'name' }, 'replace'],
        [{ pageSize: 25, search: 'ada', sort: '-email' }, 'push'],
        [{ pageSize: 25, search: 'ada' }, 'push'],
      ]);
    });

    test('the query string keeps the parameters a list does not own', () => {
      expect(pagination.queryStringWith('other=x&page=3&search=ada', userList.USER_LIST_KEYS, { page: 4, sort: 'name' })).toBe(
        'other=x&page=4&sort=name',
      );
      expect(pagination.queryStringWith(new URLSearchParams('page=2'), pagination.PAGE_KEYS, {})).toBe('');
      expect(pagination.queryStringWith('', userList.USER_LIST_KEYS, { search: 'a&b=c d' })).toBe('search=a%26b%3Dc+d');
    });
  });

  describe('users.list and users.count', () => {
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    const matching = (term: string) =>
      USERS.filter((user) => [user.name, user.email, user.role].some((value) => value.toLowerCase().includes(term.toLowerCase())));

    test('without input it returns the first page of the default size, newest first', async () => {
      const { caller } = databaseWith(USERS);
      const rows = await caller('admin').users.list();
      expect(ids(rows)).toEqual(ids(SORTED['-createdAt']?.(USERS).slice(0, pagination.DEFAULT_PAGE_SIZE) ?? []));
    });

    test('the rows hold the columns the table shows and none of the credentials', async () => {
      const [row] = await databaseWith(USERS).caller('admin').users.list();
      expect(Object.keys(row ?? {}).sort()).toEqual(
        ['banned', 'createdAt', 'email', 'firstName', 'id', 'lastName', 'name', 'phone', 'role'].sort(),
      );
    });

    test('only an admin lists users', async () => {
      await expect(databaseWith(USERS).caller('user').users.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(databaseWith(USERS).caller('user').users.count()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    describe.each(['-createdAt', 'name', '-name', 'email', '-email'])('sorted by %s', (sort) => {
      test('pages cover every user exactly once, in that order', async () => {
        const { caller } = databaseWith(USERS);
        const seen = await pagesOf((input) => caller('admin').users.list(input), { pageSize: 10, sort });
        expect(ids(seen)).toEqual(ids(SORTED[sort]?.(USERS) ?? []));
      });

      test.each([undefined, 'a'])('is served by its index, with no sort of its own, for the search %p', async (search) => {
        const { caller, queries, plan } = databaseWith(USERS);
        await caller('admin').users.list({ page: 2, pageSize: 10, sort, ...(search && { search }) });
        expectServedBy(plan(orderedQuery(queries)), USER_SORT_INDEX[sort] ?? 'no index for this sort');
      });
    });

    test('the offered sorts are the sorts the tests know', () => {
      expect([...userList.USER_SORTS].sort()).toEqual(Object.keys(SORTED).sort());
    });

    test('a search matches the name, the email or the role, in any case, anywhere in the text', async () => {
      const { caller } = databaseWith(USERS);
      for (const term of ['ARCHER', 'ines.chen', 'manager', 'a', 'ia', ' hugo ']) {
        const found = await pagesOf((input) => caller('admin').users.list(input), { pageSize: 100, search: term });
        expect(ids(found).sort(), term).toEqual(ids(matching(term.trim())).sort());
        expect(found.length, term).toBeGreaterThan(0);
      }
    });

    test('a search that matches nothing lists nothing and counts nothing', async () => {
      const { caller } = databaseWith(USERS);
      expect(await caller('admin').users.list({ search: 'zzz' })).toEqual([]);
      expect(await caller('admin').users.count({ search: 'zzz' })).toBe(0);
    });

    test('pages of a search are sorted and cover every match once', async () => {
      const { caller } = databaseWith(USERS);
      const seen = await pagesOf((input) => caller('admin').users.list(input), { pageSize: 10, search: 'a', sort: '-name' });
      expect(seen.length).toBeGreaterThan(10);
      expect(ids(seen)).toEqual(ids(SORTED['-name']?.(matching('a')) ?? []));
    });

    test('the wildcards of a pattern search are plain characters', async () => {
      const at = new Date(1_700_000_000_000);
      const rows: UserRow[] = [
        { id: 'w1', name: 'a_b', email: 'one@example.com', role: 'user', createdAt: at },
        { id: 'w2', name: 'axb', email: 'two@example.com', role: 'user', createdAt: at },
        { id: 'w3', name: '100% sure', email: 'three@example.com', role: 'user', createdAt: at },
        { id: 'w4', name: 'back\\slash', email: 'four@example.com', role: 'user', createdAt: at },
      ];
      const { caller } = databaseWith(rows);
      const found = async (search: string) => ids(await caller('admin').users.list({ search })).sort();
      expect(await found('a_b')).toEqual(['w1']);
      expect(await found('%')).toEqual(['w3']);
      expect(await found('0% s')).toEqual(['w3']);
      expect(await found('\\')).toEqual(['w4']);
      expect(await found("' or 1=1 --")).toEqual([]);
    });

    test('the list returns rows only and never counts, the total is the count procedure', async () => {
      const { caller, queries } = databaseWith(USERS);
      await caller('admin').users.list({ page: 2 });
      expect(queries.some(({ query }) => /count\(/i.test(query))).toBe(false);
      expect(await caller('admin').users.count()).toBe(USERS.length);
      expect(queries.filter(({ query }) => /count\(/i.test(query))).toHaveLength(1);
    });

    test('the total depends on the search and on nothing else', async () => {
      const { caller } = databaseWith(USERS);
      expect(await caller('admin').users.count({ search: 'archer' })).toBe(matching('archer').length);
      expect(await caller('admin').users.count({ search: 'archer', page: 3, sort: 'name' })).toBe(matching('archer').length);
      expect(await caller('admin').users.count({ search: '  ' })).toBe(USERS.length);
      expect(await databaseWith([]).caller('admin').users.count()).toBe(0);
    });

    test('the last page holds the remainder and a page past the end is empty', async () => {
      const { caller } = databaseWith(USERS);
      expect(await caller('admin').users.list({ page: 3, pageSize: 10 })).toHaveLength(USERS.length - 20);
      expect(await caller('admin').users.list({ page: 4, pageSize: 10 })).toEqual([]);
    });

    test('an invalid page, page size, sort or search reads the defaults, never the whole table or a free order', async () => {
      const { caller, queries } = databaseWith(USERS);
      const newest = ids(SORTED['-createdAt']?.(USERS).slice(0, pagination.DEFAULT_PAGE_SIZE) ?? []);
      for (const input of [
        { page: 0 },
        { page: -2 },
        { page: 'abc' },
        { pageSize: 100000 },
        { pageSize: 0 },
        { pageSize: 'all' },
        { sort: 'password' },
        { sort: 'role' },
        { sort: 'createdAt desc; drop table users' },
      ]) {
        expect(ids(await caller('admin').users.list(input)), JSON.stringify(input)).toEqual(newest);
      }
      expect(orderedQuery(queries).query).not.toMatch(/password|drop table/i);
      expect(await caller('admin').users.list({ search: 'x'.repeat(5000) })).toEqual([]);
    });

    test('get answers null for an id that matches no user, without throwing', async () => {
      expect(await databaseWith(USERS).caller('admin').users.get({ id: 'nobody' })).toBeNull();
    });

    test('get answers the user it finds, with the columns of the list and no credential', async () => {
      const user = await databaseWith(USERS).caller('admin').users.get({ id: 'u04' });
      expect(user).toMatchObject({ id: 'u04', name: USERS[4]?.name, email: USERS[4]?.email, role: USERS[4]?.role });
      expect(Object.keys(user ?? {}).sort()).toEqual(
        ['banned', 'createdAt', 'email', 'firstName', 'id', 'lastName', 'name', 'phone', 'role'].sort(),
      );
    });

    test('only an admin gets a user', async () => {
      await expect(databaseWith(USERS).caller('user').users.get({ id: 'u04' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('an input that is not an object is refused', async () => {
      await expect(databaseWith(USERS).caller('admin').users.list('everything')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(databaseWith(USERS).caller('admin').users.count('everything')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('documents.list and documents.count', () => {
    const owned = (userId: string) => DOCUMENTS.filter((document) => document.userId === userId);
    const newest = (rows: DocumentRow[]) => [...rows].sort(byTime).map((row) => row.id);

    test('a user pages through their own documents and an admin or manager through all of them, newest first', async () => {
      const { caller } = databaseWith(USERS, DOCUMENTS);
      for (const [role, userId, expected] of [
        ['admin', 'u00', DOCUMENTS],
        ['manager', 'u03', DOCUMENTS],
        ['user', 'u01', owned('u01')],
        ['user', 'u02', owned('u02')],
      ] as const) {
        const seen: DocumentRow[] = [];
        for (let page = 1; page < 50; page++) {
          const next = await caller(role, userId).documents.list({ page, pageSize: 10 });
          if (next.length === 0) break;
          seen.push(...next);
        }
        expect(seen.map((row) => row.id), `${role} ${userId}`).toEqual(newest(expected));
        expect(await caller(role, userId).documents.count(), `${role} ${userId}`).toBe(expected.length);
      }
    });

    test('the pages hold the page size and a page past the end is empty', async () => {
      const { caller } = databaseWith(USERS, DOCUMENTS);
      const lengths: number[] = [];
      for (const page of [1, 2, 3, 4]) lengths.push((await caller('admin').documents.list({ page, pageSize: 10 })).length);
      expect(lengths).toEqual([10, 10, 5, 0]);
      expect(await caller('admin').documents.list()).toHaveLength(pagination.DEFAULT_PAGE_SIZE);
    });

    test('an invalid page or page size reads the default one', async () => {
      const { caller } = databaseWith(USERS, DOCUMENTS);
      for (const input of [{ page: 0 }, { page: 'abc' }, { pageSize: 100000 }, { pageSize: 'all' }]) {
        expect(await caller('admin').documents.list(input), JSON.stringify(input)).toHaveLength(pagination.DEFAULT_PAGE_SIZE);
      }
      await expect(caller('admin').documents.list('everything')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    test('the list never counts', async () => {
      const { caller, queries } = databaseWith(USERS, DOCUMENTS);
      await caller('admin').documents.list({ page: 2 });
      expect(queries.some(({ query }) => /count\(/i.test(query))).toBe(false);
    });

    test.each([
      ['admin', 'u00'],
      ['user', 'u01'],
    ])('the page of %s is served by its index, with no sort of its own', async (role, userId) => {
      const { caller, queries, plan } = databaseWith(USERS, DOCUMENTS);
      await caller(role, userId).documents.list({ page: 2, pageSize: 10 });
      expectServedBy(
        plan(orderedQuery(queries)),
        role === 'admin' ? 'documents_created_at_id_idx' : 'documents_user_id_created_at_id_idx',
      );
    });
  });

  describe('the hooks that write the page into the URL', () => {
    const NAVIGATION = `export const navigation = { pushed: [], replaced: [], path: '/admin/users', query: '' };
export const useRouter = () => ({ push: (url) => navigation.pushed.push(url), replace: (url) => navigation.replaced.push(url) });
export const usePathname = () => navigation.path;
export const useSearchParams = () => new URLSearchParams(navigation.query);`;

    interface Navigation {
      pushed: string[];
      replaced: string[];
      path: string;
      query: string;
    }

    let navigation: Navigation;
    let useUserListParams: () => UserListControls;
    let usePageParams: () => PageParams & { setPage: (page: number) => void; setPageSize: (pageSize: number) => void };

    const visit = (path: string, query: string): void => {
      navigation.pushed = [];
      navigation.replaced = [];
      navigation.path = path;
      navigation.query = query;
    };

    beforeAll(async () => {
      await Bun.write(join(stubs, 'next-navigation.mjs'), NAVIGATION);
      ({ navigation } = (await import(join(stubs, 'next-navigation.mjs'))) as { navigation: Navigation });
      const imports: Record<string, string> = {
        'next/navigation': './next-navigation.mjs',
        '@repo/api/pagination': './pagination.mjs',
        '@repo/api/user-list': './user-list.mjs',
        '@/hooks/use-page-params': './use-page-params.mjs',
      };
      const load = async <T>(file: string, name: string): Promise<T> =>
        evaluateGeneratedModule<T>(await readTextFile(join(project, 'apps/web/src/hooks', file)), join(stubs, name), imports);
      ({ usePageParams } = await load<{ usePageParams: typeof usePageParams }>('use-page-params.ts', 'use-page-params.mjs'));
      ({ useUserListParams } = await load<{ useUserListParams: typeof useUserListParams }>('use-user-list-params.ts', 'use-user-list-params.mjs'));
    });

    test('the list reads its parameters from the URL, and the defaults for a bad one', () => {
      visit('/admin/users', 'page=3&pageSize=25&search=ada&sort=-name');
      expect(useUserListParams()).toMatchObject({ page: 3, pageSize: 25, search: 'ada', sort: '-name' });
      visit('/admin/users', 'page=abc&pageSize=7&sort=password&search=a&search=b');
      expect(useUserListParams()).toMatchObject({ page: 1, pageSize: 10, search: 'a', sort: '-createdAt' });
      visit('/admin/users', '');
      expect(useUserListParams()).toMatchObject({ page: 1, pageSize: 10, search: '', sort: '-createdAt' });
    });

    test('a page change is a history entry that keeps the search, the sort and other parameters', () => {
      visit('/admin/users', 'other=x&page=3&search=ada&sort=name');
      const controls = useUserListParams();
      controls.setPage(4);
      controls.setPage(1);
      expect(navigation.pushed).toEqual([
        '/admin/users?other=x&page=4&search=ada&sort=name',
        '/admin/users?other=x&search=ada&sort=name',
      ]);
      expect(navigation.replaced).toEqual([]);
    });

    test('typing a search replaces the entry and goes back to page one, so back leaves the list', () => {
      visit('/admin/users', 'page=3&pageSize=25&sort=name');
      const controls = useUserListParams();
      controls.setSearch('ada');
      controls.setSearch('');
      expect(navigation.replaced).toEqual(['/admin/users?pageSize=25&search=ada&sort=name', '/admin/users?pageSize=25&sort=name']);
      expect(navigation.pushed).toEqual([]);
    });

    test('a sort is a history entry that goes back to page one and leaves the default sort out', () => {
      visit('/admin/users', 'page=3&search=ada&sort=name');
      const controls = useUserListParams();
      controls.setSort('-email');
      controls.setSort('-createdAt');
      expect(navigation.pushed).toEqual(['/admin/users?search=ada&sort=-email', '/admin/users?search=ada']);
    });

    test('a page size change goes back to page one and leaves the default size out', () => {
      visit('/admin/users', 'page=3&pageSize=25&sort=name');
      const controls = useUserListParams();
      controls.setPageSize(50);
      controls.setPageSize(10);
      expect(navigation.pushed).toEqual(['/admin/users?pageSize=50&sort=name', '/admin/users?sort=name']);
    });

    test('with nothing else in the URL, the first page is the bare path', () => {
      visit('/admin/users', 'page=2');
      useUserListParams().setPage(1);
      expect(navigation.pushed).toEqual(['/admin/users']);
    });

    test('the documents page reads and writes the page like the other paginated lists', () => {
      visit('/', 'page=2&pageSize=25&search=kept');
      const controls = usePageParams();
      expect([controls.page, controls.pageSize]).toEqual([2, 25]);
      controls.setPage(3);
      controls.setPageSize(50);
      expect(navigation.pushed).toEqual(['/?search=kept&page=3&pageSize=25', '/?search=kept&pageSize=50']);
    });
  });
  describe('invalidatePagedList', () => {
    test('invalidates the list and the count of the router it is given, and nothing else', async () => {
      const { invalidatePagedList } = await evaluateGeneratedModule<{
        invalidatePagedList: (client: unknown, procedures: unknown) => Promise<void>;
      }>(await readTextFile(join(project, 'apps/web/src/lib/invalidate-paged-list.ts')), join(stubs, 'invalidate-paged-list.mjs'));
      const invalidated: unknown[] = [];
      const queryClient = { invalidateQueries: async (filter: unknown) => void invalidated.push(filter) };
      const procedure = (name: string) => ({ queryFilter: () => ({ name }) });
      await invalidatePagedList(queryClient, { list: procedure('list'), count: procedure('count'), get: procedure('get') });
      expect(invalidated).toEqual([{ name: 'list' }, { name: 'count' }]);
    });

    test('the tables keep the total for one shared time', () => {
      expect(pagination.COUNT_STALE_TIME).toBe(60_000);
    });
  });
});
