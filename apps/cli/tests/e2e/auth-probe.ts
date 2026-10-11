import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e';

const PASSWORD = 'correct-horse-battery';
const CONCURRENT_SESSION_READS = 30;
const MIXED_USERS = 3;
const MIXED_ROUNDS = 24;
const SESSION_PROBE_PATH = '/session-probe';

interface SessionResponse {
  user: { email: string };
}

interface SessionProbe {
  email: string | null;
  sameSessionObject: boolean;
}

// Test-only route: reads the session three times concurrently during one SSR pass.
// The per-request cache memoizes the promise, so all three calls resolve to the same object.
const sessionProbeRoute = `import { createFileRoute } from '@tanstack/react-router';
import { getSession } from '@/lib/auth/session';

export const Route = createFileRoute('${SESSION_PROBE_PATH}')({
  loader: async () => {
    const [first, second, third] = await Promise.all([getSession(), getSession(), getSession()]);
    return { email: first?.user.email ?? null, sameSessionObject: first === second && second === third };
  },
  component: () => <pre id="session-probe">{JSON.stringify(Route.useLoaderData())}</pre>,
});
`;

const SESSION_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 15 * SESSION_REFRESH_AGE_MS;

// Test-only tRPC router: returns the session email the context read through its own auth instance.
const trpcSessionProbeRouter = `import { publicProcedure, router } from '../trpc';

export const sessionProbeRouter = router({
  whoami: publicProcedure.query(({ ctx }) => ({ email: ctx.session?.user.email ?? null })),
});
`;

export async function writeTrpcSessionProbe(projectDir: string): Promise<void> {
  const apiSrc = join(projectDir, 'packages/api/src');
  await writeFile(join(apiSrc, 'router/session-probe.ts'), trpcSessionProbeRouter);
  const rootPath = join(apiSrc, 'root.ts');
  const root = await readFile(rootPath, 'utf8');
  const registered = root
    .replace("import { helloRouter } from './router/hello';", "import { helloRouter } from './router/hello';\nimport { sessionProbeRouter } from './router/session-probe';")
    .replace('hello: helloRouter,', 'hello: helloRouter,\n  sessionProbe: sessionProbeRouter,');
  expect(registered).toContain('sessionProbe: sessionProbeRouter');
  await writeFile(rootPath, registered);
}

export async function writeSessionProbeRoute(appDir: string): Promise<void> {
  const routePath = join(appDir, 'src/routes', `${SESSION_PROBE_PATH}.tsx`);
  await mkdir(dirname(routePath), { recursive: true });
  await writeFile(routePath, sessionProbeRoute);
}

// `vite build` snapshots .env into dist/server/.dev.vars, which `vite preview` reads: write it before building.
export async function writeAuthEnv(appDir: string, port: number): Promise<void> {
  await writeFile(
    join(appDir, '.env'),
    `BETTER_AUTH_SECRET=${AUTH_SECRET}\nBETTER_AUTH_URL=http://127.0.0.1:${port}\n`,
  );
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(body),
  });
}

function readSession(baseUrl: string, cookie: string): Promise<Response> {
  return fetch(new URL('/api/auth/get-session', baseUrl), { headers: { cookie } });
}

async function readSessionProbe(baseUrl: string, cookie: string): Promise<SessionProbe> {
  const page = await fetch(new URL(SESSION_PROBE_PATH, baseUrl), { headers: { cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  const json = html.match(/<pre id="session-probe">([^<]*)<\/pre>/)?.[1] ?? '';
  return JSON.parse(json.replaceAll('&quot;', '"'));
}

async function signUp(baseUrl: string): Promise<{ email: string; cookie: string }> {
  const email = `${crypto.randomUUID()}@example.com`;
  const response = await postJson(baseUrl, '/api/auth/sign-up/email', { email, password: PASSWORD, name: email });
  expect(response.status).toBe(200);
  const cookie = cookieHeader(response);
  expect(cookie).toContain('session_token');
  return { email, cookie };
}

export async function expectAnonymousSession(baseUrl: string): Promise<void> {
  const anonymous = await readSession(baseUrl, '');
  expect(anonymous.status, await anonymous.clone().text()).toBe(200);
  expect(await anonymous.json()).toBeNull();
}

export async function expectAnonymousFlow(baseUrl: string): Promise<void> {
  await expectAnonymousSession(baseUrl);

  const probe = await readSessionProbe(baseUrl, '');
  expect(probe).toEqual({ email: null, sameSessionObject: true });
}

export async function expectAuthApiFlow(baseUrl: string): Promise<{ email: string; cookie: string }> {
  const { email, cookie: signUpCookie } = await signUp(baseUrl);

  const afterSignUp = await readSession(baseUrl, signUpCookie);
  expect(((await afterSignUp.json()) as SessionResponse).user.email).toBe(email);

  const wrongPassword = await postJson(baseUrl, '/api/auth/sign-in/email', { email, password: 'wrong-password-1' });
  expect(wrongPassword.status).toBe(401);

  const signIn = await postJson(baseUrl, '/api/auth/sign-in/email', { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  const signInCookie = cookieHeader(signIn);
  const afterSignIn = await readSession(baseUrl, signInCookie);
  expect(((await afterSignIn.json()) as SessionResponse).user.email).toBe(email);

  const burst = await Promise.all(
    Array.from({ length: CONCURRENT_SESSION_READS }, () => readSession(baseUrl, signInCookie)),
  );
  for (const response of burst) {
    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user.email).toBe(email);
  }

  return { email, cookie: signInCookie };
}

export async function expectSignedInFlow(baseUrl: string): Promise<void> {
  const { email, cookie } = await expectAuthApiFlow(baseUrl);
  const probe = await readSessionProbe(baseUrl, cookie);
  expect(probe).toEqual({ email, sameSessionObject: true });
}

// Server-rendered pages call the cached getSession(): concurrent renders for several users and a
// no-cookie client must each get their own session, never another caller's.
export async function expectMixedUsersKeepTheirOwnSession(baseUrl: string): Promise<void> {
  const users: { email: string; cookie: string }[] = [];
  for (let user = 0; user < MIXED_USERS; user++) users.push(await signUp(baseUrl));
  const callers = [...users, { email: null, cookie: '' }];

  const schedule = Array.from({ length: MIXED_ROUNDS }).flatMap(() => callers);
  const renders = await Promise.all(
    schedule.map((caller) => readSessionProbe(baseUrl, caller.cookie).then((probe) => ({ caller, probe }))),
  );

  for (const { caller, probe } of renders) {
    expect(probe).toEqual({ email: caller.email, sameSessionObject: true });
  }
}

async function readTrpcSession(baseUrl: string, cookie: string): Promise<string | null> {
  const response = await fetch(new URL('/api/trpc/sessionProbe.whoami', baseUrl), { headers: { cookie } });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { result: { data: { json: { email: string | null } } } };
  return body.result.data.json.email;
}

export async function expectTrpcAnonymousSession(baseUrl: string): Promise<void> {
  expect(await readTrpcSession(baseUrl, '')).toBeNull();
}

function sessionExpiries(dbPath: string, email: string): number[] {
  const db = new Database(dbPath);
  try {
    const rows = db
      .query('SELECT expires_at FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .all(email) as { expires_at: number }[];
    return rows.map((row) => row.expires_at);
  } finally {
    db.close();
  }
}

// A session past its refresh age: a tRPC read (its auth instance has no cookie plugin) must leave the
// expiry untouched, because a refresh there would extend the database row without extending the browser
// cookie. The app's own auth instance still refreshes it.
export async function expectTrpcReadsWithoutRefreshing(
  baseUrl: string,
  dbPath: string,
  user: { email: string; cookie: string },
): Promise<void> {
  expect(await readTrpcSession(baseUrl, user.cookie)).toBe(user.email);

  const staleExpiry = Date.now() + SESSION_LIFETIME_MS - SESSION_REFRESH_AGE_MS - 60_000;
  const db = new Database(dbPath);
  try {
    db.query('UPDATE user_sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(
      staleExpiry,
      user.email,
    );
  } finally {
    db.close();
  }

  expect(await readTrpcSession(baseUrl, user.cookie)).toBe(user.email);
  expect(sessionExpiries(dbPath, user.email).every((expiry) => expiry === staleExpiry)).toBe(true);

  const appRead = await readSession(baseUrl, user.cookie);
  expect(((await appRead.json()) as SessionResponse).user.email).toBe(user.email);
  const refreshed = Math.max(...sessionExpiries(dbPath, user.email));
  expect(refreshed).toBeGreaterThan(staleExpiry + SESSION_REFRESH_AGE_MS / 2);
}
