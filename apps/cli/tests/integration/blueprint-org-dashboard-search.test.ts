import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  cleanupTempDir,
  createPostgresTable,
  createTempDir,
  evaluateGeneratedModule,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start'];
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
  contact: { list: (input?: unknown) => Promise<unknown[]> };
  user: { list: (input?: unknown) => Promise<unknown[]> };
}

interface UserSeed {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ContactSeed {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  company?: string;
}

interface LoggedQuery {
  query: string;
  params: unknown[];
}

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  pgCore: Bun.resolveSync('drizzle-orm/pg-core', import.meta.dir),
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  adminAccess: Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
};

const STUBS: Record<string, string> = {
  // A real tRPC instance: the procedures of the generated routers are the ones tRPC runs.
  'trpc.mjs': `import { initTRPC } from '${REAL.trpcServer}';
const t = initTRPC.context().create();
export const router = t.router;
export const protectedProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;`,
  'db.mjs': `export * from '${REAL.drizzle}';
export * from './schema.mjs';`,
  'auth.mjs': 'export const auth = {};',
  'role-assignment.mjs': 'export const listAssignableRoles = async () => [];',
  'password.mjs': "export const generatePassword = () => 'x';",
};

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

const CONTACTS: ContactSeed[] = [
  { id: 'c-grace', firstName: 'Grace', lastName: 'Hopper', email: 'grace@navy.example', company: 'Navy' },
  { id: 'c-alan', firstName: 'Alan', lastName: 'Turing', company: 'Bletchley' },
];

const must = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not there`);
  return value;
};

const titles = (group: SearchGroup | undefined): string[] => group?.items.map((item) => item.title) ?? [];
const groupNamed = (groups: SearchGroup[], type: string): SearchGroup | undefined =>
  groups.find((group) => group.type === type);

describe.each(BLUEPRINTS)('%s palette search', (blueprint) => {
  let tempDir: string;
  let schema: Record<string, PgTable>;
  let createCaller: (appRouter: unknown) => (ctx: unknown) => Caller;
  let appRouter: unknown;
  let engineModule: { SEARCH_LIMIT_PER_TYPE: number };
  let queryModule: { SEARCH_MIN_LENGTH: number };
  let postgres: PGlite;

  // One Postgres (the real engine, in process) per blueprint; each test empties it and fills the users and contacts it needs.
  const callerOn = async (contacts: ContactSeed[] = CONTACTS, extraUsers: UserSeed[] = []) => {
    await postgres.exec('TRUNCATE users, contacts, roles, role_permissions');
    // What the database grants each role, as `db:roles` writes it: a role the application does not know has no row.
    for (const [id, label] of [['user', 'User'], ['manager', 'Manager']]) {
      await postgres.query('INSERT INTO roles (id, label) VALUES ($1, $2)', [id, label]);
    }
    for (const [role, action] of [['user', 'create'], ['user', 'read'], ['user', 'update'], ['user', 'delete'], ['manager', 'read']]) {
      await postgres.query("INSERT INTO role_permissions (role_id, resource, action) VALUES ($1, 'contact', $2)", [role, action]);
    }
    for (const user of [...USERS, ...extraUsers]) {
      await postgres.query('INSERT INTO users (id, name, email, email_verified, role) VALUES ($1, $2, $3, false, $4)', [
        user.id,
        user.name,
        user.email,
        user.role,
      ]);
    }
    for (const [index, contact] of contacts.entries()) {
      await postgres.query(
        'INSERT INTO contacts (id, first_name, last_name, email, company, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          contact.id,
          contact.firstName,
          contact.lastName,
          contact.email ?? null,
          contact.company ?? null,
          new Date(1_700_000_000_000 + index * 1000),
        ],
      );
    }
    const queries: LoggedQuery[] = [];
    const db = drizzle(postgres, { logger: { logQuery: (query, params) => queries.push({ query, params }) } });
    queries.length = 0;
    const caller = async (userId: string): Promise<Caller> => {
      const role = (await postgres.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId])).rows[0]?.role;
      return createCaller(appRouter)({ db, headers: new Headers(), session: { user: { id: userId, role } } });
    };
    const readingTable = (table: string): LoggedQuery[] =>
      queries.filter(({ query }) => new RegExp(`\\bfrom "${table}"`, 'i').test(query));
    return Object.assign(caller, { queries, readingTable });
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, blueprint);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    const generated = async <T,>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated<Record<string, PgTable>>('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/pg-core': REAL.pgCore,
    });
    postgres = new PGlite();
    await createPostgresTable(postgres, schema.userTable as PgTable);
    await createPostgresTable(postgres, schema.contactTable as PgTable);
    await createPostgresTable(postgres, schema.roleTable as PgTable);
    await createPostgresTable(postgres, schema.rolePermissionTable as PgTable, { foreignKeys: true });
    await generated('packages/auth/src/permissions.ts', 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/admin/access': REAL.adminAccess,
    });

    await generated('packages/auth/src/role-permissions.ts', 'role-permissions.mjs', {
      '@repo/db': './db.mjs',
      './permissions': './permissions.mjs',
    });
    await generated(`${API}/pagination.ts`, 'pagination.mjs', { zod: REAL.zod });
    await generated(`${API}/user-role.ts`, 'user-role.mjs', { zod: REAL.zod, '@repo/auth/permissions': './permissions.mjs' });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/text-match.ts`, 'text-match.mjs', { '@repo/db': './db.mjs' });
    queryModule = await generated(`${API}/search-query.ts`, 'search-query.mjs', { zod: REAL.zod });
    engineModule = await generated(`${API}/search-engine.ts`, 'search-engine.mjs', { './search-query': './search-query.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', {
      '@trpc/server': REAL.trpcServer,
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '../trpc': './trpc.mjs',
    });
    const searchImports = {
      '@repo/db': './db.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      './middleware/rbac': './rbac.mjs',
      './search-engine': './search-engine.mjs',
      './search-records': './search-records.mjs',
      './text-match': './text-match.mjs',
    };
    await generated(`${API}/search-records.ts`, 'search-records.mjs', searchImports);
    await generated(`${API}/search.ts`, 'search.mjs', {
      '@repo/db': './db.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      './middleware/rbac': './rbac.mjs',
      './search-records': './search-records.mjs',
      './search-engine': './search-engine.mjs',
      './text-match': './text-match.mjs',
    });
    const { searchRouter } = await generated<{ searchRouter: unknown }>(`${API}/router/search.ts`, 'search-router.mjs', {
      '../trpc': './trpc.mjs',
      '../search-query': './search-query.mjs',
      '../search': './search.mjs',
    });
    const { contactRouter } = await generated<{ contactRouter: unknown }>(`${API}/router/contact.ts`, 'contact-router.mjs', {
      zod: REAL.zod,
      '@repo/db': './db.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
    });
    const { userRouter } = await generated<{ userRouter: unknown }>(`${API}/router/user.ts`, 'user-router.mjs', {
      zod: REAL.zod,
      '@repo/db': './db.mjs',
      '../auth': './auth.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-assignment': './role-assignment.mjs',
      '../user-role': './user-role.mjs',
      '@repo/auth/password': './password.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
    });
    const trpc = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => unknown;
      createCallerFactory: (router: unknown) => (ctx: unknown) => Caller;
    };
    appRouter = trpc.router({ search: searchRouter, contact: contactRouter, user: userRouter });
    createCaller = trpc.createCallerFactory;
  });

  afterAll(async () => {
    await postgres.close();
    await cleanupTempDir(tempDir);
  });

  describe('what is searched', () => {
    test('the limits are two characters and five items per type', () => {
      expect(queryModule.SEARCH_MIN_LENGTH).toBe(2);
      expect(engineModule.SEARCH_LIMIT_PER_TYPE).toBe(5);
    });

    test('an administrator finds contacts and users, grouped by type, each with the page that opens it', async () => {
      const caller = await (await callerOn([{ id: 'c-sam', firstName: 'Samira', lastName: 'Khan', email: 'samira@example.com' }]))(ADMIN);
      const groups = await caller.search.records({ query: 'sam' });
      expect(groups.map((group) => [group.type, group.label])).toEqual([
        ['contacts', 'Contacts'],
        ['users', 'Users'],
      ]);
      expect(groupNamed(groups, 'contacts')?.items).toEqual([
        { id: 'c-sam', title: 'Samira Khan', subtitle: 'samira@example.com', href: '/contacts/c-sam' },
      ]);
      expect(groupNamed(groups, 'users')?.items).toEqual([
        { id: STRANGER, title: 'Sam Stranger', subtitle: 'sam@example.com', href: `/admin/users/${STRANGER}` },
      ]);
    });

    test('a contact is found by its full name, its email or its company, whatever the case', async () => {
      const caller = await (await callerOn())(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'GRACE hop' }), 'contacts'))).toEqual(['Grace Hopper']);
      expect(titles(groupNamed(await caller.search.records({ query: 'navy.EXAMPLE' }), 'contacts'))).toEqual(['Grace Hopper']);
      expect(titles(groupNamed(await caller.search.records({ query: 'bletch' }), 'contacts'))).toEqual(['Alan Turing']);
    });

    test('a contact without an email shows its company, and one without both shows nothing', async () => {
      const caller = await (await callerOn([{ id: 'c-bare', firstName: 'Bare', lastName: 'Bones' }, ...CONTACTS]))(ADMIN);
      const items = must(groupNamed(await caller.search.records({ query: 'al' }), 'contacts'), 'the group').items;
      expect(items.map((item) => item.subtitle)).toEqual(['Bletchley']);
      const bare = must(groupNamed(await caller.search.records({ query: 'bare' }), 'contacts'), 'the group').items;
      expect(bare.map((item) => item.subtitle)).toEqual(['']);
    });

    test('users are found by name or by email, whatever the case, and not by role', async () => {
      const caller = await (await callerOn())(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'MIA' }), 'users'))).toEqual(['Mia Member']);
      expect(titles(groupNamed(await caller.search.records({ query: 'max@EXAMPLE' }), 'users'))).toEqual(['Max Manager']);
      expect(groupNamed(await caller.search.records({ query: 'manager' }), 'users')?.items.map((item) => item.id)).toEqual([MANAGER]);
      expect(groupNamed(await caller.search.records({ query: 'admin' }), 'users')?.items.map((item) => item.id)).toEqual([ADMIN]);
    });

    test('a group with no match is left out, and a search matching nothing returns no group', async () => {
      const caller = await (await callerOn())(ADMIN);
      expect((await caller.search.records({ query: 'turing' })).map((group) => group.type)).toEqual(['contacts']);
      expect(await caller.search.records({ query: 'nothing like this' })).toEqual([]);
    });
  });

  describe('the minimum length', () => {
    test.each(['', 'a', ' a ', '  '])('"%s" asks the database nothing and returns no group', async (query) => {
      const database = await callerOn();
      const caller = await database(ADMIN);
      expect(await caller.search.records({ query })).toEqual([]);
      expect(database.queries).toEqual([]);
    });

    test('two characters search, and blanks around them do not count', async () => {
      const caller = await (await callerOn())(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'ma' }), 'users'))).toEqual(['Max Manager']);
      expect(titles(groupNamed(await caller.search.records({ query: '  ma  ' }), 'users'))).toEqual(['Max Manager']);
      expect(await caller.search.records({ query: ' m ' })).toEqual([]);
    });

    test('a text longer than the search allows is cut to its first characters, whatever follows them', async () => {
      const cap = 'a'.repeat(100);
      const caller = await (await callerOn([{ id: 'c-cap', firstName: cap, lastName: 'cut' }]))(ADMIN);
      const found = await caller.search.records({ query: `${cap}${' tail'.repeat(1000)}` });
      expect(titles(groupNamed(found, 'contacts')), 'the name holds the first 100 characters only').toEqual([`${cap} cut`]);
    });
  });

  describe('the limit per type', () => {
    const manyUsers: UserSeed[] = Array.from({ length: 8 }, (_, index) => ({
      id: `u-extra-${index}`,
      name: `Extra Person ${index}`,
      email: `extra${index}@example.com`,
      role: 'user',
    }));
    const manyContacts: ContactSeed[] = Array.from({ length: 8 }, (_, index) => ({
      id: `c-extra-${index}`,
      firstName: 'Extra',
      lastName: `Contact ${index}`,
    }));

    test('each type returns at most five items, the newest contacts first and the users by name', async () => {
      const caller = await (await callerOn(manyContacts, manyUsers))(ADMIN);
      const groups = await caller.search.records({ query: 'extra' });
      expect(titles(groupNamed(groups, 'contacts'))).toEqual([
        'Extra Contact 7',
        'Extra Contact 6',
        'Extra Contact 5',
        'Extra Contact 4',
        'Extra Contact 3',
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
    const contacts: ContactSeed[] = [
      { id: 'c-percent', firstName: 'Save', lastName: '50% today' },
      { id: 'c-plain', firstName: 'Save', lastName: '50 today' },
      { id: 'c-underscore', firstName: 'plan_b', lastName: 'notes' },
      { id: 'c-letter', firstName: 'planXb', lastName: 'notes' },
      { id: 'c-other', firstName: 'Something', lastName: 'else' },
    ];

    test('a % matches itself and not any text', async () => {
      const caller = await (await callerOn(contacts))(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: '50%' }), 'contacts'))).toEqual(['Save 50% today']);
      expect(await caller.search.records({ query: '%%' })).toEqual([]);
    });

    test('a _ matches itself and not any one character', async () => {
      const caller = await (await callerOn(contacts))(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: 'n_b' }), 'contacts'))).toEqual(['plan_b notes']);
      expect(await caller.search.records({ query: '__' })).toEqual([]);
    });

    test('a quote or a backslash is text too', async () => {
      const caller = await (await callerOn([{ id: 'c-quote', firstName: "O'Brien", lastName: '\\ notes' }]))(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: "o'brien" }), 'contacts'))).toEqual(["O'Brien \\ notes"]);
      expect(titles(groupNamed(await caller.search.records({ query: '\\ n' }), 'contacts'))).toEqual(["O'Brien \\ notes"]);
    });

    test('% and _ in a name or an email match themselves too', async () => {
      const caller = await (await callerOn([], [{ id: 'u-special', name: '100%_Real', email: 'real@example.com', role: 'user' }]))(ADMIN);
      expect(titles(groupNamed(await caller.search.records({ query: '0%_R' }), 'users'))).toEqual(['100%_Real']);
      expect(await caller.search.records({ query: 'a%l' })).toEqual([]);
    });
  });

  describe('permissions, on a real database', () => {
    test('a user who is not an administrator gets no group of users, although users match', async () => {
      const caller = await (await callerOn())(MEMBER);
      expect(groupNamed(await caller.search.records({ query: 'Mia' }), 'users')).toBeUndefined();
      expect(groupNamed(await caller.search.records({ query: 'example.com' }), 'users')).toBeUndefined();
      expect(await caller.search.records({ query: 'ada@example' })).toEqual([]);
    });

    test('a user and a manager read contacts, and only contacts', async () => {
      const database = await callerOn();
      for (const userId of [MEMBER, MANAGER]) {
        const groups = await (await database(userId)).search.records({ query: 'ace' });
        expect(groups.map((group) => group.type), userId).toEqual(['contacts']);
      }
    });

    test('a role the application does not know gets no group at all', async () => {
      const caller = await (await callerOn())(STRANGER);
      expect(await caller.search.records({ query: 'grace' })).toEqual([]);
      expect(await caller.search.records({ query: 'Mia' })).toEqual([]);
    });

    test('no query runs for a type the caller may not read', async () => {
      const database = await callerOn();
      await (await database(MEMBER)).search.records({ query: 'mia' });
      expect(database.readingTable('contacts')).toHaveLength(1);
      expect(database.readingTable('users')).toEqual([]);
      const stranger = await callerOn();
      await (await stranger(STRANGER)).search.records({ query: 'grace' });
      expect(stranger.readingTable('contacts')).toEqual([]);
      expect(stranger.readingTable('users')).toEqual([]);
    });

    // The search asks what the lists ask: a role gets a group of a type exactly when it can list that type.
    test.each([ADMIN, MEMBER, MANAGER, STRANGER])('%s finds a type exactly when the list of that type answers', async (userId) => {
      const caller = await (await callerOn())(userId);
      const lists = async (list: () => Promise<unknown[]>): Promise<boolean> => {
        try {
          await list();
          return true;
        } catch {
          return false;
        }
      };
      const groups = await caller.search.records({ query: 'al' });
      expect(groupNamed(groups, 'contacts') !== undefined, 'contacts').toBe(await lists(() => caller.contact.list()));
      const users = await caller.search.records({ query: 'ad' });
      expect(groupNamed(users, 'users') !== undefined, 'users').toBe(await lists(() => caller.user.list()));
    });
  });
});
