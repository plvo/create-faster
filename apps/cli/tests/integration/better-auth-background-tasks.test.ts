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

const HARNESS_STUB = `export const harness = { calls: [], afterTasks: [], request: { waitUntilTasks: [] } };`;
const FACTORY_STUB = `import { harness } from './harness.mjs';
export const createAuth = (cookiePlugin, runInBackground) => {
  harness.calls.push({ cookiePlugin, runInBackground });
  return { marker: 'auth' };
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
    expect(auth).toEqual({ marker: 'auth' });
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

  test.if(framework === 'tanstack-start')('lets the task run on when the server offers no waitUntil', () => {
    const runInBackground = harness.calls[0]?.runInBackground as RunInBackground;
    expect(() => runInBackground(Promise.resolve())).not.toThrow();
  });
});
