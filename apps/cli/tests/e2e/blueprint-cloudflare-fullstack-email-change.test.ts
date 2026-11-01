import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
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

const PASSWORD = 'e2e-password-0123';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';
const ACCOUNT_PAGE = '/profile/account';
const CALLBACK = '/profile/account?emailChange=confirmed';
const LOGGED_LINK = /\[(change-email|email-changed)\] (\S+) → (\S+)/g;

const describeFailure = (result: CommandResult): string => `${result.stdout}\n${result.stderr}`;

// The same token better-auth signs for an email change, with an expiry that has passed.
function expiredChangeToken(email: string, updateTo: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    email,
    updateTo,
    requestType: 'change-email-verification',
    iat: now - 7_200,
    exp: now - 3_600,
  })}`;
  return `${unsigned}.${createHmac('sha256', AUTH_SECRET).update(unsigned).digest('base64url')}`;
}

interface Account {
  email: string;
  cookie: string;
}

// Each test signs up the accounts it needs, so it runs alone as well as in the file.
describe('cloudflare-fullstack-nextjs email change e2e', () => {
  let projectDir: string;
  let server: RunningServer;
  let requests = 0;
  let accounts = 0;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url, 'x-forwarded-for': `10.4.4.${++requests % 250}`, ...headers },
      body: JSON.stringify(body),
    });

  const newAccount = async (): Promise<Account> => {
    const email = `account-${++accounts}-${Date.now()}@example.com`;
    const response = await post('/api/auth/sign-up/email', { email, password: PASSWORD, name: 'Account' });
    expect(response.status, await response.clone().text()).toBe(200);
    return { email, cookie: cookieHeaderOf(response) };
  };

  const signIn = (email: string) => post('/api/auth/sign-in/email', { email, password: PASSWORD });

  const sessionUser = async (cookie: string): Promise<{ email: string; emailVerified: boolean }> => {
    const response = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie } });
    return ((await response.json()) as { user: { email: string; emailVerified: boolean } }).user;
  };

  const requestChange = (cookie: string, newEmail: string, currentPassword: string | null = PASSWORD): Promise<Response> =>
    post('/api/auth/change-email', { newEmail, currentPassword, callbackURL: CALLBACK }, { cookie });

  const logged = (kind: string): { to: string; link: string }[] =>
    [...server.output().stdout.matchAll(LOGGED_LINK)]
      .filter((match) => match[1] === kind)
      .map(([, , to = '', link = '']) => ({ to, link }));

  const waitFor = async <T>(find: () => T | undefined, what: string): Promise<T> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const found = find();
      if (found !== undefined) return found;
      await Bun.sleep(200);
    }
    throw new Error(`Never logged: ${what}\n${server.output().stdout}`);
  };

  const linkSentTo = (address: string): Promise<string> =>
    waitFor(() => logged('change-email').find((entry) => entry.to === address)?.link, `a change-email link for ${address}`);

  const openLink = async (link: string, cookie?: string): Promise<Response> =>
    fetch(link, { redirect: 'manual', headers: cookie ? { cookie } : {} });

  const landingOf = (response: Response): URL => {
    expect(response.status, response.headers.get('location') ?? '').toBe(302);
    return new URL(response.headers.get('location') ?? '', server.url);
  };

  const pageAt = async (path: string, cookie: string): Promise<string> => {
    const response = await fetch(new URL(path, server.url), { headers: { cookie } });
    expect(response.status).toBe(200);
    return response.text();
  };

  beforeAll(async () => {
    projectDir = await generateInstalledProject('bp-email-change', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    const setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
    expect(setup.exitCode, describeFailure(setup)).toBe(0);

    const webDir = join(projectDir, 'apps/web');
    const port = await getFreePort();
    const envPath = join(webDir, '.env');
    const kept = (await readFile(envPath, 'utf8')).split('\n').filter((line) => line && !line.startsWith('BETTER_AUTH_'));
    await writeFile(
      envPath,
      `${[...kept, `BETTER_AUTH_SECRET=${AUTH_SECRET}`, `BETTER_AUTH_URL=http://127.0.0.1:${port}`].join('\n')}\n`,
    );
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

  test(
    'the address changes only after the link sent to the new address is opened, and the profile and user menu follow',
    async () => {
      const { email, cookie } = await newAccount();
      const newEmail = `moved-${accounts}.Address@Example.com`;

      const requested = await requestChange(cookie, newEmail);
      expect([requested.status, await requested.json()]).toEqual([200, { status: true }]);

      const link = await linkSentTo(newEmail.toLowerCase());
      expect(link).toContain('/api/auth/verify-email?token=');
      expect((await sessionUser(cookie)).email).toBe(email);
      expect((await signIn(newEmail)).status).toBe(401);

      const landing = landingOf(await openLink(link, cookie));
      expect([landing.pathname, landing.searchParams.get('emailChange'), landing.searchParams.get('error')]).toEqual([
        ACCOUNT_PAGE,
        'confirmed',
        null,
      ]);
      expect(await sessionUser(cookie)).toMatchObject({ email: newEmail.toLowerCase(), emailVerified: true });
      expect((await signIn(email)).status).toBe(401);
      expect((await signIn(newEmail)).status).toBe(200);

      const page = await pageAt(`${landing.pathname}${landing.search}`, cookie);
      const escaped = newEmail.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(page).toContain(`Your email address is now ${newEmail.toLowerCase()}.`);
      expect(page).toMatch(new RegExp(`<dt[^>]*>Email</dt><dd[^>]*>${escaped}</dd>`));
      expect(page).toMatch(new RegExp(`data-sidebar="footer"[\\s\\S]*?<span class="truncate text-xs">${escaped}</span>`));
      expect(page).not.toContain(email);

      const notice = await waitFor(() => logged('email-changed').find((entry) => entry.to === email), `a notice to ${email}`);
      expect(notice.link).toStartWith(server.url);
    },
    TIMEOUT_SERVER,
  );

  test('the current password is required, and a wrong one answers the same for a taken and a free address', async () => {
    const { cookie } = await newAccount();
    const taken = await newAccount();
    const linksBefore = logged('change-email').length;

    const outcomes: [number, unknown][] = [];
    for (const target of [`free-${accounts}@example.com`, taken.email]) {
      for (const password of ['wrong-password', '', null]) {
        const response = await requestChange(cookie, target, password);
        outcomes.push([response.status, await response.json()]);
      }
    }
    expect(outcomes.every(([status]) => status === 400)).toBe(true);
    expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome))).size).toBe(1);

    await Bun.sleep(500);
    expect(logged('change-email')).toHaveLength(linksBefore);
  });

  test('a taken address and a free one get the same answer, and nothing is sent for the taken one', async () => {
    const { cookie, email } = await newAccount();
    const taken = await newAccount();
    const free = `free-${accounts}@example.com`;
    const linksBefore = logged('change-email').length;

    const takenAnswer = await requestChange(cookie, taken.email);
    const freeAnswer = await requestChange(cookie, free);
    expect([takenAnswer.status, await takenAnswer.json()]).toEqual([freeAnswer.status, await freeAnswer.json()]);

    await linkSentTo(free);
    await Bun.sleep(500);
    expect(logged('change-email').slice(linksBefore).map((entry) => entry.to)).toEqual([free]);
    expect((await sessionUser(cookie)).email).toBe(email);
  });

  test('an invalid or unchanged address is refused, and so is a request without a session', async () => {
    const { cookie, email } = await newAccount();
    const linksBefore = logged('change-email').length;

    expect((await requestChange(cookie, 'not-an-email')).status).toBe(400);
    const unchanged = await requestChange(cookie, email.toUpperCase());
    expect(unchanged.status).toBe(400);
    expect(await unchanged.json()).toMatchObject({ message: 'Email is the same' });
    expect((await requestChange('', 'anonymous@example.com')).status).toBe(401);

    await Bun.sleep(500);
    expect(logged('change-email')).toHaveLength(linksBefore);
  });

  test('an invalid or expired link lands on the account page with its error and changes nothing', async () => {
    const { cookie, email } = await newAccount();

    const tampered = landingOf(await openLink(`${server.url}/api/auth/verify-email?token=not-a-token&callbackURL=${encodeURIComponent(CALLBACK)}`, cookie));
    expect([tampered.pathname, tampered.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'INVALID_TOKEN']);
    expect(await pageAt(`${tampered.pathname}${tampered.search}`, cookie)).toContain('This confirmation link is invalid.');

    const expiredToken = expiredChangeToken(email, `expired-${accounts}@example.com`);
    const expired = landingOf(await openLink(`${server.url}/api/auth/verify-email?token=${expiredToken}&callbackURL=${encodeURIComponent(CALLBACK)}`, cookie));
    expect([expired.pathname, expired.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'TOKEN_EXPIRED']);
    const expiredPage = await pageAt(`${expired.pathname}${expired.search}`, cookie);
    expect(expiredPage).toContain('This confirmation link has expired.');
    expect(expiredPage).not.toContain('Your email address is now');

    expect((await sessionUser(cookie)).email).toBe(email);
  });

  test('a reused link, or one opened by another account, lands with its error and changes nothing more', async () => {
    const owner = await newAccount();
    const other = await newAccount();
    const target = `reused-${accounts}@example.com`;
    expect((await requestChange(owner.cookie, target)).status).toBe(200);
    const link = await linkSentTo(target);

    const foreign = landingOf(await openLink(link, other.cookie));
    expect([foreign.pathname, foreign.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'INVALID_USER']);
    expect((await sessionUser(owner.cookie)).email).toBe(owner.email);

    expect(landingOf(await openLink(link, owner.cookie)).searchParams.get('error')).toBeNull();
    const reused = landingOf(await openLink(link, owner.cookie));
    expect([reused.pathname, reused.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'USER_NOT_FOUND']);
    expect((await sessionUser(owner.cookie)).email).toBe(target);
  });

  test('a link whose address was taken in the meantime lands with an error, not a server failure', async () => {
    const owner = await newAccount();
    const target = `wanted-${accounts}@example.com`;
    expect((await requestChange(owner.cookie, target)).status).toBe(200);
    const link = await linkSentTo(target);

    const rival = await post('/api/auth/sign-up/email', { email: target, password: PASSWORD, name: 'Rival' });
    expect(rival.status).toBe(200);

    const landing = landingOf(await openLink(link, owner.cookie));
    expect([landing.pathname, landing.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'EMAIL_TAKEN']);
    expect(await pageAt(`${landing.pathname}${landing.search}`, owner.cookie)).toContain('can no longer be used');
    expect((await sessionUser(owner.cookie)).email).toBe(owner.email);
  });

  test('a link opened without a session changes nothing and signs nobody in, and still works once signed in', async () => {
    const owner = await newAccount();
    const target = `second-${accounts}@example.com`;
    expect((await requestChange(owner.cookie, target)).status).toBe(200);
    const link = await linkSentTo(target);

    const anonymous = await openLink(link);
    const landing = landingOf(anonymous);
    expect([landing.pathname, landing.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'SIGN_IN_REQUIRED']);
    expect(anonymous.headers.getSetCookie()).toEqual([]);
    expect((await sessionUser(owner.cookie)).email).toBe(owner.email);

    expect(landingOf(await openLink(link, owner.cookie)).searchParams.get('error')).toBeNull();
    expect((await sessionUser(owner.cookie)).email).toBe(target);
  });

  test('a callback that leaves the site is refused with a 4xx on the verification route, never redirected to', async () => {
    for (const callback of ['/\t/evil.example', '/\n/evil.example', '//evil.example', '/\\evil.example', 'https://evil.example/']) {
      const url = `${server.url}/api/auth/verify-email?token=x&callbackURL=${encodeURIComponent(callback)}`;
      const response = await openLink(url);
      expect([JSON.stringify(callback), response.status >= 400 && response.status < 500, response.headers.get('location')]).toEqual([
        JSON.stringify(callback),
        true,
        null,
      ]);
    }
  });

  test('the public verification route is closed, and the server logs no error', async () => {
    const { cookie, email } = await newAccount();
    const resend = await post('/api/auth/send-verification-email', { email }, { cookie });
    expect(resend.status).toBe(404);

    await Bun.sleep(1_000);
    const { stdout, stderr } = server.output();
    expect(`${stdout}\n${stderr}`).not.toMatch(/⨯|\[Error|ERROR/);
  });
});
