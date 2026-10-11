import { expect } from 'bun:test';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { $ } from 'bun';

export interface TrpcProbeOptions {
  /** better-auth is selected: the probe router reads the session and has a protected procedure. */
  auth: boolean;
  /** tanstack-query is selected: the router context holds the query client and the options proxy. */
  query: boolean;
}

interface ChunkArrival {
  at: number;
  text: string;
}

const PROBE_DATE = '2020-01-02T03:04:05.000Z';
const STREAM_DELAY_MS = 400;
/** Only the probe router contains it: finding it in a client asset means server code reached the browser. */
export const SERVER_MARKER = 'trpc-probe-server-only-marker';
/** Start serves a buffered response to user agents it classifies as bots, so streaming needs a browser agent. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// Test-only router: a slow procedure returning a Date, and with better-auth the session it read and a
// protected procedure.
const probeRouter = (initImport: string, { auth }: TrpcProbeOptions): string => `import { ${auth ? 'protectedProcedure, ' : ''}publicProcedure, router } from '${initImport}';

export const probeRouter = router({
  time: publicProcedure.query(async () => {
    await new Promise((resolve) => setTimeout(resolve, ${STREAM_DELAY_MS}));
    return { at: new Date('${PROBE_DATE}'), marker: '${SERVER_MARKER}' };
  }),${
    auth
      ? `
  session: publicProcedure.query(({ ctx }) => ctx.session),
  me: protectedProcedure.query(({ ctx }) => ({ email: ctx.user.email })),`
      : ''
  }
});
`;

// The loader prefetches without awaiting and the component suspends on the query: the page streams.
// data-hydrated flips after hydration, and data-is-date then shows the type the browser received.
const streamedPrefetchRoute = `import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense, useEffect, useState } from 'react';
import { useTRPC } from '@/trpc/providers';

export const Route = createFileRoute('/trpc-probe')({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(context.trpc.probe.time.queryOptions());
  },
  component: () => (
    <Suspense fallback={<p id="trpc-probe-loading">loading</p>}>
      <Time />
    </Suspense>
  ),
});

function Time() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.probe.time.queryOptions());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const isDate = data.at instanceof Date;
  return (
    <p id="trpc-probe-time" data-hydrated={String(hydrated)} data-is-date={String(isDate)}>
      {isDate ? data.at.toISOString() : String(data.at)}
    </p>
  );
}
`;

const vanillaLoaderRoute = `import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/trpc-probe')({
  loader: ({ context }) => context.trpc.probe.time.query(),
  component: Time,
});

function Time() {
  const data = Route.useLoaderData();
  const isDate = data.at instanceof Date;
  return (
    <p id="trpc-probe-time" data-is-date={String(isDate)}>
      {isDate ? data.at.toISOString() : String(data.at)}
    </p>
  );
}
`;

// getSession() and the tRPC context read the session during one SSR request: the shared cache hands both
// the same object.
const sessionProbeRoute = `import { createFileRoute } from '@tanstack/react-router';
import { TRPCClientError } from '@trpc/client';
import { getSession } from '@/lib/auth/session';

export const Route = createFileRoute('/trpc-session-probe')({
  loader: async ({ context }) => {
    const [session, trpcSession, me] = await Promise.all([
      getSession(),
      context.queryClient.fetchQuery(context.trpc.probe.session.queryOptions()),
      context.queryClient.fetchQuery(context.trpc.probe.me.queryOptions()).then(
        (user) => user.email,
        (error: unknown) => (error instanceof TRPCClientError ? String(error.data?.code) : String(error)),
      ),
    ]);
    return { email: session?.user.email ?? null, sharedSession: session === trpcSession, me };
  },
  component: () => <pre id="trpc-session-probe">{JSON.stringify(Route.useLoaderData())}</pre>,
});
`;

// No loader: the first procedure starts once a delay resolved, after the page shell was sent, so the
// context reads the request headers late in the stream.
const lateSessionRoute = `import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { useTRPC } from '@/trpc/providers';

export const Route = createFileRoute('/trpc-late-probe')({
  component: () => (
    <Suspense fallback={<p id="trpc-late-loading">loading</p>}>
      <AfterDelay />
    </Suspense>
  ),
});

function AfterDelay() {
  useSuspenseQuery({
    queryKey: ['trpc-late-probe-delay'],
    queryFn: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ${STREAM_DELAY_MS})),
  });
  return <LateSession />;
}

function LateSession() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.probe.session.queryOptions());
  return <p id="trpc-late-session">{data?.user.email ?? 'anonymous'}</p>;
}
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeProjectFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function registerProbeRouter(rootPath: string, routersDir: string): Promise<void> {
  const helloImport = `import { helloRouter } from '${routersDir}/hello';`;
  const root = await readFile(rootPath, 'utf8');
  const registered = root
    .replace(helloImport, `${helloImport}\nimport { probeRouter } from '${routersDir}/probe';`)
    .replace('hello: helloRouter,', 'hello: helloRouter,\n  probe: probeRouter,');
  expect(registered).toContain(`import { probeRouter } from '${routersDir}/probe';`);
  expect(registered).toContain('probe: probeRouter');
  await writeFile(rootPath, registered);
}

/** Writes the probe router (in packages/api in a turborepo) and the Start app's test-only routes. */
export async function writeTrpcProbe(projectDir: string, appDir: string, options: TrpcProbeOptions): Promise<void> {
  const packageRoot = join(projectDir, 'packages/api/src/root.ts');
  if (await exists(packageRoot)) {
    await writeProjectFile(join(projectDir, 'packages/api/src/router/probe.ts'), probeRouter('../trpc', options));
    await registerProbeRouter(packageRoot, './router');
  } else {
    await writeProjectFile(join(appDir, 'src/trpc/routers/probe.ts'), probeRouter('@/trpc/init', options));
    await registerProbeRouter(join(appDir, 'src/trpc/routers/_app.ts'), '.');
  }

  const routes = join(appDir, 'src/routes');
  await writeProjectFile(join(routes, 'trpc-probe.tsx'), options.query ? streamedPrefetchRoute : vanillaLoaderRoute);
  if (options.auth && options.query) {
    await writeProjectFile(join(routes, 'trpc-session-probe.tsx'), sessionProbeRoute);
    await writeProjectFile(join(routes, 'trpc-late-probe.tsx'), lateSessionRoute);
  }
}

async function fetchChunks(url: string, cookie = ''): Promise<{ status: number; chunks: ChunkArrival[] }> {
  const started = performance.now();
  const response = await fetch(url, { headers: { cookie, 'user-agent': BROWSER_USER_AGENT } });
  const decoder = new TextDecoder();
  const chunks: ChunkArrival[] = [];
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push({ at: performance.now() - started, text: decoder.decode(chunk, { stream: true }) });
  }
  return { status: response.status, chunks };
}

function elementText(html: string, id: string): string | undefined {
  return html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1];
}

async function getProcedure(baseUrl: string, path: string, cookie = ''): Promise<Response> {
  return fetch(new URL(`/api/trpc/${path}`, baseUrl), { headers: { cookie } });
}

/** The API route answers with superjson, the SSR page renders the procedure's Date. */
export async function expectTrpcServesProcedures(baseUrl: string, { query }: TrpcProbeOptions): Promise<void> {
  const response = await getProcedure(baseUrl, 'probe.time');
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    result: { data: { json: { at: string; marker: string }; meta: { values: Record<string, string[]> } } };
  };
  expect(body.result.data.json.at).toBe(PROBE_DATE);
  expect(body.result.data.meta.values.at).toEqual(['Date']);

  const { status, chunks } = await fetchChunks(new URL('/trpc-probe', baseUrl).href);
  expect(status).toBe(200);
  const html = chunks.map((chunk) => chunk.text).join('');
  expect(elementText(html, 'trpc-probe-time')).toBe(PROBE_DATE);
  expect(html).toMatch(/id="trpc-probe-time"[^>]*data-is-date="true"/);

  if (query) {
    // The fallback leaves before the slow procedure resolves; its result follows in a later chunk.
    const first = chunks[0]?.text ?? '';
    expect(first).toContain('id="trpc-probe-loading"');
    expect(first).not.toContain(PROBE_DATE);
    const resolved = chunks.find((chunk) => chunk.text.includes(PROBE_DATE));
    expect(resolved?.at ?? 0).toBeGreaterThan((chunks[0]?.at ?? 0) + STREAM_DELAY_MS / 2);
  }
}

async function readSessionProbe(baseUrl: string, cookie: string): Promise<unknown> {
  const { status, chunks } = await fetchChunks(new URL('/trpc-session-probe', baseUrl).href, cookie);
  expect(status).toBe(200);
  const json = elementText(chunks.map((chunk) => chunk.text).join(''), 'trpc-session-probe') ?? '';
  return JSON.parse(json.replaceAll('&quot;', '"'));
}

/** Reads the session through the tRPC context the way a page does: first called late in a streamed render. */
export async function readLateTrpcSession(baseUrl: string, cookie: string): Promise<string | undefined> {
  const { status, chunks } = await fetchChunks(new URL('/trpc-late-probe', baseUrl).href, cookie);
  expect(status).toBe(200);
  const html = chunks.map((chunk) => chunk.text).join('');
  expect(chunks[0]?.text ?? '').toContain('id="trpc-late-loading"');
  return elementText(html, 'trpc-late-session');
}

/** Reads the session through the tRPC context late in a streamed render, then over the API route. */
export async function readStartTrpcSession(baseUrl: string, cookie: string): Promise<string | null | undefined> {
  const rendered = await readLateTrpcSession(baseUrl, cookie);
  const response = await getProcedure(baseUrl, 'probe.session', cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result: { data: { json: { user: { email: string } } | null } } };
  expect(body.result.data.json?.user.email).toBe(rendered);
  return rendered;
}

export async function expectAnonymousTrpcSession(baseUrl: string): Promise<void> {
  const me = await getProcedure(baseUrl, 'probe.me');
  expect(me.status).toBe(401);
  const body = (await me.json()) as { error: { json: { data: { code: string } } } };
  expect(body.error.json.data.code).toBe('UNAUTHORIZED');

  expect(await readSessionProbe(baseUrl, '')).toEqual({ email: null, sharedSession: true, me: 'UNAUTHORIZED' });
  expect(await readLateTrpcSession(baseUrl, '')).toBe('anonymous');
}

/** The protected procedure returns the signed-in user, and getSession() shares its lookup with the context. */
export async function expectSignedInTrpcSession(baseUrl: string, user: { email: string; cookie: string }): Promise<void> {
  const me = await getProcedure(baseUrl, 'probe.me', user.cookie);
  expect(me.status, await me.clone().text()).toBe(200);
  const body = (await me.json()) as { result: { data: { json: { email: string } } } };
  expect(body.result.data.json.email).toBe(user.email);

  expect(await readSessionProbe(baseUrl, user.cookie)).toEqual({
    email: user.email,
    sharedSession: true,
    me: user.email,
  });
  expect(await readLateTrpcSession(baseUrl, user.cookie)).toBe(user.email);
}

function chromeBinary(): string {
  const candidates = [process.env.CHROME_PATH, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const found = candidates.find((candidate) => candidate && Bun.which(candidate));
  if (!found) throw new Error('The hydration check needs Chrome or Chromium: install it or set CHROME_PATH');
  return found;
}

/** Loads the page in headless Chrome and checks the Date survived hydration (superjson dehydration). */
export async function expectDateSurvivesHydration(baseUrl: string): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), 'trpc-probe-chrome-'));
  try {
    const url = new URL('/trpc-probe', baseUrl).href;
    const dom = await $`${chromeBinary()} --headless=new --disable-gpu --no-sandbox --no-first-run --user-data-dir=${profile} --virtual-time-budget=10000 --dump-dom ${url}`
      .quiet()
      .text();
    expect(dom).toMatch(
      new RegExp(`id="trpc-probe-time" data-hydrated="true" data-is-date="true">${PROBE_DATE.replaceAll('.', '\\.')}<`),
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

async function filesContaining(dir: string, needles: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name.endsWith('.map')) continue;
    const path = join(entry.parentPath, entry.name);
    const content = await readFile(path, 'utf8');
    if (needles.some((needle) => content.includes(needle))) matches.push(path);
  }
  return matches;
}

/**
 * The server build carries the probe router and the db schema; the client assets carry neither.
 * `markers` are strings only server code contains (the probe marker, a table name of the db schema).
 */
export async function expectClientBundleWithoutServerCode(
  clientDir: string,
  serverDir: string,
  markers: string[],
): Promise<void> {
  for (const marker of markers) {
    expect(await filesContaining(serverDir, [marker]), `${marker} in the server build`).not.toEqual([]);
  }
  expect(await filesContaining(clientDir, markers)).toEqual([]);
}
