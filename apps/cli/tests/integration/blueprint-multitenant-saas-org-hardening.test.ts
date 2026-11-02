import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgTable } from 'drizzle-orm/pg-core';
import { cleanupTempDir, createPostgresTable, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'multitenant-saas-nextjs';
const AUTH = 'packages/auth/src';
const API = 'packages/api/src';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';
const ONE_ROLE_ID = 'A role is one id of lowercase letters, digits and hyphens';

const REAL = {
  betterAuth: Bun.resolveSync('better-auth', import.meta.dir),
  plugins: Bun.resolveSync('better-auth/plugins', import.meta.dir),
  api: Bun.resolveSync('better-auth/api', import.meta.dir),
  access: Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
  organizationAccess: Bun.resolveSync('better-auth/plugins/organization/access', import.meta.dir),
  drizzleAdapter: Bun.resolveSync('@better-auth/drizzle-adapter', import.meta.dir),
  drizzle: Bun.resolveSync('drizzle-orm', import.meta.dir),
  pgCore: Bun.resolveSync('drizzle-orm/pg-core', import.meta.dir),
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  superjson: Bun.resolveSync('superjson', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
};

const TABLES = [
  'userTable',
  'userSessionTable',
  'userAccountTable',
  'userVerificationTable',
  'organizationTable',
  'memberTable',
  'invitationTable',
  'organizationRoleTable',
];

// What the module `@repo/db` is in the test: Drizzle, the generated tables, and `db`, which reads the database of the test
// running the way the module of a project reads the one of DATABASE_URL.
const DB_STUB = `export * from '${REAL.drizzle}';
export * from './schema.mjs';
export const db = new Proxy({}, { get: (_, property) => Reflect.get(globalThis.__orgDb, property) });`;

interface Answer {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
  message: string | undefined;
  logged: string[];
}

interface Auth {
  handler: (request: Request) => Promise<Response>;
}

interface Caller {
  role: { create: (input: { role: string; permission: Statement }) => Promise<unknown> };
  invitation: { list: () => Promise<{ id: string; email: string; role: string }[]> };
  member: {
    assignableRoles: () => Promise<string[]>;
    updateRole: (input: { memberId: string; role: string }) => Promise<unknown>;
  };
}

type Statement = Record<string, string[]>;

describe(`${BLUEPRINT} organization hardening`, () => {
  let tempDir: string;
  let schema: Record<string, PgTable>;
  let postgres: PGlite;
  let auth: Auth;
  let createAuth: () => Auth;
  let callerOf: (account: Account) => Promise<Caller>;
  let errorLog: ReturnType<typeof spyOn<Console, 'error'>>;
  let emails = 0;

  const run = (sql: string, params: unknown[] = []) => postgres.query(sql, params);
  const rows = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => (await postgres.query<T>(sql, params)).rows;
  const memberRole = async (userId: string) =>
    (await rows<{ role: string }>('SELECT role FROM members WHERE user_id = $1', [userId]))[0]?.role;

  interface Account {
    id: string;
    email: string;
    cookie: string;
  }

  async function request(account: Account | null, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<Answer> {
    errorLog.mockClear();
    const url = new URL(`${ORIGIN}/api/auth${path}`);
    if (method === 'GET') for (const [key, value] of Object.entries((payload ?? {}) as Record<string, string>)) url.searchParams.set(key, value);
    const response = await auth.handler(
      new Request(url.toString(), {
        method,
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          'x-forwarded-for': '10.0.0.1',
          ...(account ? { cookie: account.cookie } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(payload ?? {}) } : {}),
      }),
    );
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    return {
      status: response.status,
      json,
      message: json && !Array.isArray(json) ? (json.message as string | undefined) : undefined,
      logged: errorLog.mock.calls.map((call) => String(call[0])),
    };
  }

  async function signUp(name: string, address?: string): Promise<Account> {
    const email = address ?? `${name}${++emails}@example.com`;
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify({ name, email, password: PASSWORD }),
      }),
    );
    expect(response.status).toBe(200);
    const { user } = (await response.json()) as { user: { id: string } };
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    return { id: user.id, email, cookie };
  }

  async function createOrganization(owner: Account): Promise<string> {
    const answer = await request(owner, 'POST', '/organization/create', { name: 'Acme', slug: `acme-${++emails}` });
    expect(answer.status).toBe(200);
    return (answer.json as { id: string }).id;
  }

  async function addRole(organizationId: string, role: string, permission: Statement): Promise<void> {
    await run('INSERT INTO organization_roles (id, organization_id, role, permission) VALUES ($1, $2, $3, $4)', [
      crypto.randomUUID(),
      organizationId,
      role,
      JSON.stringify(permission),
    ]);
  }

  async function addMember(organizationId: string, name: string, role: string): Promise<Account> {
    const account = await signUp(name);
    await run('INSERT INTO members (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)', [
      crypto.randomUUID(),
      organizationId,
      account.id,
      role,
    ]);
    expect((await request(account, 'POST', '/organization/set-active', { organizationId })).status).toBe(200);
    return account;
  }

  const memberIdOf = async (userId: string) =>
    (await rows<{ id: string }>('SELECT id FROM members WHERE user_id = $1', [userId]))[0]?.id ?? '';

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = 'a-secret-for-the-tests-only-0123456789abcdef';
    process.env.BETTER_AUTH_URL = ORIGIN;
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, BLUEPRINT);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'db.mjs'), DB_STUB);

    const generated = async <T,>(file: string, name: string, imports: Record<string, string> = {}): Promise<T> =>
      evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports);

    schema = await generated('packages/db/src/schema.ts', 'schema.mjs', {
      'drizzle-orm': REAL.drizzle,
      'drizzle-orm/pg-core': REAL.pgCore,
    });
    const own = {
      '@repo/db': './db.mjs',
      './permissions': './permissions.mjs',
      './role-grants': './role-grants.mjs',
      './organization-guard': './organization-guard.mjs',
      './link-delivery': './link-delivery.mjs',
      './invitation-link': './invitation-link.mjs',
      './email-change-guard': './email-change-guard.mjs',
    };
    await generated(`${AUTH}/permissions.ts`, 'permissions.mjs', {
      'better-auth/plugins/access': REAL.access,
      'better-auth/plugins/organization/access': REAL.organizationAccess,
    });
    await generated(`${AUTH}/link-delivery.ts`, 'link-delivery.mjs');
    await generated(`${AUTH}/invitation-link.ts`, 'invitation-link.mjs');
    await generated(`${AUTH}/email-change-guard.ts`, 'email-change-guard.mjs', { ...own, 'better-auth/api': REAL.api });
    await generated(`${AUTH}/role-grants.ts`, 'role-grants.mjs', own);
    await generated(`${AUTH}/organization-guard.ts`, 'organization-guard.mjs', { ...own, 'better-auth/api': REAL.api });
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
      '@repo/auth/role-grants': './role-grants.mjs',
      '@repo/auth/invitation-link': './invitation-link.mjs',
      'drizzle-orm': REAL.drizzle,
      '../auth': './api-auth.mjs',
      './auth': './api-auth.mjs',
      '../trpc': './trpc.mjs',
      './auth-errors': './auth-errors.mjs',
      '../middleware/rbac': './rbac.mjs',
      superjson: REAL.superjson,
      zod: REAL.zod,
    };
    await Bun.write(join(stubs, 'api-auth.mjs'), "import { createAuth } from './auth.mjs';\nexport const auth = createAuth();");
    await generated(`${API}/auth-errors.ts`, 'auth-errors.mjs', { '@trpc/server': REAL.trpcServer });
    const trpc = await generated<{
      router: (procedures: Record<string, unknown>) => unknown;
      createTRPCContext: (options: { headers: Headers }) => Promise<unknown>;
    }>(`${API}/trpc.ts`, 'trpc.mjs', apiModules);
    await generated(`${API}/middleware/rbac.ts`, 'rbac.mjs', apiModules);
    const members = await generated<{ memberRouter: unknown }>(`${API}/router/member.ts`, 'member-router.mjs', apiModules);
    const invitations = await generated<{ invitationRouter: unknown }>(`${API}/router/invitation.ts`, 'invitation-router.mjs', apiModules);
    const roles = await generated<{ roleRouter: unknown }>(`${API}/router/role.ts`, 'role-router.mjs', apiModules);
    const appRouter = trpc.router({
      member: members.memberRouter,
      invitation: invitations.invitationRouter,
      role: roles.roleRouter,
    }) as { createCaller: (ctx: unknown) => Caller };
    callerOf = async (account) => appRouter.createCaller(await trpc.createTRPCContext({ headers: new Headers({ cookie: account.cookie }) }));

    postgres = new PGlite();
    for (const name of TABLES) await createPostgresTable(postgres, schema[name] as PgTable, { foreignKeys: true });
  });

  afterAll(async () => {
    await postgres.close();
    await cleanupTempDir(tempDir);
  });

  beforeEach(async () => {
    errorLog = spyOn(console, 'error').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'warn').mockImplementation(() => {});
    await postgres.exec('TRUNCATE users, user_sessions, user_accounts, user_verifications, organizations, members, invitations, organization_roles CASCADE');
    (globalThis as { __orgDb?: unknown }).__orgDb = drizzle(postgres, { schema });
    auth = createAuth();
  });

  afterEach(() => {
    errorLog.mockRestore();
    (console.log as unknown as { mockRestore?: () => void }).mockRestore?.();
    (console.warn as unknown as { mockRestore?: () => void }).mockRestore?.();
  });

  describe('assigning a role', () => {
    let organizationId: string;
    let owner: Account;
    let hr: Account;
    let peer: Account;
    let admin: Account;

    // `hr` holds member.update and reads projects. `manager` holds the project permissions `hr` lacks.
    beforeEach(async () => {
      owner = await signUp('owner');
      organizationId = await createOrganization(owner);
      await addRole(organizationId, 'hr', { member: ['update'], project: ['read'] });
      await addRole(organizationId, 'manager', { project: ['create', 'read', 'update', 'delete'] });
      hr = await addMember(organizationId, 'hr', 'hr');
      peer = await addMember(organizationId, 'peer', 'member');
      admin = await addMember(organizationId, 'admin', 'admin');
    });

    const assign = (caller: Account, target: Account, role: unknown) =>
      memberIdOf(target.id).then((memberId) => request(caller, 'POST', '/organization/update-member-role', { memberId, role, organizationId }));

    test('a role that holds member.update cannot give itself a stronger role', async () => {
      const answer = await assign(hr, hr, 'admin');
      expect(answer.status).toBe(403);
      expect(await memberRole(hr.id)).toBe('hr');
    });

    test('it cannot give anyone a role with a permission it does not hold, a built-in one included', async () => {
      for (const role of ['admin', 'manager']) {
        expect((await assign(hr, peer, role)).status, role).toBe(403);
        expect(await memberRole(peer.id), role).toBe('member');
      }
    });

    test('it can still give a role whose permissions it holds, its own included', async () => {
      expect((await assign(hr, peer, 'hr')).status).toBe(200);
      expect(await memberRole(peer.id)).toBe('hr');
      expect((await assign(hr, peer, 'member')).status).toBe(200);
      expect(await memberRole(peer.id)).toBe('member');
    });

    test('an admin gives admin, never owner, and the owner gives any role', async () => {
      expect((await assign(admin, peer, 'admin')).status).toBe(200);
      expect((await assign(admin, peer, 'manager')).status).toBe(200);
      expect((await assign(admin, peer, 'owner')).status).toBe(403);
      expect(await memberRole(peer.id)).toBe('manager');
      for (const role of ['admin', 'hr', 'owner', 'member']) {
        expect((await assign(owner, peer, role)).status, role).toBe(200);
        expect(await memberRole(peer.id), role).toBe(role);
      }
    });

    test('the procedure of the interface meets the same rule, and lists only the roles the caller may give', async () => {
      const memberId = await memberIdOf(peer.id);
      await expect((await callerOf(hr)).member.updateRole({ memberId, role: 'admin' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await memberRole(peer.id)).toBe('member');
      expect((await (await callerOf(hr)).member.assignableRoles()).sort()).toEqual(['hr', 'member']);
      expect((await (await callerOf(admin)).member.assignableRoles()).sort()).toEqual(['admin', 'hr', 'manager', 'member']);
      expect((await (await callerOf(owner)).member.assignableRoles()).sort()).toEqual(['admin', 'hr', 'manager', 'member', 'owner']);
    });

    test('a refusal is an answer: it logs no error and names no table or column', async () => {
      const answer = await assign(hr, hr, 'admin');
      expect(answer.logged).toEqual([]);
      expect(answer.message).toBeString();
      expect(answer.message).not.toMatch(/does not exist|table|column/i);
    });

    describe('an invitation', () => {
      let inviter: Account;

      const invite = (caller: Account, role: unknown, email = `new${++emails}@example.com`) =>
        request(caller, 'POST', '/organization/invite-member', { email, role, organizationId });
      const pendingRoles = async () => (await rows<{ role: string }>("SELECT role FROM invitations WHERE status = 'pending'")).map((row) => row.role);

      beforeEach(async () => {
        await addRole(organizationId, 'inviter', { invitation: ['create', 'cancel'], project: ['read'] });
        inviter = await addMember(organizationId, 'inviter', 'inviter');
      });

      test('cannot carry a role stronger than the one of the member who sends it', async () => {
        for (const role of ['admin', 'manager', 'hr']) {
          expect((await invite(inviter, role)).status, role).toBe(403);
        }
        expect(await pendingRoles()).toEqual([]);
      });

      test('carries a role the sender holds, and the owner can send any', async () => {
        expect((await invite(inviter, 'member')).status).toBe(200);
        expect((await invite(inviter, 'inviter')).status).toBe(200);
        for (const role of ['admin', 'manager', 'hr']) expect((await invite(owner, role)).status, role).toBe(200);
        expect((await pendingRoles()).sort()).toEqual(['admin', 'hr', 'inviter', 'manager', 'member']);
      });
    });

    describe('a role definition', () => {
      let editor: Account;

      const create = (caller: Account, role: string, permission: Statement) =>
        request(caller, 'POST', '/organization/create-role', { role, permission, organizationId });
      const update = (caller: Account, roleName: string, permission: Statement) =>
        request(caller, 'POST', '/organization/update-role', { roleName, data: { permission }, organizationId });
      const storedPermission = async (role: string) =>
        (await rows<{ permission: string }>('SELECT permission FROM organization_roles WHERE role = $1', [role]))[0]?.permission;

      beforeEach(async () => {
        await addRole(organizationId, 'editor', { ac: ['create', 'read', 'update'], project: ['read'] });
        editor = await addMember(organizationId, 'editor', 'editor');
      });

      test('cannot be created with a permission its author does not hold', async () => {
        expect((await create(editor, 'sneaky', { member: ['update'] })).status).toBe(403);
        expect(await storedPermission('sneaky')).toBeUndefined();
        expect((await create(editor, 'reader', { project: ['read'] })).status).toBe(200);
      });

      test('cannot be edited to hold a permission its editor does not hold, the editor own role included', async () => {
        expect((await update(editor, 'editor', { ac: ['update'], member: ['update'] })).status).toBe(403);
        expect((await update(editor, 'hr', { member: ['update'], project: ['delete'] })).status).toBe(403);
        expect(JSON.parse((await storedPermission('editor')) ?? '{}')).toEqual({ ac: ['create', 'read', 'update'], project: ['read'] });
        expect(JSON.parse((await storedPermission('hr')) ?? '{}')).toEqual({ member: ['update'], project: ['read'] });
      });
    });

    test('every endpoint that gives a role answers 400 to a value that is not the id of one existing role', async () => {
      const values: [unknown, string][] = [
        [['member', 'admin'], ONE_ROLE_ID],
        ['member,admin', ONE_ROLE_ID],
        ['', ONE_ROLE_ID],
        ['constructor', ONE_ROLE_ID],
        ['Admin', ONE_ROLE_ID],
        [123, ONE_ROLE_ID],
        ['ghost', 'No role has that id'],
      ];
      for (const [role, message] of values) {
        const memberId = await memberIdOf(peer.id);
        const update = await request(owner, 'POST', '/organization/update-member-role', { memberId, role, organizationId });
        const invitation = await request(owner, 'POST', '/organization/invite-member', { email: `x${++emails}@example.com`, role, organizationId });
        for (const answer of [update, invitation]) {
          expect([JSON.stringify(role), answer.status]).toEqual([JSON.stringify(role), 400]);
          expect([JSON.stringify(role), answer.message]).toEqual([JSON.stringify(role), message]);
          expect(answer.logged).toEqual([]);
        }
      }
      expect(await memberRole(peer.id)).toBe('member');
      expect(await rows('SELECT id FROM invitations')).toEqual([]);
    });
  });

  describe('renaming a role', () => {
    let organizationId: string;
    let owner: Account;
    let holder: Account;

    const rename = (roleName: string, newName: string) =>
      request(owner, 'POST', '/organization/update-role', { roleName, data: { roleName: newName }, organizationId });
    const canReadProjects = async (account: Account) =>
      (await request(account, 'POST', '/organization/has-permission', { permissions: { project: ['read'] }, organizationId })).json;
    const storedRoles = async () =>
      (await rows<{ role: string }>('SELECT role FROM organization_roles ORDER BY role')).map((row) => row.role);

    beforeEach(async () => {
      owner = await signUp('owner');
      organizationId = await createOrganization(owner);
      expect((await request(owner, 'POST', '/organization/create-role', { role: 'ops', permission: { project: ['read'] }, organizationId })).status).toBe(200);
      holder = await addMember(organizationId, 'holder', 'ops');
    });

    test('is refused, so the members and the invitations that hold the role keep their access', async () => {
      const invited = await request(owner, 'POST', '/organization/invite-member', { email: 'ops-new@example.com', role: 'ops', organizationId });
      expect(invited.status).toBe(200);

      const answer = await rename('ops', 'operations');
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.logged).toEqual([]);
      expect(answer.message).not.toMatch(/does not exist|table|column/i);

      expect(await storedRoles()).toEqual(['ops']);
      expect(await memberRole(holder.id)).toBe('ops');
      expect(await canReadProjects(holder)).toEqual({ error: null, success: true });
      expect((await rows<{ role: string }>("SELECT role FROM invitations WHERE status = 'pending'")).map((row) => row.role)).toEqual(['ops']);
    });

    test('is refused for a role nobody holds too: the name is what members and invitations store', async () => {
      await run('UPDATE members SET role = $1 WHERE user_id = $2', ['member', holder.id]);
      expect((await rename('ops', 'operations')).status).toBeGreaterThanOrEqual(400);
      expect(await storedRoles()).toEqual(['ops']);
    });

    test('leaves the permissions of a role editable while the role is held', async () => {
      const update = await request(owner, 'POST', '/organization/update-role', {
        roleName: 'ops',
        data: { permission: { project: ['read', 'update'] } },
        organizationId,
      });
      expect(update.status).toBe(200);
      expect(await canReadProjects(holder)).toEqual({ error: null, success: true });
    });
  });
  describe('naming a role', () => {
    let organizationId: string;
    let owner: Account;

    const create = (role: unknown) =>
      request(owner, 'POST', '/organization/create-role', { role, permission: { project: ['read'] }, organizationId });
    const storedRoles = async () =>
      (await rows<{ role: string }>('SELECT role FROM organization_roles ORDER BY role')).map((row) => row.role);

    beforeEach(async () => {
      owner = await signUp('owner');
      organizationId = await createOrganization(owner);
    });

    test('accepts one id of lowercase letters, digits and hyphens', async () => {
      for (const role of ['ops', 'ops-2', '2fa', 'x'.repeat(40)]) expect((await create(role)).status, role).toBe(200);
      expect(await storedRoles()).toEqual(['2fa', 'ops', 'ops-2', 'x'.repeat(40)].sort());
    });

    test('refuses a name that is not one id, and stores nothing', async () => {
      const names: [string, unknown][] = [
        ['a space', 'ops team'],
        ['a comma', 'ops,team'],
        ['capitals', 'Ops'],
        ['a key every object has', 'constructor'],
        ['the prototype accessor', '__proto__'],
        ['more than 40 characters', 'x'.repeat(41)],
        ['nothing', ''],
        ['a number', 7],
        ['a built-in role', 'admin'],
      ];
      for (const [label, role] of names) {
        const answer = await create(role);
        expect(answer.status, label).toBeGreaterThanOrEqual(400);
        expect(answer.message, label).not.toMatch(/does not exist|table|column/i);
      }
      expect(await storedRoles()).toEqual([]);
    });

    test('the procedure of the role form refuses it with the same words', async () => {
      await expect((await callerOf(owner)).role.create({ role: 'ops team', permission: { project: ['read'] } })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: ONE_ROLE_ID,
      });
      expect(await storedRoles()).toEqual([]);
    });

    test('the refusal of a name the form should have caught is an answer, not an error in the log', async () => {
      const answer = await create('ops team');
      expect(answer.logged).toEqual([]);
      expect(answer.status).toBe(400);
      expect(answer.message).toBe(ONE_ROLE_ID);
    });
  });
  // An organization with the owner, a member of each kind of role and the roles the cases below need: `hr` holds
  // member.update, `mdel` member.delete, `sender` invitation.create, `inviter` invitation.create and cancel, `canceler`
  // invitation.cancel, `editor` the role definitions, `manager` the project actions. Each holds project.read too.
  async function organizationWithStaff() {
    const owner = await signUp('owner');
    const organizationId = await createOrganization(owner);
    const READ = { project: ['read'] };
    await addRole(organizationId, 'hr', { member: ['update'], ...READ });
    await addRole(organizationId, 'mdel', { member: ['delete'], ...READ });
    await addRole(organizationId, 'sender', { invitation: ['create'], ...READ });
    await addRole(organizationId, 'inviter', { invitation: ['create', 'cancel'], ...READ });
    await addRole(organizationId, 'canceler', { invitation: ['cancel'], ...READ });
    await addRole(organizationId, 'editor', { ac: ['create', 'read', 'update', 'delete'], ...READ });
    await addRole(organizationId, 'manager', { project: ['create', 'read', 'update', 'delete'] });
    const staff: Record<string, Account> = {};
    for (const role of ['hr', 'mdel', 'sender', 'inviter', 'canceler', 'editor', 'manager', 'admin', 'member']) {
      staff[role] = await addMember(organizationId, role, role);
    }
    return { owner, organizationId, staff };
  }

  const storedPermission = async (role: string) =>
    JSON.parse((await rows<{ permission: string }>('SELECT permission FROM organization_roles WHERE role = $1', [role]))[0]?.permission ?? 'null');

  describe('a request the guard has to place', () => {
    let organizationId: string;
    let owner: Account;
    let staff: Record<string, Account>;

    beforeEach(async () => {
      ({ owner, organizationId, staff } = await organizationWithStaff());
    });

    const post = (caller: Account | undefined, path: string, body: unknown) => request(caller ?? null, 'POST', path, body);
    const who = (role: string): Account => staff[role] as Account;

    test('an empty organization id names the active organization, on every endpoint the guard covers', async () => {
      const attempts: [string, Answer][] = [
        ['update-member-role', await post(who('hr'), '/organization/update-member-role', { memberId: await memberIdOf(who('hr').id), role: 'admin', organizationId: '' })],
        ['invite-member', await post(who('sender'), '/organization/invite-member', { email: 'a@example.com', role: 'admin', organizationId: '' })],
        ['invite-member with a list', await post(who('sender'), '/organization/invite-member', { email: 'b@example.com', role: ['member', 'admin'], organizationId: '' })],
        ['remove-member', await post(who('mdel'), '/organization/remove-member', { memberIdOrEmail: await memberIdOf(who('admin').id), organizationId: '' })],
        ['create-role', await post(who('editor'), '/organization/create-role', { role: 'ops team', permission: { project: ['read'] }, organizationId: '' })],
        ['update-role', await post(who('editor'), '/organization/update-role', { roleName: 'manager', data: { permission: {} }, organizationId: '' })],
        ['delete-role', await post(who('editor'), '/organization/delete-role', { roleName: 'manager', organizationId: '' })],
      ];
      for (const [label, answer] of attempts) expect([label, answer.status >= 400 && answer.status < 500]).toEqual([label, true]);
      expect(await memberRole(who('hr').id)).toBe('hr');
      expect(await memberRole(who('admin').id)).toBe('admin');
      expect(await rows('SELECT id FROM invitations')).toEqual([]);
      expect(await storedPermission('manager')).toEqual({ project: ['create', 'read', 'update', 'delete'] });
    });

    test('a request that names no organization and has no active one is refused, never passed on', async () => {
      const lost = await signUp('lost');
      const answer = await post(lost, '/organization/invite-member', { email: 'c@example.com', role: 'member' });
      expect([answer.status, answer.message]).toEqual([400, 'No active organization']);
      const outsider = await post(lost, '/organization/update-member-role', { memberId: 'x', role: 'member', organizationId });
      expect([outsider.status, outsider.message]).toEqual([403, 'You are not a member of this organization']);
    });

    test('a role that holds member.update changes only members whose permissions it holds', async () => {
      const hr = who('hr');
      for (const stronger of ['admin', 'manager']) {
        const target = who(stronger);
        const answer = await post(hr, '/organization/update-member-role', { memberId: await memberIdOf(target.id), role: 'member', organizationId });
        expect([stronger, answer.status]).toEqual([stronger, 403]);
        expect(await memberRole(target.id)).toBe(stronger);
      }
      const peer = who('member');
      const lowered = await post(hr, '/organization/update-member-role', { memberId: await memberIdOf(peer.id), role: 'hr', organizationId });
      expect(lowered.status).toBe(200);
      expect(await memberRole(peer.id)).toBe('hr');
      const self = await post(hr, '/organization/update-member-role', { memberId: await memberIdOf(hr.id), role: 'member', organizationId });
      expect(self.status).toBe(200);
    });

    test('a role that holds member.delete removes only members whose permissions it holds, and anyone can leave', async () => {
      const mdel = who('mdel');
      for (const stronger of ['admin', 'manager']) {
        const target = who(stronger);
        const byId = await post(mdel, '/organization/remove-member', { memberIdOrEmail: await memberIdOf(target.id), organizationId });
        const byEmail = await post(mdel, '/organization/remove-member', { memberIdOrEmail: target.email, organizationId });
        expect([stronger, byId.status, byEmail.status]).toEqual([stronger, 403, 403]);
        expect(await memberRole(target.id)).toBe(stronger);
      }
      const peer = who('member');
      expect((await post(mdel, '/organization/remove-member', { memberIdOrEmail: peer.email, organizationId })).status).toBe(200);
      expect(await memberRole(peer.id)).toBeUndefined();

      expect((await post(who('canceler'), '/organization/leave', { organizationId })).status).toBe(200);
      expect((await post(mdel, '/organization/remove-member', { memberIdOrEmail: await memberIdOf(mdel.id), organizationId })).status).toBe(200);
      expect((await post(owner, '/organization/remove-member', { memberIdOrEmail: await memberIdOf(who('admin').id), organizationId })).status).toBe(200);
    });

    test('a role that holds ac.update changes and deletes only the stored roles whose permissions it holds', async () => {
      const editor = who('editor');
      const manager = { project: ['create', 'read', 'update', 'delete'] };
      const emptied = await post(editor, '/organization/update-role', { roleName: 'manager', data: { permission: {} }, organizationId });
      const byId = await post(editor, '/organization/update-role', {
        roleId: (await rows<{ id: string }>("SELECT id FROM organization_roles WHERE role = 'manager'"))[0]?.id,
        data: { permission: {} },
        organizationId,
      });
      const deleted = await post(editor, '/organization/delete-role', { roleName: 'manager', organizationId });
      expect([emptied.status, byId.status, deleted.status]).toEqual([403, 403, 403]);
      expect(await storedPermission('manager')).toEqual(manager);

      expect((await post(editor, '/organization/create-role', { role: 'reader', permission: { project: ['read'] }, organizationId })).status).toBe(200);
      expect((await post(editor, '/organization/update-role', { roleName: 'reader', data: { permission: {} }, organizationId })).status).toBe(200);
      expect((await post(editor, '/organization/delete-role', { roleName: 'reader', organizationId })).status).toBe(200);
      expect((await post(owner, '/organization/update-role', { roleName: 'manager', data: { permission: { project: ['read'] } }, organizationId })).status).toBe(200);
    });

    test('a stored role whose permissions cannot be read is never given, and the member keeps its role', async () => {
      const peer = who('member');
      for (const [role, permission] of [
        ['broken-text', 'not json'],
        ['broken-list', '[1]'],
        ['broken-shape', '{"project":"read"}'],
      ] as const) {
        await run('INSERT INTO organization_roles (id, organization_id, role, permission) VALUES ($1, $2, $3, $4)', [crypto.randomUUID(), organizationId, role, permission]);
        const answer = await post(owner, '/organization/update-member-role', { memberId: await memberIdOf(peer.id), role, organizationId });
        expect([role, answer.status, answer.message]).toEqual([role, 400, 'No role has that id']);
        expect(await memberRole(peer.id)).toBe('member');
      }
    });

    test('a member with a stored list of roles gives a role the roles of the list hold together', async () => {
      const hr = who('hr');
      await run("UPDATE members SET role = 'hr,sender' WHERE user_id = $1", [hr.id]);
      await addRole(organizationId, 'both', { member: ['update'], invitation: ['create'] });
      const peer = who('member');
      const given = await post(hr, '/organization/update-member-role', { memberId: await memberIdOf(peer.id), role: 'both', organizationId });
      expect(given.status).toBe(200);
      expect(await memberRole(peer.id)).toBe('both');
      const stronger = await post(hr, '/organization/update-member-role', { memberId: await memberIdOf(peer.id), role: 'admin', organizationId });
      expect(stronger.status).toBe(403);
    });

  });

  describe('two organizations', () => {
    let owner: Account;
    let traveller: Account;
    let organizationA: string;
    let organizationB: string;

    const insertMember = (organizationId: string, userId: string, role: string) =>
      run('INSERT INTO members (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)', [crypto.randomUUID(), organizationId, userId, role]);

    beforeEach(async () => {
      owner = await signUp('owner');
      organizationA = await createOrganization(owner);
      organizationB = await createOrganization(owner);
      traveller = await signUp('traveller');
      await insertMember(organizationA, traveller.id, 'admin');
      await addRole(organizationB, 'hrb', { member: ['update'], invitation: ['create'], project: ['read'] });
      await insertMember(organizationB, traveller.id, 'hrb');
      expect((await request(traveller, 'POST', '/organization/set-active', { organizationId: organizationA })).status).toBe(200);
    });

    const memberIn = async (organizationId: string, role: string) => {
      const account = await signUp(role);
      await insertMember(organizationId, account.id, role);
      return account;
    };

    test('the roles of the organization a request names decide, not those of the active one', async () => {
      const target = await memberIn(organizationB, 'member');
      const memberId = await memberIdOf(target.id);
      const giveAdmin = await request(traveller, 'POST', '/organization/update-member-role', { memberId, role: 'admin', organizationId: organizationB });
      const inviteAdmin = await request(traveller, 'POST', '/organization/invite-member', { email: 'x@example.com', role: 'admin', organizationId: organizationB });
      expect([giveAdmin.status, inviteAdmin.status]).toEqual([403, 403]);
      expect(await memberRole(target.id)).toBe('member');

      const inA = await memberIn(organizationA, 'member');
      const inOwn = await request(traveller, 'POST', '/organization/update-member-role', { memberId: await memberIdOf(inA.id), role: 'admin', organizationId: organizationA });
      expect(inOwn.status).toBe(200);
    });

    test('a role name of another organization decides nothing, lists nothing and leaks nothing', async () => {
      await addRole(organizationB, 'ops', { project: ['read', 'delete'], member: ['update', 'delete'] });
      await addRole(organizationB, 'secret-b', { project: ['read'] });
      await addRole(organizationA, 'ops', { project: ['read'] });
      await addRole(organizationA, 'hra', { member: ['update'], invitation: ['create'], project: ['read'] });
      const hra = await memberIn(organizationA, 'hra');
      expect((await request(hra, 'POST', '/organization/set-active', { organizationId: organizationA })).status).toBe(200);
      const peer = await memberIn(organizationA, 'member');

      const given = await request(hra, 'POST', '/organization/update-member-role', { memberId: await memberIdOf(peer.id), role: 'ops', organizationId: organizationA });
      expect(given.status).toBe(200);
      expect(await memberRole(peer.id)).toBe('ops');
      const unknown = await request(hra, 'POST', '/organization/update-member-role', { memberId: await memberIdOf(peer.id), role: 'secret-b', organizationId: organizationA });
      expect(unknown.message).toBe('No role has that id');

      const offered = await (await callerOf(hra)).member.assignableRoles();
      expect(offered.sort()).toEqual(['hra', 'member', 'ops']);
    });
  });
});
