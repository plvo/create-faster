import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { BetterAuthPlugin } from 'better-auth';
import { type DatabaseHarness, type DeliveryHarness, loadGeneratedAuth } from './generated-auth-harness';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const ORIGIN = 'http://localhost:3000';
const CALLBACK = '/profile/account?emailChange=confirmed';
const PASSWORD = 'correct-horse-battery';
const SECRET = 'integration-secret-integration-secret-0123';
const PATIENCE = 3_000;

type Handler = (request: Request) => Promise<Response>;
type CreateAuth = (
  db: unknown,
  cookiePlugin?: BetterAuthPlugin,
  runInBackground?: (task: Promise<unknown>) => void,
) => { handler: Handler };

const timedOut = Symbol('the answer waited');
const answeredWithin = <T>(answer: Promise<T>): Promise<T | typeof timedOut> =>
  Promise.race([answer, Bun.sleep(PATIENCE).then((): typeof timedOut => timedOut)]);

// The generated `createAuth` of cloudflare-fullstack-nextjs, with its generated plugins and permissions, on the real
// better-auth over a memory database: the wiring of `auth.ts` is what runs, not a copy of it.
describe('the email change on the generated auth of cloudflare-fullstack-nextjs', () => {
  let tempDir: string;
  let createAuth: CreateAuth;
  let database: DatabaseHarness;
  let delivery: DeliveryHarness;
  let handler: Handler;
  let background: Promise<unknown>[];
  let logged: string[];

  const realError = console.error;
  const savedEnv = { url: process.env.BETTER_AUTH_URL, secret: process.env.BETTER_AUTH_SECRET };

  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = ORIGIN;
    process.env.BETTER_AUTH_SECRET = SECRET;
    tempDir = await createTempDir();
    const result = await runCli(
      ['ec', '--blueprint', 'cloudflare-fullstack-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    ({ createAuth, database, delivery } = await loadGeneratedAuth<CreateAuth>(join(tempDir, 'ec'), tempDir, {
      modules: ['email-change-guard', 'permissions', 'refuse-own-role-change'],
      deliveryModule: './email',
    }));
  });

  afterAll(async () => {
    console.error = realError;
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
    database.tables = { user: [], session: [], account: [], verification: [] };
    delivery.delivered = [];
    delivery.gate = Promise.resolve();
    delivery.failing = new Set();
    background = [];
    logged = [];
    console.error = (...parts: unknown[]) => {
      logged.push(parts.map(String).join(' '));
    };
    // The app hands better-auth the Worker's waitUntil: a task runs on after the response.
    handler = createAuth({}, undefined, (task) => background.push(task)).handler;
  });

  afterEach(async () => {
    delivery.gate = Promise.resolve();
    await Promise.allSettled(background);
    console.error = realError;
  });

  const request = (path: string, init: RequestInit = {}, cookie = ''): Promise<Response> =>
    handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        ...init,
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie && { cookie }), ...init.headers },
      }),
    );

  const post = (path: string, body: unknown, cookie = ''): Promise<Response> =>
    request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);

  const cookieOf = (response: Response): string =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

  const signUp = async (email: string): Promise<string> => {
    const response = await post('/sign-up/email', { email, password: PASSWORD, name: email });
    expect(response.status, await response.clone().text()).toBe(200);
    return cookieOf(response);
  };

  const emailOf = async (cookie: string): Promise<string | undefined> => {
    const session = (await (await request('/get-session', {}, cookie)).json()) as { user?: { email: string } } | null;
    return session?.user?.email;
  };

  const requestChange = (cookie: string, newEmail: string, currentPassword: string | null = PASSWORD) =>
    post('/change-email', { newEmail, callbackURL: CALLBACK, currentPassword }, cookie);

  const linkTo = (address: string): string => {
    const found = delivery.delivered.find((entry) => entry.kind === 'change-email' && entry.to === address);
    if (!found) throw new Error(`no change-email link for ${address}: ${JSON.stringify(delivery.delivered)}`);
    return found.link;
  };

  const open = (link: string, cookie = ''): Promise<Response> => request(link.slice(`${ORIGIN}/api/auth`.length), {}, cookie);

  describe('the configuration the generated auth.ts wires', () => {
    test('the guard is registered: the current password is asked for', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'new@example.com', 'wrong-password')).status).toBe(400);
      expect(delivery.delivered).toEqual([]);
    });

    test('no address changes without the link, not even for an account that never verified its address', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'new@example.com')).status).toBe(200);
      await Promise.allSettled(background);

      expect(await emailOf(cookie)).toBe('owner@example.com');
      expect((await post('/sign-in/email', { email: 'new@example.com', password: PASSWORD })).status).toBe(401);
      expect((await post('/sign-in/email', { email: 'owner@example.com', password: PASSWORD })).status).toBe(200);
    });

    test('the public verification route is closed', async () => {
      await signUp('owner@example.com');
      const response = await post('/send-verification-email', { email: 'owner@example.com' });
      expect(response.status).toBe(404);
      await Promise.allSettled(background);
      expect(delivery.delivered).toEqual([]);
    });

    test('a free address is answered before its slow delivery finishes, as a taken one is', async () => {
      const cookie = await signUp('owner@example.com');
      await signUp('taken@example.com');
      let release: () => void = () => {};
      delivery.gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const free = await answeredWithin(requestChange(cookie, 'free@example.com'));
      const taken = await answeredWithin(requestChange(cookie, 'taken@example.com'));
      expect(free).not.toBe(timedOut);
      expect(taken).not.toBe(timedOut);
      expect([(free as Response).status, await (free as Response).json()]).toEqual([
        (taken as Response).status,
        await (taken as Response).json(),
      ]);
      expect(delivery.delivered.map((entry) => entry.to)).toEqual(['free@example.com']);
      release();
    });
  });

  describe('opening a link without a session', () => {
    const verify = (callbackURL: string | string[]) => {
      const query = new URLSearchParams({ token: 'x' });
      for (const value of [callbackURL].flat()) query.append('callbackURL', value);
      return request(`/verify-email?${query}`);
    };

    test('goes back to the callback with an error and signs nobody in', async () => {
      const response = await verify(CALLBACK);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(`${CALLBACK}&error=SIGN_IN_REQUIRED`);
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    test('keeps a fragment of the callback after the error', async () => {
      const response = await verify('/profile/account#email');
      expect(response.headers.get('location')).toBe('/profile/account?error=SIGN_IN_REQUIRED#email');
    });

    test.each([
      ['a tab after the slash', '/\t/evil.example'],
      ['a newline after the slash', '/\n/evil.example'],
      ['a carriage return', '/\r/evil.example'],
      ['a protocol-relative URL', '//evil.example'],
      ['a backslash', '/\\evil.example'],
      ['an encoded backslash', '/%5Cevil.example'],
      ['an absolute URL of another site', 'https://evil.example/'],
      ['a script URL', 'javascript:alert(1)'],
      ['an empty value', ''],
    ])('refuses %s as a 4xx and never redirects', async (_label, callbackURL) => {
      const response = await verify(callbackURL);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(response.headers.get('location')).toBeNull();
    });

    test('refuses a callback given twice, one of them hostile', async () => {
      const response = await verify([CALLBACK, '/\t/evil.example']);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(response.headers.get('location')).toBeNull();
    });
  });

  describe('asking for a new address', () => {
    test('needs the current password of the account, and sends nothing without it', async () => {
      const cookie = await signUp('owner@example.com');
      for (const password of ['wrong-password', '', null]) {
        const response = await requestChange(cookie, 'new@example.com', password);
        expect(response.status, String(password)).toBe(400);
      }
      expect((await post('/change-email', { newEmail: 'new@example.com', callbackURL: CALLBACK }, cookie)).status).toBe(400);
      expect(delivery.delivered).toEqual([]);
    });

    test('answers a wrong password the same for a taken and a free address', async () => {
      const cookie = await signUp('owner@example.com');
      await signUp('taken@example.com');
      const free = await requestChange(cookie, 'free@example.com', 'wrong-password');
      const taken = await requestChange(cookie, 'taken@example.com', 'wrong-password');
      expect([taken.status, await taken.json()]).toEqual([free.status, await free.json()]);
    });

    test('with the right password sends one link to a free address and none to a taken one, with the same answer', async () => {
      const cookie = await signUp('owner@example.com');
      await signUp('taken@example.com');
      const free = await requestChange(cookie, 'free@example.com');
      const taken = await requestChange(cookie, 'taken@example.com');
      expect([taken.status, await taken.json()]).toEqual([free.status, await free.json()]);
      expect(delivery.delivered.map((entry) => entry.to)).toEqual(['free@example.com']);
    });

    test('is refused without a session', async () => {
      expect((await requestChange('', 'new@example.com')).status).toBe(401);
    });
  });

  describe('confirming the link', () => {
    test('changes the address only in the signed-in browser, and tells the old address', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'new@example.com')).status).toBe(200);
      const link = linkTo('new@example.com');
      expect(await emailOf(cookie)).toBe('owner@example.com');

      const anonymous = await open(link);
      expect(anonymous.headers.get('location')).toBe(`${CALLBACK}&error=SIGN_IN_REQUIRED`);
      expect(await emailOf(cookie)).toBe('owner@example.com');

      const confirmed = await open(link, cookie);
      expect(confirmed.headers.get('location')).toBe(CALLBACK);
      expect(await emailOf(cookie)).toBe('new@example.com');
      await Promise.allSettled(background);
      expect(delivery.delivered.filter((entry) => entry.kind === 'email-changed').map((entry) => entry.to)).toEqual([
        'owner@example.com',
      ]);
    });

    test('still answers, with the new session cookie, when the mailer fails to tell the old address', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'new@example.com')).status).toBe(200);
      const link = linkTo('new@example.com');
      delivery.failing.add('email-changed');

      const confirmed = await open(link, cookie);
      expect([confirmed.status, confirmed.headers.get('location')]).toEqual([302, CALLBACK]);
      expect(confirmed.headers.getSetCookie().some((setCookie) => setCookie.includes('session_token'))).toBe(true);
      expect(await emailOf(cookie)).toBe('new@example.com');

      await Promise.allSettled(background);
      expect(logged.join('\n')).toContain('the mailer is down: email-changed');
    });

    test('answers as well when the app gives better-auth no background handler, as a script that builds auth does', async () => {
      handler = createAuth({}).handler;
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'new@example.com')).status).toBe(200);
      const link = linkTo('new@example.com');
      delivery.failing.add('email-changed');

      const confirmed = await open(link, cookie);
      expect([confirmed.status, confirmed.headers.get('location')]).toEqual([302, CALLBACK]);
      expect(await emailOf(cookie)).toBe('new@example.com');
    });

    test('does not wait for a slow mailer to tell the old address', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'new@example.com')).status).toBe(200);
      const link = linkTo('new@example.com');
      let release: () => void = () => {};
      delivery.gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const confirmed = await answeredWithin(open(link, cookie));
      expect(confirmed).not.toBe(timedOut);
      expect((confirmed as Response).headers.get('location')).toBe(CALLBACK);
      expect(delivery.delivered.map((entry) => entry.kind)).toEqual(['change-email', 'email-changed']);
      release();
    });

    test('lands on the callback with an error when the address was taken in the meantime', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'wanted@example.com')).status).toBe(200);
      const link = linkTo('wanted@example.com');
      await signUp('wanted@example.com');

      const response = await open(link, cookie);
      expect([response.status, response.headers.get('location')]).toEqual([302, `${CALLBACK}&error=EMAIL_TAKEN`]);
      expect(await emailOf(cookie)).toBe('owner@example.com');
      await Promise.allSettled(background);
      expect(delivery.delivered.filter((entry) => entry.kind === 'email-changed')).toEqual([]);
    });

    test('keeps the error codes of better-auth for a link that is not valid', async () => {
      const cookie = await signUp('owner@example.com');
      const response = await open(`${ORIGIN}/api/auth/verify-email?token=nope&callbackURL=${encodeURIComponent(CALLBACK)}`, cookie);
      expect(response.headers.get('location')).toBe(`${CALLBACK}&error=INVALID_TOKEN`);
    });
  });
});
