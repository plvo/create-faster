import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, REACT_ELEMENT_STUB, readTextFile, runCli } from './helpers';
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
  // A real tRPC instance. protectedProcedure refuses a caller without a session, as the generated one does.
  'trpc.mjs': `import { initTRPC, TRPCError } from '${REAL.trpcServer}';
const t = initTRPC.context().create();
export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const protectedProcedure = t.procedure.use((opts) => {
  if (!opts.ctx.session?.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return opts.next({ ctx: opts.ctx });
});`,
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
  defaultRoleStatements: (existing: Iterable<string>, definitions?: Record<string, unknown>) => string[];
}

interface RolePermissions {
  permissionsOf: (db: unknown, role: string | null | undefined) => Promise<string[]>;
  hasPermission: (db: unknown, role: string | null | undefined, resource: string, action: string) => Promise<boolean>;
  listRoleMatrix: (db: unknown) => Promise<{ id: string; label: string; permissions: string[] }[]>;
}

interface Caller {
  documents: { list: (input?: unknown) => Promise<unknown[]>; delete: (input: { id: string }) => Promise<unknown> };
  users: { list: (input?: unknown) => Promise<unknown[]> };
  permissions: { mine: () => Promise<string[]> };
}

function createTable(sqlite: Database, table: SQLiteTable): void {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const defaulted = column.name === 'created_at' || column.name === 'updated_at' ? ' DEFAULT (unixepoch())' : '';
    return `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}${defaulted}`;
  });
  for (const key of config.primaryKeys) {
    columns.push(`PRIMARY KEY (${key.columns.map((column) => `"${column.name}"`).join(', ')})`);
  }
  for (const foreignKey of config.foreignKeys) {
    const reference = foreignKey.reference();
    const names = (list: { name: string }[]) => list.map((column) => `"${column.name}"`).join(', ');
    columns.push(
      `FOREIGN KEY (${names(reference.columns)}) REFERENCES "${getTableConfig(reference.foreignTable).name}" (${names(reference.foreignColumns)}) ON DELETE ${(foreignKey.onDelete ?? 'no action').toUpperCase()}`,
    );
  }
  sqlite.run(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  for (const column of config.columns.filter((each) => each.isUnique)) {
    sqlite.run(`CREATE UNIQUE INDEX "${config.name}_${column.name}_unique" ON "${config.name}" ("${column.name}")`);
  }
}

describe(`${BLUEPRINT} database roles`, () => {
  let tempDir: string;
  let project: string;
  let stubs: string;
  let permissions: Permissions;
  let defaults: DefaultRoles;
  let engine: RolePermissions;
  let schema: Record<string, SQLiteTable>;
  let createCaller: (router: unknown) => (ctx: unknown) => Caller;
  let appRouter: unknown;

  let sqlite: Database;
  let db: unknown;

  const grant = (role: string, ...names: string[]) => {
    for (const name of names) {
      const [resource = '', action = ''] = name.split('.');
      sqlite.run('INSERT INTO role_permissions (role_id, resource, action) VALUES (?, ?, ?)', [role, resource, action]);
    }
  };
  const addRole = (id: string, label = id) => sqlite.run('INSERT INTO roles (id, label) VALUES (?, ?)', [id, label]);
  const callerOf = (role: string | null, userId = 'u1') =>
    createCaller(appRouter)({ db, headers: new Headers(), session: { user: { id: userId, role } } });
  const rowsOf = () =>
    sqlite.query('SELECT role_id, resource, action FROM role_permissions ORDER BY role_id, resource, action').all();
  const runAll = (statements: string[]) => {
    for (const statement of statements) sqlite.run(statement);
  };

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
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
    };
    await Bun.write(join(stubs, 'auth.mjs'), 'export const createAuth = () => ({ api: {} });');
    const zod = Bun.resolveSync('zod', import.meta.dir);
    await generated(`${API}/pagination.ts`, 'pagination.mjs', { zod });
    await generated(`${API}/user-list.ts`, 'user-list.mjs', { zod, './pagination': './pagination.mjs' });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', imports);
    const routerImports = {
      ...imports,
      zod,
      '../page-query': './page-query.mjs',
      '../pagination': './pagination.mjs',
      '../user-list': './user-list.mjs',
      '@repo/auth/auth': './auth.mjs',
    };
    const { documentsRouter } = await generated<{ documentsRouter: unknown }>(`${API}/router/documents.ts`, 'documents-router.mjs', routerImports);
    const { usersRouter } = await generated<{ usersRouter: unknown }>(`${API}/router/users.ts`, 'users-router.mjs', routerImports);
    const { permissionsRouter } = await generated<{ permissionsRouter: unknown }>(`${API}/router/permissions.ts`, 'permissions-router.mjs', imports);

    const trpc = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => unknown;
      createCallerFactory: (router: unknown) => (ctx: unknown) => Caller;
    };
    appRouter = trpc.router({ documents: documentsRouter, users: usersRouter, permissions: permissionsRouter });
    createCaller = trpc.createCallerFactory;
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
    db = drizzle(sqlite);
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

    test('a procedure answers FORBIDDEN to a role the database does not know, and UNAUTHORIZED without a session', async () => {
      await expect(callerOf('auditor').documents.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        createCaller(appRouter)({ db, headers: new Headers(), session: null }).documents.list(),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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
      await expect(callerOf('manager').users.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    test('the vocabulary of stored permissions is the business statement, and excludes the account statement', () => {
      expect(Object.keys(permissions.accountStatement).sort()).toEqual(['session', 'user']);
      expect(Object.keys(permissions.businessStatement)).toEqual(['document']);
      expect(permissions.isBusinessPermission('document', 'read')).toBe(true);
      for (const [resource, action] of [['user', 'list'], ['user', 'set-role'], ['session', 'list'], ['document', 'nuke'], ['', ''], ['document.read', ''], ['constructor', 'name']] as const) {
        expect([resource, action, permissions.isBusinessPermission(resource, action)]).toEqual([resource, action, false]);
      }
      for (const permission of permissions.BUSINESS_PERMISSIONS) expect(permission).not.toMatch(/^(user|session)\./);
    });

    test('the defaults writer refuses a definition that names an account resource, an unknown action or an unsafe role', () => {
      const attempt = (definitions: Record<string, unknown>) => () => defaults.defaultRoleStatements([], definitions);
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

    test('a refused definition writes nothing, even beside valid roles, and a role that already exists is still validated', () => {
      expect(() =>
        defaults.defaultRoleStatements([], {
          fine: { label: 'Fine', permissions: ['document.read'] },
          bad: { label: 'Bad', permissions: ['user.list'] },
        }),
      ).toThrow();
      expect(() => defaults.defaultRoleStatements(['bad'], { bad: { label: 'Bad', permissions: ['user.list'] } })).toThrow();
    });

    test('a label is data, never SQL', () => {
      addRole('placeholder');
      runAll(defaults.defaultRoleStatements([], { tricky: { label: "O'Brien'); DROP TABLE roles; --", permissions: ['document.read'] } }));
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
      runAll(defaults.defaultRoleStatements([]));
      expect(rowsOf().filter((row) => (row as { role_id: string }).role_id === 'admin')).toEqual([]);
      expect(sqlite.query("SELECT id FROM roles WHERE id = 'admin'").all()).toEqual([]);
      addRole('admin');
      grant('admin', 'document.read');
      expect(await engine.permissionsOf(db, 'admin')).toEqual([...permissions.ADMIN_PERMISSIONS]);
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
      await expect(callerOf('admin').users.list({})).resolves.toEqual([]);
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

    test('follows a revocation on the next call', async () => {
      addRole('user');
      grant('user', 'document.read');
      expect(await callerOf('user').permissions.mine()).toEqual(['document.read']);
      sqlite.run('DELETE FROM role_permissions');
      expect(await callerOf('user').permissions.mine()).toEqual([]);
    });

    test('needs a session', async () => {
      await expect(
        createCaller(appRouter)({ db, headers: new Headers(), session: null }).permissions.mine(),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('the defaults command', () => {
    test('gives a fresh database the permissions the code gave before: user keeps the full document set, manager reads', async () => {
      runAll(defaults.defaultRoleStatements([]));
      expect((await engine.permissionsOf(db, 'user')).sort()).toEqual([
        'document.create',
        'document.delete',
        'document.read',
        'document.update',
      ]);
      expect(await engine.permissionsOf(db, 'manager')).toEqual(['document.read']);
      expect(await engine.listRoleMatrix(db)).toEqual([
        { id: 'manager', label: 'Manager', permissions: ['document.read'] },
        { id: 'user', label: 'User', permissions: ['document.create', 'document.delete', 'document.read', 'document.update'] },
      ]);
    });

    test('is idempotent: a second run, with or without knowing the roles, changes nothing', () => {
      runAll(defaults.defaultRoleStatements([]));
      const once = rowsOf();
      runAll(defaults.defaultRoleStatements([]));
      expect(rowsOf()).toEqual(once);
      expect(defaults.defaultRoleStatements(Object.keys(defaults.DEFAULT_ROLES))).toEqual([]);
    });

    test('never touches a role that exists, so a permission revoked since survives a rerun', async () => {
      runAll(defaults.defaultRoleStatements([]));
      sqlite.run("DELETE FROM role_permissions WHERE role_id = 'user' AND action = 'delete'");
      sqlite.run("UPDATE roles SET label = 'Member' WHERE id = 'user'");
      const existing = (sqlite.query('SELECT id FROM roles').all() as { id: string }[]).map((row) => row.id);
      runAll(defaults.defaultRoleStatements(existing));
      expect(await engine.hasPermission(db, 'user', 'document', 'delete')).toBe(false);
      expect(sqlite.query("SELECT label FROM roles WHERE id = 'user'").get()).toEqual({ label: 'Member' });
    });

    test('writes only roles that are missing', () => {
      runAll(defaults.defaultRoleStatements(['user']));
      expect(sqlite.query('SELECT id FROM roles').all()).toEqual([{ id: 'manager' }]);
    });

    test('is safe to run twice at once: the statements ignore rows that exist', () => {
      const statements = defaults.defaultRoleStatements([]);
      runAll(statements);
      expect(() => runAll(statements)).not.toThrow();
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
