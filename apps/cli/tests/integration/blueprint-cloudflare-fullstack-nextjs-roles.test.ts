import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, REACT_ELEMENT_STUB, readTextFile, runCli } from './helpers';
import { createTable } from './sqlite-tables';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-fullstack-nextjs';
const AUTH = 'packages/auth/src';
const API = 'packages/api/src';

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  sqliteCore: Bun.resolveSync('drizzle-orm/sqlite-core', import.meta.dir),
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  adminAccess: Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
};

const STUBS: Record<string, string> = {
  'db.mjs': `export * from '${REAL.drizzle}';
export * from './schema.mjs';`,
};

interface Permissions {
  ADMIN_ROLE: string;
  PERMISSIONS: readonly string[];
  ADMIN_PERMISSIONS: readonly string[];
  BUSINESS_PERMISSIONS: readonly string[];
  businessStatement: Record<string, readonly string[]>;
  accountStatement: Record<string, readonly string[]>;
  statement: Record<string, readonly string[]>;
  roles: Record<string, { statements: Record<string, readonly string[]> }>;
  isBusinessPermission: (resource: string, action: string) => boolean;
}

interface DefaultRoles {
  DEFAULT_ROLES: Record<string, { label: string; permissions: readonly string[] }>;
  defaultRoleStatements: (definitions?: Record<string, unknown>) => string[];
}

interface RolePermissions {
  permissionsOf: (db: unknown, role: string | null | undefined) => Promise<string[]>;
  hasPermission: (db: unknown, role: string | null | undefined, resource: string, action: string) => Promise<boolean>;
  isGranted: (granted: readonly string[], resource: string, action: string) => boolean;
  listRoleMatrix: (db: unknown) => Promise<{ id: string; label: string; permissions: string[] }[]>;
}

interface DocumentRow {
  id: string;
  userId: string;
}

interface Caller {
  documents: { list: (input?: unknown) => Promise<DocumentRow[]>; count: () => Promise<number>; delete: (input: { id: string }) => Promise<unknown> };
  users: { list: (input?: unknown) => Promise<unknown[]> };
  permissions: { mine: () => Promise<string[]> };
}

interface DocumentScope {
  visibleDocuments: (granted: readonly string[], userId: string) => unknown;
  deletableDocument: (granted: readonly string[], userId: string, id: string) => unknown;
}

interface Rbac {
  permissionProcedure: (resource: string, action: string) => unknown;
}

describe(`${BLUEPRINT} database roles`, () => {
  let tempDir: string;
  let project: string;
  let stubs: string;
  let permissions: Permissions;
  let defaults: DefaultRoles;
  let engine: RolePermissions;
  let scope: DocumentScope;
  let schema: Record<string, SQLiteTable>;
  let createCaller: (router: unknown) => (ctx: unknown) => Caller;
  let appRouter: unknown;

  let sqlite: Database;
  let db: unknown;
  let queries: string[];

  const grant = (role: string, ...names: string[]) => {
    for (const name of names) {
      const [resource = '', action = ''] = name.split('.');
      sqlite.run('INSERT INTO role_permissions (role_id, resource, action) VALUES (?, ?, ?)', [role, resource, action]);
    }
  };
  const addRole = (id: string, label = id) => sqlite.run('INSERT INTO roles (id, label) VALUES (?, ?)', [id, label]);
  const addUser = (id: string, role = 'user') =>
    sqlite.run('INSERT INTO users (id, name, email, email_verified, role) VALUES (?, ?, ?, 0, ?)', [id, id, `${id}@example.com`, role]);
  const addDocument = (id: string, userId: string) =>
    sqlite.run("INSERT INTO documents (id, user_id, title, r2_key, size, mime_type) VALUES (?, ?, ?, ?, 1, 'text/plain')", [id, userId, id, id]);
  // Every call is a request of its own unless a test hands the same headers to several: tRPC builds one context per request.
  const callerOf = (role: string | null, userId = 'u1', headers = new Headers()) =>
    createCaller(appRouter)({ db, headers, session: { user: { id: userId, role } } });
  const rowsOf = () =>
    sqlite.query('SELECT role_id, resource, action FROM role_permissions ORDER BY role_id, resource, action').all();
  const roleIds = () => (sqlite.query('SELECT id FROM roles ORDER BY id').all() as { id: string }[]).map((row) => row.id);
  const runAll = (statements: string[]) => {
    for (const statement of statements) sqlite.run(statement);
  };
  const permissionReads = () => queries.filter((query) => query.includes('"role_permissions"')).length;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, BLUEPRINT);

    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    const generated = async <T>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/sqlite-core': REAL.sqliteCore,
    });
    permissions = await generated(`${AUTH}/permissions.ts`, 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/admin/access': REAL.adminAccess,
    });
    defaults = await generated(`${AUTH}/default-roles.ts`, 'default-roles.mjs', { './permissions': './permissions.mjs' });
    engine = await generated(`${AUTH}/role-permissions.ts`, 'role-permissions.mjs', {
      '@repo/db': './db.mjs',
      './permissions': './permissions.mjs',
    });
    const imports = {
      '@trpc/server': REAL.trpcServer,
      '@repo/db': './db.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@repo/auth/role-assignment': './role-assignment.mjs',
      '../auth-errors': './auth-errors.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../document-scope': './document-scope.mjs',
      '../text-match': './text-match.mjs',
    };
    const zod = Bun.resolveSync('zod', import.meta.dir);
    // The real context and procedures of the generated api package: a stand-in would make the refusals below test the stand-in.
    await Bun.write(
      join(stubs, 'counting-auth.mjs'),
      "export const createAuth = () => ({ api: { getSession: async () => { globalThis.__sessionReads = (globalThis.__sessionReads ?? 0) + 1; return { user: { id: 'read-here', role: 'user' } }; } } });",
    );
    await generated(`${AUTH}/role-assignment.ts`, 'role-assignment.mjs', { '@repo/db': './db.mjs', './permissions': './permissions.mjs' });
    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', { '@trpc/server': REAL.trpcServer });
    await generated(`${API}/trpc.ts`, 'trpc.mjs', {
      '@repo/auth/auth': './counting-auth.mjs',
      '@trpc/server': REAL.trpcServer,
      superjson: Bun.resolveSync('superjson', import.meta.dir),
      './auth-errors': './auth-errors.mjs',
    });
    await generated(`${API}/pagination.ts`, 'pagination.mjs', { zod });
    await generated(`${API}/user-list.ts`, 'user-list.mjs', { zod, './pagination': './pagination.mjs' });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/text-match.ts`, 'text-match.mjs', { '@repo/db': './db.mjs' });
    scope = await generated(`${API}/document-scope.ts`, 'document-scope.mjs', { '@repo/db': './db.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', imports);
    const { documentsRouter } = await generated<{ documentsRouter: unknown }>(`${API}/router/documents.ts`, 'documents-router.mjs', {
      ...imports,
      zod,
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
    });
    const { usersRouter } = await generated<{ usersRouter: unknown }>(`${API}/router/users.ts`, 'users-router.mjs', {
      ...imports,
      zod,
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
      '../user-list': './user-list.mjs',
      '@repo/auth/auth': './counting-auth.mjs',
    });
    const { permissionsRouter } = await generated<{ permissionsRouter: unknown }>(`${API}/router/permissions.ts`, 'permissions-router.mjs', imports);

    const trpc = (await import(join(stubs, 'trpc.mjs'))) as { router: (procedures: Record<string, unknown>) => unknown };
    appRouter = trpc.router({ documents: documentsRouter, users: usersRouter, permissions: permissionsRouter });
    createCaller = (router) => (ctx) => (router as { createCaller: (context: unknown) => Caller }).createCaller(ctx);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.run('PRAGMA foreign_keys = ON');
    for (const name of ['userTable', 'documentTable', 'roleTable', 'rolePermissionTable']) {
      createTable(sqlite, schema[name] as SQLiteTable);
    }
    queries = [];
    db = drizzle(sqlite, { logger: { logQuery: (query) => queries.push(query) } });
  });

  describe('a role that is missing, or has no rows, is refused', () => {
    test('a role with no row in roles holds nothing, even when stray permission rows name it', async () => {
      sqlite.run('PRAGMA foreign_keys = OFF');
      grant('ghost', 'document.read', 'document.create');
      sqlite.run('PRAGMA foreign_keys = ON');
      expect(await engine.permissionsOf(db, 'ghost')).toEqual([]);
      expect(await engine.hasPermission(db, 'ghost', 'document', 'read')).toBe(false);
    });

    test('a role with no permission rows holds nothing', async () => {
      addRole('auditor');
      expect(await engine.permissionsOf(db, 'auditor')).toEqual([]);
      expect(await engine.hasPermission(db, 'auditor', 'document', 'read')).toBe(false);
    });

    test('an empty database, as before the defaults command ran, refuses every non-admin role', async () => {
      for (const role of ['user', 'manager', 'auditor']) {
        for (const permission of permissions.BUSINESS_PERMISSIONS) {
          const [resource, action] = permission.split('.') as [string, string];
          expect([role, permission, await engine.hasPermission(db, role, resource, action)]).toEqual([role, permission, false]);
        }
      }
    });

    test('no role at all holds nothing', async () => {
      for (const role of [null, undefined, '']) expect(await engine.permissionsOf(db, role)).toEqual([]);
    });

    test('a procedure answers FORBIDDEN to a role the database does not know', async () => {
      await expect(callerOf('auditor').documents.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('a procedure answers UNAUTHORIZED without a session, before any permission is read', async () => {
      const anonymous = createCaller(appRouter)({ db, headers: new Headers(), session: null });
      await expect(anonymous.documents.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(anonymous.permissions.mine()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(permissionReads()).toBe(0);
    });
  });

  describe('a revocation is refused on the next request', () => {
    test('deleting a row stops the very next call, with the same database and the same module', async () => {
      addRole('manager');
      grant('manager', 'document.read');
      await expect(callerOf('manager').documents.list()).resolves.toEqual([]);

      sqlite.run("DELETE FROM role_permissions WHERE role_id = 'manager' AND action = 'read'");
      await expect(callerOf('manager').documents.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });

      sqlite.run("INSERT INTO role_permissions (role_id, resource, action) VALUES ('manager', 'document', 'read')");
      await expect(callerOf('manager').documents.list()).resolves.toEqual([]);
    });

    test('deleting the role stops it too, and the foreign key takes its rows with it', async () => {
      addRole('manager');
      grant('manager', 'document.read');
      expect(await engine.hasPermission(db, 'manager', 'document', 'read')).toBe(true);
      sqlite.run("DELETE FROM roles WHERE id = 'manager'");
      expect(await engine.hasPermission(db, 'manager', 'document', 'read')).toBe(false);
      expect(rowsOf()).toEqual([]);
    });

    test('an action the role does not hold is refused while the one it holds passes', async () => {
      addRole('manager');
      grant('manager', 'document.read');
      await expect(callerOf('manager').documents.delete({ id: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerOf('manager').documents.list()).resolves.toEqual([]);
    });
  });

  describe('a stored permission can only name a business resource', () => {
    test('rows that name user or session, or a name outside the vocabulary, are never honored', async () => {
      addRole('manager');
      grant('manager', 'user.list', 'user.delete', 'session.revoke', 'document.nuke', 'ghost.read', 'document.read');
      expect(await engine.permissionsOf(db, 'manager')).toEqual(['document.read']);
      expect(await engine.hasPermission(db, 'manager', 'user', 'list')).toBe(false);
      expect(await engine.hasPermission(db, 'manager', 'session', 'revoke')).toBe(false);
    });

    test('planted user.list and session.list rows leave account administration refused', async () => {
      addRole('manager');
      grant('manager', 'document.read', 'user.list', 'session.list');
      await expect(callerOf('manager').users.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await callerOf('manager').permissions.mine()).toEqual(['document.read']);
    });

    test('the vocabulary of stored permissions is the business statement, and excludes the account statement', () => {
      expect(Object.keys(permissions.accountStatement).sort()).toEqual(['session', 'user']);
      expect(Object.keys(permissions.businessStatement)).toEqual(['document']);
      expect(permissions.isBusinessPermission('document', 'read')).toBe(true);
      expect(permissions.isBusinessPermission('document', 'read-any')).toBe(true);
      for (const [resource, action] of [['user', 'list'], ['user', 'set-role'], ['session', 'list'], ['document', 'nuke'], ['', ''], ['document.read', ''], ['constructor', 'name']] as const) {
        expect([resource, action, permissions.isBusinessPermission(resource, action)]).toEqual([resource, action, false]);
      }
      for (const permission of permissions.BUSINESS_PERMISSIONS) expect(permission).not.toMatch(/^(user|session)\./);
    });

    test('the defaults writer refuses a definition that names an account resource, an unknown action or an unsafe role', () => {
      const attempt = (definitions: Record<string, unknown>) => () => defaults.defaultRoleStatements(definitions);
      expect(attempt({ editor: { label: 'Editor', permissions: ['user.list'] } })).toThrow();
      expect(attempt({ editor: { label: 'Editor', permissions: ['session.revoke'] } })).toThrow();
      expect(attempt({ editor: { label: 'Editor', permissions: ['document.nuke'] } })).toThrow();
      expect(attempt({ editor: { label: 'Editor', permissions: ['document'] } })).toThrow();
      expect(attempt({ admin: { label: 'Admin', permissions: ['document.read'] } })).toThrow();
      for (const id of ['Bad Role', 'a,b', "a'b", '', 'UPPER', 'a;drop']) {
        expect(attempt({ [id]: { label: 'Bad', permissions: [] } }), id).toThrow();
      }
      expect(attempt({ editor: { label: 'Editor', permissions: ['document.read'] } })).not.toThrow();
    });

    test('a refused definition writes nothing, even beside valid roles', () => {
      expect(() =>
        defaults.defaultRoleStatements({
          fine: { label: 'Fine', permissions: ['document.read'] },
          bad: { label: 'Bad', permissions: ['user.list'] },
        }),
      ).toThrow();
    });

    test('a label is data, never SQL', () => {
      runAll(defaults.defaultRoleStatements({ tricky: { label: "O'Brien'); DROP TABLE roles; --", permissions: ['document.read'] } }));
      expect(sqlite.query("SELECT label FROM roles WHERE id = 'tricky'").get()).toEqual({ label: "O'Brien'); DROP TABLE roles; --" });
    });
  });

  describe('admin has no rows and keeps every business action', () => {
    test('admin holds every business action, and what the plugin grants it, with the tables empty or missing', async () => {
      expect(await engine.permissionsOf(db, 'admin')).toEqual([...permissions.ADMIN_PERMISSIONS]);
      const bare = drizzle(new Database(':memory:'));
      expect(await engine.permissionsOf(bare, 'admin')).toEqual([...permissions.ADMIN_PERMISSIONS]);
      expect(permissions.ADMIN_PERMISSIONS).toEqual(expect.arrayContaining([...permissions.BUSINESS_PERMISSIONS]));
      for (const permission of permissions.ADMIN_PERMISSIONS) {
        const [resource, action] = permission.split('.') as [string, string];
        expect(await engine.hasPermission(bare, 'admin', resource, action), permission).toBe(true);
      }
    });

    test('rows written for admin change nothing, and the defaults never write any', async () => {
      runAll(defaults.defaultRoleStatements());
      expect(rowsOf().filter((row) => (row as { role_id: string }).role_id === 'admin')).toEqual([]);
      expect(sqlite.query("SELECT id FROM roles WHERE id = 'admin'").all()).toEqual([]);
      addRole('admin');
      grant('admin', 'document.read');
      expect(await engine.permissionsOf(db, 'admin')).toEqual([...permissions.ADMIN_PERMISSIONS]);
    });

    test('the roles matrix never lists a stored admin row', async () => {
      addRole('admin');
      grant('admin', 'document.read');
      addRole('auditor');
      expect((await engine.listRoleMatrix(db)).map((role) => role.id)).toEqual(['auditor']);
    });

    test('the compiled admin role of the plugin covers every business action, and is the list admin is given', () => {
      const compiled = permissions.roles.admin?.statements ?? {};
      for (const permission of permissions.BUSINESS_PERMISSIONS) {
        const [resource, action] = permission.split('.') as [string, string];
        expect([permission, compiled[resource]?.includes(action)]).toEqual([permission, true]);
      }
      const compiledNames = Object.entries(compiled).flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`));
      expect([...permissions.ADMIN_PERMISSIONS].sort()).toEqual(compiledNames.sort());
    });

    test('no other compiled role grants a business or account action: the database is the only source', () => {
      for (const [name, role] of Object.entries(permissions.roles)) {
        if (name === permissions.ADMIN_ROLE) continue;
        expect([name, role.statements]).toEqual([name, {}]);
      }
    });

    test('admin passes the procedures it never had rows for', async () => {
      await expect(callerOf('admin').documents.list()).resolves.toEqual([]);
    });
  });

  describe('the permission list of the caller', () => {
    test('is the flat list the role holds, for a database role and for admin', async () => {
      addRole('user');
      grant('user', 'document.create', 'document.read');
      expect((await callerOf('user').permissions.mine()).sort()).toEqual(['document.create', 'document.read']);
      expect(await callerOf('admin').permissions.mine()).toEqual([...permissions.ADMIN_PERMISSIONS]);
      expect(await callerOf('auditor').permissions.mine()).toEqual([]);
    });

    test('follows a revocation on the next request', async () => {
      addRole('user');
      grant('user', 'document.read');
      expect(await callerOf('user').permissions.mine()).toEqual(['document.read']);
      sqlite.run('DELETE FROM role_permissions');
      expect(await callerOf('user').permissions.mine()).toEqual([]);
    });
  });

  describe('one request reads the permissions of its caller once', () => {
    test('three procedures of one request read role_permissions once, and each new request reads again', async () => {
      addRole('manager');
      grant('manager', 'document.read');
      const request = new Headers();
      const caller = callerOf('manager', 'u1', request);
      await caller.documents.list();
      await caller.documents.count();
      await caller.permissions.mine();
      expect(permissionReads()).toBe(1);

      queries.length = 0;
      await callerOf('manager').documents.list();
      await callerOf('manager').documents.count();
      await callerOf('manager').permissions.mine();
      expect(permissionReads()).toBe(3);
    });

    test('a request whose role has no rows reads once as well', async () => {
      const request = new Headers();
      await expect(callerOf('auditor', 'u1', request).documents.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerOf('auditor', 'u1', request).documents.count()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(permissionReads()).toBe(1);
    });
  });

  describe('the scope of the documents a role sees and deletes comes from the permission list', () => {
    const ids = (rows: DocumentRow[]) => rows.map((row) => row.id).sort();

    const seedDocuments = () => {
      addUser('u1');
      addUser('u2');
      addDocument('d1', 'u1');
      addDocument('d2', 'u2');
    };

    test('read-any shows every document and a role without it sees its own', async () => {
      seedDocuments();
      addRole('reader');
      grant('reader', 'document.read');
      addRole('auditor');
      grant('auditor', 'document.read', 'document.read-any');
      expect(ids(await callerOf('reader', 'u1').documents.list())).toEqual(['d1']);
      expect(await callerOf('reader', 'u1').documents.count()).toBe(1);
      expect(ids(await callerOf('auditor', 'u1').documents.list())).toEqual(['d1', 'd2']);
      expect(await callerOf('auditor', 'u1').documents.count()).toBe(2);
    });

    test('read-any alone does not open the list: read is still asked', async () => {
      seedDocuments();
      addRole('odd');
      grant('odd', 'document.read-any');
      await expect(callerOf('odd', 'u1').documents.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('a role that gains or loses read-any changes scope on the next request, whatever its name', async () => {
      seedDocuments();
      addRole('manager');
      grant('manager', 'document.read');
      expect(ids(await callerOf('manager', 'u1').documents.list())).toEqual(['d1']);
      grant('manager', 'document.read-any');
      expect(ids(await callerOf('manager', 'u1').documents.list())).toEqual(['d1', 'd2']);
      sqlite.run("DELETE FROM role_permissions WHERE action = 'read-any'");
      expect(ids(await callerOf('manager', 'u1').documents.list())).toEqual(['d1']);
    });

    test('admin sees every document through its own permissions, not through its name', async () => {
      seedDocuments();
      expect(ids(await callerOf('admin', 'u1').documents.list())).toEqual(['d1', 'd2']);
    });

    test('a delete the server refuses is an error, not a success: a document of someone else without delete-any, or none at all', async () => {
      seedDocuments();
      addRole('worker');
      grant('worker', 'document.read', 'document.delete');
      await expect(callerOf('worker', 'u1').documents.delete({ id: 'd2' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(callerOf('worker', 'u1').documents.delete({ id: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((sqlite.query('SELECT id FROM documents ORDER BY id').all() as { id: string }[]).map((row) => row.id)).toEqual(['d1', 'd2']);
    });

    test('delete-any lets a caller delete a document of someone else, and without it only their own', () => {
      const run = (granted: string[], userId: string, id: string) =>
        (db as { select: () => { from: (table: unknown) => { where: (clause: unknown) => { all: () => { id: string }[] } } } })
          .select()
          .from(schema.documentTable)
          .where(scope.deletableDocument(granted, userId, id))
          .all();
      seedDocuments();
      expect(run(['document.delete'], 'u1', 'd1').map((row) => row.id)).toEqual(['d1']);
      expect(run(['document.delete'], 'u1', 'd2')).toEqual([]);
      expect(run(['document.delete', 'document.delete-any'], 'u1', 'd2').map((row) => row.id)).toEqual(['d2']);
    });

    test('the defaults keep the scope of the code they replace: manager sees every document and deletes none, user keeps its own', async () => {
      seedDocuments();
      runAll(defaults.defaultRoleStatements());
      expect(ids(await callerOf('manager', 'u1').documents.list())).toEqual(['d1', 'd2']);
      expect(ids(await callerOf('user', 'u1').documents.list())).toEqual(['d1']);
      await expect(callerOf('manager', 'u1').documents.delete({ id: 'd2' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await engine.permissionsOf(db, 'user')).not.toContain('document.delete-any');
      expect(await engine.permissionsOf(db, 'manager')).not.toContain('document.delete-any');
    });
  });

  describe('the defaults command', () => {
    test('gives a fresh database the permissions the code gave before: user keeps the document set, manager reads every document', async () => {
      runAll(defaults.defaultRoleStatements());
      expect((await engine.permissionsOf(db, 'user')).sort()).toEqual([
        'document.create',
        'document.delete',
        'document.read',
        'document.update',
      ]);
      expect((await engine.permissionsOf(db, 'manager')).sort()).toEqual(['document.read', 'document.read-any']);
      expect(await engine.listRoleMatrix(db)).toEqual([
        { id: 'manager', label: 'Manager', permissions: ['document.read', 'document.read-any'] },
        { id: 'user', label: 'User', permissions: ['document.create', 'document.delete', 'document.read', 'document.update'] },
      ]);
    });

    test('runs again without changing anything', () => {
      runAll(defaults.defaultRoleStatements());
      const once = rowsOf();
      runAll(defaults.defaultRoleStatements());
      expect(rowsOf()).toEqual(once);
    });

    test('never writes back a default role an operator deleted, and its holders stay refused', async () => {
      runAll(defaults.defaultRoleStatements());
      sqlite.run("DELETE FROM roles WHERE id = 'manager'");
      runAll(defaults.defaultRoleStatements());
      expect(roleIds()).toEqual(['user']);
      expect(await engine.permissionsOf(db, 'manager')).toEqual([]);
    });

    test('never restores a permission revoked since, nor a label changed', async () => {
      runAll(defaults.defaultRoleStatements());
      sqlite.run("DELETE FROM role_permissions WHERE role_id = 'user' AND action = 'delete'");
      sqlite.run("UPDATE roles SET label = 'Member' WHERE id = 'user'");
      runAll(defaults.defaultRoleStatements());
      expect(await engine.hasPermission(db, 'user', 'document', 'delete')).toBe(false);
      expect(sqlite.query("SELECT label FROM roles WHERE id = 'user'").get()).toEqual({ label: 'Member' });
    });

    test('never refills a matrix an operator emptied, with every default role still there', async () => {
      runAll(defaults.defaultRoleStatements());
      sqlite.run('DELETE FROM role_permissions');
      runAll(defaults.defaultRoleStatements());
      expect(rowsOf()).toEqual([]);
      expect(await engine.permissionsOf(db, 'user')).toEqual([]);
    });

    test('writes nothing into a database where someone else created a role first, whatever the list the script read', () => {
      addRole('auditor');
      runAll(defaults.defaultRoleStatements());
      expect(roleIds()).toEqual(['auditor']);
      expect(rowsOf()).toEqual([]);
    });

    test('is all or none: a failure in the middle leaves no role and no permission, and a rerun writes everything', () => {
      const statements = defaults.defaultRoleStatements();
      const interrupted = sqlite.transaction(() => {
        sqlite.run(statements[0] ?? '');
        throw new Error('interrupted');
      });
      expect(() => interrupted()).toThrow('interrupted');
      expect(roleIds()).toEqual([]);
      expect(rowsOf()).toEqual([]);

      runAll(statements);
      expect(roleIds()).toEqual(['manager', 'user']);
      expect(rowsOf().length).toBe(6);
    });

    test('a run that stopped between its two statements leaves roles that hold nothing, and a rerun does not guess', async () => {
      const [roles = ''] = defaults.defaultRoleStatements();
      sqlite.run(roles);
      runAll(defaults.defaultRoleStatements());
      expect(rowsOf()).toEqual([]);
      expect(await engine.permissionsOf(db, 'user')).toEqual([]);
    });

    test('two runs at once write the roles once, and the second changes nothing', () => {
      const statements = defaults.defaultRoleStatements();
      runAll(statements);
      expect(() => runAll(statements)).not.toThrow();
      expect(roleIds()).toEqual(['manager', 'user']);
      expect(rowsOf().length).toBe(6);
    });
  });

  describe('the tRPC context reuses the session its caller already read', () => {
    interface Context {
      session: unknown;
    }
    let createTRPCContext: (opts: { headers: Headers; db: unknown; session?: unknown }) => Promise<Context>;
    const counted = globalThis as { __sessionReads?: number };

    beforeAll(async () => {
      await Bun.write(
        join(stubs, 'counting-auth.mjs'),
        "export const createAuth = () => ({ api: { getSession: async () => { globalThis.__sessionReads = (globalThis.__sessionReads ?? 0) + 1; return { user: { id: 'read-here', role: 'user' } }; } } });",
      );
      const generated = async <T>(file: string, name: string, imports: Record<string, string>): Promise<T> =>
        evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);
      await generated(`${AUTH}/role-assignment.ts`, 'role-assignment.mjs', { '@repo/db': './db.mjs', './permissions': './permissions.mjs' });
    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', { '@trpc/server': REAL.trpcServer });
      ({ createTRPCContext } = await generated<{ createTRPCContext: typeof createTRPCContext }>(`${API}/trpc.ts`, 'init.mjs', {
        '@repo/auth/auth': './counting-auth.mjs',
        '@trpc/server': REAL.trpcServer,
        superjson: Bun.resolveSync('superjson', import.meta.dir),
        './auth-errors': './auth-errors.mjs',
      }));
    });

    test('reads the session once when nobody handed it over', async () => {
      counted.__sessionReads = 0;
      const context = await createTRPCContext({ headers: new Headers(), db });
      expect(counted.__sessionReads).toBe(1);
      expect(context.session).toEqual({ user: { id: 'read-here', role: 'user' } });
    });

    test('reads nothing when the caller hands over its session, an anonymous visitor included', async () => {
      counted.__sessionReads = 0;
      const given = { user: { id: 'u9', role: 'manager' } };
      expect((await createTRPCContext({ headers: new Headers(), db, session: given })).session).toBe(given);
      expect((await createTRPCContext({ headers: new Headers(), db, session: null })).session).toBeNull();
      expect(counted.__sessionReads).toBe(0);
    });

    test('the page guards and the server context ask the same cached reader', async () => {
      const web = join(project, 'apps/web/src');
      expect(await readTextFile(join(web, 'lib/server.ts'))).toMatch(/export const getRequestSession = cache\(/);
      expect(await readTextFile(join(web, 'lib/auth/session.ts'))).toContain('export const getSession = getRequestSession;');
      expect(await readTextFile(join(web, 'trpc/server.tsx'))).toContain('session: await getRequestSession()');
    });
  });

  describe('the client reads the permission list with a three-state verdict', () => {
    interface Element {
      type: { name?: string } | string;
      props: { children?: unknown; item?: { title: string } };
    }
    type Verdict = 'unknown' | 'granted' | 'denied';
    interface PermissionHook {
      verdictOf: (granted: readonly string[] | undefined, request: Record<string, string[]>) => Verdict;
    }
    const globals = globalThis as { __granted?: readonly string[] };

    let hook: PermissionHook;
    let Can: (props: { permissions: Record<string, string[]>; children: unknown; fallback?: unknown }) => unknown;
    let SidebarLinks: (props: { role: string | null }) => unknown;

    function* descendants(node: unknown): Generator<Element> {
      if (Array.isArray(node)) {
        for (const child of node) yield* descendants(child);
      } else if (node && typeof node === 'object' && 'type' in node) {
        yield node as Element;
        yield* descendants((node as Element).props.children);
      }
    }
    const textOf = (node: unknown): string =>
      Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' ? node : '';
    const linksShown = (role: string | null = 'user') =>
      [...descendants(SidebarLinks({ role }))].filter((element) => (element.type as { name?: string }).name === 'RouteItem').map((element) => element.props.item?.title);
    const groupsShown = (role: string | null = 'user') =>
      [...descendants(SidebarLinks({ role }))]
        .filter((element) => (element.type as { name?: string }).name === 'SidebarGroupLabel')
        .map((element) => textOf(element.props.children));

    beforeAll(async () => {
      const web = 'apps/web/src';
      const STUB_MODULES: Record<string, string> = {
        'react.mjs': REACT_ELEMENT_STUB,
        'react-query.mjs': 'export const useQuery = () => ({ data: globalThis.__granted });',
        'providers.mjs': 'export const useTRPC = () => ({ permissions: { mine: { queryOptions: () => ({}) } } });',
        'icons.mjs': 'export const FileText = () => null; export const ShieldCheck = () => null; export const Users = () => null;',
        'next-link.mjs': 'export default function Link() { return null; }',
        'next-navigation.mjs': "export const usePathname = () => '/';",
        'sidebar.mjs': ['SidebarGroup', 'SidebarGroupLabel', 'SidebarMenu', 'SidebarMenuButton', 'SidebarMenuItem']
          .map((name) => `export function ${name}() { return null; }`)
          .join('\n'),
      };
      for (const [file, source] of Object.entries(STUB_MODULES)) await Bun.write(join(stubs, file), source);

      const generated = async <T>(file: string, name: string, imports: Record<string, string>, loader: 'ts' | 'tsx' = 'ts'): Promise<T> =>
        evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports, loader);

      hook = await generated<PermissionHook>(`${web}/hooks/use-permission.ts`, 'use-permission.mjs', {
        '@tanstack/react-query': './react-query.mjs',
        '@/trpc/providers': './providers.mjs',
      });
      await generated(`${web}/lib/constants.ts`, 'constants.mjs', { 'lucide-react': './icons.mjs' });
      await generated(`${web}/lib/allowed-routes.ts`, 'allowed-routes.mjs', {
        '@/hooks/use-permission': './use-permission.mjs',
        '@/lib/constants': './constants.mjs',
      });
      const componentImports = { react: './react.mjs', '@/hooks/use-permission': './use-permission.mjs' };
      ({ Can } = await generated<{ Can: typeof Can }>(`${web}/components/can.tsx`, 'can.mjs', componentImports, 'tsx'));
      ({ SidebarLinks } = await generated<{ SidebarLinks: typeof SidebarLinks }>(
        `${web}/components/navigation/sidebar-links.tsx`,
        'sidebar-links.mjs',
        {
          ...componentImports,
          'next/link': './next-link.mjs',
          'next/navigation': './next-navigation.mjs',
          '@repo/ui/components/ui/sidebar': './sidebar.mjs',
          '@/lib/allowed-routes': './allowed-routes.mjs',
        },
        'tsx',
      ));
    });

    test('is unknown before the list is known, granted when every action is held and denied when one is not', () => {
      const request = { document: ['read', 'delete'] };
      expect(hook.verdictOf(undefined, request)).toBe('unknown');
      expect(hook.verdictOf(['document.read', 'document.delete'], request)).toBe('granted');
      expect(hook.verdictOf(['document.read'], request)).toBe('denied');
      expect(hook.verdictOf([], request)).toBe('denied');
      expect(hook.verdictOf(['user.list'], { document: ['read'] })).toBe('denied');
    });

    test('a check that asks for nothing is granted whatever the list says', () => {
      expect(hook.verdictOf(undefined, {})).toBe('granted');
      expect(hook.verdictOf([], { document: [] })).toBe('granted');
    });

    test('<Can> renders nothing while unknown, its children when granted and its fallback when denied', () => {
      const props = { permissions: { document: ['read'] }, children: 'allowed', fallback: 'refused' };
      globals.__granted = undefined;
      expect(Can(props)).toBeNull();
      globals.__granted = ['document.read'];
      expect(Can(props)).toBe('allowed');
      globals.__granted = [];
      expect(Can(props)).toBe('refused');
      expect(Can({ ...props, fallback: undefined })).toBeNull();
    });

    test('the sidebar lists the links the permission list grants, with no empty group', () => {
      globals.__granted = ['document.read'];
      expect(linksShown()).toEqual(['Documents']);
      expect(groupsShown()).toEqual([]);

      globals.__granted = [...permissions.ADMIN_PERMISSIONS];
      expect(linksShown()).toEqual(['Documents', 'Users', 'Roles']);
      expect(groupsShown()).toEqual(['Administration']);
    });

    test('a role that lost document.read loses the Documents link', () => {
      globals.__granted = ['document.create'];
      expect(linksShown()).toEqual([]);
    });

    test('the sidebar follows the permission list whatever the role name says', () => {
      globals.__granted = ['document.read'];
      expect(linksShown('admin')).toEqual(['Documents']);
      globals.__granted = [...permissions.ADMIN_PERMISSIONS];
      expect(linksShown('ghost')).toEqual(['Documents', 'Users', 'Roles']);
      expect(linksShown(null)).toEqual(['Documents', 'Users', 'Roles']);
    });

    test('the sidebar lists nothing while the list is unknown', () => {
      globals.__granted = undefined;
      expect(linksShown()).toEqual([]);
      expect(groupsShown()).toEqual([]);
    });
  });
});
