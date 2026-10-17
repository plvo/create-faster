import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start', 'cloudflare-fullstack-nextjs'];

const PLUGIN = 'packages/auth/src/refuse-own-role-change.ts';
const AUTH = 'packages/auth/src/auth.ts';

interface HookContext {
  path: string;
  body?: Record<string, unknown>;
  session?: { user: { id: string } } | null;
}
interface Plugin {
  id: string;
  hooks: {
    before: { matcher: (ctx: HookContext) => boolean; handler: (ctx: HookContext) => Promise<void> }[];
  };
}

// The pieces of better-auth/api the plugin uses: the middleware is its own function, the session is the one the
// test puts on the context, and an APIError records its status and body.
const BETTER_AUTH_API_STUB = `export const createAuthMiddleware = (handler) => handler;
export const getSessionFromCtx = async (ctx) => ctx.session ?? null;
export class APIError extends Error {
  constructor(status, body) {
    super(body.message);
    this.name = 'APIError';
    this.status = status;
  }
}`;

describe('an admin cannot change their own role', () => {
  let tempDir: string;
  let projectPaths: Map<string, string>;
  let hook: Plugin['hooks']['before'][number];

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPaths = new Map();
    for (const blueprint of BLUEPRINTS) {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
      projectPaths.set(blueprint, join(tempDir, blueprint));
    }

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'better-auth-api.mjs'), BETTER_AUTH_API_STUB);
    const source = await readTextFile(join(projectPaths.get(BLUEPRINTS[0] as string) as string, PLUGIN));
    const { refuseOwnRoleChange } = await evaluateGeneratedModule<{ refuseOwnRoleChange: Plugin }>(
      source,
      join(stubs, 'refuse-own-role-change.mjs'),
      { 'better-auth/api': './better-auth-api.mjs' },
    );
    hook = refuseOwnRoleChange.hooks.before[0] as Plugin['hooks']['before'][number];
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const self = { user: { id: 'admin-1' } };

  test('the hook watches the endpoints that set a role', () => {
    expect(hook.matcher({ path: '/admin/set-role' })).toBe(true);
    expect(hook.matcher({ path: '/admin/update-user', body: { userId: 'u1', data: { role: 'user' } } })).toBe(true);
    expect(hook.matcher({ path: '/admin/update-user', body: { userId: 'u1', data: { name: 'Ada' } } })).toBe(false);
    expect(hook.matcher({ path: '/admin/ban-user' })).toBe(false);
  });

  test('setting the role of the signed-in user is a bad request with a message', async () => {
    const refusal = await hook
      .handler({ path: '/admin/set-role', body: { userId: 'admin-1', role: 'user' }, session: self })
      .catch((error: Error & { status: string }) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error & { status: string }).status).toBe('BAD_REQUEST');
    expect((refusal as Error).message).toBe('You cannot change your own role');
  });

  test('changing the role through update-user is refused the same way', async () => {
    const refusal = await hook
      .handler({ path: '/admin/update-user', body: { userId: 'admin-1', data: { role: 'user' } }, session: self })
      .catch((error: Error) => error);
    expect((refusal as Error).message).toBe('You cannot change your own role');
  });

  test('setting the role of another user goes through', async () => {
    await expect(
      hook.handler({ path: '/admin/set-role', body: { userId: 'user-2', role: 'admin' }, session: self }),
    ).resolves.toBeUndefined();
  });

  test('a request without a session is left to the endpoint to refuse', async () => {
    await expect(
      hook.handler({ path: '/admin/set-role', body: { userId: 'admin-1', role: 'user' }, session: null }),
    ).resolves.toBeUndefined();
  });

  test.each(BLUEPRINTS)('%s registers the plugin', async (blueprint) => {
    const auth = await readTextFile(join(projectPaths.get(blueprint) as string, AUTH));
    expect(auth).toContain("import { refuseOwnRoleChange } from './refuse-own-role-change';");
    expect(auth).toMatch(/refuseOwnRoleChange,\s*\.\.\.\(cookiePlugin/);
  });
});
