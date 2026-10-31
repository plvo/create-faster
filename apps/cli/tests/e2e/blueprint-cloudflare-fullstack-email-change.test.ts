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

const SEED_PASSWORD = 'password';
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123';
const ACCOUNT_PAGE = '/profile/account';
const LINK_LINE = /\[change-email\] (\S+) → (\S+)/g;

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

describe('cloudflare-fullstack-nextjs email change e2e', () => {
  let projectDir: string;
  let server: RunningServer;
  let clientCount = 0;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.url, 'x-forwarded-for': `10.4.4.${++clientCount}`, ...headers },
      body: JSON.stringify(body),
    });

  const signIn = async (email: string, password = SEED_PASSWORD): Promise<string> => {
    const response = await post('/api/auth/sign-in/email', { email, password });
    expect(response.status, await response.clone().text()).toBe(200);
    return cookieHeaderOf(response);
  };

  const sessionUser = async (cookie: string): Promise<{ email: string; emailVerified: boolean }> => {
    const response = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie } });
    return ((await response.json()) as { user: { email: string; emailVerified: boolean } }).user;
  };

  const requestChange = (cookie: string, newEmail: string): Promise<Response> =>
    post('/api/auth/change-email', { newEmail, callbackURL: '/profile/account?emailChange=confirmed' }, { cookie });

  const deliveredLinks = (): { to: string; link: string }[] =>
    [...server.output().stdout.matchAll(LINK_LINE)].map(([, to = '', link = '']) => ({ to, link }));

  const linkSentTo = async (address: string): Promise<string> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const delivered = deliveredLinks().find((entry) => entry.to === address);
      if (delivered) return delivered.link;
      await Bun.sleep(200);
    }
    throw new Error(`No [change-email] link logged for ${address}\n${server.output().stdout}`);
  };

  const openLink = async (link: string, cookie?: string): Promise<URL> => {
    const response = await fetch(link, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    expect(response.status, await response.clone().text()).toBe(302);
    return new URL(response.headers.get('location') ?? '', server.url);
  };

  const pageAt = async (landing: URL, cookie: string): Promise<string> => {
    const response = await fetch(new URL(`${landing.pathname}${landing.search}`, server.url), { headers: { cookie } });
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
      const cookie = await signIn('user@example.com');
      const before = await sessionUser(cookie);
      expect(before.email).toBe('user@example.com');

      const requested = await requestChange(cookie, 'New.Address@Example.com');
      expect([requested.status, await requested.json()]).toEqual([200, { status: true }]);

      const link = await linkSentTo('new.address@example.com');
      expect(link).toContain('/api/auth/verify-email?token=');

      expect((await sessionUser(cookie)).email).toBe('user@example.com');
      expect((await post('/api/auth/sign-in/email', { email: 'new.address@example.com', password: SEED_PASSWORD })).status).toBe(401);

      const landing = await openLink(link, cookie);
      expect([landing.pathname, landing.searchParams.get('emailChange'), landing.searchParams.get('error')]).toEqual([
        ACCOUNT_PAGE,
        'confirmed',
        null,
      ]);

      expect(await sessionUser(cookie)).toMatchObject({ email: 'new.address@example.com', emailVerified: true });
      expect((await post('/api/auth/sign-in/email', { email: 'user@example.com', password: SEED_PASSWORD })).status).toBe(401);
      await signIn('new.address@example.com');

      // Every dashboard page carries the user menu, which reads the email from the same session as the profile.
      const page = await pageAt(landing, cookie);
      expect(page).toContain('Your email address is now new.address@example.com.');
      expect(page.match(/new\.address@example\.com/g)?.length).toBeGreaterThanOrEqual(3);
      expect(page).not.toContain('user@example.com');
    },
    TIMEOUT_SERVER,
  );

  // better-auth signs in whoever opens the link when the browser has no session. An address typed with a typo
  // would then hand the account to the owner of that address, so the link works in a signed-in browser only.
  test('a link opened without a session changes nothing and signs nobody in, and still works once signed in', async () => {
    const cookie = await signIn('new.address@example.com');
    expect((await requestChange(cookie, 'second.address@example.com')).status).toBe(200);
    const link = await linkSentTo('second.address@example.com');

    const anonymous = await fetch(link, { redirect: 'manual' });
    const landing = new URL(anonymous.headers.get('location') ?? '', server.url);
    expect([anonymous.status, landing.pathname, landing.searchParams.get('error')]).toEqual([302, ACCOUNT_PAGE, 'SIGN_IN_REQUIRED']);
    expect(anonymous.headers.getSetCookie()).toEqual([]);
    expect((await sessionUser(cookie)).email).toBe('new.address@example.com');

    const signedIn = await openLink(link, cookie);
    expect(signedIn.searchParams.get('error')).toBeNull();
    expect((await sessionUser(cookie)).email).toBe('second.address@example.com');
  });

  test('a taken address and a free one get the same answer, and nothing is sent for the taken one', async () => {
    const cookie = await signIn('manager@example.com');
    const linksBefore = deliveredLinks().length;

    const taken = await requestChange(cookie, 'admin@example.com');
    const free = await requestChange(cookie, 'manager.free@example.com');
    expect([taken.status, await taken.json()]).toEqual([free.status, await free.json()]);

    await linkSentTo('manager.free@example.com');
    await Bun.sleep(500);
    expect(deliveredLinks().slice(linksBefore).map((entry) => entry.to)).toEqual(['manager.free@example.com']);
    expect((await sessionUser(cookie)).email).toBe('manager@example.com');
  });

  test('an invalid or unchanged address is refused', async () => {
    const cookie = await signIn('manager@example.com');
    const linksBefore = deliveredLinks().length;

    const invalid = await requestChange(cookie, 'not-an-email');
    expect(invalid.status).toBe(400);

    const unchanged = await requestChange(cookie, 'Manager@Example.com');
    expect(unchanged.status).toBe(400);
    expect(await unchanged.json()).toMatchObject({ message: 'Email is the same' });

    expect(deliveredLinks()).toHaveLength(linksBefore);
  });

  test('without a session the request is refused', async () => {
    const response = await requestChange('', 'anonymous@example.com');
    expect(response.status).toBe(401);
  });

  test('an invalid, expired, reused or foreign link redirects to the account page with its error and changes nothing', async () => {
    const cookie = await signIn('admin@example.com');

    const tampered = await openLink(`${server.url}/api/auth/verify-email?token=not-a-token&callbackURL=${encodeURIComponent('/profile/account?emailChange=confirmed')}`, cookie);
    expect([tampered.pathname, tampered.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'INVALID_TOKEN']);
    expect(await pageAt(tampered, cookie)).toContain('This confirmation link is invalid.');

    const expired = await openLink(
      `${server.url}/api/auth/verify-email?token=${expiredChangeToken('admin@example.com', 'admin.expired@example.com')}&callbackURL=${encodeURIComponent('/profile/account?emailChange=confirmed')}`,
      cookie,
    );
    expect([expired.pathname, expired.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'TOKEN_EXPIRED']);
    const expiredPage = await pageAt(expired, cookie);
    expect(expiredPage).toContain('This confirmation link has expired.');
    expect(expiredPage).not.toContain('Your email address is now');

    const memberCookie = await signIn('manager@example.com');
    const link = await linkSentTo('manager.free@example.com');
    const foreign = await openLink(link, cookie);
    expect([foreign.pathname, foreign.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'INVALID_USER']);
    expect((await sessionUser(memberCookie)).email).toBe('manager@example.com');
    expect((await sessionUser(cookie)).email).toBe('admin@example.com');

    expect((await openLink(link, memberCookie)).searchParams.get('error')).toBeNull();
    const reused = await openLink(link, memberCookie);
    expect([reused.pathname, reused.searchParams.get('error')]).toEqual([ACCOUNT_PAGE, 'USER_NOT_FOUND']);
    expect((await sessionUser(memberCookie)).email).toBe('manager.free@example.com');
  });

  test('the public verification route is closed, and the server logs no error', async () => {
    const cookie = await signIn('admin@example.com');
    const resend = await post('/api/auth/send-verification-email', { email: 'admin@example.com' }, { cookie });
    expect(resend.status).toBe(404);

    await Bun.sleep(1_000);
    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/⨯|\[Error|ERROR/);
  });
});
