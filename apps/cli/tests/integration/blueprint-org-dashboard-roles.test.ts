import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgTable } from 'drizzle-orm/pg-core';
import { cleanupTempDir, createPostgresTable, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start'];
const AUTH = 'packages/auth/src';
const API = 'packages/api/src';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';

const REAL = {
  betterAuth: Bun.resolveSync('better-auth', import.meta.dir),
  plugins: Bun.resolveSync('better-auth/plugins', import.meta.dir),
  api: Bun.resolveSync('better-auth/api', import.meta.dir),
  db: Bun.resolveSync('better-auth/db', import.meta.dir),
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  adminAccess: Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
  drizzleAdapter: Bun.resolveSync('@better-auth/drizzle-adapter', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  pgCore: Bun.resolveSync('drizzle-orm/pg-core', import.meta.dir),
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  superjson: Bun.resolveSync('superjson', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
};

const TABLES = ['userTable', 'userSessionTable', 'userAccountTable', 'userVerificationTable', 'contactTable', 'roleTable', 'rolePermissionTable'];

// What the module `@repo/db` is in the test: Drizzle, the generated tables, and `db`, which reads the database of the test
// running (a new one for each test) the way the module of a project reads the one of DATABASE_URL.
const DB_STUB = `export * from '${REAL.drizzle}';
export * from './schema.mjs';
export const db = new Proxy({}, { get: (_, property) => Reflect.get(globalThis.__rolesDb, property) });`;

interface Outcome {
  written: boolean;
  roles: number;
  permissions: number;
}

interface Permissions {
  ADMIN_ROLE: string;
  DEFAULT_ROLE: string;
  BUSINESS_PERMISSIONS: readonly string[];
  PERMISSIONS: readonly string[];
  ADMIN_PERMISSIONS: readonly string[];
  businessStatement: Record<string, readonly string[]>;
  accountStatement: Record<string, readonly string[]>;
  roles: Record<string, { statements: Record<string, readonly string[]> }>;
  verdictOf: (granted: readonly string[] | undefined, request: Record<string, string[]>) => string;
}

interface RolePermissions {
  permissionsOf: (db: unknown, role: string | null | undefined) => Promise<string[]>;
  hasPermission: (db: unknown, role: string | null | undefined, resource: string, action: string) => Promise<boolean>;
}

interface RoleStore {
  writeDefaultRoles: (db: unknown, definitions?: Record<string, unknown>) => Promise<Outcome>;
}

interface RoleAssignment {
  assignRole: (db: unknown, userId: string, role: string) => Promise<unknown>;
  claimBan: (db: unknown, userId: string) => Promise<unknown>;
  removeAccount: (db: unknown, userId: string) => Promise<unknown>;
}

interface UserOutput {
  id: string;
  role: string | null;
}

interface Answer {
  status: number;
  json: { message?: string; user?: UserOutput } | null;
}

interface Auth {
  handler: (request: Request) => Promise<Response>;
  api: {
    createUser: (input: { body: { email: string; password: string; name: string; role?: unknown } }) => Promise<{ user: UserOutput }>;
    signInEmail: (input: { body: { email: string; password: string }; asResponse: true }) => Promise<Response>;
  };
}

interface Caller {
  permissions: { mine: () => Promise<string[]> };
  contact: { list: (input?: unknown) => Promise<unknown[]>; count: () => Promise<number> };
  roles: {
    matrix: () => Promise<{
      permissions: { name: string; editable: boolean }[];
      roles: { id: string; label: string; permissions: string[]; holders: number; editable: boolean; deletable: boolean }[];
    }>;
    create: (input: { id: string; label: string }) => Promise<{ id: string }>;
    setPermission: (input: { id: string; permission: string; granted: boolean }) => Promise<{ granted: boolean }>;
    remove: (input: { id: string }) => Promise<{ removed: boolean }>;
  };
  user: {
    create: (input: { name: string; email: string; role: string }) => Promise<{ password: string; user: UserOutput }>;
    setRole: (input: { id: string; role: string }) => Promise<{ role: string }>;
    assignableRoles: () => Promise<{ id: string; label: string }[]>;
  };
}

// Values a request could send as a role that are not the id of one existing role. Each is something better-auth's `admin`
// plugin stores or treats as a role of some kind: it splits `user.role` on `,`, so `user,admin` is an administrator to it
// and nothing to the permission engine.
const NOT_ONE_EXISTING_ROLE: [string, unknown][] = [
  ['a comma list that holds admin', 'user,admin'],
  ['a comma list that starts with admin', 'admin,user'],
  ['admin in capitals', 'Admin'],
  ['admin with a leading space', ' admin'],
  ['admin with a trailing space', 'admin '],
  ['an array of two roles', ['user', 'admin']],
  ['an array of one existing role', ['manager']],
  ['an id no role has', 'ghost'],
  ['admin with a trailing line break', 'admin\n'],
  ['an empty string', ''],
  ['a key of Object.prototype', 'constructor'],
  ['the prototype accessor', '__proto__'],
  ['a number', 1],
  ['null', null],
  ['an object', { id: 'admin' }],
];

const OBJECT_KEYS = Object.getOwnPropertyNames(Object.prototype).filter((key) => /^[a-z0-9-]+$/.test(key.toLowerCase()));

describe.each(BLUEPRINTS)('%s roles on PostgreSQL', (blueprint) => {
  let tempDir: string;
  let schema: Record<string, PgTable>;
  let permissions: Permissions;
  let engine: RolePermissions;
  let store: RoleStore;
  let assignment: RoleAssignment;
  let management: { listRoleMatrix: unknown };
  let createAuth: () => Auth;
  let createCaller: (ctx: unknown) => Caller;

  let postgres: PGlite;
  let db: unknown;
  let auth: Auth;
  let queries: string[];
  let emails = 0;
  let errorLog: ReturnType<typeof spyOn<Console, 'error'>>;

  const run = (sql: string, params: unknown[] = []) => postgres.query(sql, params);
  const rows = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => (await postgres.query<T>(sql, params)).rows;
  const addRole = (id: string, label = id) => run('INSERT INTO roles (id, label) VALUES ($1, $2)', [id, label]);
  const grant = async (role: string, ...names: string[]) => {
    for (const name of names) {
      const [resource = '', action = ''] = name.split('.');
      await run('INSERT INTO role_permissions (role_id, resource, action) VALUES ($1, $2, $3)', [role, resource, action]);
    }
  };
  const roleOf = async (id: string) => (await rows<{ role: string }>('SELECT role FROM users WHERE id = $1', [id]))[0]?.role;
  const roleIds = async () => (await rows<{ id: string }>('SELECT id FROM roles ORDER BY id')).map((row) => row.id);
  const permissionRows = () =>
    rows<{ role_id: string; resource: string; action: string }>('SELECT role_id, resource, action FROM role_permissions ORDER BY 1, 2, 3');
  const activeAdministrators = async () =>
    (await rows<{ id: string }>("SELECT id FROM users WHERE role = 'admin' AND NOT coalesce(banned, false) ORDER BY id")).map((row) => row.id);
  const permissionReads = () => queries.filter((query) => query.includes('"role_permissions"')).length;

  async function addAccount(name: string, role: string): Promise<{ id: string; email: string }> {
    const email = `${name}${++emails}@example.com`;
    const { user } = await auth.api.createUser({ body: { email, password: PASSWORD, name } });
    await run('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
    return { id: user.id, email };
  }

  async function signIn(email: string): Promise<string> {
    const response = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

  async function request(cookie: string, path: string, body: unknown): Promise<Answer> {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie, 'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  }

  // Every call is a request of its own unless a test hands the same headers to several: tRPC builds one context per request.
  const callerOf = (role: string | null, userId = 'u1', headers = new Headers()) =>
    createCaller({ db, headers, session: { user: { id: userId, role } } });
  const adminCaller = async (account: { id: string; email: string }) =>
    createCaller({ db, headers: new Headers({ cookie: await signIn(account.email) }), session: { user: { id: account.id, role: 'admin' } } });

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = 'a-secret-for-the-tests-only-0123456789abcdef';
    process.env.BETTER_AUTH_URL = ORIGIN;
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, blueprint);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'db.mjs'), DB_STUB);
    await Bun.write(
      join(stubs, 'api-auth.mjs'),
      "import { createAuth } from './auth.mjs';\nexport const auth = createAuth();",
    );

    const generated = async <T,>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/pg-core': REAL.pgCore,
    });
    const own = {
      '@repo/db': './db.mjs',
      './permissions': './permissions.mjs',
      './default-roles': './default-roles.mjs',
      './role-store': './role-store.mjs',
      './role-permissions': './role-permissions.mjs',
      './role-assignment': './role-assignment.mjs',
      './guard-administrators': './guard-administrators.mjs',
      './refuse-own-role-change': './refuse-own-role-change.mjs',
      './link-delivery': './link-delivery.mjs',
      './email-change-guard': './email-change-guard.mjs',
    };
    permissions = await generated(`${AUTH}/permissions.ts`, 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/admin/access': REAL.adminAccess,
    });
    await generated(`${AUTH}/default-roles.ts`, 'default-roles.mjs', own);
    store = await generated(`${AUTH}/role-store.ts`, 'role-store.mjs', own);
    engine = await generated(`${AUTH}/role-permissions.ts`, 'role-permissions.mjs', own);
    assignment = await generated(`${AUTH}/role-assignment.ts`, 'role-assignment.mjs', own);
    management = await generated(`${AUTH}/role-management.ts`, 'role-management.mjs', own);
    await generated(`${AUTH}/link-delivery.ts`, 'link-delivery.mjs');
    await generated(`${AUTH}/email-change-guard.ts`, 'email-change-guard.mjs', { ...own, 'better-auth/api': REAL.api });
    await generated(`${AUTH}/refuse-own-role-change.ts`, 'refuse-own-role-change.mjs', { 'better-auth/api': REAL.api });
    await generated(`${AUTH}/guard-administrators.ts`, 'guard-administrators.mjs', { ...own, 'better-auth/api': REAL.api, 'better-auth/db': REAL.db });
    ({ createAuth } = await generated<{ createAuth: () => Auth }>(`${AUTH}/auth.ts`, 'auth.mjs', {
      ...own,
      '@better-auth/drizzle-adapter': REAL.drizzleAdapter,
      'better-auth': REAL.betterAuth,
      'better-auth/plugins': REAL.plugins,
    }));

    const apiModules = {
      '@trpc/server': REAL.trpcServer,
      '@repo/db': './db.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@repo/auth/role-assignment': './role-assignment.mjs',
      '@repo/auth/role-management': './role-management.mjs',
      '@repo/auth/password': './password.mjs',
      '@repo/auth/session-cache': './session-cache.mjs',
      '../auth': './api-auth.mjs',
      './auth': './api-auth.mjs',
      '../trpc': './trpc.mjs',
      '../auth-errors': './auth-errors.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../user-role': './user-role.mjs',
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
      superjson: REAL.superjson,
      zod: REAL.zod,
    };
    await Bun.write(join(stubs, 'session-cache.mjs'), 'export const getRequestSession = (_headers, read) => read();');
    await Bun.write(join(stubs, 'password.mjs'), "export const generatePassword = () => 'generated-password-1';");
    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', { '@trpc/server': REAL.trpcServer });
    await generated(`${API}/trpc.ts`, 'trpc.mjs', apiModules);
    await generated(`${API}/pagination.ts`, 'pagination.mjs', { zod: REAL.zod });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/user-role.ts`, 'user-role.mjs', apiModules);
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', apiModules);
    const routers: Record<string, unknown> = {};
    for (const [key, file, exportName] of [
      ['contact', 'contact', 'contactRouter'],
      ['permissions', 'permissions', 'permissionsRouter'],
      ['roles', 'roles', 'rolesRouter'],
      ['user', 'user', 'userRouter'],
    ] as const) {
      const module = await generated<Record<string, unknown>>(`${API}/router/${file}.ts`, `${file}-router.mjs`, apiModules);
      routers[key] = module[exportName];
    }
    const trpc = (await import(join(stubs, 'trpc.mjs'))) as { router: (procedures: Record<string, unknown>) => unknown };
    const appRouter = trpc.router(routers) as { createCaller: (ctx: unknown) => Caller };
    createCaller = (ctx) => appRouter.createCaller(ctx);

    // One Postgres (the real engine, in process) per blueprint; each test empties it.
    postgres = new PGlite();
    for (const name of TABLES) await createPostgresTable(postgres, schema[name] as PgTable, { foreignKeys: true });
  });

  afterAll(async () => {
    await postgres.close();
    await cleanupTempDir(tempDir);
  });

  // better-auth logs an error for a thrown message that contains `does not exist`, `table` or `column` (it reads them as
  // database errors), so a refusal worded that way would fill the production log. A refusal is an answer, not a failure.
  beforeEach(async () => {
    errorLog = spyOn(console, 'error');
    await postgres.exec('TRUNCATE users, user_sessions, user_accounts, user_verifications, contacts, roles, role_permissions');
    queries = [];
    db = drizzle(postgres, { logger: { logQuery: (query) => queries.push(query) } });
    (globalThis as { __rolesDb?: unknown }).__rolesDb = db;
    auth = createAuth();
    await addRole('user', 'User');
    await addRole('manager', 'Manager');
  });

  afterEach(async () => {
    const logged = errorLog.mock.calls.map((call) => String(call[0]));
    errorLog.mockRestore();
    expect(logged).toEqual([]);
  });

  describe('what a role may do is read from the database, per request', () => {
    test('a role with no row in roles holds nothing, even when stray permission rows name it', async () => {
      await postgres.exec('SET session_replication_role = replica');
      await grant('ghost', 'contact.read');
      await postgres.exec('SET session_replication_role = origin');
      expect(await engine.permissionsOf(db, 'ghost')).toEqual([]);
    });

    test('a role with no permission rows, an empty database and no role at all hold nothing', async () => {
      expect(await engine.permissionsOf(db, 'manager')).toEqual([]);
      await postgres.exec('DELETE FROM roles');
      expect(await engine.permissionsOf(db, 'user')).toEqual([]);
      expect(await engine.permissionsOf(db, null)).toEqual([]);
      expect(await engine.permissionsOf(db, undefined)).toEqual([]);
      expect(await engine.permissionsOf(db, '')).toEqual([]);
    });

    test('a role holds exactly the rows it has, and admin holds everything it is compiled with with no row', async () => {
      await grant('manager', 'contact.read');
      expect(await engine.permissionsOf(db, 'manager')).toEqual(['contact.read']);
      expect(await engine.permissionsOf(db, 'admin')).toEqual([...permissions.ADMIN_PERMISSIONS]);
      expect(permissions.ADMIN_PERMISSIONS).toEqual(expect.arrayContaining([...permissions.BUSINESS_PERMISSIONS, 'user.list', 'session.list']));
    });

    test('a procedure answers FORBIDDEN to a role the database does not know, and UNAUTHORIZED with no session', async () => {
      await expect(callerOf('ghost').contact.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(createCaller({ db, headers: new Headers(), session: null }).contact.list()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    test('deleting a row stops the very next call, with the same database and the same module', async () => {
      await grant('manager', 'contact.read');
      expect(await callerOf('manager').contact.list()).toEqual([]);
      await run("DELETE FROM role_permissions WHERE role_id = 'manager'");
      await expect(callerOf('manager').contact.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await grant('manager', 'contact.read');
      expect(await callerOf('manager').contact.list()).toEqual([]);
    });

    test('deleting the role stops it too, and the foreign key takes its rows with it', async () => {
      await grant('manager', 'contact.read');
      await run("DELETE FROM roles WHERE id = 'manager'");
      expect(await permissionRows()).toEqual([]);
      await expect(callerOf('manager').contact.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('an action the role does not hold is refused while the one it holds passes', async () => {
      await grant('manager', 'contact.read');
      expect(await callerOf('manager').contact.count()).toBe(0);
      const create = (callerOf('manager') as unknown as { contact: { create: (input: unknown) => Promise<unknown> } }).contact.create;
      await expect(create({ firstName: 'Ada', lastName: 'Lovelace' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('three procedures of one request read role_permissions once, and each new request reads again', async () => {
      await grant('manager', 'contact.read');
      const headers = new Headers();
      const caller = callerOf('manager', 'u1', headers);
      queries.length = 0;
      await Promise.all([caller.contact.list(), caller.contact.count(), caller.permissions.mine()]);
      expect(permissionReads()).toBe(1);
      await callerOf('manager', 'u1', new Headers()).permissions.mine();
      expect(permissionReads()).toBe(2);
    });

    test('permissions.mine is the flat list of the caller, and follows a revocation on the next request', async () => {
      await grant('user', 'contact.read', 'contact.update');
      expect((await callerOf('user').permissions.mine()).sort()).toEqual(['contact.read', 'contact.update']);
      await run("DELETE FROM role_permissions WHERE action = 'update'");
      expect(await callerOf('user').permissions.mine()).toEqual(['contact.read']);
      expect(await callerOf('admin').permissions.mine()).toEqual([...permissions.ADMIN_PERMISSIONS]);
    });
  });

  describe('a stored permission can only name a business resource', () => {
    test('rows that name user or session, or a name outside the vocabulary, are never honored', async () => {
      await grant('manager', 'user.list', 'user.delete', 'session.revoke', 'contact.explode', 'contact.read');
      expect(await engine.permissionsOf(db, 'manager')).toEqual(['contact.read']);
      await expect(callerOf('manager').roles.matrix()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('the vocabulary of stored permissions is the business statement, and excludes the account statement', () => {
      expect(Object.keys(permissions.businessStatement)).toEqual(['contact']);
      expect(Object.keys(permissions.accountStatement)).toEqual(expect.arrayContaining(['user', 'session']));
      for (const name of permissions.BUSINESS_PERMISSIONS) expect(name).toMatch(/^contact\./);
    });

    test('the compiled admin role covers every business action, and no other compiled role grants anything', () => {
      const covered = Object.entries(permissions.roles.admin?.statements ?? {}).flatMap(([resource, actions]) =>
        actions.map((action) => `${resource}.${action}`),
      );
      expect(covered).toEqual(expect.arrayContaining([...permissions.BUSINESS_PERMISSIONS]));
      for (const name of ['user', 'manager']) expect(permissions.roles[name]?.statements).toEqual({});
    });
  });

  describe('the defaults command', () => {
    beforeEach(async () => {
      await postgres.exec('DELETE FROM roles');
    });

    test('gives a fresh database the permissions the code gave before: user keeps the contact set, manager reads', async () => {
      expect(await store.writeDefaultRoles(db)).toEqual({ written: true, roles: 2, permissions: 5 });
      expect(await roleIds()).toEqual(['manager', 'user']);
      expect(await engine.permissionsOf(db, 'user')).toEqual(
        expect.arrayContaining(['contact.create', 'contact.read', 'contact.update', 'contact.delete']),
      );
      expect(await engine.permissionsOf(db, 'manager')).toEqual(['contact.read']);
    });

    test('runs again without changing anything, and never restores what an operator removed', async () => {
      await store.writeDefaultRoles(db);
      await run("DELETE FROM role_permissions WHERE role_id = 'user' AND action = 'delete'");
      await run("UPDATE roles SET label = 'Staff' WHERE id = 'user'");
      await run("DELETE FROM roles WHERE id = 'manager'");
      const before = await permissionRows();

      expect(await store.writeDefaultRoles(db)).toMatchObject({ written: false });
      expect(await permissionRows()).toEqual(before);
      expect(await roleIds()).toEqual(['user']);
      expect((await rows<{ label: string }>("SELECT label FROM roles WHERE id = 'user'"))[0]?.label).toBe('Staff');
    });

    test('never refills a matrix an operator emptied, and leaves a role someone else created first alone', async () => {
      await addRole('auditor', 'Auditor');
      expect(await store.writeDefaultRoles(db)).toEqual({ written: false, roles: 1, permissions: 0 });
      expect(await roleIds()).toEqual(['auditor']);
      expect(await permissionRows()).toEqual([]);
    });

    test('refuses a definition that names an account resource, an unknown action, admin or an unsafe id, and writes nothing', async () => {
      const attempt = (definitions: Record<string, unknown>) => () => store.writeDefaultRoles(db, definitions);
      await expect(attempt({ bad: { label: 'Bad', permissions: ['user.delete'] } })()).rejects.toThrow('not a business permission');
      await expect(attempt({ bad: { label: 'Bad', permissions: ['contact.explode'] } })()).rejects.toThrow('not a business permission');
      await expect(attempt({ admin: { label: 'Admin', permissions: [] } })()).rejects.toThrow('compiled');
      await expect(attempt({ 'Bad Id': { label: 'Bad', permissions: [] } })()).rejects.toThrow('not a role identifier');
      await expect(attempt({ ok: { label: 'Ok', permissions: ['contact.read'] }, bad: { label: 'Bad', permissions: ['session.list'] } })()).rejects.toThrow();
      expect(await roleIds()).toEqual([]);
    });

    test('is all or none: a failure in the middle leaves no role and no permission, and a rerun writes everything', async () => {
      const failing = { one: { label: 'One', permissions: ['contact.read', 'contact.read'] } };
      await expect(store.writeDefaultRoles(db, failing)).rejects.toThrow();
      expect(await roleIds()).toEqual([]);
      expect(await permissionRows()).toEqual([]);
      expect(await store.writeDefaultRoles(db)).toMatchObject({ written: true });
    });

    test('a label is data, never SQL', async () => {
      const label = "O'Brien'); DROP TABLE roles; --";
      await store.writeDefaultRoles(db, { tricky: { label, permissions: ['contact.read'] } });
      expect((await rows<{ label: string }>("SELECT label FROM roles WHERE id = 'tricky'"))[0]?.label).toBe(label);
    });

    test('two runs at once write the roles once', async () => {
      const outcomes = await Promise.all([store.writeDefaultRoles(db), store.writeDefaultRoles(db)]);
      expect(outcomes.map((outcome) => outcome.written).sort()).toEqual([false, true]);
      expect(await roleIds()).toEqual(['manager', 'user']);
    });
  });

  describe('only the literal admin role manages roles', () => {
    test.each(['user', 'manager', 'Admin', 'user,admin', 'ghost'])('%s is refused by every procedure of the roles router', async (role) => {
      await grant('manager', ...permissions.BUSINESS_PERMISSIONS);
      const caller = callerOf(role).roles;
      const calls = [
        () => caller.matrix(),
        () => caller.create({ id: 'auditor', label: 'Auditor' }),
        () => caller.setPermission({ id: 'manager', permission: 'contact.read', granted: true }),
        () => caller.remove({ id: 'manager' }),
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await roleIds()).not.toContain('auditor');
    });

    test('a request with no session is refused', async () => {
      const anonymous = createCaller({ db, headers: new Headers(), session: null });
      await expect(anonymous.roles.matrix()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    test('the matrix lists admin first, read only, then the roles of the database with what each holds and who holds it', async () => {
      await grant('manager', 'contact.read');
      await addAccount('boss', 'admin');
      await addAccount('rep', 'user');
      const matrix = await callerOf('admin').roles.matrix();

      expect(matrix.permissions.filter((permission) => permission.editable).map((permission) => permission.name)).toEqual([
        ...permissions.BUSINESS_PERMISSIONS,
      ]);
      expect(matrix.permissions.filter((permission) => !permission.editable).map((permission) => permission.name)).toEqual(
        expect.arrayContaining(['user.list', 'session.list']),
      );
      expect(matrix.roles.map((role) => [role.id, role.holders, role.editable, role.deletable])).toEqual([
        ['admin', 1, false, false],
        ['manager', 0, true, true],
        ['user', 1, true, false],
      ]);
      expect(matrix.roles[1]?.permissions).toEqual(['contact.read']);
    });
  });

  describe('a permission is granted and revoked from the code vocabulary only', () => {
    test('grants and revokes one permission, and doing either twice changes nothing more', async () => {
      const roles = callerOf('admin').roles;
      expect(await roles.setPermission({ id: 'manager', permission: 'contact.update', granted: true })).toEqual({ granted: true });
      await roles.setPermission({ id: 'manager', permission: 'contact.update', granted: true });
      expect(await permissionRows()).toEqual([{ role_id: 'manager', resource: 'contact', action: 'update' }]);
      expect(await callerOf('manager').permissions.mine()).toEqual(['contact.update']);

      await roles.setPermission({ id: 'manager', permission: 'contact.update', granted: false });
      await roles.setPermission({ id: 'manager', permission: 'contact.update', granted: false });
      expect(await permissionRows()).toEqual([]);
      expect(await callerOf('manager').permissions.mine()).toEqual([]);
    });

    test.each(['user.list', 'user.delete', 'session.revoke', 'contact.explode', 'contact', 'contact.read.extra', '', 'constructor.read'])(
      'a grant or a revocation of %p is refused and writes nothing',
      async (name) => {
        const roles = callerOf('admin').roles;
        await expect(roles.setPermission({ id: 'manager', permission: name, granted: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(roles.setPermission({ id: 'manager', permission: name, granted: false })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(await permissionRows()).toEqual([]);
      },
    );

    test('a role the database has no row for is not found, and no permission row is left for it', async () => {
      await expect(
        callerOf('admin').roles.setPermission({ id: 'ghost', permission: 'contact.read', granted: true }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await permissionRows()).toEqual([]);
    });
  });

  describe('admin and the default role are not editable, and reserved ids are never created', () => {
    test('admin is not edited, not deleted, and a stored row is never created for it', async () => {
      const roles = callerOf('admin').roles;
      await expect(roles.setPermission({ id: 'admin', permission: 'contact.read', granted: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(roles.remove({ id: 'admin' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(roles.create({ id: 'admin', label: 'Admin' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await permissionRows()).toEqual([]);
      expect(await roleIds()).toEqual(['manager', 'user']);
    });

    test('the default role can be edited but not deleted, and cannot be created again', async () => {
      const roles = callerOf('admin').roles;
      await roles.setPermission({ id: 'user', permission: 'contact.read', granted: true });
      await expect(roles.remove({ id: 'user' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(roles.create({ id: 'user', label: 'User' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await roleIds()).toContain('user');
    });

    test.each(OBJECT_KEYS)('the key %p, which every object has, is reserved: no role is created under it', async (key) => {
      if (!/^[a-z0-9-]+$/.test(key)) return;
      await expect(callerOf('admin').roles.create({ id: key, label: 'Key' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await roleIds()).not.toContain(key);
    });

    test.each(['', 'Auditor', 'with space', 'under_score', 'a'.repeat(41), 'ünï', 'a,b'])('the id %p is refused', async (id) => {
      await expect(callerOf('admin').roles.create({ id, label: 'Label' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    test.each(['', '   ', 'x'.repeat(65)])('the label %p is refused', async (label) => {
      await expect(callerOf('admin').roles.create({ id: 'auditor', label })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await roleIds()).not.toContain('auditor');
    });
  });

  describe('a role is created and deleted, and only a role nobody holds is deleted', () => {
    test('creates a role that holds nothing, lists it, and refuses a duplicate that keeps the first label', async () => {
      const roles = callerOf('admin').roles;
      expect(await roles.create({ id: 'auditor', label: '  Auditor ' })).toEqual({ id: 'auditor' });
      await expect(roles.create({ id: 'auditor', label: 'Other' })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await rows<{ label: string }>("SELECT label FROM roles WHERE id = 'auditor'"))[0]?.label).toBe('Auditor');
      expect(await engine.permissionsOf(db, 'auditor')).toEqual([]);
    });

    test('the same id created twice at once makes one role', async () => {
      const roles = callerOf('admin').roles;
      const results = await Promise.allSettled([roles.create({ id: 'auditor', label: 'A' }), roles.create({ id: 'auditor', label: 'B' })]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect((await rows('SELECT id FROM roles WHERE id = $1', ['auditor'])).length).toBe(1);
    });

    test('deletes a role nobody holds with its permission rows, and leaves the other roles alone', async () => {
      await addRole('auditor');
      await grant('auditor', 'contact.read');
      await grant('manager', 'contact.read');
      expect(await callerOf('admin').roles.remove({ id: 'auditor' })).toEqual({ removed: true });
      expect(await roleIds()).toEqual(['manager', 'user']);
      expect(await permissionRows()).toEqual([{ role_id: 'manager', resource: 'contact', action: 'read' }]);
    });

    test('a role created again under a deleted id starts with nothing', async () => {
      const roles = callerOf('admin').roles;
      await roles.create({ id: 'auditor', label: 'Auditor' });
      await roles.setPermission({ id: 'auditor', permission: 'contact.read', granted: true });
      await roles.remove({ id: 'auditor' });
      await roles.create({ id: 'auditor', label: 'Auditor' });
      expect(await permissionRows()).toEqual([]);
    });

    test('a role someone holds is refused, says who holds it, and keeps its permissions; a banned holder still holds it', async () => {
      await grant('manager', 'contact.read');
      const holder = await addAccount('holder', 'manager');
      await expect(callerOf('admin').roles.remove({ id: 'manager' })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('1 account holds this role'),
      });
      await run('UPDATE users SET banned = true WHERE id = $1', [holder.id]);
      await expect(callerOf('admin').roles.remove({ id: 'manager' })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await roleIds()).toContain('manager');
      expect(await permissionRows()).toHaveLength(1);
      await addAccount('second', 'manager');
      await expect(callerOf('admin').roles.remove({ id: 'manager' })).rejects.toMatchObject({
        message: expect.stringContaining('2 users hold this role'),
      });
    });

    test('a role nobody has is not found', async () => {
      await expect(callerOf('admin').roles.remove({ id: 'ghost' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    test('a role created at runtime works for a user assigned to it, and stops when it is emptied', async () => {
      const roles = callerOf('admin').roles;
      await roles.create({ id: 'auditor', label: 'Auditor' });
      await roles.setPermission({ id: 'auditor', permission: 'contact.read', granted: true });
      expect(await callerOf('auditor').contact.count()).toBe(0);
      await roles.setPermission({ id: 'auditor', permission: 'contact.read', granted: false });
      await expect(callerOf('auditor').contact.count()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('no refusal of the modules uses the words better-auth logs as a database error', async () => {
      await addAccount('holder', 'manager');
      const roles = callerOf('admin').roles;
      const attempts = [
        () => roles.create({ id: 'user', label: 'x' }),
        () => roles.create({ id: 'auditor', label: '' }),
        () => roles.setPermission({ id: 'ghost', permission: 'contact.read', granted: true }),
        () => roles.setPermission({ id: 'manager', permission: 'user.list', granted: true }),
        () => roles.remove({ id: 'ghost' }),
        () => roles.remove({ id: 'manager' }),
        () => roles.remove({ id: 'admin' }),
        () => roles.remove({ id: 'user' }),
      ];
      for (const attempt of attempts) {
        const message = await attempt().then(
          () => '',
          (error: Error) => error.message,
        );
        expect(message).not.toBe('');
        expect(message).not.toMatch(/does not exist|\btable\b|\bcolumn\b|\brelation\b/i);
      }
    });
  });

  describe('a role is assigned as exactly one id that exists, on every path', () => {
    test('/admin/set-role gives a user a compiled role, a role only the database knows and admin', async () => {
      await addRole('auditor', 'Auditor');
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const cookie = await signIn(admin.email);

      for (const role of ['manager', 'auditor', 'admin', 'user']) {
        const answer = await request(cookie, '/admin/set-role', { userId: target.id, role });
        expect([role, answer.status]).toEqual([role, 200]);
        expect(await roleOf(target.id)).toBe(role);
        expect(answer.json?.user).toMatchObject({ id: target.id, role });
      }
    });

    test.each(NOT_ONE_EXISTING_ROLE)('/admin/set-role refuses %s', async (_, role) => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/set-role', { userId: target.id, role });
      expect(answer.status).toBe(400);
      expect(await roleOf(target.id)).toBe('user');
    });

    test.each(NOT_ONE_EXISTING_ROLE)('/admin/update-user refuses %s as data.role', async (_, role) => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/update-user', { userId: target.id, data: { role } });
      expect(answer.status).toBe(400);
      expect(await roleOf(target.id)).toBe('user');
    });

    test('a role the database no longer has is refused as an unknown one, and a user that does not exist is not found', async () => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const cookie = await signIn(admin.email);
      await run("DELETE FROM roles WHERE id = 'manager'");
      const unknown = await request(cookie, '/admin/set-role', { userId: target.id, role: 'manager' });
      expect(unknown.status).toBe(400);
      expect(unknown.json?.message).toBe('No role has that id');
      expect(await roleOf(target.id)).toBe('user');
      expect((await request(cookie, '/admin/set-role', { userId: 'nobody', role: 'user' })).status).toBe(404);
    });

    test('/admin/update-user changes no role and no ban, but still updates the other fields', async () => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const cookie = await signIn(admin.email);
      for (const data of [{ role: 'manager' }, { banned: true }, { banReason: 'because' }, { banExpires: 1 }]) {
        expect([Object.keys(data)[0], (await request(cookie, '/admin/update-user', { userId: target.id, data })).status]).toEqual([
          Object.keys(data)[0],
          400,
        ]);
      }
      expect((await rows<{ role: string; banned: boolean }>('SELECT role, banned FROM users WHERE id = $1', [target.id]))[0]).toEqual({
        role: 'user',
        banned: false,
      });
      expect((await request(cookie, '/admin/update-user', { userId: target.id, data: { name: 'Renamed' } })).status).toBe(200);
    });

    test('/admin/create-user creates the account on the default role or on admin only, in body.role and in data.role', async () => {
      const admin = await addAccount('admin', 'admin');
      const cookie = await signIn(admin.email);
      const create = (body: Record<string, unknown>, index: number) =>
        request(cookie, '/admin/create-user', { email: `new${index}@example.com`, password: PASSWORD, name: 'New', ...body });
      const created = async (index: number) =>
        (await rows<{ role: string }>('SELECT role FROM users WHERE email = $1', [`new${index}@example.com`]))[0]?.role;

      for (const [index, [body, expected]] of (
        [
          [{ role: 'admin' }, 'admin'],
          [{ data: { role: 'admin' } }, 'admin'],
          [{ role: 'user' }, 'user'],
          [{}, 'user'],
        ] as [Record<string, unknown>, string][]
      ).entries()) {
        expect([index, (await create(body, index)).status]).toEqual([index, 200]);
        expect(await created(index)).toBe(expected);
      }
      // A role that can be deleted is refused: the account is written after the guard read, so it could be gone by then.
      for (const [index, body] of [
        [10, { role: 'manager' }],
        [11, { data: { role: 'manager' } }],
        [12, { role: 'constructor' }],
        [13, { role: ['admin'] }],
      ] as [number, Record<string, unknown>][]) {
        expect([index, (await create(body, index)).status]).toEqual([index, 400]);
        expect(await created(index)).toBeUndefined();
      }
    });

    test('a role row named after a key every object has is never assigned: the plugin reads roles by plain key', async () => {
      await postgres.exec('SET session_replication_role = replica');
      await addRole('constructor', 'Constructor');
      await postgres.exec('SET session_replication_role = origin');
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/set-role', { userId: target.id, role: 'constructor' });
      expect(answer.status).toBe(400);
      expect(await roleOf(target.id)).toBe('user');
    });

    test('a caller that is not exactly admin is refused every one of these paths, whatever the plugin makes of its role', async () => {
      const target = await addAccount('target', 'user');
      for (const role of ['user', 'manager', 'user,admin', 'Admin']) {
        const caller = await addAccount(`caller-${role.replace(/\W/g, '')}`, role);
        const cookie = await signIn(caller.email);
        for (const [path, body] of [
          ['/admin/set-role', { userId: target.id, role: 'manager' }],
          ['/admin/ban-user', { userId: target.id }],
          ['/admin/remove-user', { userId: target.id }],
          ['/admin/update-user', { userId: target.id, data: { name: 'x' } }],
          ['/admin/create-user', { email: 'new@example.com', password: PASSWORD, name: 'New' }],
        ] as [string, unknown][]) {
          const answer = await request(cookie, path, body);
          expect([role, path, answer.status]).toEqual([role, path, 403]);
        }
      }
      expect(await roleOf(target.id)).toBe('user');
      expect(await rows('SELECT 1 FROM users WHERE email = $1', ['new@example.com'])).toEqual([]);
    });

    test('an anonymous request is refused on each of the five endpoints, and writes nothing', async () => {
      const target = await addAccount('target', 'user');
      for (const [path, body] of [
        ['/admin/set-role', { userId: target.id, role: 'manager' }],
        ['/admin/ban-user', { userId: target.id }],
        ['/admin/remove-user', { userId: target.id }],
        ['/admin/update-user', { userId: target.id, data: { name: 'x' } }],
        ['/admin/create-user', { email: 'anon@example.com', password: PASSWORD, name: 'Anon' }],
      ] as [string, unknown][]) {
        expect([path, (await request('', path, body)).status]).toEqual([path, 401]);
      }
      expect(await roleOf(target.id)).toBe('user');
    });

    test('the other ways to write users.role are closed: a user changing their own role, and sign-up', async () => {
      const user = await addAccount('plain', 'user');
      const cookie = await signIn(user.email);
      expect((await request(cookie, '/update-user', { role: 'admin' })).status).toBeLessThan(500);
      expect(await roleOf(user.id)).toBe('user');
      expect((await request('', '/sign-up/email', { email: 'x@example.com', password: PASSWORD, name: 'X', role: 'admin' })).status).toBe(400);
    });

    test('an administrator cannot change their own role', async () => {
      const first = await addAccount('first', 'admin');
      await addAccount('second', 'admin');
      const answer = await request(await signIn(first.email), '/admin/set-role', { userId: first.id, role: 'user' });
      expect(answer.status).toBe(400);
      expect(await roleOf(first.id)).toBe('admin');
    });
  });

  describe('the last administrator cannot be demoted, banned or removed', () => {
    const writes = {
      demote: (cookie: string, targetId: string) => request(cookie, '/admin/set-role', { userId: targetId, role: 'user' }),
      ban: (cookie: string, targetId: string) => request(cookie, '/admin/ban-user', { userId: targetId }),
      remove: (cookie: string, targetId: string) => request(cookie, '/admin/remove-user', { userId: targetId }),
    };
    const guarded = {
      demote: (id: string) => assignment.assignRole(db, id, 'user'),
      ban: (id: string) => assignment.claimBan(db, id),
      remove: (id: string) => assignment.removeAccount(db, id),
    };
    const REFUSED_VERB = { demote: 'demoted', ban: 'banned', remove: 'removed' };
    const CHANGES = ['demote', 'ban', 'remove'] as const;
    const pairs = CHANGES.flatMap((first) => CHANGES.map((second) => [first, second] as const));

    test.each(['demote', 'ban', 'remove'] as const)('the sole administrator is protected from being %s, whoever asks', async (change) => {
      const only = await addAccount('only', 'admin');
      await expect(guarded[change](only.id)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: `The last administrator cannot be ${REFUSED_VERB[change]}`,
      });
      expect(await activeAdministrators()).toEqual([only.id]);
    });

    test.each(pairs)('two administrators who %s and %s each other at once, in the write itself, leave one', async (first, second) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await postgres.exec('DELETE FROM users');
        const [a, b] = [await addAccount('first', 'admin'), await addAccount('second', 'admin')];

        const results = await Promise.allSettled([guarded[first](b.id), guarded[second](a.id)]);

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect((await activeAdministrators()).length).toBe(1);
      }
    });

    test.each(pairs)('two administrators who %s and %s each other through the endpoints at once leave one', async (first, second) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await postgres.exec('DELETE FROM users');
        const [a, b] = [await addAccount('first', 'admin'), await addAccount('second', 'admin')];
        const [cookieA, cookieB] = [await signIn(a.email), await signIn(b.email)];

        const answers = await Promise.all([writes[first](cookieA, b.id), writes[second](cookieB, a.id)]);

        expect(answers.filter((answer) => answer.status === 200), JSON.stringify(answers)).toHaveLength(1);
        expect(answers.find((answer) => answer.status !== 200)?.status).toBeGreaterThanOrEqual(400);
        expect((await activeAdministrators()).length).toBe(1);
      }
    });

    test('three administrators who demote each other at once leave at least one', async () => {
      const [a, b, c] = [await addAccount('a', 'admin'), await addAccount('b', 'admin'), await addAccount('c', 'admin')];
      await Promise.allSettled([guarded.demote(b.id), guarded.demote(c.id), guarded.demote(a.id)]);
      expect((await activeAdministrators()).length).toBeGreaterThanOrEqual(1);
    });

    test('a ban or a removal of one of several administrators goes through, and a banned one is not one that remains', async () => {
      const [a, b] = [await addAccount('a', 'admin'), await addAccount('b', 'admin')];
      await guarded.ban(b.id);
      expect(await activeAdministrators()).toEqual([a.id]);
      await expect(guarded.demote(a.id)).rejects.toMatchObject({ message: 'The last administrator cannot be demoted' });
      await expect(guarded.remove(a.id)).rejects.toMatchObject({ message: 'The last administrator cannot be removed' });
      await guarded.remove(b.id);
      expect(await activeAdministrators()).toEqual([a.id]);
    });

    test('removing an administrator takes their sessions and accounts with them, and banning ends their sessions', async () => {
      const [a, b] = [await addAccount('a', 'admin'), await addAccount('b', 'admin')];
      await signIn(b.email);
      const cookie = await signIn(a.email);
      expect((await writes.ban(cookie, b.id)).status).toBe(200);
      expect(await rows('SELECT 1 FROM user_sessions WHERE user_id = $1', [b.id])).toEqual([]);
      expect((await writes.remove(cookie, b.id)).status).toBe(200);
      expect(await rows('SELECT 1 FROM user_accounts WHERE user_id = $1', [b.id])).toEqual([]);
    });

    test('an administrator cannot ban or remove themselves, and nothing was written first', async () => {
      const [a] = [await addAccount('a', 'admin'), await addAccount('b', 'admin')];
      const cookie = await signIn(a.email);
      expect((await writes.ban(cookie, a.id)).status).toBe(400);
      expect((await writes.remove(cookie, a.id)).status).toBe(400);
      expect(await activeAdministrators()).toContain(a.id);
    });

    test('a role is never given to an account in the same statement that deletes it: assignment and delete at once', async () => {
      await addRole('auditor', 'Auditor');
      const target = await addAccount('target', 'user');
      for (let attempt = 0; attempt < 3; attempt++) {
        await run('UPDATE users SET role = $1 WHERE id = $2', ['user', target.id]);
        await run("INSERT INTO roles (id, label) VALUES ('auditor', 'Auditor') ON CONFLICT DO NOTHING");
        await Promise.allSettled([assignment.assignRole(db, target.id, 'auditor'), callerOf('admin').roles.remove({ id: 'auditor' })]);
        const role = await roleOf(target.id);
        const stillThere = (await roleIds()).includes('auditor');
        expect(role === 'auditor' ? stillThere : true, `the account holds ${role} and the role exists: ${stillThere}`).toBe(true);
        await run("DELETE FROM roles WHERE id = 'auditor' AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'auditor')");
      }
    });
  });

  describe('the same rules apply through the tRPC procedures', () => {
    test('user.setRole assigns a role only the database knows, refuses an unknown one and the caller\'s own', async () => {
      await addRole('auditor', 'Auditor');
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const caller = await adminCaller(admin);

      expect(await caller.user.setRole({ id: target.id, role: 'auditor' })).toEqual({ role: 'auditor' });
      expect(await roleOf(target.id)).toBe('auditor');
      await expect(caller.user.setRole({ id: target.id, role: 'ghost' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'No role has that id' });
      await expect(caller.user.setRole({ id: admin.id, role: 'user' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(caller.user.setRole({ id: target.id, role: 'user,admin' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await roleOf(admin.id)).toBe('admin');
    });

    test('user.create makes the account with the default role and then assigns the chosen one', async () => {
      await addRole('auditor', 'Auditor');
      const caller = await adminCaller(await addAccount('admin', 'admin'));
      const { user } = await caller.user.create({ name: 'New', email: 'created@example.com', role: 'auditor' });
      expect(await roleOf(user.id)).toBe('auditor');
      const plain = await caller.user.create({ name: 'Plain', email: 'plain@example.com', role: 'user' });
      expect(await roleOf(plain.user.id)).toBe('user');
    });

    test('a failure while assigning the role leaves the account on the default role', async () => {
      const caller = await adminCaller(await addAccount('admin', 'admin'));
      await expect(caller.user.create({ name: 'New', email: 'half@example.com', role: 'ghost' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect((await rows<{ role: string }>('SELECT role FROM users WHERE email = $1', ['half@example.com']))[0]?.role).toBe('user');
    });

    test('user.create refuses a role that is not one id before it creates anything', async () => {
      const caller = await adminCaller(await addAccount('admin', 'admin'));
      await expect(caller.user.create({ name: 'New', email: 'bad@example.com', role: 'user,admin' })).rejects.toThrow();
      expect(await rows('SELECT 1 FROM users WHERE email = $1', ['bad@example.com'])).toEqual([]);
    });

    test('user.assignableRoles lists admin and the roles of the database, to an administrator only', async () => {
      const caller = await adminCaller(await addAccount('admin', 'admin'));
      expect(await caller.user.assignableRoles()).toEqual([
        { id: 'admin', label: 'Admin' },
        { id: 'manager', label: 'Manager' },
        { id: 'user', label: 'User' },
      ]);
      await expect(callerOf('manager').user.assignableRoles()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  test('the client verdict is unknown before the list is known, granted when every action is held and denied otherwise', () => {
    const request = { contact: ['read', 'delete'] };
    expect(permissions.verdictOf(undefined, request)).toBe('unknown');
    expect(permissions.verdictOf(['contact.read', 'contact.delete'], request)).toBe('granted');
    expect(permissions.verdictOf(['contact.read'], request)).toBe('denied');
    expect(permissions.verdictOf(['user.list'], { contact: ['read'] })).toBe('denied');
    expect(permissions.verdictOf(undefined, {})).toBe('granted');
    expect(permissions.verdictOf([], { contact: [] })).toBe('granted');
  });
});
