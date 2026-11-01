import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { createTable } from './sqlite-tables';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-fullstack-nextjs';
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
  sqliteCore: Bun.resolveSync('drizzle-orm/sqlite-core', import.meta.dir),
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  superjson: Bun.resolveSync('superjson', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
};

const TABLES = ['userTable', 'userSessionTable', 'userAccountTable', 'userVerificationTable', 'documentTable', 'roleTable', 'rolePermissionTable'];

interface UserOutput {
  id: string;
  role: string | null;
  banned?: boolean | null;
}

interface AuthResult {
  status: number;
  json: { message?: string; user?: UserOutput; success?: boolean } | null;
}

interface Auth {
  handler: (request: Request) => Promise<Response>;
  api: {
    signUpEmail: (input: { body: { email: string; password: string; name: string } }) => Promise<{ user: UserOutput }>;
    createUser: (input: { body: { email: string; password: string; name: string; role?: unknown } }) => Promise<{ user: UserOutput }>;
    signInEmail: (input: { body: { email: string; password: string }; asResponse: true }) => Promise<Response>;
  };
}

interface RoleAssignment {
  assignRole: (db: unknown, userId: string, role: string) => Promise<unknown>;
  claimBan: (db: unknown, userId: string) => Promise<unknown>;
  removeAccount: (db: unknown, userId: string) => Promise<unknown>;
  listAssignableRoles: (db: unknown) => Promise<{ id: string; label: string }[]>;
}

interface UsersCaller {
  users: {
    create: (input: { name: string; email: string; role: string }) => Promise<{ id: string; password: string }>;
    setRole: (input: { id: string; role: string }) => Promise<{ role: string }>;
    setBanned: (input: { id: string; banned: boolean }) => Promise<{ banned: boolean }>;
    remove: (input: { id: string }) => Promise<{ removed: boolean }>;
    assignableRoles: () => Promise<{ id: string; label: string }[]>;
  };
}

// Values a request could send as a role that are not the id of one existing role. Each is something better-auth's
// `admin` plugin stores or treats as a role of some kind: the plugin splits `user.role` on `,`, so `user,admin` is an
// administrator to it and nothing to the permission engine.
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

describe(`${BLUEPRINT} role assignment and the last administrator`, () => {
  let tempDir: string;
  let stubs: string;
  let schema: Record<string, SQLiteTable>;
  let createAuth: (db: unknown) => Auth;
  let assignment: RoleAssignment;
  let createCaller: (ctx: unknown) => UsersCaller;

  let sqlite: Database;
  let db: unknown;
  let auth: Auth;
  let emails = 0;
  let beforeQuery: ((query: string) => void) | null = null;

  const addRole = (id: string, label = id) => sqlite.run('INSERT INTO roles (id, label) VALUES (?, ?)', [id, label]);
  const roleOf = (id: string) => (sqlite.query('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | null)?.role;
  const exists = (id: string) => sqlite.query('SELECT 1 AS found FROM users WHERE id = ?').get(id) !== null;
  const activeAdministrators = () =>
    (sqlite.query("SELECT id FROM users WHERE role = 'admin' AND coalesce(banned, 0) = 0 ORDER BY id").all() as { id: string }[]).map(
      (row) => row.id,
    );

  async function addAccount(name: string, role: string): Promise<{ id: string; email: string }> {
    const email = `${name}${++emails}@example.com`;
    const { user } = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
    sqlite.run('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
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

  async function request(cookie: string, path: string, body: unknown): Promise<AuthResult> {
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

  const callerOf = async (account: { id: string; email: string }): Promise<UsersCaller> =>
    createCaller({
      db,
      headers: new Headers({ cookie: await signIn(account.email) }),
      session: { user: { id: account.id, role: roleOf(account.id) } },
    });

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = 'a-secret-for-the-tests-only-0123456789abcdef';
    process.env.BETTER_AUTH_URL = ORIGIN;
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);

    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'db.mjs'), `export * from '${REAL.drizzle}';\nexport * from './schema.mjs';`);

    const generated = async <T>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/sqlite-core': REAL.sqliteCore,
    });
    const ownModules = {
      '@repo/db': './db.mjs',
      './permissions': './permissions.mjs',
      './default-roles': './default-roles.mjs',
      './role-store': './role-store.mjs',
      './role-assignment': './role-assignment.mjs',
      './link-delivery': './link-delivery.mjs',
      './email-change-guard': './email-change-guard.mjs',
      './refuse-own-role-change': './refuse-own-role-change.mjs',
      './guard-administrators': './guard-administrators.mjs',
    };
    await generated(`${AUTH}/permissions.ts`, 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/admin/access': REAL.adminAccess,
    });
    await generated(`${AUTH}/link-delivery.ts`, 'link-delivery.mjs');
    await generated(`${AUTH}/default-roles.ts`, 'default-roles.mjs', ownModules);
    await generated(`${AUTH}/role-store.ts`, 'role-store.mjs', ownModules);
    await generated(`${AUTH}/email-change-guard.ts`, 'email-change-guard.mjs', { ...ownModules, 'better-auth/api': REAL.api });
    await generated(`${AUTH}/role-permissions.ts`, 'role-permissions.mjs', ownModules);
    assignment = await generated(`${AUTH}/role-assignment.ts`, 'role-assignment.mjs', ownModules);
    await generated(`${AUTH}/refuse-own-role-change.ts`, 'refuse-own-role-change.mjs', { 'better-auth/api': REAL.api });
    await generated(`${AUTH}/guard-administrators.ts`, 'guard-administrators.mjs', { ...ownModules, 'better-auth/api': REAL.api, 'better-auth/db': REAL.db });
    ({ createAuth } = await generated<{ createAuth: (db: unknown) => Auth }>(`${AUTH}/auth.ts`, 'auth.mjs', {
      ...ownModules,
      '@better-auth/drizzle-adapter': REAL.drizzleAdapter,
      'better-auth': REAL.betterAuth,
      'better-auth/plugins': REAL.plugins,
    }));

    const apiModules = {
      '@trpc/server': REAL.trpcServer,
      '@repo/db': './db.mjs',
      '@repo/auth/auth': './auth.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-permissions': './role-permissions.mjs',
      '@repo/auth/role-assignment': './role-assignment.mjs',
      '../trpc': './trpc.mjs',
      '../auth-errors': './auth-errors.mjs',
      '../role-input': './role-input.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../page-query': './page-query.mjs',
      '../user-list': './user-list.mjs',
      '../text-match': './text-match.mjs',
      zod: REAL.zod,
    };
    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', { '@trpc/server': REAL.trpcServer });
    await generated(`${API}/role-input.ts`, 'role-input.mjs', apiModules);
    await generated(`${API}/trpc.ts`, 'trpc.mjs', { ...apiModules, superjson: REAL.superjson });
    await generated(`${API}/pagination.ts`, 'pagination.mjs', { zod: REAL.zod });
    await generated(`${API}/search-query.ts`, 'search-query.mjs', { zod: REAL.zod });
    await generated(`${API}/user-list.ts`, 'user-list.mjs', {
      zod: REAL.zod,
      './pagination': './pagination.mjs',
      './search-query': './search-query.mjs',
    });
    await generated(`${API}/page-query.ts`, 'page-query.mjs', { '@repo/db': './db.mjs', './pagination': './pagination.mjs' });
    await generated(`${API}/text-match.ts`, 'text-match.mjs', { '@repo/db': './db.mjs' });
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', apiModules);
    const { usersRouter } = await generated<{ usersRouter: unknown }>(`${API}/router/users.ts`, 'users-router.mjs', apiModules);
    const trpc = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => { createCaller: (ctx: unknown) => UsersCaller };
    };
    const appRouter = trpc.router({ users: usersRouter });
    createCaller = (ctx) => appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  // better-auth logs an error for a thrown message that contains `does not exist`, `table` or `column` (it reads them as
  // database errors), so a refusal worded that way would fill the production log. A refusal is an answer, not a failure.
  let errorLog: ReturnType<typeof spyOn<Console, 'error'>>;

  beforeEach(() => {
    errorLog = spyOn(console, 'error');
    sqlite = new Database(':memory:');
    sqlite.run('PRAGMA foreign_keys = ON');
    for (const name of TABLES) createTable(sqlite, schema[name] as SQLiteTable);
    beforeQuery = null;
    db = drizzle(sqlite, { logger: { logQuery: (query) => beforeQuery?.(query) } });
    auth = createAuth(db);
    addRole('user', 'User');
    addRole('manager', 'Manager');
  });

  afterEach(() => {
    const logged = errorLog.mock.calls.map((call) => String(call[0]));
    errorLog.mockRestore();
    expect(logged).toEqual([]);
  });

  describe('a role is assigned as exactly one id that exists', () => {
    test('/admin/set-role gives a user a compiled role, a role only the database knows and admin', async () => {
      addRole('auditor', 'Auditor');
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const cookie = await signIn(admin.email);

      for (const role of ['manager', 'auditor', 'admin', 'user']) {
        const answer = await request(cookie, '/admin/set-role', { userId: target.id, role });
        expect([role, answer.status]).toEqual([role, 200]);
        expect(roleOf(target.id)).toBe(role);
        expect(answer.json?.user).toMatchObject({ id: target.id, role });
      }
    });

    test.each(NOT_ONE_EXISTING_ROLE)('/admin/set-role refuses %s', async (_, role) => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/set-role', { userId: target.id, role });
      expect(answer.status).toBe(400);
      expect(roleOf(target.id)).toBe('user');
    });

    test('a compiled role the database no longer has is refused as an unknown one', async () => {
      sqlite.run("DELETE FROM roles WHERE id = 'manager'");
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/set-role', { userId: target.id, role: 'manager' });
      expect(answer.status).toBe(400);
      expect(answer.json?.message).toContain('role');
      expect(roleOf(target.id)).toBe('user');
    });

    test('a user that does not exist is not found, and nothing is written', async () => {
      const admin = await addAccount('admin', 'admin');
      const answer = await request(await signIn(admin.email), '/admin/set-role', { userId: 'nobody', role: 'manager' });
      expect(answer.status).toBe(404);
      expect(sqlite.query('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    });

    test.each(NOT_ONE_EXISTING_ROLE)('/admin/update-user refuses %s as data.role', async (_, role) => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/update-user', { userId: target.id, data: { role } });
      expect(answer.status).toBe(400);
      expect(roleOf(target.id)).toBe('user');
    });

    test('/admin/update-user changes no role and no ban, even for a valid one: set-role and ban-user are the paths', async () => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const cookie = await signIn(admin.email);
      for (const data of [{ role: 'manager' }, { banned: true }, { banReason: 'because' }, { banExpires: 1 }]) {
        const answer = await request(cookie, '/admin/update-user', { userId: target.id, data });
        expect([Object.keys(data)[0], answer.status]).toEqual([Object.keys(data)[0], 400]);
      }
      expect(sqlite.query('SELECT role, banned FROM users WHERE id = ?').get(target.id)).toEqual({ role: 'user', banned: 0 });
    });

    test('/admin/update-user still updates the fields that are not a role or a ban', async () => {
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const answer = await request(await signIn(admin.email), '/admin/update-user', { userId: target.id, data: { name: 'Renamed' } });
      expect(answer.status).toBe(200);
      expect(sqlite.query('SELECT name FROM users WHERE id = ?').get(target.id)).toEqual({ name: 'Renamed' });
    });

    test('/admin/create-user creates the account on the default role or on admin, in body.role and in data.role', async () => {
      const admin = await addAccount('admin', 'admin');
      const cookie = await signIn(admin.email);
      for (const [index, [body, expected]] of (
        [
          [{ role: 'admin' }, 'admin'],
          [{ data: { role: 'admin' } }, 'admin'],
          [{ role: 'user' }, 'user'],
          [{}, 'user'],
        ] as const
      ).entries()) {
        const email = `created${index}@example.com`;
        const answer = await request(cookie, '/admin/create-user', { email, password: PASSWORD, name: 'Created', ...body });
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(sqlite.query('SELECT role FROM users WHERE email = ?').get(email)).toEqual({ role: expected });
      }
    });

    // The plugin writes the account after the guard has read: a role that can be deleted (every role but admin and the
    // default one) could be gone by then, leaving an account on a role nobody has. The account is created on the default
    // role and the role is given with set-role, whose write is conditional on the role being there (users.create does so).
    test.each([
      ['a compiled role the database has', 'manager'],
      ['a role only the database has', 'auditor'],
    ])('/admin/create-user refuses %s, in body.role and in data.role, and creates no account', async (_, role) => {
      addRole('auditor', 'Auditor');
      const admin = await addAccount('admin', 'admin');
      const cookie = await signIn(admin.email);
      for (const [index, body] of [{ role }, { data: { role } }].entries()) {
        const email = `deferred${index}@example.com`;
        const answer = await request(cookie, '/admin/create-user', { email, password: PASSWORD, name: 'Deferred', ...body });
        expect(answer.status).toBe(400);
        expect(answer.json?.message).toContain('set-role');
        expect(sqlite.query('SELECT 1 FROM users WHERE email = ?').get(email)).toBeNull();
      }
    });

    test('a role deleted while an account is being created never leaves the account on it', async () => {
      const admin = await addAccount('admin', 'admin');
      const cookie = await signIn(admin.email);
      // The second administrator deletes the role at the moment the plugin writes the account.
      beforeQuery = (query) => {
        if (query.startsWith('insert into "users"')) sqlite.run("DELETE FROM roles WHERE id = 'manager'");
      };
      const answer = await request(cookie, '/admin/create-user', { email: 'racer@example.com', password: PASSWORD, name: 'Racer', role: 'manager' });
      beforeQuery = null;

      expect(answer.status).toBe(400);
      expect(sqlite.query("SELECT id FROM users WHERE role <> 'admin' AND role NOT IN (SELECT id FROM roles)").all()).toEqual([]);
    });

    test('a role row named after a key every object has is never assigned: the plugin reads roles by plain key', async () => {
      addRole('constructor', 'Constructor');
      const admin = await addAccount('admin', 'admin');
      const target = await addAccount('target', 'user');
      const cookie = await signIn(admin.email);
      for (const [path, body] of [
        ['/admin/set-role', { userId: target.id, role: 'constructor' }],
        ['/admin/create-user', { email: 'proto@example.com', password: PASSWORD, name: 'Proto', role: 'constructor' }],
      ] as const) {
        const answer = await request(cookie, path, body);
        expect([path, answer.status]).toEqual([path, 400]);
      }
      expect(roleOf(target.id)).toBe('user');
      expect(sqlite.query("SELECT 1 FROM users WHERE email = 'proto@example.com'").get()).toBeNull();
      await expect(assignment.assignRole(db, target.id, 'constructor')).rejects.toThrow('reserved');
    });

    test.each(NOT_ONE_EXISTING_ROLE)('/admin/create-user refuses %s, in body.role and in data.role, and creates no account', async (_, role) => {
      const admin = await addAccount('admin', 'admin');
      const cookie = await signIn(admin.email);
      for (const [index, body] of [{ role }, { data: { role } }].entries()) {
        const email = `refused${index}@example.com`;
        const answer = await request(cookie, '/admin/create-user', { email, password: PASSWORD, name: 'Refused', ...body });
        expect(answer.status).toBe(400);
        expect(sqlite.query('SELECT 1 FROM users WHERE email = ?').get(email)).toBeNull();
      }
    });

    test('a caller that is not exactly admin is refused every one of these paths, whatever the plugin makes of its role', async () => {
      const target = await addAccount('target', 'user');
      for (const role of ['manager', 'user,admin', 'admin,user']) {
        const caller = await addAccount('caller', role);
        const cookie = await signIn(caller.email);
        for (const [path, body] of [
          ['/admin/set-role', { userId: target.id, role: 'manager' }],
          ['/admin/ban-user', { userId: target.id }],
          ['/admin/remove-user', { userId: target.id }],
          ['/admin/update-user', { userId: target.id, data: { name: 'Hijacked' } }],
          ['/admin/create-user', { email: `from-${role.replace(/\W/g, '')}@example.com`, password: PASSWORD, name: 'X' }],
        ] as const) {
          const answer = await request(cookie, path, body);
          expect([role, path, answer.status]).toEqual([role, path, 403]);
        }
      }
      expect(sqlite.query('SELECT role, banned, name FROM users WHERE id = ?').get(target.id)).toMatchObject({ role: 'user', banned: 0 });
      expect(exists(target.id)).toBe(true);
    });

    test('an anonymous request is refused on each of the five endpoints, and writes nothing', async () => {
      const target = await addAccount('target', 'user');
      const before = sqlite.query('SELECT id, role, banned, name FROM users ORDER BY id').all();
      for (const [path, body] of [
        ['/admin/set-role', { userId: target.id, role: 'manager' }],
        ['/admin/ban-user', { userId: target.id }],
        ['/admin/remove-user', { userId: target.id }],
        ['/admin/update-user', { userId: target.id, data: { name: 'Hijacked' } }],
        ['/admin/create-user', { email: 'anonymous@example.com', password: PASSWORD, name: 'Anonymous', role: 'manager' }],
      ] as const) {
        const answer = await request('', path, body);
        expect([path, answer.status, answer.json?.message]).toEqual([path, 401, 'Sign in to manage accounts']);
      }
      expect(sqlite.query('SELECT id, role, banned, name FROM users ORDER BY id').all()).toEqual(before);
    });

    test('a call from the server without a session or headers still creates an account, under the same role rule', async () => {
      const created = await auth.api.createUser({ body: { email: 'trusted@example.com', password: PASSWORD, name: 'Trusted', role: 'admin' } });
      expect(roleOf(created.user.id)).toBe('admin');
      await expect(
        auth.api.createUser({ body: { email: 'trusted3@example.com', password: PASSWORD, name: 'Trusted', role: 'manager' } }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        auth.api.createUser({ body: { email: 'trusted2@example.com', password: PASSWORD, name: 'Trusted', role: ['user', 'admin'] } }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(sqlite.query("SELECT 1 FROM users WHERE email = 'trusted2@example.com'").get()).toBeNull();
    });

    test('the other ways to write users.role are closed to a user: sign-up and the user\'s own update', async () => {
      const signUp = await request('', '/sign-up/email', { email: 'sneaky@example.com', password: PASSWORD, name: 'Sneaky', role: 'admin' });
      expect(signUp.status).toBeGreaterThanOrEqual(400);
      expect(sqlite.query('SELECT 1 FROM users WHERE email = ?').get('sneaky@example.com')).toBeNull();

      const member = await addAccount('member', 'user');
      const update = await request(await signIn(member.email), '/update-user', { role: 'admin' });
      expect(update.status).toBeGreaterThanOrEqual(400);
      expect(roleOf(member.id)).toBe('user');
    });
  });

  describe('the last administrator cannot be demoted, banned or removed', () => {
    const writes = {
      demote: (cookie: string, targetId: string) => request(cookie, '/admin/set-role', { userId: targetId, role: 'user' }),
      ban: (cookie: string, targetId: string) => request(cookie, '/admin/ban-user', { userId: targetId }),
      remove: (cookie: string, targetId: string) => request(cookie, '/admin/remove-user', { userId: targetId }),
    };
    const REFUSED_VERB = { demote: 'demoted', ban: 'banned', remove: 'removed' };
    const pairs = Object.keys(writes).flatMap((first) => Object.keys(writes).map((second) => [first, second] as const));

    // Two statements that each look at the other administrator, sent together. Nothing sits between them but the
    // statements themselves, so a guard that reads first and writes after lets both through.
    test.each(pairs)('two administrators who %s and %s each other at once, in the write itself, leave one', async (first, second) => {
      const guarded = {
        demote: (id: string) => assignment.assignRole(db, id, 'user'),
        ban: (id: string) => assignment.claimBan(db, id),
        remove: (id: string) => assignment.removeAccount(db, id),
      };
      for (let attempt = 0; attempt < 5; attempt++) {
        sqlite.run('DELETE FROM users');
        const [a, b] = [await addAccount('first', 'admin'), await addAccount('second', 'admin')];

        const results = await Promise.allSettled([
          guarded[first as keyof typeof guarded](b.id),
          guarded[second as keyof typeof guarded](a.id),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        const refusal = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const refusedAction = results[0]?.status === 'rejected' ? first : second;
        expect(refusal?.reason).toMatchObject({
          code: 'BAD_REQUEST',
          message: `The last administrator cannot be ${REFUSED_VERB[refusedAction as keyof typeof REFUSED_VERB]}`,
        });
        expect(activeAdministrators().length).toBe(1);
      }
    });

    // Through the endpoints a second request may already be refused earlier: its caller was demoted, banned or removed
    // before the request read its session. The administrator that remains is the point.
    test.each(pairs)('two administrators who %s and %s each other through the endpoints at once leave one', async (first, second) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        sqlite.run('DELETE FROM users');
        const [a, b] = [await addAccount('first', 'admin'), await addAccount('second', 'admin')];
        const [cookieA, cookieB] = [await signIn(a.email), await signIn(b.email)];

        const answers = await Promise.all([
          writes[first as keyof typeof writes](cookieA, b.id),
          writes[second as keyof typeof writes](cookieB, a.id),
        ]);

        expect(answers.filter((answer) => answer.status === 200), JSON.stringify(answers)).toHaveLength(1);
        expect(answers.find((answer) => answer.status !== 200)?.status).toBeGreaterThanOrEqual(400);
        expect(activeAdministrators().length).toBe(1);
      }
    });

    test('three administrators who demote each other at once leave at least one', async () => {
      const [a, b, c] = [await addAccount('a', 'admin'), await addAccount('b', 'admin'), await addAccount('c', 'admin')];
      const cookies = await Promise.all([a, b, c].map((account) => signIn(account.email)));
      await Promise.all([
        writes.demote(cookies[0] as string, b.id),
        writes.demote(cookies[1] as string, c.id),
        writes.demote(cookies[2] as string, a.id),
      ]);
      expect(activeAdministrators().length).toBeGreaterThanOrEqual(1);
    });

    test('a ban or a removal of one of several administrators goes through', async () => {
      const [a, b, c] = [await addAccount('a', 'admin'), await addAccount('b', 'admin'), await addAccount('c', 'admin')];
      const cookie = await signIn(a.email);
      expect((await writes.ban(cookie, b.id)).status).toBe(200);
      expect(sqlite.query('SELECT banned FROM users WHERE id = ?').get(b.id)).toEqual({ banned: 1 });
      expect((await writes.remove(cookie, c.id)).status).toBe(200);
      expect(exists(c.id)).toBe(false);
      expect(activeAdministrators()).toEqual([a.id]);
    });

    test('a banned administrator is not an administrator that remains', async () => {
      const [a, b] = [await addAccount('a', 'admin'), await addAccount('b', 'admin')];
      sqlite.run('UPDATE users SET banned = 1 WHERE id = ?', [b.id]);
      await expect(assignment.assignRole(db, a.id, 'user')).rejects.toMatchObject({ message: 'The last administrator cannot be demoted' });
      await expect(assignment.claimBan(db, a.id)).rejects.toMatchObject({ message: 'The last administrator cannot be banned' });
      await expect(assignment.removeAccount(db, a.id)).rejects.toMatchObject({ message: 'The last administrator cannot be removed' });
      expect(roleOf(a.id)).toBe('admin');
      expect(exists(a.id)).toBe(true);
    });

    test('the sole administrator is protected in the write itself, whoever asks', async () => {
      const sole = await addAccount('sole', 'admin');
      await addAccount('other', 'user');
      await expect(assignment.assignRole(db, sole.id, 'manager')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(assignment.claimBan(db, sole.id)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(assignment.removeAccount(db, sole.id)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(sqlite.query('SELECT role, banned FROM users WHERE id = ?').get(sole.id)).toEqual({ role: 'admin', banned: 0 });
      await expect(assignment.assignRole(db, sole.id, 'admin')).resolves.toBeDefined();
    });

    test('removing an administrator takes their sessions and accounts with them', async () => {
      const [a, b] = [await addAccount('a', 'admin'), await addAccount('b', 'admin')];
      await signIn(b.email);
      expect((await writes.remove(await signIn(a.email), b.id)).status).toBe(200);
      expect(sqlite.query('SELECT count(*) AS n FROM user_sessions WHERE user_id = ?').get(b.id)).toEqual({ n: 0 });
      expect(sqlite.query('SELECT count(*) AS n FROM user_accounts WHERE user_id = ?').get(b.id)).toEqual({ n: 0 });
    });

    test('banning ends the sessions of the banned user, as the plugin does', async () => {
      const [a, b] = [await addAccount('a', 'admin'), await addAccount('b', 'user')];
      await signIn(b.email);
      expect((await writes.ban(await signIn(a.email), b.id)).status).toBe(200);
      expect(sqlite.query('SELECT count(*) AS n FROM user_sessions WHERE user_id = ?').get(b.id)).toEqual({ n: 0 });
      expect(sqlite.query('SELECT banned, ban_reason FROM users WHERE id = ?').get(b.id)).toEqual({ banned: 1, ban_reason: 'No reason' });
    });

    test('an administrator cannot ban or remove themselves, and nothing was written first', async () => {
      const [a] = [await addAccount('a', 'admin'), await addAccount('b', 'admin')];
      const cookie = await signIn(a.email);
      expect((await writes.ban(cookie, a.id)).status).toBe(400);
      expect((await writes.remove(cookie, a.id)).status).toBe(400);
      expect((await writes.demote(cookie, a.id)).status).toBe(400);
      expect(sqlite.query('SELECT role, banned FROM users WHERE id = ?').get(a.id)).toEqual({ role: 'admin', banned: 0 });
    });
  });

  describe('the same rules apply through the tRPC procedures', () => {
    test('users.setRole assigns a role only the database knows, refuses an unknown one and the caller\'s own', async () => {
      addRole('auditor', 'Auditor');
      const [admin, target] = [await addAccount('admin', 'admin'), await addAccount('target', 'user')];
      const caller = await callerOf(admin);

      await expect(caller.users.setRole({ id: target.id, role: 'auditor' })).resolves.toEqual({ role: 'auditor' });
      expect(roleOf(target.id)).toBe('auditor');
      await expect(caller.users.setRole({ id: target.id, role: 'ghost' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(caller.users.setRole({ id: target.id, role: 'user,admin' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(caller.users.setRole({ id: target.id, role: 'Admin' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(roleOf(target.id)).toBe('auditor');
      await expect(caller.users.setRole({ id: admin.id, role: 'user' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'You cannot change your own role',
      });
      expect(roleOf(admin.id)).toBe('admin');
    });

    // A request may be refused before the guard is reached, when its caller was demoted, banned or removed before the
    // request read the session. The administrator that remains is the point; the guard itself is tested above.
    test('two administrators who demote each other through the procedures at once leave one', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        sqlite.run('DELETE FROM users');
        const [a, b] = [await addAccount('first', 'admin'), await addAccount('second', 'admin')];
        const [callerA, callerB] = [await callerOf(a), await callerOf(b)];
        const results = await Promise.allSettled([
          callerA.users.setRole({ id: b.id, role: 'user' }),
          callerB.users.setRole({ id: a.id, role: 'user' }),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        const refusal = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        expect(['BAD_REQUEST', 'FORBIDDEN', 'UNAUTHORIZED']).toContain(refusal?.reason.code);
        expect(activeAdministrators().length).toBe(1);
      }
    });

    test('users.setBanned and users.remove protect the last administrator the same way', async () => {
      for (const mutate of [
        (caller: UsersCaller, id: string) => caller.users.setBanned({ id, banned: true }),
        (caller: UsersCaller, id: string) => caller.users.remove({ id }),
      ]) {
        sqlite.run('DELETE FROM users');
        const [a, b] = [await addAccount('first', 'admin'), await addAccount('second', 'admin')];
        const [callerA, callerB] = [await callerOf(a), await callerOf(b)];
        const results = await Promise.allSettled([mutate(callerA, b.id), mutate(callerB, a.id)]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(['BAD_REQUEST', 'FORBIDDEN', 'UNAUTHORIZED']).toContain(
          results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason.code,
        );
        expect(activeAdministrators().length).toBe(1);
      }
    });

    test('users.create makes the account with the default role and then assigns the chosen one', async () => {
      addRole('auditor', 'Auditor');
      const caller = await callerOf(await addAccount('admin', 'admin'));
      const created = await caller.users.create({ name: 'Audrey', email: 'audrey@example.com', role: 'auditor' });
      expect(created.password.length).toBeGreaterThanOrEqual(12);
      expect(sqlite.query('SELECT role FROM users WHERE id = ?').get(created.id)).toEqual({ role: 'auditor' });

      const plain = await caller.users.create({ name: 'Una', email: 'una@example.com', role: 'user' });
      expect(roleOf(plain.id)).toBe('user');
    });

    test('a failure while assigning the role leaves the account on the default role', async () => {
      addRole('auditor', 'Auditor');
      const caller = await callerOf(await addAccount('admin', 'admin'));
      sqlite.run(
        "CREATE TRIGGER fail_role_change BEFORE UPDATE OF role ON users WHEN NEW.role = 'auditor' BEGIN SELECT RAISE(ABORT, 'disk on fire'); END",
      );

      await expect(caller.users.create({ name: 'Audrey', email: 'audrey@example.com', role: 'auditor' })).rejects.toBeInstanceOf(Error);
      expect(sqlite.query("SELECT role FROM users WHERE email = 'audrey@example.com'").get()).toEqual({ role: 'user' });
    });

    // `ghost` and `constructor` pass the zod pattern of the procedure, so they reach the guard: the first has no row, the
    // second is a key every object has, which the plugin would find in its compiled roles. Each leaves the account on the
    // default role, read back, and says why.
    test.each([
      ['ghost', 'No role has that id'],
      ['constructor', '"constructor" is reserved and cannot be a role id'],
    ])('users.create with the id %s leaves the account on the default role and says why', async (role, message) => {
      const caller = await callerOf(await addAccount('admin', 'admin'));
      const email = `${role}@example.com`;
      await expect(caller.users.create({ name: 'Gus', email, role })).rejects.toMatchObject({ code: 'BAD_REQUEST', message });
      expect(sqlite.query('SELECT role FROM users WHERE email = ?').get(email)).toEqual({ role: 'user' });
    });

    test.each([
      ['ghost', 'No role has that id'],
      ['constructor', '"constructor" is reserved and cannot be a role id'],
    ])('users.setRole with the id %s leaves the role as it was', async (role, message) => {
      const [admin, target] = [await addAccount('admin', 'admin'), await addAccount('target', 'manager')];
      await expect((await callerOf(admin)).users.setRole({ id: target.id, role })).rejects.toMatchObject({ code: 'BAD_REQUEST', message });
      expect(roleOf(target.id)).toBe('manager');
    });

    test('users.create refuses a role that is not one id before it creates anything', async () => {
      const caller = await callerOf(await addAccount('admin', 'admin'));
      for (const role of ['user,admin', 'Admin', 'admin ']) {
        await expect(caller.users.create({ name: 'Gus', email: 'gus@example.com', role })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      expect(sqlite.query("SELECT 1 FROM users WHERE email = 'gus@example.com'").get()).toBeNull();
    });

    test('users.assignableRoles lists admin and the roles of the database, to an administrator only', async () => {
      addRole('auditor', 'Auditor');
      sqlite.run("INSERT INTO roles (id, label) VALUES ('admin', 'Stored admin')");
      const [admin, member] = [await addAccount('admin', 'admin'), await addAccount('member', 'manager')];
      expect(await (await callerOf(admin)).users.assignableRoles()).toEqual([
        { id: 'admin', label: 'Admin' },
        { id: 'auditor', label: 'Auditor' },
        { id: 'manager', label: 'Manager' },
        { id: 'user', label: 'User' },
      ]);
      await expect((await callerOf(member)).users.assignableRoles()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
