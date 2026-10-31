import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
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
      'user.create',
      'user.delete',
      'user.read',
      'user.update',
    ]);

    const again = await runCommand(['bun', 'run', 'db:roles'], projectDir);
    expect(again.exitCode, describeFailure(again)).toBe(0);
    expect(again.stdout).toContain('already there');
    expect(await d1('SELECT role_id, resource, action FROM role_permissions ORDER BY role_id, resource, action')).toEqual(before);
  }, TIMEOUT_SETUP);

  test('the server resolves the permission list of each caller, a non-admin included', async () => {
    const admin = await query('permissions.mine', await signIn(ADMIN));
    expect(admin.status).toBe(200);
    expect(admin.data).toEqual(expect.arrayContaining(['document.create', 'document.read', 'document.update', 'document.delete', 'user.list']));

    expect(await query('permissions.mine', await signIn(MANAGER))).toEqual({ status: 200, data: ['document.read'] });
    const member = await query('permissions.mine', await signIn(MEMBER));
    expect((member.data as string[]).sort()).toEqual(['document.create', 'document.delete', 'document.read', 'document.update']);
    expect((await query('permissions.mine', '')).status).toBe(401);
  });

  test('the first render of the sidebar and of the buttons is already right for a non-admin', async () => {
    const manager = await page('/', await signIn(MANAGER));
    expect(manager.status).toBe(200);
    expect(manager.html).toContain('Documents');
    expect(manager.html).not.toContain('/admin/users');
    expect(manager.html).not.toContain('type="file"');

    const member = await page('/', await signIn(MEMBER));
    expect(member.html).toContain('type="file"');
    expect(member.html).not.toContain('/admin/users');

    const admin = await page('/', await signIn(ADMIN));
    expect(admin.html).toContain('/admin/users');
    expect(admin.html).toContain('/admin/roles');
  });

  test('a non-admin is refused account administration, and a stored row naming user or session grants nothing', async () => {
    const cookie = await signIn(MANAGER);
    expect((await query('users.list', cookie, {})).status).toBe(403);
    expect(await page('/admin/users', cookie)).toMatchObject({ status: 307, location: expect.stringMatching(/\/$/) });

    await d1("PRAGMA foreign_keys = OFF; INSERT INTO role_permissions (role_id, resource, action) VALUES ('manager', 'user', 'list'), ('manager', 'session', 'list')");
    try {
      expect((await query('users.list', cookie, {})).status).toBe(403);
      expect(await query('permissions.mine', cookie)).toEqual({ status: 200, data: ['document.read'] });
      expect(await page('/admin/users', cookie)).toMatchObject({ status: 307 });
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
      expect(await query('permissions.mine', cookie)).toEqual({ status: 200, data: [] });

      const noAccess = await page('/', cookie);
      expect(noAccess.status).toBe(200);
      expect(noAccess.html).toContain('Your role has no access to documents.');

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
});
