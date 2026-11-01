import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadGeneratedAuth } from './generated-auth-harness';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

// The role assignment guard of `cloudflare-fullstack-nextjs` (packages/auth/src/guard-administrators.ts) stands in
// front of the `admin` plugin and relies on how the installed plugin treats a role, a ban and a removal. This file runs
// the real plugin of the better-auth the CLI is tested with, without the guard, and pins every one of those
// behaviors. When a better-auth upgrade changes one, a test here fails: re-read the guard, the generated
// docs/agents/auth-rbac.md and the plugin's changelog before changing the expectation.

const BLUEPRINT = 'cloudflare-fullstack-nextjs';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';

const REAL = {
  betterAuth: Bun.resolveSync('better-auth', import.meta.dir),
  plugins: Bun.resolveSync('better-auth/plugins', import.meta.dir),
  api: Bun.resolveSync('better-auth/api', import.meta.dir),
  memory: Bun.resolveSync('better-auth/adapters/memory', import.meta.dir),
};

// Every endpoint of the `admin` plugin, by path. The guard covers the five that write a role, a ban or a removal; the
// others are listed with why they stay unguarded. A new endpoint is not in either list, which fails the test.
const GUARDED_PATHS = ['/admin/create-user', '/admin/set-role', '/admin/update-user', '/admin/ban-user', '/admin/remove-user'];
const UNGUARDED_PATHS = [
  '/admin/get-user',
  '/admin/list-users',
  '/admin/list-user-sessions',
  '/admin/has-permission',
  '/admin/unban-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  // Equivalent to root: an administrator signs in as any non-administrator, resets any password, and (update-user)
  // changes any email. Documented in docs/agents/auth-rbac.md, not guarded.
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
  '/admin/set-user-password',
];

interface Answer {
  status: number;
  json: Record<string, unknown> | null;
}

interface PluginApi {
  handler: (request: Request) => Promise<Response>;
  api: {
    signUpEmail: (input: { body: { email: string; password: string; name: string } }) => Promise<{ user: { id: string } }>;
    signInEmail: (input: { body: { email: string; password: string }; asResponse: true }) => Promise<Response>;
  };
}

type BetterAuthFactory = (options: Record<string, unknown>) => PluginApi;

describe('the better-auth admin plugin keeps the behavior the role assignment guard relies on', () => {
  let tempDir: string;
  let betterAuth: BetterAuthFactory;
  let admin: (options: Record<string, unknown>) => { endpoints: Record<string, { path: string }> };
  // The options the generated auth.ts gives the admin plugin, captured when it builds its plugin list.
  let adminOptions: Record<string, unknown>;
  let createAuthMiddleware: (handler: (ctx: Record<string, unknown>) => unknown) => unknown;

  let memory: { user: Record<string, unknown>[]; session: unknown[]; account: unknown[]; verification: unknown[] };
  let auth: PluginApi;
  let memoryAdapterOf: (db: typeof memory) => unknown;
  let accounts = 0;

  function authWith(extraPlugins: unknown[] = []): PluginApi {
    return betterAuth({
      baseURL: ORIGIN,
      secret: 'a-secret-for-the-tests-only-0123456789abcdef',
      database: memoryAdapterOf(memory),
      emailAndPassword: { enabled: true },
      plugins: [...extraPlugins, admin(adminOptions)],
    });
  }

  async function addAccount(role: string): Promise<{ id: string; email: string }> {
    const email = `account${++accounts}@example.com`;
    const { user } = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: `Account ${accounts}` } });
    storedUser(user.id).role = role;
    return { id: user.id, email };
  }

  const storedUser = (id: string) => memory.user.find((user) => user.id === id) as Record<string, unknown>;

  async function cookieOf(email: string): Promise<string> {
    const response = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

  async function post(cookie: string, path: string, body: unknown): Promise<Answer> {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = 'a-secret-for-the-tests-only-0123456789abcdef';
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    // The generated createAuth runs on a memory database, with the admin plugin wrapped to record its options: the pins
    // below run the plugin as the blueprint configures it, never as a copy of that configuration. The guard of the
    // admin endpoints is the thing under test elsewhere and is left out here.
    process.env.BETTER_AUTH_URL = ORIGIN;
    const recordingPlugins = `import { admin as realAdmin } from ${JSON.stringify(REAL.plugins)};
export * from ${JSON.stringify(REAL.plugins)};
export const admin = (options) => {
  globalThis.__adminOptionsOfTheGeneratedAuth = options;
  return realAdmin(options);
};`;
    const { createAuth } = await loadGeneratedAuth<(db: unknown) => unknown>(join(tempDir, BLUEPRINT), tempDir, {
      modules: ['email-change-guard', 'permissions', 'refuse-own-role-change'],
      standIns: {
        './guard-administrators': "export const guardAdministrators = () => ({ id: 'guard-administrators' });",
        'better-auth/plugins': recordingPlugins,
      },
    });
    createAuth({});
    adminOptions = (globalThis as { __adminOptionsOfTheGeneratedAuth?: Record<string, unknown> }).__adminOptionsOfTheGeneratedAuth ?? {};
    expect(Object.keys(adminOptions).sort()).toEqual(['ac', 'adminRoles', 'defaultRole', 'roles']);
    ({ betterAuth } = (await import(REAL.betterAuth)) as { betterAuth: BetterAuthFactory });
    ({ admin } = (await import(REAL.plugins)) as { admin: typeof admin });
    ({ createAuthMiddleware } = (await import(REAL.api)) as { createAuthMiddleware: typeof createAuthMiddleware });
    const { memoryAdapter } = (await import(REAL.memory)) as { memoryAdapter: (db: typeof memory) => unknown };
    memoryAdapterOf = memoryAdapter;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const reset = (extraPlugins: unknown[] = []) => {
    memory = { user: [], session: [], account: [], verification: [] };
    auth = authWith(extraPlugins);
  };

  describe('the endpoints that can write a role, a ban or a removal', () => {
    test('are exactly the five the guard stands in front of, and no endpoint is new', () => {
      reset();
      const paths = Object.values(admin(adminOptions).endpoints)
        .map((endpoint) => endpoint.path)
        .sort();
      expect(paths).toEqual([...GUARDED_PATHS, ...UNGUARDED_PATHS].sort());
    });
  });

  describe('a role', () => {
    test('is split on a comma, so a list stored in users.role makes its holder an administrator to the plugin', async () => {
      reset();
      const root = await addAccount('admin');
      const target = await addAccount('user');
      const cookie = await cookieOf(root.email);

      const stored = await post(cookie, '/admin/set-role', { userId: target.id, role: ['user', 'admin'] });
      expect(stored.status).toBe(200);
      expect(storedUser(target.id).role).toBe('user,admin');

      const listed = await auth.handler(
        new Request(`${ORIGIN}/api/auth/admin/list-users`, { headers: { origin: ORIGIN, cookie: await cookieOf(target.email) } }),
      );
      expect(listed.status).toBe(200);
    });

    test('is accepted when it is a key of Object.prototype, because the compiled roles are looked up by key', async () => {
      reset();
      const root = await addAccount('admin');
      const target = await addAccount('user');
      const answer = await post(await cookieOf(root.email), '/admin/set-role', { userId: target.id, role: 'constructor' });
      expect(answer.status).toBe(200);
      expect(storedUser(target.id).role).toBe('constructor');
    });

    test('is checked against the compiled roles only, and case and spaces are not normalized', async () => {
      reset();
      const root = await addAccount('admin');
      const target = await addAccount('user');
      const cookie = await cookieOf(root.email);
      for (const role of ['Admin', ' admin', 'ghost']) {
        expect([role, (await post(cookie, '/admin/set-role', { userId: target.id, role })).status]).toEqual([role, 400]);
      }
      expect(storedUser(target.id).role).toBe('user');
    });

    test('is written by update-user too, an array included, and so is a ban', async () => {
      reset();
      const root = await addAccount('admin');
      const target = await addAccount('user');
      const cookie = await cookieOf(root.email);
      expect((await post(cookie, '/admin/update-user', { userId: target.id, data: { role: ['user', 'admin'] } })).status).toBe(200);
      expect(storedUser(target.id).role).toBe('user,admin');
      expect((await post(cookie, '/admin/update-user', { userId: target.id, data: { banned: true } })).status).toBe(200);
      expect(storedUser(target.id).banned).toBe(true);
    });

    test('is written by create-user as given, an array included', async () => {
      reset();
      const root = await addAccount('admin');
      const answer = await post(await cookieOf(root.email), '/admin/create-user', {
        email: 'listed@example.com',
        password: PASSWORD,
        name: 'Listed',
        role: ['user', 'admin'],
      });
      expect(answer.status).toBe(200);
      expect(memory.user.find((user) => user.email === 'listed@example.com')?.role).toBe('user,admin');
    });

    test('is not written by sign-up or by the signed-in user: the field is not an input', async () => {
      reset();
      await post('', '/sign-up/email', { email: 'sneaky@example.com', password: PASSWORD, name: 'Sneaky', role: 'admin' });
      expect(memory.user.find((user) => user.email === 'sneaky@example.com')?.role ?? 'user').toBe('user');

      const member = await addAccount('user');
      await post(await cookieOf(member.email), '/update-user', { role: 'admin' });
      expect(storedUser(member.id).role).toBe('user');
    });
  });

  describe('an anonymous request', () => {
    test('is refused with a 401 by each of the five endpoints, and writes nothing', async () => {
      reset();
      const target = await addAccount('user');
      const before = JSON.stringify(memory.user);
      for (const [path, body] of [
        ['/admin/set-role', { userId: target.id, role: 'manager' }],
        ['/admin/ban-user', { userId: target.id }],
        ['/admin/remove-user', { userId: target.id }],
        ['/admin/update-user', { userId: target.id, data: { name: 'Hijacked' } }],
        ['/admin/create-user', { email: 'anonymous@example.com', password: PASSWORD, name: 'Anonymous', role: 'manager' }],
      ] as const) {
        expect([path, (await post('', path, body)).status]).toEqual([path, 401]);
      }
      expect(JSON.stringify(memory.user)).toBe(before);
    });

    test('is allowed by create-user when it is a call from the server with no headers, which the guard keeps', async () => {
      reset();
      const created = await (auth.api as unknown as { createUser: (input: unknown) => Promise<{ user: { id: string } }> }).createUser({
        body: { email: 'trusted@example.com', password: PASSWORD, name: 'Trusted', role: 'manager' },
      });
      expect(storedUser(created.user.id).role).toBe('manager');
    });
  });

  describe('the last administrator', () => {
    test('is not protected by the plugin: an administrator demotes themselves, and the application has none left', async () => {
      reset();
      const only = await addAccount('admin');
      const answer = await post(await cookieOf(only.email), '/admin/set-role', { userId: only.id, role: 'user' });
      expect(answer.status).toBe(200);
      expect(memory.user.filter((user) => user.role === 'admin')).toHaveLength(0);
    });

    test('is not protected from a ban or a removal by another administrator either', async () => {
      reset();
      const first = await addAccount('admin');
      const second = await addAccount('admin');
      const cookie = await cookieOf(first.email);
      expect((await post(cookie, '/admin/ban-user', { userId: second.id })).status).toBe(200);
      expect((await post(cookie, '/admin/remove-user', { userId: second.id })).status).toBe(200);
    });

    test('cannot ban or remove themselves, which the guard repeats before it writes anything', async () => {
      reset();
      const only = await addAccount('admin');
      const cookie = await cookieOf(only.email);
      expect((await post(cookie, '/admin/ban-user', { userId: only.id })).status).toBe(400);
      expect((await post(cookie, '/admin/remove-user', { userId: only.id })).status).toBe(400);
    });
  });

  describe('a before hook', () => {
    test('that returns a response ends the request there: the endpoint does not run and the response is what is sent', async () => {
      const probe = {
        id: 'probe',
        hooks: {
          before: [
            {
              matcher: (ctx: { path: string }) => ctx.path === '/admin/set-role',
              handler: createAuthMiddleware(async (ctx) => (ctx.json as (value: unknown) => unknown)({ user: { id: 'from-the-hook' } })),
            },
          ],
        },
      };
      reset([probe]);
      const root = await addAccount('admin');
      const target = await addAccount('user');
      const answer = await post(await cookieOf(root.email), '/admin/set-role', { userId: target.id, role: 'manager' });
      expect(answer.json).toEqual({ user: { id: 'from-the-hook' } });
      expect(storedUser(target.id).role).toBe('user');
    });

    test('that returns nothing lets the endpoint run', async () => {
      const probe = {
        id: 'probe',
        hooks: { before: [{ matcher: (ctx: { path: string }) => ctx.path === '/admin/ban-user', handler: createAuthMiddleware(async () => {}) }] },
      };
      reset([probe]);
      const root = await addAccount('admin');
      const target = await addAccount('user');
      expect((await post(await cookieOf(root.email), '/admin/ban-user', { userId: target.id })).status).toBe(200);
      expect(storedUser(target.id).banned).toBe(true);
    });

    test('reads the body as it was sent: an id sent as an array reaches the hook as an array, which the endpoint turns into a string', async () => {
      let seen: unknown;
      const probe = {
        id: 'probe',
        hooks: {
          before: [
            {
              matcher: (ctx: { path: string }) => ctx.path === '/admin/ban-user',
              handler: createAuthMiddleware(async (ctx) => {
                seen = (ctx.body as { userId: unknown }).userId;
              }),
            },
          ],
        },
      };
      reset([probe]);
      const root = await addAccount('admin');
      const target = await addAccount('user');
      const answer = await post(await cookieOf(root.email), '/admin/ban-user', { userId: [target.id] });
      expect(seen).toEqual([target.id]);
      expect(answer.status).toBe(200);
      expect(storedUser(target.id).banned).toBe(true);
    });
  });
});
