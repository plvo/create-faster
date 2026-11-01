import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type DatabaseHarness, type DeliveryHarness, loadGeneratedAuth } from './generated-auth-harness';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery';
const SECRET = 'integration-secret-integration-secret-0123';
const PATIENCE = 3_000;

type Handler = (request: Request) => Promise<Response>;
type CreateAuth = (cookiePlugin?: undefined, runInBackground?: (task: Promise<unknown>) => void) => { handler: Handler };

const timedOut = Symbol('the answer waited');
const answeredWithin = <T>(answer: Promise<T>): Promise<T | typeof timedOut> =>
  Promise.race([answer, Bun.sleep(PATIENCE).then((): typeof timedOut => timedOut)]);

// Once a mailer is plugged in, a password reset must not answer later for an account that exists than for one that
// does not: the delivery runs after the response.
describe('the links of multitenant-saas-nextjs on the generated auth', () => {
  let tempDir: string;
  let projectPath: string;
  let createAuth: CreateAuth;
  let database: DatabaseHarness;
  let delivery: DeliveryHarness;
  let handler: Handler;
  let background: Promise<unknown>[];

  const savedEnv = { url: process.env.BETTER_AUTH_URL, secret: process.env.BETTER_AUTH_SECRET };

  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = ORIGIN;
    process.env.BETTER_AUTH_SECRET = SECRET;
    tempDir = await createTempDir();
    const result = await runCli(
      ['mt', '--blueprint', 'multitenant-saas-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, 'mt');
    ({ createAuth, database, delivery } = await loadGeneratedAuth<CreateAuth>(projectPath, tempDir, {
      modules: ['email-change-guard', 'invitation-link', 'permissions'],
    }));
  });

  afterAll(async () => {
    for (const [name, value] of [
      ['BETTER_AUTH_URL', savedEnv.url],
      ['BETTER_AUTH_SECRET', savedEnv.secret],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    database.tables = {
      user: [],
      session: [],
      account: [],
      verification: [],
      organization: [],
      member: [],
      invitation: [],
      organizationRole: [],
    };
    delivery.delivered = [];
    delivery.gate = Promise.resolve();
    background = [];
    handler = createAuth(undefined, (task) => background.push(task)).handler;
  });

  afterEach(async () => {
    delivery.gate = Promise.resolve();
    await Promise.allSettled(background);
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const holdDelivery = (): (() => void) => {
    let release: () => void = () => {};
    delivery.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  };

  test('a password reset is answered before its slow delivery finishes, for an account that exists as for one that does not', async () => {
    const signUp = await post('/sign-up/email', { email: 'owner@example.com', password: PASSWORD, name: 'Owner' });
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const release = holdDelivery();

    const existing = await answeredWithin(post('/request-password-reset', { email: 'owner@example.com', redirectTo: '/reset-password' }));
    const warned: string[] = [];
    const realWarn = console.warn;
    console.warn = (...parts: unknown[]) => {
      warned.push(parts.map(String).join(' '));
    };
    const unknown = await answeredWithin(post('/request-password-reset', { email: 'nobody@example.com', redirectTo: '/reset-password' })).finally(() => {
      console.warn = realWarn;
    });
    expect(warned.join('\n')).toContain('Reset Password: User not found');

    expect(existing).not.toBe(timedOut);
    expect(unknown).not.toBe(timedOut);
    expect([(existing as Response).status, await (existing as Response).json()]).toEqual([
      (unknown as Response).status,
      await (unknown as Response).json(),
    ]);
    expect(delivery.delivered.map((entry) => [entry.kind, entry.to])).toEqual([['reset-password', 'owner@example.com']]);
    release();
  });

  test('the app instance hands better-auth the after() of Next.js as its background handler', async () => {
    const stubs = join(tempDir, 'web-stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(
      join(stubs, 'auth-package.mjs'),
      'export const harness = { calls: [] };\nexport const createAuth = (...args) => { harness.calls.push(args); return {}; };',
    );
    await Bun.write(join(stubs, 'next-js.mjs'), "export const nextCookies = () => 'cookie plugin';");
    await Bun.write(join(stubs, 'next-server.mjs'), 'export const harness = { tasks: [] };\nexport const after = (task) => harness.tasks.push(task);');
    await evaluateGeneratedModule(
      await readTextFile(join(projectPath, 'apps/web/src/lib/auth/auth.ts')),
      join(stubs, 'web-auth.mjs'),
      {
        '@repo/auth/auth': join(stubs, 'auth-package.mjs'),
        'better-auth/next-js': join(stubs, 'next-js.mjs'),
        'next/server': join(stubs, 'next-server.mjs'),
      },
    );
    await import(join(stubs, 'web-auth.mjs'));
    const { harness: created } = (await import(join(stubs, 'auth-package.mjs'))) as {
      harness: { calls: [string, (task: Promise<unknown>) => void][] };
    };
    const { harness: scheduled } = (await import(join(stubs, 'next-server.mjs'))) as { harness: { tasks: Promise<unknown>[] } };

    const [cookiePlugin, runInBackground] = created.calls[0] ?? [];
    expect(cookiePlugin).toBe('cookie plugin');
    const task = Promise.resolve();
    runInBackground?.(task);
    expect(scheduled.tasks).toEqual([task]);
  });
});
