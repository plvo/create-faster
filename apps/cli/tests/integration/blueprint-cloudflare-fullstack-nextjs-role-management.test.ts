import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
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
  superjson: Bun.resolveSync('superjson', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
};

interface RoleOverview {
  id: string;
  label: string;
  permissions: string[];
  holders: number;
  editable: boolean;
  deletable: boolean;
}

interface Matrix {
  permissions: { name: string; editable: boolean }[];
  roles: RoleOverview[];
}

interface RolesCaller {
  roles: {
    matrix: () => Promise<Matrix>;
    create: (input: { id: string; label: string }) => Promise<{ id: string }>;
    setPermission: (input: { id: string; permission: string; granted: boolean }) => Promise<{ granted: boolean }>;
    remove: (input: { id: string }) => Promise<{ removed: boolean }>;
  };
  permissions: { mine: () => Promise<string[]> };
  documents: { list: (input?: unknown) => Promise<unknown[]> };
}

interface Management {
  createRole: (db: unknown, input: { id: unknown; label: unknown }) => Promise<unknown>;
  setRolePermission: (db: unknown, id: unknown, permission: unknown, granted: boolean) => Promise<unknown>;
  deleteRole: (db: unknown, id: unknown) => Promise<unknown>;
}

interface Assignment {
  assignRole: (db: unknown, userId: string, role: string) => Promise<unknown>;
}

interface TrpcError {
  code: string;
  message: string;
}

// The wording better-auth reads as a database failure and logs at error level; no refusal of the role procedures uses it.
const DATABASE_WORDS = /does not exist|table|column|relation/i;

async function refusal(run: () => Promise<unknown>): Promise<TrpcError> {
  try {
    await run();
  } catch (error) {
    const { code, message } = error as TrpcError;
    return { code, message };
  }
  throw new Error('expected a refusal, the call went through');
}

describe(`${BLUEPRINT} role management`, () => {
  let tempDir: string;
  let schema: Record<string, SQLiteTable>;
  let management: Management;
  let assignment: Assignment;
  let routerCaller: (ctx: unknown) => RolesCaller;
  let procedureNames: string[];

  let sqlite: Database;
  let db: unknown;
  let beforeQuery: ((query: string) => void) | null;
  let queries: string[];

  const addRole = (id: string, label = id) => sqlite.run('INSERT INTO roles (id, label) VALUES (?, ?)', [id, label]);
  const grant = (role: string, ...names: string[]) => {
    for (const name of names) {
      const [resource = '', action = ''] = name.split('.');
      sqlite.run('INSERT INTO role_permissions (role_id, resource, action) VALUES (?, ?, ?)', [role, resource, action]);
    }
  };
  const addUser = (id: string, role: string) =>
    sqlite.run('INSERT INTO users (id, name, email, email_verified, role) VALUES (?, ?, ?, 0, ?)', [id, id, `${id}@example.com`, role]);
  const roleIds = () => (sqlite.query('SELECT id FROM roles ORDER BY id').all() as { id: string }[]).map((row) => row.id);
  const permissionRows = () =>
    (sqlite.query('SELECT role_id, resource, action FROM role_permissions ORDER BY role_id, resource, action').all() as {
      role_id: string;
      resource: string;
      action: string;
    }[]).map((row) => `${row.role_id}:${row.resource}.${row.action}`);
  const roleOf = (userId: string) => (sqlite.query('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | null)?.role;
  const snapshot = () => ({ roles: roleIds(), permissions: permissionRows() });

  // Each call is a request of its own, with its own headers, which is what the permission list is read for.
  const asRole = (role: string | null, userId = 'caller') =>
    routerCaller({ db, headers: new Headers(), session: { user: { id: userId, role } } });
  const admin = () => asRole('admin', 'root');

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'db.mjs'), `export * from '${REAL.drizzle}';\nexport * from './schema.mjs';`);
    await Bun.write(
      join(stubs, 'no-auth.mjs'),
      'export const createAuth = () => ({ api: { getSession: async () => null } });',
    );

    const generated = async <T>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/sqlite-core': REAL.sqliteCore,
    });
    const own = {
      '@trpc/server': REAL.trpcServer,
      '@repo/db': './db.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@repo/auth/role-assignment': './role-assignment.mjs',
      '@repo/auth/role-management': './role-management.mjs',
      './permissions': './permissions.mjs',
      './default-roles': './default-roles.mjs',
      './role-store': './role-store.mjs',
      './role-permissions': './role-permissions.mjs',
      '../auth-errors': './auth-errors.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../document-scope': './document-scope.mjs',
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
      zod: REAL.zod,
    };
    await generated(`${AUTH}/permissions.ts`, 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/admin/access': REAL.adminAccess,
    });
    await generated(`${AUTH}/default-roles.ts`, 'default-roles.mjs', own);
    await generated(`${AUTH}/role-store.ts`, 'role-store.mjs', own);
    await generated(`${AUTH}/role-permissions.ts`, 'role-permissions.mjs', own);
    assignment = await generated(`${AUTH}/role-assignment.ts`, 'role-assignment.mjs', own);
    management = await generated(`${AUTH}/role-management.ts`, 'role-management.mjs', own);
    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', own);
    await generated(`${API}/trpc.ts`, 'trpc.mjs', { ...own, '@repo/auth/auth': './no-auth.mjs', superjson: REAL.superjson });
    await generated(`${API}/pagination.ts`, 'pagination.mjs', own);
    await generated(`${API}/page-query.ts`, 'page-query.mjs', own);
    await generated(`${API}/document-scope.ts`, 'document-scope.mjs', own);
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', own);
    const { rolesRouter } = await generated<{ rolesRouter: { _def: { procedures: Record<string, unknown> } } }>(
      `${API}/router/roles.ts`,
      'roles-router.mjs',
      own,
    );
    const { permissionsRouter } = await generated<{ permissionsRouter: unknown }>(`${API}/router/permissions.ts`, 'permissions-router.mjs', own);
    const { documentsRouter } = await generated<{ documentsRouter: unknown }>(`${API}/router/documents.ts`, 'documents-router.mjs', own);
    procedureNames = Object.keys(rolesRouter._def.procedures).sort();

    const trpc = (await import(join(stubs, 'trpc.mjs'))) as { router: (procedures: Record<string, unknown>) => { createCaller: (ctx: unknown) => RolesCaller } };
    const appRouter = trpc.router({ roles: rolesRouter, permissions: permissionsRouter, documents: documentsRouter });
    routerCaller = (ctx) => appRouter.createCaller(ctx);
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
    beforeQuery = null;
    queries = [];
    const real = drizzle(sqlite, {
      logger: {
        logQuery: (query) => {
          queries.push(query);
          beforeQuery?.(query);
        },
      },
    });
    // D1 runs the statements of a batch as one transaction, which is what its `batch` guarantees and what this does.
    db = Object.assign(real, {
      batch: async (queries: { all: () => unknown }[]) => sqlite.transaction(() => queries.map((query) => query.all()))(),
    });
    addRole('user', 'User');
    addRole('manager', 'Manager');
    grant('user', 'document.create', 'document.read');
    grant('manager', 'document.read', 'document.read-any');
  });

  describe('only the literal admin role manages roles', () => {
    // A structural guard: a rename would leave every holder of the id on a role that no longer exists, so no procedure
    // may exist for it. A new procedure is a decision to make here, not an accident.
    test('the router has exactly the procedures that read, create, grant and delete: no procedure changes an id', () => {
      expect(procedureNames).toEqual(['create', 'matrix', 'remove', 'setPermission']);
    });

    test('a field that asks for another id is dropped, so no procedure renames a role by accident', async () => {
      addUser('u1', 'manager');
      const before = snapshot();
      await admin().roles.setPermission({ id: 'manager', permission: 'document.update', granted: true, newId: 'renamed' } as never);
      expect(roleIds()).toEqual(before.roles);
      expect(roleOf('u1')).toBe('manager');
      expect(permissionRows()).toContain('manager:document.update');
    });

    const notAdmins: [string, string | null][] = [
      ['a user', 'user'],
      ['a manager', 'manager'],
      ['a role that holds every permission but is not admin', 'superuser'],
      ['a comma list that holds admin', 'user,admin'],
      ['admin in capitals', 'Admin'],
      ['admin with a trailing space', 'admin '],
      ['an account with no role', null],
    ];

    test.each(notAdmins)('%s is refused by every procedure, and nothing changes', async (_, role) => {
      addRole('superuser');
      grant('superuser', ...['document.create', 'document.read', 'document.update', 'document.delete', 'document.read-any', 'document.delete-any']);
      const before = snapshot();
      const caller = asRole(role);
      const calls = [
        () => caller.roles.matrix(),
        () => caller.roles.create({ id: 'auditor', label: 'Auditor' }),
        () => caller.roles.setPermission({ id: 'user', permission: 'document.delete', granted: true }),
        () => caller.roles.setPermission({ id: 'manager', permission: 'document.read', granted: false }),
        () => caller.roles.remove({ id: 'manager' }),
      ];
      for (const call of calls) expect((await refusal(call)).code).toBe('FORBIDDEN');
      expect(snapshot()).toEqual(before);
    });

    test('a request with no session is refused', async () => {
      const caller = routerCaller({ db, headers: new Headers(), session: null });
      for (const call of [() => caller.roles.matrix(), () => caller.roles.remove({ id: 'manager' })]) {
        expect((await refusal(call)).code).toBe('UNAUTHORIZED');
      }
      expect(roleIds()).toEqual(['manager', 'user']);
    });
  });

  describe('the matrix', () => {
    test('lists admin first and read only, then the roles of the database with what each holds and who holds it', async () => {
      addUser('u1', 'manager');
      addUser('u2', 'manager');
      const { roles, permissions } = await admin().roles.matrix();

      expect(roles.map((role) => role.id)).toEqual(['admin', 'manager', 'user']);
      expect(roles[0]).toMatchObject({ id: 'admin', editable: false, deletable: false });
      expect(roles[0]?.permissions).toContain('user.ban');
      expect(roles[0]?.permissions).toContain('document.delete-any');
      expect(roles[1]).toEqual({
        id: 'manager',
        label: 'Manager',
        permissions: ['document.read', 'document.read-any'],
        holders: 2,
        editable: true,
        deletable: true,
      });
      expect(roles[2]).toMatchObject({ id: 'user', holders: 0, editable: true, deletable: false });
      const names = permissions.map((permission) => permission.name);
      expect(names.slice(0, 6)).toEqual(['document.create', 'document.read', 'document.update', 'document.delete', 'document.read-any', 'document.delete-any']);
      expect(permissions.slice(0, 6).every((permission) => permission.editable)).toBe(true);
      expect(permissions.slice(6).some((permission) => permission.editable)).toBe(false);
      expect(permissions.find((permission) => permission.name === 'document.read')).toEqual({ name: 'document.read', editable: true });
      expect(permissions.find((permission) => permission.name === 'user.ban')).toEqual({ name: 'user.ban', editable: false });
      expect(permissions.find((permission) => permission.name === 'session.revoke')?.editable).toBe(false);
    });
  });

  describe('a permission is granted and revoked from the code vocabulary only', () => {
    test('grants and revokes one permission, and doing either twice changes nothing more', async () => {
      const caller = admin();
      await caller.roles.setPermission({ id: 'manager', permission: 'document.delete', granted: true });
      await caller.roles.setPermission({ id: 'manager', permission: 'document.delete', granted: true });
      expect(permissionRows()).toContain('manager:document.delete');
      expect(permissionRows().filter((row) => row === 'manager:document.delete')).toHaveLength(1);

      await caller.roles.setPermission({ id: 'manager', permission: 'document.delete', granted: false });
      await caller.roles.setPermission({ id: 'manager', permission: 'document.delete', granted: false });
      expect(permissionRows()).not.toContain('manager:document.delete');
      expect(permissionRows()).toContain('manager:document.read-any');
    });

    const outsideTheVocabulary = [
      'user.delete',
      'user.ban',
      'session.revoke',
      'document.fly',
      'document',
      '',
      'document.read.extra',
      'Document.read',
      ' document.read',
      'document.read ',
      '__proto__.read',
      'constructor.name',
      'document.constructor',
      'invoice.read',
    ];

    test.each(outsideTheVocabulary)('granting %j is refused, and nothing is written', async (permission) => {
      const before = snapshot();
      const answer = await refusal(() => admin().roles.setPermission({ id: 'user', permission, granted: true }));
      expect(answer.code).toBe('BAD_REQUEST');
      expect(answer.message).toContain('permission');
      expect(answer.message).not.toMatch(DATABASE_WORDS);
      expect(snapshot()).toEqual(before);
    });

    test('revoking a name outside the vocabulary is refused too, so a stored stray row is not a way to probe', async () => {
      const answer = await refusal(() => admin().roles.setPermission({ id: 'user', permission: 'user.delete', granted: false }));
      expect(answer.code).toBe('BAD_REQUEST');
    });

    test('a role the database has no row for is not found, and no permission row is left for it', async () => {
      const answer = await refusal(() => admin().roles.setPermission({ id: 'ghost', permission: 'document.read', granted: true }));
      expect(answer).toEqual({ code: 'NOT_FOUND', message: 'No role has that id' });
      expect(permissionRows().some((row) => row.startsWith('ghost:'))).toBe(false);
    });

    test('a grant to a role that is deleted right before the write is refused and leaves no row behind', async () => {
      addRole('auditor');
      beforeQuery = (query) => {
        if (query.startsWith('insert into "role_permissions"')) {
          beforeQuery = null;
          sqlite.run("DELETE FROM roles WHERE id = 'auditor'");
        }
      };
      const answer = await refusal(() => admin().roles.setPermission({ id: 'auditor', permission: 'document.read', granted: true }));
      expect(answer.code).toBe('NOT_FOUND');
      expect(permissionRows().some((row) => row.startsWith('auditor:'))).toBe(false);

      addRole('auditor');
      expect(await admin().roles.matrix().then(({ roles }) => roles.find((role) => role.id === 'auditor')?.permissions)).toEqual([]);
    });
  });

  describe('admin and the default role are not editable', () => {
    test('admin is not edited, and a stored row is never created for it', async () => {
      for (const granted of [true, false]) {
        const answer = await refusal(() => admin().roles.setPermission({ id: 'admin', permission: 'document.read', granted }));
        expect(answer.code).toBe('BAD_REQUEST');
        expect(answer.message).toContain('admin');
      }
      expect(permissionRows().some((row) => row.startsWith('admin:'))).toBe(false);
    });

    test('admin is not deleted, even when a stray row exists for it', async () => {
      addRole('admin');
      const answer = await refusal(() => admin().roles.remove({ id: 'admin' }));
      expect(answer.code).toBe('BAD_REQUEST');
      expect(roleIds()).toContain('admin');
    });

    test('admin and the default role are reserved identifiers: no role is created under either', async () => {
      sqlite.run("DELETE FROM roles WHERE id = 'user'");
      const before = snapshot();
      for (const id of ['admin', 'user']) {
        const answer = await refusal(() => admin().roles.create({ id, label: 'Anything' }));
        expect(answer.code).toBe('BAD_REQUEST');
        expect(answer.message).toContain('reserved');
      }
      expect(snapshot()).toEqual(before);
    });

    test('a key every object has is reserved: the plugin reads roles by plain key, so an account on it gets a 500', async () => {
      const before = snapshot();
      const keys = Object.getOwnPropertyNames(Object.prototype);
      expect(keys).toContain('constructor');
      for (const id of keys) {
        const answer = await refusal(() => admin().roles.create({ id, label: 'Inherited' }));
        expect([id, answer.code]).toEqual([id, 'BAD_REQUEST']);
      }
      const reserved = await refusal(() => admin().roles.create({ id: 'constructor', label: 'Inherited' }));
      expect(reserved.message).toContain('reserved');
      expect(snapshot()).toEqual(before);
    });

    test('the default role can be edited but not deleted: new accounts start on it', async () => {
      await admin().roles.setPermission({ id: 'user', permission: 'document.update', granted: true });
      expect(permissionRows()).toContain('user:document.update');

      const answer = await refusal(() => admin().roles.remove({ id: 'user' }));
      expect(answer.code).toBe('BAD_REQUEST');
      expect(answer.message).toContain('default');
      expect(roleIds()).toContain('user');
    });
  });

  describe('a role is created with a valid identifier and a label', () => {
    test('creates a role that holds nothing, and lists it', async () => {
      expect(await admin().roles.create({ id: 'auditor-2', label: 'Auditor' })).toEqual({ id: 'auditor-2' });
      expect(roleIds()).toContain('auditor-2');
      const { roles } = await admin().roles.matrix();
      expect(roles.find((role) => role.id === 'auditor-2')).toMatchObject({ label: 'Auditor', permissions: [], holders: 0, deletable: true });
    });

    const invalidIds: [string, unknown][] = [
      ['an empty id', ''],
      ['capitals', 'Auditor'],
      ['a space', 'my role'],
      ['a comma, which the admin plugin reads as a list', 'a,b'],
      ['a leading space', ' auditor'],
      ['a trailing line break', 'auditor\n'],
      ['an underscore', 'my_role'],
      ['a dot', 'my.role'],
      ['a slash', 'a/b'],
      ['a non-latin letter', 'rôle'],
      ['more than 40 characters', 'a'.repeat(41)],
      ['a number', 1],
      ['an array', ['auditor']],
      ['null', null],
    ];

    test.each(invalidIds)('%s is refused', async (_, id) => {
      const before = snapshot();
      const answer = await refusal(() => management.createRole(db, { id, label: 'Auditor' }));
      expect(answer.code).toBe('BAD_REQUEST');
      expect(answer.message).not.toMatch(DATABASE_WORDS);
      expect(snapshot()).toEqual(before);
    });

    test.each([['empty', ''], ['blank', '   '], ['a number', 1], ['65 characters', 'x'.repeat(65)]])('a label that is %s is refused', async (_, label) => {
      const answer = await refusal(() => management.createRole(db, { id: 'auditor', label }));
      expect(answer.code).toBe('BAD_REQUEST');
      expect(answer.message).toContain('label');
      expect(roleIds()).not.toContain('auditor');
    });

    test('a duplicate is refused and the first role keeps its label and permissions', async () => {
      const answer = await refusal(() => admin().roles.create({ id: 'manager', label: 'Someone else' }));
      expect(answer).toEqual({ code: 'CONFLICT', message: 'A role with that id already exists' });
      expect(sqlite.query("SELECT label FROM roles WHERE id = 'manager'").get()).toEqual({ label: 'Manager' });
      expect(permissionRows()).toContain('manager:document.read-any');
    });

    test('the same id created twice at once makes one role', async () => {
      const results = await Promise.allSettled([
        admin().roles.create({ id: 'auditor', label: 'First' }),
        admin().roles.create({ id: 'auditor', label: 'Second' }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(sqlite.query("SELECT count(*) AS n FROM roles WHERE id = 'auditor'").get()).toEqual({ n: 1 });
    });
  });

  describe('a role is deleted only when nobody holds it, in the write itself', () => {
    test('deletes a role nobody holds with its permission rows, and leaves the other roles alone', async () => {
      addRole('auditor');
      grant('auditor', 'document.read', 'document.update');
      expect(await admin().roles.remove({ id: 'auditor' })).toEqual({ removed: true });
      expect(roleIds()).toEqual(['manager', 'user']);
      expect(permissionRows()).toEqual(['manager:document.read', 'manager:document.read-any', 'user:document.create', 'user:document.read']);
    });

    test('a role created again under a deleted id starts with nothing', async () => {
      addRole('auditor');
      grant('auditor', 'document.read-any');
      await admin().roles.remove({ id: 'auditor' });
      await admin().roles.create({ id: 'auditor', label: 'Auditor' });
      expect(permissionRows().some((row) => row.startsWith('auditor:'))).toBe(false);
      expect(await asRole('auditor', 'someone').permissions.mine()).toEqual([]);
    });

    test('a role someone holds is refused, with who holds it, and it keeps its permissions', async () => {
      addUser('u1', 'manager');
      addUser('u2', 'manager');
      const answer = await refusal(() => admin().roles.remove({ id: 'manager' }));
      expect(answer.code).toBe('CONFLICT');
      expect(answer.message).toContain('2 users');
      expect(answer.message).not.toMatch(DATABASE_WORDS);
      expect(roleIds()).toContain('manager');
      expect(permissionRows()).toContain('manager:document.read-any');
    });

    test('a banned holder still holds the role', async () => {
      addUser('u1', 'manager');
      sqlite.run("UPDATE users SET banned = 1 WHERE id = 'u1'");
      expect((await refusal(() => admin().roles.remove({ id: 'manager' }))).code).toBe('CONFLICT');
      expect(roleIds()).toContain('manager');
    });

    test('a role nobody has is not found', async () => {
      expect(await refusal(() => admin().roles.remove({ id: 'ghost' }))).toEqual({ code: 'NOT_FOUND', message: 'No role has that id' });
    });

    test('a user given the role right before the delete runs still stops it: the check is part of the write', async () => {
      addRole('auditor');
      grant('auditor', 'document.read');
      addUser('u1', 'user');
      beforeQuery = (query) => {
        if (/^delete from "roles"/.test(query)) {
          beforeQuery = null;
          sqlite.run("UPDATE users SET role = 'auditor' WHERE id = 'u1'");
        }
      };
      const answer = await refusal(() => admin().roles.remove({ id: 'auditor' }));
      expect(answer.code).toBe('CONFLICT');
      expect(roleIds()).toContain('auditor');
      expect(permissionRows()).toContain('auditor:document.read');
      expect(roleOf('u1')).toBe('auditor');
    });

    test('the permission rows go in the same batch: a refused delete leaves them, a delete that runs removes them, with no cascade', async () => {
      sqlite.run('PRAGMA foreign_keys = OFF');
      addRole('auditor');
      grant('auditor', 'document.read');
      addUser('u1', 'auditor');
      await refusal(() => admin().roles.remove({ id: 'auditor' }));
      expect(permissionRows()).toContain('auditor:document.read');

      sqlite.run("UPDATE users SET role = 'user' WHERE id = 'u1'");
      await admin().roles.remove({ id: 'auditor' });
      expect(permissionRows().some((row) => row.startsWith('auditor:'))).toBe(false);
    });
  });

  describe('assigning and deleting a role at once never leave an account on a deleted role', () => {
    const holdersOfMissingRoles = () =>
      (sqlite.query("SELECT users.id FROM users WHERE users.role <> 'admin' AND NOT EXISTS (SELECT 1 FROM roles WHERE roles.id = users.role)").all() as { id: string }[]).map(
        (row) => row.id,
      );
    const assign = () => assignment.assignRole(db, 'u1', 'auditor');
    const remove = () => admin().roles.remove({ id: 'auditor' });
    const seedRole = () => {
      addRole('auditor');
      grant('auditor', 'document.read');
      addUser('u1', 'user');
    };

    // The writes that decide, in the order the database ran them. A request that starts first does not run first (the
    // delete goes through the router's middleware, the assignment does not), so each test starts the second request
    // from inside the first one's write, and the recorded order is what proves which ordering occurred.
    const writes = (): string[] => queries.filter((query) => /^(update "users"|delete from "roles")/.test(query)).map((query) => query.split(' ').slice(0, 3).join(' '));
    const startWhenWriting = (write: RegExp, start: () => Promise<unknown>): Promise<unknown>[] => {
      const started: Promise<unknown>[] = [];
      beforeQuery = (query) => {
        if (write.test(query)) {
          beforeQuery = null;
          started.push(start());
        }
      };
      return started;
    };

    test('the assignment writes first: the account holds the role and the concurrent delete is refused', async () => {
      seedRole();
      const started = startWhenWriting(/^update "users"/, () => remove().then(() => 'removed', (error) => error));
      const assigned = await assign();
      const [deleteOutcome] = await Promise.all(started);

      expect(writes()).toEqual(['update "users" set', 'delete from "roles"']);
      expect(assigned).toMatchObject({ id: 'u1', role: 'auditor' });
      expect(deleteOutcome).toMatchObject({ code: 'CONFLICT' });
      expect(roleOf('u1')).toBe('auditor');
      expect(roleIds()).toContain('auditor');
      expect(permissionRows()).toContain('auditor:document.read');
      expect(holdersOfMissingRoles()).toEqual([]);
    });

    test('the delete writes first: the role is gone and the concurrent assignment is refused, so the account keeps its role', async () => {
      seedRole();
      const started = startWhenWriting(/^delete from "roles"/, () => assign().then(() => 'assigned', (error) => error));
      expect(await remove()).toEqual({ removed: true });
      const [assignOutcome] = await Promise.all(started);

      expect(writes()).toEqual(['delete from "roles"', 'update "users" set']);
      expect(assignOutcome).toMatchObject({ message: 'No role has that id' });
      expect(roleOf('u1')).toBe('user');
      expect(roleIds()).not.toContain('auditor');
      expect(permissionRows().some((row) => row.startsWith('auditor:'))).toBe(false);
      expect(holdersOfMissingRoles()).toEqual([]);
    });

    // The orderings above start the second request while the first one writes. Here the other request lands between the
    // statement being issued and its execution, which is where a check followed by a write would be wrong.
    test('the delete lands right before the assignment writes: the write refuses and the account keeps its role', async () => {
      seedRole();
      beforeQuery = (query) => {
        if (/^update "users"/.test(query)) {
          beforeQuery = null;
          sqlite.run("DELETE FROM role_permissions WHERE role_id = 'auditor'; DELETE FROM roles WHERE id = 'auditor'");
        }
      };
      await expect(assign()).rejects.toThrow('No role has that id');
      expect(roleOf('u1')).toBe('user');
      expect(holdersOfMissingRoles()).toEqual([]);
    });

    test('the assignment lands right before the delete writes: the write refuses and the role stays with its holder', async () => {
      seedRole();
      beforeQuery = (query) => {
        if (/^delete from "roles"/.test(query)) {
          beforeQuery = null;
          sqlite.run("UPDATE users SET role = 'auditor' WHERE id = 'u1'");
        }
      };
      expect(await refusal(remove)).toMatchObject({ code: 'CONFLICT' });
      expect(roleOf('u1')).toBe('auditor');
      expect(roleIds()).toContain('auditor');
      expect(permissionRows()).toContain('auditor:document.read');
      expect(holdersOfMissingRoles()).toEqual([]);
    });
  });

  describe('a change applies at the next request', () => {
    test('a revoked permission is refused on the next request, and a granted one is allowed', async () => {
      addUser('m1', 'manager');
      expect(await asRole('manager', 'm1').permissions.mine()).toEqual(['document.read', 'document.read-any']);
      await asRole('manager', 'm1').documents.list();

      await admin().roles.setPermission({ id: 'manager', permission: 'document.read', granted: false });
      expect(await asRole('manager', 'm1').permissions.mine()).toEqual(['document.read-any']);
      expect((await refusal(() => asRole('manager', 'm1').documents.list())).code).toBe('FORBIDDEN');

      await admin().roles.setPermission({ id: 'manager', permission: 'document.read', granted: true });
      await asRole('manager', 'm1').documents.list();
    });

    test('a role created at runtime works for a user assigned to it, and stops when it is emptied', async () => {
      addUser('u1', 'user');
      await admin().roles.create({ id: 'auditor', label: 'Auditor' });
      await admin().roles.setPermission({ id: 'auditor', permission: 'document.read-any', granted: true });
      await assignment.assignRole(db, 'u1', 'auditor');

      expect(await asRole('auditor', 'u1').permissions.mine()).toEqual(['document.read-any']);
      await admin().roles.setPermission({ id: 'auditor', permission: 'document.read-any', granted: false });
      expect(await asRole('auditor', 'u1').permissions.mine()).toEqual([]);
    });

    test('a deleted role holds nothing, and admin keeps what it is compiled with whatever the table says', async () => {
      await admin().roles.remove({ id: 'manager' });
      expect(await asRole('manager').permissions.mine()).toEqual([]);
      sqlite.run('DELETE FROM role_permissions');
      sqlite.run('DELETE FROM roles');
      expect((await asRole('admin', 'root').permissions.mine()).length).toBeGreaterThan(6);
      expect((await refusal(() => asRole('user').roles.matrix())).code).toBe('FORBIDDEN');
    });
  });

  test('no refusal of the module uses the words better-auth logs as a database error', async () => {
    addUser('u1', 'manager');
    const refusals = [
      () => admin().roles.create({ id: 'manager', label: 'x' }),
      () => admin().roles.create({ id: 'admin', label: 'x' }),
      () => admin().roles.create({ id: 'BAD ID', label: 'x' }),
      () => admin().roles.create({ id: 'ok', label: '' }),
      () => admin().roles.remove({ id: 'ghost' }),
      () => admin().roles.remove({ id: 'manager' }),
      () => admin().roles.remove({ id: 'admin' }),
      () => admin().roles.remove({ id: 'user' }),
      () => admin().roles.setPermission({ id: 'ghost', permission: 'document.read', granted: true }),
      () => admin().roles.setPermission({ id: 'admin', permission: 'document.read', granted: true }),
      () => admin().roles.setPermission({ id: 'user', permission: 'user.ban', granted: true }),
    ];
    for (const run of refusals) expect((await refusal(run)).message).not.toMatch(DATABASE_WORDS);
  });
});
