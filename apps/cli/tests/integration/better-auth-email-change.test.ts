import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type BetterAuthPlugin, betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const ORIGIN = 'http://localhost:3000';
const CALLBACK = '/profile/account?emailChange=confirmed';
const PASSWORD = 'correct-horse-battery';
const SECRET = 'integration-secret-integration-secret-0123';

type Auth = ReturnType<typeof createTestAuth>;
interface Tables {
  [model: string]: Record<string, unknown>[];
}

let deliverLink: (link: { kind: string; to: string; link: string }) => Promise<void>;
let emailChangeGuard: BetterAuthPlugin;

function createTestAuth(tables: Tables) {
  return betterAuth({
    baseURL: ORIGIN,
    secret: SECRET,
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => deliverLink({ kind: 'change-email', to: user.email, link: url }),
    },
    user: { changeEmail: { enabled: true } },
    advanced: { disableOriginCheck: false },
    plugins: [emailChangeGuard],
  });
}

describe('the email change on the real better-auth', () => {
  let tempDir: string;
  let delivered: { kind: string; to: string; link: string }[];
  let auth: Auth;
  let tables: Tables;

  const realLog = console.log;
  const realWarn = console.warn;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['ec', '--blueprint', 'cloudflare-fullstack-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const authDir = join(tempDir, 'ec/packages/auth/src');

    ({ deliverLink } = await evaluateGeneratedModule<{ deliverLink: typeof deliverLink }>(
      await readTextFile(join(authDir, 'email.ts')),
      join(tempDir, 'email.mjs'),
    ));
    ({ emailChangeGuard } = await evaluateGeneratedModule<{ emailChangeGuard: typeof emailChangeGuard }>(
      await readTextFile(join(authDir, 'email-change-guard.ts')),
      join(tempDir, 'email-change-guard.mjs'),
      { 'better-auth/api': Bun.resolveSync('better-auth/api', import.meta.dir), './email': join(tempDir, 'email.mjs') },
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    delivered = [];
    console.log = (line: string) => {
      const [, kind = '', to = '', link = ''] = String(line).match(/^\[(\S+)\] (\S+) → (\S+)$/) ?? [];
      if (kind) delivered.push({ kind, to, link });
    };
    console.warn = () => {};
    tables = { user: [], session: [], account: [], verification: [] };
    auth = createTestAuth(tables);
  });

  const restoreConsole = () => {
    console.log = realLog;
    console.warn = realWarn;
  };
  afterAll(restoreConsole);

  const request = (path: string, init: RequestInit = {}, cookie = ''): Promise<Response> =>
    auth.handler(
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
    const found = delivered.find((entry) => entry.kind === 'change-email' && entry.to === address);
    if (!found) throw new Error(`no change-email link for ${address}: ${JSON.stringify(delivered)}`);
    return found.link;
  };

  const open = (link: string, cookie = ''): Promise<Response> => request(link.slice(`${ORIGIN}/api/auth`.length), {}, cookie);

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
      expect(delivered).toEqual([]);
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
      expect(delivered.map((entry) => entry.to)).toEqual(['free@example.com']);
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
      expect(delivered.filter((entry) => entry.kind === 'email-changed').map((entry) => entry.to)).toEqual([
        'owner@example.com',
      ]);
    });

    test('lands on the callback with an error when the address was taken in the meantime', async () => {
      const cookie = await signUp('owner@example.com');
      expect((await requestChange(cookie, 'wanted@example.com')).status).toBe(200);
      const link = linkTo('wanted@example.com');
      await signUp('wanted@example.com');

      const response = await open(link, cookie);
      expect([response.status, response.headers.get('location')]).toEqual([302, `${CALLBACK}&error=EMAIL_TAKEN`]);
      expect(await emailOf(cookie)).toBe('owner@example.com');
      expect(delivered.filter((entry) => entry.kind === 'email-changed')).toEqual([]);
    });

    test('keeps the error codes of better-auth for a link that is not valid', async () => {
      const cookie = await signUp('owner@example.com');
      const response = await open(`${ORIGIN}/api/auth/verify-email?token=nope&callbackURL=${encodeURIComponent(CALLBACK)}`, cookie);
      expect(response.headers.get('location')).toBe(`${CALLBACK}&error=INVALID_TOKEN`);
    });
  });
});
