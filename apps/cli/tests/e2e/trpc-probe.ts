import { expect } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { $ } from 'bun';
import { fileExists, filesContaining } from './helpers';

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
/** What a failing query's error message carries; a production client must never see it. */
const INTERNAL_DETAIL = "select * from users where email = 'leak@example.com'";
/** Start serves a buffered response to user agents it classifies as bots, so streaming needs a browser agent. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const FOREIGN_ORIGIN = 'https://attacker.example';

const CHROME = [process.env.CHROME_PATH, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(
  (candidate) => candidate && Bun.which(candidate),
);
export const CHROME_AVAILABLE = CHROME !== undefined;

/** Title of a test that needs Chrome: it says so when the test is skipped. */
export function chromeTestTitle(title: string): string {
  return CHROME_AVAILABLE ? title : `${title} (skipped: Chrome is not installed)`;
}

// Test-only router: a slow procedure returning a Date, a procedure failing with internal details, a mutation,
// and with better-auth the session the context read and a protected procedure.
const probeRouter = (initImport: string, { auth }: TrpcProbeOptions): string => `import { z } from 'zod';
import { ${auth ? 'protectedProcedure, ' : ''}publicProcedure, router } from '${initImport}';

export const probeRouter = router({
  time: publicProcedure.query(async () => {
    await new Promise((resolve) => setTimeout(resolve, ${STREAM_DELAY_MS}));
    return { at: new Date('${PROBE_DATE}'), marker: '${SERVER_MARKER}' };
  }),
  fail: publicProcedure.query(() => {
    throw new Error("${INTERNAL_DETAIL}");
  }),
  echo: publicProcedure.input(z.object({ value: z.string() })).mutation(({ input }) => input),${
    auth
      ? `
  session: publicProcedure.query(({ ctx }) => ctx.session),
  me: protectedProcedure.query(({ ctx }) => ({ email: ctx.user.email })),`
      : ''
  }
});
`;

// Shows the probe's Date. data-hydrated flips after hydration, and data-is-date then shows the type the
// browser received.
const timeView = (readData: string): string => `function Time() {
  ${readData}
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const isDate = data.at instanceof Date;
  return (
    <p id="probe-time" data-hydrated={String(hydrated)} data-is-date={String(isDate)}>
      {isDate ? data.at.toISOString() : String(data.at)}
    </p>
  );
}
`;

// The loader prefetches without awaiting and the component suspends on the query: the page streams.
const streamedTrpcRoute = `import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense, useEffect, useState } from 'react';
import { useTRPC } from '@/trpc/providers';

export const Route = createFileRoute('/trpc-probe')({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(context.trpc.probe.time.queryOptions());
  },
  component: () => (
    <Suspense fallback={<p id="probe-loading">loading</p>}>
      <Time />
    </Suspense>
  ),
});

${timeView(`const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.probe.time.queryOptions());`)}`;

const vanillaTrpcRoute = `import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/trpc-probe')({
  loader: ({ context }) => context.trpc.probe.time.query(),
  component: Time,
});

${timeView('const data = Route.useLoaderData();')}`;

// TanStack Query without tRPC: the same streamed prefetch, from a plain query function.
const streamedQueryRoute = `import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense, useEffect, useState } from 'react';

const timeQuery = queryOptions({
  queryKey: ['query-probe-time'],
  queryFn: async () => {
    await new Promise((resolve) => setTimeout(resolve, ${STREAM_DELAY_MS}));
    return { at: new Date('${PROBE_DATE}') };
  },
});

export const Route = createFileRoute('/query-probe')({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(timeQuery);
  },
  component: () => (
    <Suspense fallback={<p id="probe-loading">loading</p>}>
      <Time />
    </Suspense>
  ),
});

${timeView('const { data } = useSuspenseQuery(timeQuery);')}`;

// getSession() and the tRPC context read the session during one SSR request: the shared cache hands both
// the same object.
const sessionProbeRoute = ({ query }: TrpcProbeOptions): string => `import { createFileRoute } from '@tanstack/react-router';
import { TRPCClientError } from '@trpc/client';
import { getSession } from '@/lib/auth/session';

export const Route = createFileRoute('/trpc-session-probe')({
  loader: async ({ context }) => {
    const [session, trpcSession, me] = await Promise.all([
      getSession(),
      ${query ? 'context.queryClient.fetchQuery(context.trpc.probe.session.queryOptions())' : 'context.trpc.probe.session.query()'},
      ${query ? 'context.queryClient.fetchQuery(context.trpc.probe.me.queryOptions())' : 'context.trpc.probe.me.query()'}.then(
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
  if (await fileExists(packageRoot)) {
    await writeProjectFile(join(projectDir, 'packages/api/src/router/probe.ts'), probeRouter('../trpc', options));
    await registerProbeRouter(packageRoot, './router');
  } else {
    await writeProjectFile(join(appDir, 'src/trpc/routers/probe.ts'), probeRouter('@/trpc/init', options));
    await registerProbeRouter(join(appDir, 'src/trpc/routers/_app.ts'), '.');
  }

  const routes = join(appDir, 'src/routes');
  await writeProjectFile(join(routes, 'trpc-probe.tsx'), options.query ? streamedTrpcRoute : vanillaTrpcRoute);
  if (options.auth) await writeProjectFile(join(routes, 'trpc-session-probe.tsx'), sessionProbeRoute(options));
  if (options.auth && options.query) await writeProjectFile(join(routes, 'trpc-late-probe.tsx'), lateSessionRoute);
}

/** Writes a test-only route that prefetches a plain TanStack Query query, for an app without tRPC. */
export async function writeQueryProbe(appDir: string): Promise<void> {
  await writeProjectFile(join(appDir, 'src/routes/query-probe.tsx'), streamedQueryRoute);
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

function getProcedure(baseUrl: string, path: string, cookie = ''): Promise<Response> {
  return fetch(new URL(`/api/trpc/${path}`, baseUrl), { headers: { cookie } });
}

// workerd closes a connection whose request body the Worker left unread, as the 403 refusal does. `vite preview`
// then fails the next request it sends over that pooled connection with its own 500 "fetch failed" page
// (undici: "other side closed"), before the Worker sees it. Only that proxy error is sent again.
const PREVIEW_PROXY_ERROR = 'TypeError: fetch failed';

async function fetchThroughPreview(url: URL, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== 500 || !(await response.clone().text()).includes(PREVIEW_PROXY_ERROR)) return response;
  return fetch(url, init);
}

function postMutation(baseUrl: string, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetchThroughPreview(new URL(`/api/trpc/${path}`, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ json: { value: 'probe' } }),
  });
}

/** The server renders the probe's Date; with a streamed prefetch, the fallback leaves before the data. */
export async function expectServesProbePage(baseUrl: string, path: string, { streamed }: { streamed: boolean }): Promise<void> {
  const { status, chunks } = await fetchChunks(new URL(path, baseUrl).href);
  expect(status).toBe(200);
  const html = chunks.map((chunk) => chunk.text).join('');
  expect(elementText(html, 'probe-time')).toBe(PROBE_DATE);
  expect(html).toMatch(/id="probe-time"[^>]*data-is-date="true"/);

  if (streamed) {
    const first = chunks[0]?.text ?? '';
    expect(first).toContain('id="probe-loading"');
    expect(first).not.toContain(PROBE_DATE);
    const resolved = chunks.find((chunk) => chunk.text.includes(PROBE_DATE));
    expect(resolved?.at ?? 0).toBeGreaterThan((chunks[0]?.at ?? 0) + STREAM_DELAY_MS / 2);
  }
}

/** The API route answers with superjson, and the SSR page renders the procedure's Date. */
export async function expectTrpcServesProcedures(baseUrl: string, { query }: TrpcProbeOptions): Promise<void> {
  const response = await getProcedure(baseUrl, 'probe.time');
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    result: { data: { json: { at: string; marker: string }; meta: { values: Record<string, string[]> } } };
  };
  expect(body.result.data.json.at).toBe(PROBE_DATE);
  expect(body.result.data.meta.values.at).toEqual(['Date']);

  await expectServesProbePage(baseUrl, '/trpc-probe', { streamed: query });
}

/**
 * Production error responses carry no stack trace and no internal message, and the API route refuses a
 * write whose Origin is another origin while it serves same-origin writes, non-browser writes and reads.
 */
export async function expectTrpcGuards(baseUrl: string): Promise<void> {
  const invalid = await getProcedure(baseUrl, `hello.greet?input=${encodeURIComponent('{"json":{"name":""}}')}`);
  expect(invalid.status).toBe(400);
  const invalidBody = await invalid.text();
  expect(invalidBody).not.toContain('stack');
  const validation = JSON.parse(invalidBody) as { error: { json: { data: Record<string, unknown> } } };
  expect(validation.error.json.data.code).toBe('BAD_REQUEST');

  const failing = await getProcedure(baseUrl, 'probe.fail');
  expect(failing.status).toBe(500);
  const failure = await failing.text();
  expect(failure).not.toContain('leak@example.com');
  expect(failure).not.toContain('select');
  expect(failure).not.toContain('stack');
  const internal = JSON.parse(failure) as { error: { json: { message: string; data: Record<string, unknown> } } };
  expect(internal.error.json.message).toBe('Internal server error');
  expect(internal.error.json.data.code).toBe('INTERNAL_SERVER_ERROR');
  expect(internal.error.json.data).not.toHaveProperty('stack');

  const crossOrigin = await postMutation(baseUrl, 'probe.echo', { origin: FOREIGN_ORIGIN });
  expect(crossOrigin.status).toBe(403);
  const accepted: Record<string, string>[] = [
    { origin: new URL(baseUrl).origin },
    {},
    // Behind a proxy, the public host the page was served from arrives as X-Forwarded-Host.
    { origin: 'https://app.example', 'x-forwarded-host': 'app.example' },
  ];
  for (const headers of accepted) {
    const response = await postMutation(baseUrl, 'probe.echo', headers);
    expect(response.status, `${JSON.stringify(headers)}: ${await response.clone().text()}`).toBe(200);
  }
  const crossOriginRead = await fetchThroughPreview(new URL('/api/trpc/probe.time', baseUrl), {
    headers: { origin: FOREIGN_ORIGIN },
  });
  expect(crossOriginRead.status, await crossOriginRead.clone().text()).toBe(200);
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

export async function expectAnonymousTrpcSession(baseUrl: string, { query }: TrpcProbeOptions): Promise<void> {
  const me = await getProcedure(baseUrl, 'probe.me');
  expect(me.status).toBe(401);
  const body = (await me.json()) as { error: { json: { data: Record<string, unknown> } } };
  expect(body.error.json.data.code).toBe('UNAUTHORIZED');
  expect(body.error.json.data).not.toHaveProperty('stack');

  expect(await readSessionProbe(baseUrl, '')).toEqual({ email: null, sharedSession: true, me: 'UNAUTHORIZED' });
  if (query) expect(await readLateTrpcSession(baseUrl, '')).toBe('anonymous');
}

/** The protected procedure returns the signed-in user, and getSession() shares its lookup with the context. */
export async function expectSignedInTrpcSession(
  baseUrl: string,
  user: { email: string; cookie: string },
  { query }: TrpcProbeOptions,
): Promise<void> {
  const me = await getProcedure(baseUrl, 'probe.me', user.cookie);
  expect(me.status, await me.clone().text()).toBe(200);
  const body = (await me.json()) as { result: { data: { json: { email: string } } } };
  expect(body.result.data.json.email).toBe(user.email);

  expect(await readSessionProbe(baseUrl, user.cookie)).toEqual({
    email: user.email,
    sharedSession: true,
    me: user.email,
  });
  if (query) expect(await readLateTrpcSession(baseUrl, user.cookie)).toBe(user.email);
}

/** Loads the page in headless Chrome and checks the Date survived hydration. Needs CHROME_AVAILABLE. */
export async function expectDateSurvivesHydration(baseUrl: string, path: string): Promise<void> {
  if (!CHROME) throw new Error('Chrome is not installed');
  const profile = await mkdtemp(join(tmpdir(), 'trpc-probe-chrome-'));
  try {
    const url = new URL(path, baseUrl).href;
    const dom = await $`${CHROME} --headless=new --disable-gpu --no-sandbox --no-first-run --user-data-dir=${profile} --virtual-time-budget=10000 --dump-dom ${url}`
      .quiet()
      .text();
    expect(dom).toMatch(
      new RegExp(`id="probe-time" data-hydrated="true" data-is-date="true">${PROBE_DATE.replaceAll('.', '\\.')}<`),
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
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
