import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

type RunInBackground = (task: Promise<unknown>) => void;

interface FactoryCall {
  cookiePlugin: unknown;
  runInBackground: RunInBackground | undefined;
}

interface Harness {
  calls: FactoryCall[];
  /** What `after` of `next/server` was given. */
  afterTasks: Promise<unknown>[];
  /** The current request; its `waitUntil` is absent on a server that offers none. */
  request: { waitUntil?: (task: Promise<unknown>) => void; waitUntilTasks: Promise<unknown>[] };
  /** Runs inside the auth handler of the factory stand-in, as better-auth hands a delivery to its handler. */
  onHandle?: (runInBackground: RunInBackground) => void;
}

const FRAMEWORK_STUBS = {
  nextjs: {
    'better-auth/next-js': `export const nextCookies = () => 'next-cookies';`,
    'next/server': `import { harness } from './harness.mjs'; export const after = (task) => harness.afterTasks.push(task);`,
  },
  'tanstack-start': {
    'better-auth/tanstack-start': `export const tanstackStartCookies = () => 'start-cookies';`,
    '@tanstack/react-start/server': `import { harness } from './harness.mjs'; export const getRequest = () => harness.request;`,
  },
} as const;

const HARNESS_STUB = `export const harness = { calls: [], afterTasks: [], request: { waitUntilTasks: [] }, onHandle: undefined };`;
const FACTORY_STUB = `import { harness } from './harness.mjs';
export const createAuth = (cookiePlugin, runInBackground) => {
  harness.calls.push({ cookiePlugin, runInBackground });
  return {
    marker: 'auth',
    handler: async () => {
      harness.onHandle?.(runInBackground);
      return new Response('answer');
    },
  };
};`;

interface Blueprint {
  name: string;
  framework: keyof typeof FRAMEWORK_STUBS;
  cookiePlugin: string;
}

const BLUEPRINTS: Blueprint[] = [
  { name: 'org-dashboard-nextjs', framework: 'nextjs', cookiePlugin: 'next-cookies' },
  { name: 'org-dashboard-tanstack-start', framework: 'tanstack-start', cookiePlugin: 'start-cookies' },
  { name: 'multitenant-saas-nextjs', framework: 'nextjs', cookiePlugin: 'next-cookies' },
];

// A link's delivery must run after the response, so an address that exists and one that does not answer alike. The
// app instance is what hands better-auth the framework's way to do it: the generated module is evaluated over the
// stand-ins of the framework and of the shared factory.
describe.each(BLUEPRINTS)('the background tasks of the web auth instance of $name', ({ name, framework, cookiePlugin }) => {
  let tempDir: string;
  let harness: Harness;
  let auth: unknown;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([name, '--blueprint', name, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'harness.mjs'), HARNESS_STUB);
    await Bun.write(join(stubs, 'factory.mjs'), FACTORY_STUB);
    const imports: Record<string, string> = { '@repo/auth/auth': join(stubs, 'factory.mjs') };
    for (const [specifier, source] of Object.entries(FRAMEWORK_STUBS[framework])) {
      const file = join(stubs, `${specifier.replaceAll('/', '-').replaceAll('@', '')}.mjs`);
      await Bun.write(file, source);
      imports[specifier] = file;
    }
    harness = ((await import(join(stubs, 'harness.mjs'))) as { harness: Harness }).harness;

    ({ auth } = await evaluateGeneratedModule<{ auth: unknown }>(
      await readTextFile(join(tempDir, name, 'apps/web/src/lib/auth/auth.ts')),
      join(stubs, 'auth.mjs'),
      imports,
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    harness.afterTasks = [];
    harness.request = { waitUntilTasks: [] };
  });

  test("builds the instance from the shared factory with the framework's cookie plugin and a background handler", () => {
    expect(auth).toMatchObject({ marker: 'auth' });
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]?.cookiePlugin).toBe(cookiePlugin);
    expect(typeof harness.calls[0]?.runInBackground).toBe('function');
  });

  test('hands a task to the framework without waiting for it', () => {
    const runInBackground = harness.calls[0]?.runInBackground as RunInBackground;
    const task = new Promise<void>(() => {});
    harness.request.waitUntil = function (this: Harness['request'], handed) {
      this.waitUntilTasks.push(handed);
    };

    runInBackground(task);

    const handed = framework === 'nextjs' ? harness.afterTasks : harness.request.waitUntilTasks;
    expect(handed).toEqual([task]);
  });

});

const ROUTE_STUB = `export const createFileRoute = () => (options) => ({ options });`;

// A Lambda runs the Nitro handler with no `waitUntil` on the request and freezes the process when the handler
// returns, so a delivery nobody awaits could be lost. The auth route holds the answer until it is done there, and
// leaves it to the server's `waitUntil` where there is one.
describe('the background tasks of the Start auth route', () => {
  const name = 'org-dashboard-tanstack-start';
  let tempDir: string;
  let harness: Harness;
  let handleAuthRequest: (request: Request) => Promise<Response>;
  let post: (context: { request: Request }) => Promise<Response>;

  const settlesWithin = async (answer: Promise<unknown>, milliseconds: number): Promise<boolean> =>
    Promise.race([answer.then(() => true), Bun.sleep(milliseconds).then(() => false)]);

  const delivery = () => {
    let finish: () => void = () => {};
    const task = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { task, finish };
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([name, '--blueprint', name, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'harness.mjs'), HARNESS_STUB);
    await Bun.write(join(stubs, 'factory.mjs'), FACTORY_STUB);
    await Bun.write(join(stubs, 'cookies.mjs'), FRAMEWORK_STUBS['tanstack-start']['better-auth/tanstack-start']);
    await Bun.write(join(stubs, 'server.mjs'), FRAMEWORK_STUBS['tanstack-start']['@tanstack/react-start/server']);
    await Bun.write(join(stubs, 'router.mjs'), ROUTE_STUB);
    harness = ((await import(join(stubs, 'harness.mjs'))) as { harness: Harness }).harness;

    const web = join(tempDir, name, 'apps/web/src');
    const auth = await evaluateGeneratedModule<{ handleAuthRequest: typeof handleAuthRequest }>(
      await readTextFile(join(web, 'lib/auth/auth.ts')),
      join(stubs, 'auth.mjs'),
      {
        '@repo/auth/auth': join(stubs, 'factory.mjs'),
        'better-auth/tanstack-start': join(stubs, 'cookies.mjs'),
        '@tanstack/react-start/server': join(stubs, 'server.mjs'),
      },
    );
    handleAuthRequest = auth.handleAuthRequest;
    const route = await evaluateGeneratedModule<{
      Route: { options: { server: { handlers: { POST: typeof post } } } };
    }>(await readTextFile(join(web, 'routes/api/auth/$.ts')), join(stubs, 'route.mjs'), {
      '@tanstack/react-router': join(stubs, 'router.mjs'),
      '@/lib/auth/auth': join(stubs, 'auth.mjs'),
    });
    post = route.Route.options.server.handlers.POST;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    harness.request = { waitUntilTasks: [] };
    harness.onHandle = undefined;
  });

  test('without a waitUntil the answer waits for the delivery', async () => {
    const { task, finish } = delivery();
    harness.onHandle = (runInBackground) => runInBackground(task);

    const answer = handleAuthRequest(new Request('http://localhost/api/auth/change-email', { method: 'POST' }));
    expect(await settlesWithin(answer, 50)).toBe(false);
    finish();
    expect(await (await answer).text()).toBe('answer');
  });

  test('the auth route answers through the same wait', async () => {
    const { task, finish } = delivery();
    harness.onHandle = (runInBackground) => runInBackground(task);

    const answer = post({ request: new Request('http://localhost/api/auth/change-email', { method: 'POST' }) });
    expect(await settlesWithin(answer, 50)).toBe(false);
    finish();
    expect((await answer).status).toBe(200);
  });

  test('with a waitUntil the answer does not wait, and the server keeps the delivery', async () => {
    const { task } = delivery();
    harness.request.waitUntil = function (this: Harness['request'], handed) {
      this.waitUntilTasks.push(handed);
    };
    harness.onHandle = (runInBackground) => runInBackground(task);

    const answer = handleAuthRequest(new Request('http://localhost/api/auth/change-email', { method: 'POST' }));
    expect(await settlesWithin(answer, 500)).toBe(true);
    expect(harness.request.waitUntilTasks).toEqual([task]);
  });

  test('a request that hands over nothing is answered at once', async () => {
    const answer = handleAuthRequest(new Request('http://localhost/api/auth/get-session'));
    expect(await settlesWithin(answer, 500)).toBe(true);
  });

  test('a task of one request is never awaited by another', async () => {
    const slow = delivery();
    harness.onHandle = (runInBackground) => runInBackground(slow.task);
    const first = handleAuthRequest(new Request('http://localhost/api/auth/change-email', { method: 'POST' }));
    await Bun.sleep(10);

    harness.request = { waitUntilTasks: [] };
    harness.onHandle = undefined;
    const second = handleAuthRequest(new Request('http://localhost/api/auth/get-session'));
    expect(await settlesWithin(second, 500)).toBe(true);
    expect(await settlesWithin(first, 50)).toBe(false);
    slow.finish();
    await first;
  });
});
