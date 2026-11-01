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

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

interface Caller {
  search: { records: (input: { query: string }) => Promise<SearchGroup[]> };
}

interface UserSeed {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface DocumentSeed {
  id: string;
  userId: string;
  title: string;
  size?: number;
}

interface LoggedQuery {
  query: string;
  params: unknown[];
}

interface SearchableType {
  type: string;
  label: string;
  canSearch: (caller: { permissions: readonly string[] }) => boolean;
  find: (caller: { permissions: readonly string[] }, text: string, limit: number) => Promise<SearchItem[]>;
}

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  sqliteCore: Bun.resolveSync('drizzle-orm/sqlite-core', import.meta.dir),
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  adminAccess: Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
};

const STUBS: Record<string, string> = {
  // A real tRPC instance: the procedure of the generated search router is the one tRPC runs.
  'trpc.mjs': `import { initTRPC } from '${REAL.trpcServer}';
const t = initTRPC.context().create();
export const router = t.router;
export const protectedProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;`,
  'db.mjs': `export * from '${REAL.drizzle}';
export * from './schema.mjs';`,
};

// The id of the signed-in user, the other users, and a role the application does not know.
const ADMIN = 'u-admin';
const MEMBER = 'u-member';
const MANAGER = 'u-manager';
const STRANGER = 'u-stranger';

const USERS: UserSeed[] = [
  { id: ADMIN, name: 'Ada Admin', email: 'ada@example.com', role: 'admin' },
  { id: MEMBER, name: 'Mia Member', email: 'mia@example.com', role: 'user' },
  { id: MANAGER, name: 'Max Manager', email: 'max@example.com', role: 'manager' },
  { id: STRANGER, name: 'Sam Stranger', email: 'sam@example.com', role: 'guest' },
];

const must = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not there`);
  return value;
};

const titles = (group: SearchGroup | undefined): string[] => group?.items.map((item) => item.title) ?? [];
const groupNamed = (groups: SearchGroup[], type: string): SearchGroup | undefined =>
  groups.find((group) => group.type === type);

describe(`${BLUEPRINT} palette search`, () => {
  let tempDir: string;
  let schema: Record<string, SQLiteTable>;
  let createCaller: (appRouter: unknown) => (ctx: unknown) => Caller;
  let appRouter: unknown;
  let engineModule: { SEARCH_LIMIT_PER_TYPE: number };
  let searchModule: {
    searchRecords: (caller: unknown, query: string, types?: SearchableType[]) => Promise<SearchGroup[]>;
  };
  let queryModule: { SEARCH_MIN_LENGTH: number };
  let defaults: { defaultRoleStatements: () => string[] };

  // Each test gets its own database holding the users above and the documents it needs.
  const callerOn = (documents: DocumentSeed[] = [], extraUsers: UserSeed[] = []) => {
    const sqlite = new Database(':memory:');
    createSqliteTable(sqlite, schema.userTable as SQLiteTable);
    createSqliteTable(sqlite, schema.documentTable as SQLiteTable);
    createSqliteTable(sqlite, schema.roleTable as SQLiteTable);
    createSqliteTable(sqlite, schema.rolePermissionTable as SQLiteTable);
    for (const statement of defaults.defaultRoleStatements()) sqlite.run(statement);
    const insertUser = (user: UserSeed) =>
      sqlite.run(
        'INSERT INTO users (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 0, ?, 1700000000, 1700000000)',
        [user.id, user.name, user.email, user.role],
      );
    for (const user of [...USERS, ...extraUsers]) insertUser(user);
    documents.forEach((document, index) =>
      sqlite.run(
        'INSERT INTO documents (id, user_id, title, r2_key, size, mime_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          document.id,
          document.userId,
          document.title,
          document.id,
          document.size ?? 1,
          'text/plain',
          1_700_000_000 + index,
          1_700_000_000 + index,
        ],
      ),
    );
    const queries: LoggedQuery[] = [];
    const db = drizzle(sqlite, { logger: { logQuery: (query, params) => queries.push({ query, params }) } });
    queries.length = 0;
    // A request of the user, as the tRPC context holds it: the permissions of its caller are read once for its headers.
    const context = (userId: string) => {
      const role = (sqlite.query('SELECT role FROM users WHERE id = ?').get(userId) as { role: string }).role;
      return { db, headers: new Headers(), session: { user: { id: userId, role } } };
    };
    const caller = (userId: string): Caller => createCaller(appRouter)(context(userId));
    const searches = (): LoggedQuery[] => queries.filter(({ query }) => /instr\(/.test(query));
    const plan = ({ query, params }: LoggedQuery): string =>
      sqlite
        .query(`EXPLAIN QUERY PLAN ${query}`)
        .all(...(params as never[]))
        .map((row) => (row as { detail: string }).detail)
        .join(' | ');
    // A role created at run time, as an administrator would with the matrix: a new request reads it.
    const addRole = (id: string, ...granted: string[]) => {
      sqlite.run('INSERT INTO roles (id, label) VALUES (?, ?)', [id, id]);
      for (const name of granted) grant(id, name);
    };
    const grant = (role: string, name: string) => {
      const [resource = '', action = ''] = name.split('.');
      sqlite.run('INSERT INTO role_permissions (role_id, resource, action) VALUES (?, ?, ?)', [role, resource, action]);
    };
    const revoke = (role: string, name: string) => {
      const [resource = '', action = ''] = name.split('.');
      sqlite.run('DELETE FROM role_permissions WHERE role_id = ? AND resource = ? AND action = ?', [role, resource, action]);
    };
    return Object.assign(caller, { queries, searches, plan, addRole, grant, revoke, context });
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    const generated = async <T>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated<Record<string, SQLiteTable>>('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/sqlite-core': REAL.sqliteCore,
    });

    // What a role holds is the generated engine, on this database: the vocabulary on better-auth's access control,
    // the default roles written by the SQL `db:roles` runs, and `permissionsOf` reading `role_permissions`.
    await generated('packages/auth/src/permissions.ts', 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/admin/access': REAL.adminAccess,
    });
    defaults = await generated('packages/auth/src/default-roles.ts', 'default-roles.mjs', { './permissions': './permissions.mjs' });
    await generated('packages/auth/src/role-permissions.ts', 'role-permissions.mjs', {
      '@repo/db': './db.mjs',
      './permissions': './permissions.mjs',
    });

    await generated(`${API}/pagination.ts`, 'pagination.mjs', { zod: REAL.zod });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/text-match.ts`, 'text-match.mjs', { '@repo/db': './db.mjs' });
    queryModule = await generated(`${API}/search-query.ts`, 'search-query.mjs', { zod: REAL.zod });
    engineModule = await generated(`${API}/search-engine.ts`, 'search-engine.mjs', { './search-query': './search-query.mjs' });
    await generated(`${API}/format-date.ts`, 'format-date.mjs', {});
    await generated(`${API}/format-file-size.ts`, 'format-file-size.mjs', {});
    await generated(`${API}/document-scope.ts`, 'document-scope.mjs', { '@repo/db': './db.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', {
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@trpc/server': REAL.trpcServer,
      '@repo/db': './db.mjs',
      '../trpc': './trpc.mjs',
    });
    searchModule = await generated(`${API}/search.ts`, 'search.mjs', {
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@repo/db': './db.mjs',
      './document-scope': './document-scope.mjs',
      './format-date': './format-date.mjs',
      './format-file-size': './format-file-size.mjs',
      './middleware/rbac': './rbac.mjs',
      './search-engine': './search-engine.mjs',
      './text-match': './text-match.mjs',
    });
    const { searchRouter } = await generated<{ searchRouter: unknown }>(`${API}/router/search.ts`, 'search-router.mjs', {
      '../trpc': './trpc.mjs',
      '../search-query': './search-query.mjs',
      '../search': './search.mjs',
    });
    const trpc = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => unknown;
      createCallerFactory: (router: unknown) => (ctx: unknown) => Caller;
    };
    appRouter = trpc.router({ search: searchRouter });
    createCaller = trpc.createCallerFactory;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('what is searched', () => {
    test('the limits are two characters and five items per type', () => {
      expect(queryModule.SEARCH_MIN_LENGTH).toBe(2);
      expect(engineModule.SEARCH_LIMIT_PER_TYPE).toBe(5);
    });

    test('an administrator finds documents and users, grouped by type, each with the page that opens it', async () => {
      const caller = callerOn([{ id: 'd1', userId: MEMBER, title: "Sam's plan", size: 3_670_016 }]);
      const groups = await caller(ADMIN).search.records({ query: 'sam' });
      expect(groups.map((group) => [group.type, group.label])).toEqual([
        ['documents', 'Documents'],
        ['users', 'Users'],
      ]);
      expect(groupNamed(groups, 'documents')?.items).toEqual([
        { id: 'd1', title: "Sam's plan", subtitle: '3.5 MB, Nov 14, 2023', href: '/' },
      ]);
      expect(groupNamed(groups, 'users')?.items).toEqual([
        { id: STRANGER, title: 'Sam Stranger', subtitle: 'sam@example.com', href: `/admin/users/${STRANGER}` },
      ]);
    });

    test('users are found by name or by email, whatever the case', async () => {
      const caller = callerOn()(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'MIA' }), 'users'))).toEqual(['Mia Member']);
      expect(titles(groupNamed(await caller.search.records({ query: 'max@EXAMPLE' }), 'users'))).toEqual(['Max Manager']);
    });

    test('a group with no match is left out, and a search matching nothing returns no group', async () => {
      const caller = callerOn([{ id: 'd1', userId: MEMBER, title: 'Annual report' }])(ADMIN);
      expect((await caller.search.records({ query: 'report' })).map((group) => group.type)).toEqual(['documents']);
      expect(await caller.search.records({ query: 'nothing like this' })).toEqual([]);
    });
  });

  describe('the minimum length', () => {
    test.each(['', 'a', ' a ', '  '])('"%s" asks the database nothing and returns no group', async (query) => {
      const caller = callerOn()(ADMIN);
      expect(await caller.search.records({ query })).toEqual([]);
    });

    test('two characters search, and blanks around them do not count', async () => {
      const caller = callerOn()(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'ma' }), 'users'))).toEqual(['Max Manager']);
      expect(titles(groupNamed(await caller.search.records({ query: '  ma  ' }), 'users'))).toEqual(['Max Manager']);
      expect(await caller.search.records({ query: ' m ' })).toEqual([]);
    });

    test('a text longer than the search allows is cut to its first characters, whatever follows them', async () => {
      const cap = 'a'.repeat(100);
      const caller = callerOn([{ id: 'd-cap', userId: MEMBER, title: `${cap} cut` }])(ADMIN);
      const found = await caller.search.records({ query: `${cap}${' tail'.repeat(1000)}` });
      expect(titles(groupNamed(found, 'documents')), 'the title holds the first 100 characters only').toEqual([`${cap} cut`]);
    });
  });

  describe('the limit per type', () => {
    const manyUsers: UserSeed[] = Array.from({ length: 8 }, (_, index) => ({
      id: `u-extra-${index}`,
      name: `Extra Person ${index}`,
      email: `extra${index}@example.com`,
      role: 'user',
    }));
    const manyDocuments: DocumentSeed[] = Array.from({ length: 8 }, (_, index) => ({
      id: `d-extra-${index}`,
      userId: MEMBER,
      title: `Extra document ${index}`,
    }));

    test('each type returns at most five items, the newest documents first and the users by name', async () => {
      const caller = callerOn(manyDocuments, manyUsers)(ADMIN);
      const groups = await caller.search.records({ query: 'extra' });
      expect(titles(groupNamed(groups, 'documents'))).toEqual([
        'Extra document 7',
        'Extra document 6',
        'Extra document 5',
        'Extra document 4',
        'Extra document 3',
      ]);
      expect(titles(groupNamed(groups, 'users'))).toEqual([
        'Extra Person 0',
        'Extra Person 1',
        'Extra Person 2',
        'Extra Person 3',
        'Extra Person 4',
      ]);
    });
  });

  describe('plain text', () => {
    const documents: DocumentSeed[] = [
      { id: 'd-percent', userId: MEMBER, title: 'Save 50% today' },
      { id: 'd-plain', userId: MEMBER, title: 'Save 50 today' },
      { id: 'd-underscore', userId: MEMBER, title: 'plan_b notes' },
      { id: 'd-letter', userId: MEMBER, title: 'planXb notes' },
      { id: 'd-other', userId: MEMBER, title: 'Something else' },
    ];

    test('a % matches itself and not any text', async () => {
      const caller = callerOn(documents)(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: '50%' }), 'documents'))).toEqual(['Save 50% today']);
      expect(await caller.search.records({ query: '%%' })).toEqual([]);
    });

    test('a _ matches itself and not any one character', async () => {
      const caller = callerOn(documents)(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'n_b' }), 'documents'))).toEqual(['plan_b notes']);
      expect(await caller.search.records({ query: '__' })).toEqual([]);
    });

    test('a quote or a backslash is text too', async () => {
      const caller = callerOn([{ id: 'd-quote', userId: MEMBER, title: `O'Brien \\ notes` }])(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: `o'brien` }), 'documents'))).toEqual([`O'Brien \\ notes`]);
      expect(titles(groupNamed(await caller.search.records({ query: '\\ n' }), 'documents'))).toEqual([`O'Brien \\ notes`]);
    });

    test('% and _ in a name or an email match themselves too', async () => {
      const caller = callerOn([], [{ id: 'u-special', name: '100%_Real', email: 'real@example.com', role: 'user' }])(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: '0%_R' }), 'users'))).toEqual(['100%_Real']);
      expect(await caller.search.records({ query: 'a%l' })).toEqual([]);
    });
  });

  describe('permissions, on a real database', () => {
    const documents: DocumentSeed[] = [
      { id: 'd-mine', userId: MEMBER, title: 'Shared notes mine' },
      { id: 'd-theirs', userId: ADMIN, title: 'Shared notes admin' },
    ];

    test('a user who is not an administrator gets no group of users, although users match', async () => {
      const caller = callerOn(documents)(MEMBER);
      expect(groupNamed(await caller.search.records({ query: 'Mia' }), 'users')).toBeUndefined();
      expect(groupNamed(await caller.search.records({ query: 'example.com' }), 'users')).toBeUndefined();
      expect(await caller.search.records({ query: 'ada@example' })).toEqual([]);
    });

    test('a manager gets no group of users either', async () => {
      const caller = callerOn(documents)(MANAGER);
      expect(groupNamed(await caller.search.records({ query: 'Ada' }), 'users')).toBeUndefined();
    });

    test('a user finds their own documents only', async () => {
      const caller = callerOn(documents)(MEMBER);
      expect(titles(groupNamed(await caller.search.records({ query: 'shared' }), 'documents'))).toEqual(['Shared notes mine']);
    });

    test('an administrator and a manager find the documents of everyone, as the list does', async () => {
      const database = callerOn(documents);
      for (const userId of [ADMIN, MANAGER]) {
        const found = titles(groupNamed(await database(userId).search.records({ query: 'shared' }), 'documents'));
        expect(found.sort(), userId).toEqual(['Shared notes admin', 'Shared notes mine']);
      }
    });

    test('a role without the permission to read documents gets no group of documents', async () => {
      const caller = callerOn(documents)(STRANGER);
      expect(await caller.search.records({ query: 'shared' })).toEqual([]);
      expect(await caller.search.records({ query: 'Mia' })).toEqual([]);
    });
  });
  describe('permissions the database grants, as the lists read them', () => {
    const documents: DocumentSeed[] = [
      { id: 'd-mine', userId: MEMBER, title: 'Shared notes mine' },
      { id: 'd-theirs', userId: ADMIN, title: 'Shared notes admin' },
    ];
    const AUDITOR = 'u-auditor';
    const READER = 'u-reader';
    const extraUsers: UserSeed[] = [
      { id: AUDITOR, name: 'Aud Itor', email: 'aud@example.com', role: 'auditor' },
      { id: READER, name: 'Rea Der', email: 'rea@example.com', role: 'reader' },
    ];
    const found = async (request: Caller): Promise<string[]> =>
      titles(groupNamed(await request.search.records({ query: 'shared' }), 'documents')).sort();

    test('a role made at run time that holds document.read-any finds every document, one that holds document.read its own', async () => {
      const database = callerOn(documents, extraUsers);
      database.addRole('auditor', 'document.read', 'document.read-any');
      database.addRole('reader', 'document.read');
      expect(await found(database(AUDITOR))).toEqual(['Shared notes admin', 'Shared notes mine']);
      expect(await found(database(READER))).toEqual([]);
    });

    test('a permission revoked in the database is refused on the next request', async () => {
      const database = callerOn(documents);
      expect(await found(database(MANAGER))).toEqual(['Shared notes admin', 'Shared notes mine']);

      database.revoke('manager', 'document.read-any');
      expect(await found(database(MANAGER)), 'the manager now holds read only, and owns no document').toEqual([]);

      database.revoke('user', 'document.read');
      expect(await database(MEMBER).search.records({ query: 'shared' })).toEqual([]);
    });

    test('a permission granted in the database is honored on the next request', async () => {
      const database = callerOn(documents);
      expect(await found(database(MEMBER))).toEqual(['Shared notes mine']);
      database.grant('user', 'document.read-any');
      expect(await found(database(MEMBER))).toEqual(['Shared notes admin', 'Shared notes mine']);
    });

    test('a role with no row in roles holds nothing, and neither does a role whose rows are all gone', async () => {
      const database = callerOn(documents);
      expect(await found(database(STRANGER))).toEqual([]);
      for (const name of ['create', 'read', 'update', 'delete']) database.revoke('user', `document.${name}`);
      expect(await found(database(MEMBER))).toEqual([]);
    });

    test('the administrator finds every document with no row of its own', async () => {
      const database = callerOn(documents);
      database.revoke('manager', 'document.read');
      expect(await found(database(ADMIN))).toEqual(['Shared notes admin', 'Shared notes mine']);
    });

    test('a stored row that names account administration grants no users group', async () => {
      const database = callerOn(documents, extraUsers);
      database.addRole('auditor', 'document.read', 'user.list');
      expect(groupNamed(await database(AUDITOR).search.records({ query: 'example' }), 'users')).toBeUndefined();
    });

    test('the permissions are read once for the search, whatever the number of types', async () => {
      const database = callerOn(documents);
      await database(ADMIN).search.records({ query: 'example' });
      const reads = database.queries.filter(({ query }) => query.includes('"role_permissions"'));
      expect(reads.length).toBeLessThanOrEqual(1);
    });
  });

  describe('what reaches the database', () => {
    const documents: DocumentSeed[] = [{ id: 'd-mine', userId: MEMBER, title: 'Shared notes mine' }];
    const TABLE = { documents: /from "documents"/i, users: /from "users"/i };

    test.each(['', 'a', ' a ', '  '])('"%s" runs no query at all, the permission check included', async (query) => {
      const database = callerOn(documents);
      await database(ADMIN).search.records({ query });
      expect(database.queries).toEqual([]);
    });

    test('a user who is not an administrator never runs the users query', async () => {
      const database = callerOn(documents);
      await database(MEMBER).search.records({ query: 'example' });
      expect(database.searches().filter(({ query }) => TABLE.users.test(query))).toEqual([]);
      expect(database.searches().filter(({ query }) => TABLE.documents.test(query))).toHaveLength(1);
    });

    test('a role without the permission to read documents runs no search query', async () => {
      const database = callerOn(documents);
      await database(STRANGER).search.records({ query: 'example' });
      expect(database.searches()).toEqual([]);
    });

    test('an administrator runs one query per type', async () => {
      const database = callerOn(documents);
      await database(ADMIN).search.records({ query: 'example' });
      expect(database.searches().map(({ query }) => (TABLE.users.test(query) ? 'users' : 'documents')).sort()).toEqual([
        'documents',
        'users',
      ]);
    });

    // The match scans the table (instr cannot use an index), but each query reads its rows in the order of an index
    // and stops at the limit, so it sorts nothing.
    describe.each([
      ['an administrator', ADMIN, TABLE.documents, 'documents_created_at_id_idx'],
      ['a manager', MANAGER, TABLE.documents, 'documents_created_at_id_idx'],
      ['a user, who sees their own documents', MEMBER, TABLE.documents, 'documents_user_id_created_at_id_idx'],
      ['an administrator', ADMIN, TABLE.users, 'users_name_id_idx'],
    ])('the query of %s', (_name, userId, table, index) => {
      test(`reads ${table.source.includes('users') ? 'users' : 'documents'} in the order of ${index}`, async () => {
        const database = callerOn(documents);
        await database(userId).search.records({ query: 'example' });
        const query = must(
          database.searches().find((logged) => table.test(logged.query)),
          'the search query',
        );
        expectServedBy(database.plan(query), index);
      });
    });
  });

  describe('the list of searchable types', () => {
    let caller: ReturnType<ReturnType<typeof callerOn>['context']>;
    beforeAll(() => {
      caller = callerOn().context(MEMBER);
    });
    const item = (id: string): SearchItem => ({ id, title: id, subtitle: '', href: `/${id}` });
    const entry = (overrides: Partial<SearchableType> & Pick<SearchableType, 'type'>): SearchableType => ({
      label: overrides.type,
      canSearch: () => true,
      find: async () => [item('one')],
      ...overrides,
    });

    test('a group holds at most five items, even when the query of its type ignores the limit', async () => {
      const unlimited = entry({ type: 'unlimited', find: async () => Array.from({ length: 12 }, (_, index) => item(`r${index}`)) });
      const [group] = await searchModule.searchRecords(caller, 'ab', [unlimited]);
      expect(group?.items.map((each) => each.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    });

    test('a type the caller may not read is not queried and has no group', async () => {
      let queried = 0;
      const forbidden = entry({
        type: 'forbidden',
        canSearch: () => false,
        find: async () => {
          queried += 1;
          return [item('secret')];
        },
      });
      const groups = await searchModule.searchRecords(caller, 'ab', [forbidden, entry({ type: 'open' })]);
      expect(groups.map((group) => group.type)).toEqual(['open']);
      expect(queried).toBe(0);
    });

    test('the types come in the order of the list, under their own labels', async () => {
      const groups = await searchModule.searchRecords(caller, 'ab', [
        entry({ type: 'b', label: 'Bees' }),
        entry({ type: 'a', label: 'Ants' }),
      ]);
      expect(groups.map((group) => [group.type, group.label])).toEqual([
        ['b', 'Bees'],
        ['a', 'Ants'],
      ]);
    });

    test('the text a type receives is trimmed and no type is asked below the minimum', async () => {
      const received: [string, number][] = [];
      const recording = entry({
        type: 'recording',
        find: async (_caller, text, limit) => {
          received.push([text, limit]);
          return [];
        },
      });
      await searchModule.searchRecords(caller, '  ab  ', [recording]);
      await searchModule.searchRecords(caller, ' a ', [recording]);
      expect(received).toEqual([['ab', engineModule.SEARCH_LIMIT_PER_TYPE]]);
    });
  });
});
