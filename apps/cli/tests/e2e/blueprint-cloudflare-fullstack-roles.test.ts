import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  generateInstalledProject,
  getFreePort,
  type RunningServer,
  runCommand,
  startServer,
} from './helpers';
import { cookieHeaderOf } from './set-cookie';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_SETUP = 240_000;
const TIMEOUT_SERVER = 120_000;

const SEED_PASSWORD = 'password';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';

// The seeded accounts: admin, manager (role `manager`) and user (role `user`).
const ADMIN = 'admin@example.com';
const MANAGER = 'manager@example.com';
const MEMBER = 'user@example.com';

const describeFailure = (result: CommandResult): string => `${result.stdout}\n${result.stderr}`;

let clientNumber = 0;

// The Documents entry of the sidebar, which the page title and the breadcrumb of the same page do not match.
const DOCUMENTS_LINK = /<a\b[^>]*data-sidebar="menu-button"[^>]*href="\/"|<a\b[^>]*href="\/"[^>]*data-sidebar="menu-button"/;

describe('cloudflare-fullstack-nextjs roles read from the database, on a served project with the local D1', () => {
  let projectDir: string;
  let webDir: string;
  let server: RunningServer;

  const d1 = async (sql: string): Promise<Record<string, unknown>[]> => {
    const result = await runCommand(
      ['bunx', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', join(projectDir, '.wrangler'), '--json', '--command', sql],
      webDir,
    );
    expect(result.exitCode, describeFailure(result)).toBe(0);
    const [statement] = JSON.parse(result.stdout) as { results: Record<string, unknown>[] }[];
    return statement?.results ?? [];
  };

  const signIn = async (email: string): Promise<string> => {
    const response = await fetch(new URL('/api/auth/sign-in/email', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url, 'x-forwarded-for': `10.9.0.${++clientNumber}` },
      body: JSON.stringify({ email, password: SEED_PASSWORD }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return cookieHeaderOf(response);
  };

  // The tRPC endpoint speaks superjson: a query is a GET with its input in the URL, wrapped as superjson wraps it.
  const query = async (procedure: string, cookie: string, input?: unknown): Promise<{ status: number; data?: unknown }> => {
    const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const response = await fetch(new URL(`/api/trpc/${procedure}${search}`, server.url), { headers: { cookie } });
    if (response.status !== 200) return { status: response.status };
    const body = (await response.json()) as { result: { data: { json: unknown } } };
    return { status: 200, data: body.result.data.json };
  };


  // A POST to the Better Auth endpoints, as a browser sends it: the origin of the app and the session cookie.
  const authPost = async (path: string, cookie: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    const response = await fetch(new URL(`/api/auth${path}`, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url, cookie, 'x-forwarded-for': `10.9.1.${++clientNumber}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  };

  // A tRPC mutation is a POST with its input wrapped as superjson wraps it.
  const mutate = async (procedure: string, cookie: string, input: unknown): Promise<{ status: number; message?: string; data?: unknown }> => {
    const response = await fetch(new URL(`/api/trpc/${procedure}`, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ json: input }),
    });
    const body = (await response.json()) as { result?: { data: { json: unknown } }; error?: { json: { message: string } } };
    return { status: response.status, message: body.error?.json.message, data: body.result?.data.json };
  };

  // Runs every statement even when one fails, so a failed cleanup never leaves the rest of the state unrestored, and
  // then reports the first failure.
  const restore = async (...statements: string[]): Promise<void> => {
    const failures: unknown[] = [];
    for (const statement of statements) {
      try {
        await d1(statement);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  };

  const idOf = async (email: string): Promise<string> => String((await d1(`SELECT id FROM users WHERE email = '${email}'`))[0]?.id);
  const roleOf = async (email: string): Promise<unknown> => (await d1(`SELECT role FROM users WHERE email = '${email}'`))[0]?.role;

  // A throwaway account that signs up like anyone, so no seeded account has to be banned or removed.
  const signUp = async (email: string, role: string): Promise<string> => {
    const response = await fetch(new URL('/api/auth/sign-up/email', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url, 'x-forwarded-for': `10.9.2.${++clientNumber}` },
      body: JSON.stringify({ email, password: SEED_PASSWORD, name: email.split('@')[0] }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    await d1(`UPDATE users SET role = '${role}' WHERE email = '${email}'`);
    return idOf(email);
  };

  const page = async (path: string, cookie: string): Promise<{ status: number; html: string; location: string | null }> => {
    const response = await fetch(new URL(path, server.url), { redirect: 'manual', headers: { cookie } });
    return { status: response.status, html: await response.text(), location: response.headers.get('location') };
  };

  const upload = async (cookie: string): Promise<number> => {
    const form = new FormData();
    form.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
    form.set('title', 'hello');
    const response = await fetch(new URL('/api/documents/upload', server.url), { method: 'POST', headers: { cookie }, body: form });
    return response.status;
  };

  beforeAll(async () => {
    projectDir = await generateInstalledProject('bp-roles-cloudflare', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    webDir = join(projectDir, 'apps/web');
    const setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
    expect(setup.exitCode, describeFailure(setup)).toBe(0);

    const port = await getFreePort();
    const envPath = join(webDir, '.env');
    const kept = (await readFile(envPath, 'utf8')).split('\n').filter((line) => line && !line.startsWith('BETTER_AUTH_'));
    const origin = `http://127.0.0.1:${port}`;
    await writeFile(envPath, `${[...kept, `BETTER_AUTH_SECRET=${AUTH_SECRET}`, `BETTER_AUTH_URL=${origin}`].join('\n')}\n`);
    server = await startServer(['bunx', 'next', 'dev', '-p', String(port)], webDir, {
      port,
      readyPath: '/login',
      readyTimeout: TIMEOUT_SERVER,
    });
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP + TIMEOUT_SERVER);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('local-setup wrote the default roles, and the defaults command run again changes nothing', async () => {
    const before = await d1('SELECT role_id, resource, action FROM role_permissions ORDER BY role_id, resource, action');
    expect(before.map((row) => `${row.role_id}.${row.action}`)).toEqual([
      'manager.read',
      'manager.read-any',
      'user.create',
      'user.delete',
      'user.read',
      'user.update',
    ]);

    const again = await runCommand(['bun', 'run', 'db:roles'], projectDir);
    expect(again.exitCode, describeFailure(again)).toBe(0);
    expect(again.stdout).toContain('already has roles');
    expect(await d1('SELECT role_id, resource, action FROM role_permissions ORDER BY role_id, resource, action')).toEqual(before);
  }, TIMEOUT_SETUP);

  test('the server resolves the permission list of each caller, a non-admin included', async () => {
    const admin = await query('permissions.mine', await signIn(ADMIN));
    expect(admin.status).toBe(200);
    expect(admin.data).toEqual(expect.arrayContaining(['document.create', 'document.read', 'document.update', 'document.delete', 'user.list']));

    const manager = await query('permissions.mine', await signIn(MANAGER));
    expect((manager.data as string[]).sort()).toEqual(['document.read', 'document.read-any']);
    const member = await query('permissions.mine', await signIn(MEMBER));
    expect((member.data as string[]).sort()).toEqual(['document.create', 'document.delete', 'document.read', 'document.update']);
    expect((await query('permissions.mine', '')).status).toBe(401);
  });

  test('the first render of the sidebar and of the buttons is already right for a non-admin', async () => {
    const manager = await page('/', await signIn(MANAGER));
    expect(manager.status).toBe(200);
    expect(manager.html).toMatch(DOCUMENTS_LINK);
    expect(manager.html).not.toContain('/admin/users');
    expect(manager.html).not.toContain('type="file"');

    const member = await page('/', await signIn(MEMBER));
    expect(member.html).toContain('type="file"');
    expect(member.html).not.toContain('/admin/users');

    const admin = await page('/', await signIn(ADMIN));
    expect(admin.html).toContain('/admin/users');
    expect(admin.html).toContain('/admin/roles');
  });

  test('a non-admin is refused account administration', async () => {
    const cookie = await signIn(MANAGER);
    expect((await query('users.list', cookie, {})).status).toBe(403);
    expect(await page('/admin/users', cookie)).toMatchObject({ status: 307, location: expect.stringMatching(/\/$/) });
  });

  test('a stored row naming user or session is not part of what the server says the caller may do', async () => {
    const cookie = await signIn(MANAGER);
    await d1("PRAGMA foreign_keys = OFF; INSERT INTO role_permissions (role_id, resource, action) VALUES ('manager', 'user', 'list'), ('manager', 'session', 'list')");
    try {
      expect(await query('permissions.mine', cookie)).toEqual({ status: 200, data: ['document.read', 'document.read-any'] });
    } finally {
      await d1("DELETE FROM role_permissions WHERE resource IN ('user', 'session')");
    }
  });

  test('a revocation written to the database is refused on the next request, and the defaults command does not undo it', async () => {
    const cookie = await signIn(MANAGER);
    expect((await query('documents.list', cookie, { page: 1, pageSize: 10 })).status).toBe(200);

    await d1("DELETE FROM role_permissions WHERE role_id = 'manager' AND action = 'read'");
    try {
      expect((await query('documents.list', cookie, { page: 1, pageSize: 10 })).status).toBe(403);
      expect(await query('permissions.mine', cookie)).toEqual({ status: 200, data: ['document.read-any'] });

      const noAccess = await page('/', cookie);
      expect(noAccess.status).toBe(200);
      expect(noAccess.html).toContain('Your role has no access to documents.');
      expect(noAccess.html).not.toMatch(DOCUMENTS_LINK);

      const rerun = await runCommand(['bun', 'run', 'db:roles'], projectDir);
      expect(rerun.exitCode, describeFailure(rerun)).toBe(0);
      expect((await query('documents.list', cookie, { page: 1, pageSize: 10 })).status).toBe(403);
    } finally {
      await d1("INSERT INTO role_permissions (role_id, resource, action) VALUES ('manager', 'document', 'read')");
    }
    expect((await query('documents.list', cookie, { page: 1, pageSize: 10 })).status).toBe(200);
  }, TIMEOUT_SETUP);

  test('the upload route follows document.create from the database', async () => {
    const memberCookie = await signIn(MEMBER);
    expect(await upload(await signIn(MANAGER))).toBe(403);
    expect(await upload(memberCookie)).toBe(200);

    await d1("DELETE FROM role_permissions WHERE role_id = 'user' AND action = 'create'");
    try {
      expect(await upload(memberCookie)).toBe(403);
    } finally {
      await d1("INSERT INTO role_permissions (role_id, resource, action) VALUES ('user', 'document', 'create')");
    }
  });

  test('a role the database does not know holds nothing, though its session stays valid', async () => {
    const cookie = await signIn(MEMBER);
    await d1("UPDATE users SET role = 'ghost' WHERE email = 'user@example.com'");
    try {
      expect((await query('documents.list', cookie, { page: 1, pageSize: 10 })).status).toBe(403);
      expect(await query('permissions.mine', cookie)).toEqual({ status: 200, data: [] });
      expect(await upload(cookie)).toBe(403);
    } finally {
      await d1("UPDATE users SET role = 'user' WHERE email = 'user@example.com'");
    }
    expect((await query('documents.list', cookie, { page: 1, pageSize: 10 })).status).toBe(200);
  });
  test('the defaults command does not write back a default role an operator deleted', async () => {
    await d1("DELETE FROM roles WHERE id = 'manager'");
    try {
      const rerun = await runCommand(['bun', 'run', 'db:roles'], projectDir);
      expect(rerun.exitCode, describeFailure(rerun)).toBe(0);
      expect(await d1('SELECT id FROM roles')).toEqual([{ id: 'user' }]);
      expect(await query('permissions.mine', await signIn(MANAGER))).toEqual({ status: 200, data: [] });
    } finally {
      await d1(
        "INSERT INTO roles (id, label) VALUES ('manager', 'Manager'); INSERT INTO role_permissions (role_id, resource, action) VALUES ('manager', 'document', 'read'), ('manager', 'document', 'read-any')",
      );
    }
  }, TIMEOUT_SETUP);

  test('read-any decides which documents a role sees, whatever the role is called', async () => {
    const cookie = await signIn(MANAGER);
    const [all] = await d1('SELECT count(*) AS n FROM documents');
    expect((await query('documents.count', cookie)).data).toBe(all?.n);
    const [own] = await d1("SELECT count(*) AS n FROM documents WHERE user_id = (SELECT id FROM users WHERE email = 'manager@example.com')");

    await d1("DELETE FROM role_permissions WHERE role_id = 'manager' AND action = 'read-any'");
    try {
      expect((await query('documents.count', cookie)).data).toBe(own?.n);
    } finally {
      await d1("INSERT INTO role_permissions (role_id, resource, action) VALUES ('manager', 'document', 'read-any')");
    }
    expect((await query('documents.count', cookie)).data).toBe(all?.n);
  });

  describe('assigning roles and the last administrator', () => {
    test('an administrator assigns a role created in the database, through the procedures and the plugin endpoint', async () => {
      await d1("INSERT INTO roles (id, label) VALUES ('auditor', 'Auditor')");
      const adminCookie = await signIn(ADMIN);
      const memberId = await idOf(MEMBER);
      try {
        expect((await query('users.assignableRoles', adminCookie)).data).toEqual([
          { id: 'admin', label: 'Admin' },
          { id: 'auditor', label: 'Auditor' },
          { id: 'manager', label: 'Manager' },
          { id: 'user', label: 'User' },
        ]);
        expect((await query('users.assignableRoles', await signIn(MANAGER))).status).toBe(403);

        expect((await mutate('users.setRole', adminCookie, { id: memberId, role: 'auditor' })).status).toBe(200);
        expect(await roleOf(MEMBER)).toBe('auditor');
        const auditor = await query('permissions.mine', await signIn(MEMBER));
        expect(auditor.data).toEqual([]);

        const viaPlugin = await authPost('/admin/set-role', adminCookie, { userId: memberId, role: 'manager' });
        expect(viaPlugin.status).toBe(200);
        expect(await roleOf(MEMBER)).toBe('manager');

        const created = await mutate('users.create', adminCookie, { name: 'Audrey', email: 'audrey@example.com', role: 'auditor' });
        expect(created.status).toBe(200);
        expect(await roleOf('audrey@example.com')).toBe('auditor');
      } finally {
        await restore(
          `UPDATE users SET role = 'user' WHERE email = '${MEMBER}'`,
          "DELETE FROM users WHERE email = 'audrey@example.com'",
          "DELETE FROM roles WHERE id = 'auditor'",
        );
      }
    }, TIMEOUT_SETUP);

    test('a role is exactly one id that exists, whichever endpoint writes it', async () => {
      const adminCookie = await signIn(ADMIN);
      const memberId = await idOf(MEMBER);
      try {
        for (const role of ['user,admin', 'admin,user', ['user', 'admin'], 'Admin', ' admin', 'ghost', 'constructor']) {
          const answer = await authPost('/admin/set-role', adminCookie, { userId: memberId, role });
          expect([role, answer.status]).toEqual([role, 400]);
          expect((await authPost('/admin/update-user', adminCookie, { userId: memberId, data: { role } })).status).toBe(400);
          expect((await mutate('users.setRole', adminCookie, { id: memberId, role: role as string })).status).toBeGreaterThanOrEqual(400);
        }
        expect(await roleOf(MEMBER)).toBe('user');
        expect((await mutate('users.setRole', adminCookie, { id: await idOf(ADMIN), role: 'user' })).message).toBe(
          'You cannot change your own role',
        );
        expect(await roleOf(ADMIN)).toBe('admin');
      } finally {
        await restore(`UPDATE users SET role = 'user' WHERE email = '${MEMBER}'`, `UPDATE users SET role = 'admin' WHERE email = '${ADMIN}'`);
      }
    }, TIMEOUT_SETUP);

    // Two requests at once, repeated. What this proves: through the endpoints on a real D1, however the two requests
    // interleave, exactly one succeeds and an administrator who can sign in is left. What it cannot prove: that the
    // two guarded writes themselves meet. Over HTTP the second request is often refused before it reaches the guard,
    // because its caller was already demoted, banned or removed when the request read its session. The interleaving of
    // the writes is held by blueprint-cloudflare-fullstack-nextjs-role-assignment.test.ts ("in the write itself"),
    // which sends the guarded statements together and fails on a read followed by a write.
    //
    // The seeded administrator would remain after any race, so it is a plain user while the accounts race, and the
    // count that matters is every administrator who can sign in.
    const RACE_REPETITIONS = 5;
    const raceBetween = async (
      label: string,
      race: (cookies: [string, string], ids: [string, string]) => Promise<{ status: number }[]>,
    ): Promise<void> => {
      const created: string[] = [];
      try {
        await d1(`UPDATE users SET role = 'user' WHERE email = '${ADMIN}'`);
        for (let attempt = 0; attempt < RACE_REPETITIONS; attempt++) {
          const emails: [string, string] = [`race-${label}-${attempt}-a@example.com`, `race-${label}-${attempt}-b@example.com`];
          created.push(...emails);
          const ids: [string, string] = [await signUp(emails[0], 'admin'), await signUp(emails[1], 'admin')];
          const cookies: [string, string] = [await signIn(emails[0]), await signIn(emails[1])];
          const answers = await race(cookies, ids);
          expect(answers.filter((answer) => answer.status === 200), `attempt ${attempt}: ${JSON.stringify(answers)}`).toHaveLength(1);
          const [{ n }] = (await d1("SELECT count(*) AS n FROM users WHERE role = 'admin' AND coalesce(banned, 0) = 0")) as [{ n: number }];
          expect(n, `attempt ${attempt}`).toBe(1);
          await d1(`DELETE FROM users WHERE email IN ('${emails[0]}', '${emails[1]}')`);
        }
      } finally {
        await restore(
          `UPDATE users SET role = 'admin' WHERE email = '${ADMIN}'`,
          ...(created.length > 0 ? [`DELETE FROM users WHERE email IN (${created.map((email) => `'${email}'`).join(', ')})`] : []),
        );
      }
    };

    test('two administrators who demote each other at once leave one, on the local D1', async () => {
      await raceBetween('demote', (cookies, ids) =>
        Promise.all([
          authPost('/admin/set-role', cookies[0], { userId: ids[1], role: 'user' }),
          authPost('/admin/set-role', cookies[1], { userId: ids[0], role: 'user' }),
        ]),
      );
    }, TIMEOUT_SETUP * 3);

    test('an administrator who bans the other while the other removes them leaves one, on the local D1', async () => {
      await raceBetween('ban-remove', (cookies, ids) =>
        Promise.all([
          authPost('/admin/ban-user', cookies[0], { userId: ids[1] }),
          authPost('/admin/remove-user', cookies[1], { userId: ids[0] }),
        ]),
      );
    }, TIMEOUT_SETUP * 3);
  });

  test('permissionProcedure takes business resources and their actions only, at type check', async () => {
    const apiDir = join(projectDir, 'packages/api');
    const planted = join(apiDir, 'src/planted-permission.ts');
    await writeFile(
      planted,
      [
        "import { permissionProcedure } from './middleware/rbac';",
        "export const fine = permissionProcedure('document', 'read');",
        "export const account = permissionProcedure('user', 'ban');",
        "export const unknown = permissionProcedure('document', 'launch');",
        '',
      ].join('\n'),
    );
    try {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], apiDir);
      const output = describeFailure(result);
      expect(result.exitCode, output).not.toBe(0);
      expect(output).toContain('planted-permission.ts(3,');
      expect(output).toContain('planted-permission.ts(4,');
      expect(output).not.toContain('planted-permission.ts(2,');
    } finally {
      await rm(planted, { force: true });
    }
  }, TIMEOUT_SETUP);
});
