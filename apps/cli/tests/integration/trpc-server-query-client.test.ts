import './timeout';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cleanupTempDir,
  createTempDir,
  evaluateGeneratedModule,
  REACT_ELEMENT_STUB,
  readTextFile,
  runCli,
} from './helpers';

interface Element {
  type: unknown;
  props: { state?: { dehydratedFrom: unknown }; children?: unknown };
}

interface QueryClientStandIn {
  prefetched: unknown[];
  prefetchQuery: (options: unknown) => Promise<void>;
}

interface ServerModule {
  getQueryClient?: () => QueryClientStandIn;
  HydrateClient: (props: { children: unknown }) => Element;
  prefetch: (options: { queryKey: unknown[] }) => void;
}

// Stand-ins for what the generated `trpc/server.tsx` imports. The query client is a recorder, React's `cache`
// memoizes like a request does, and `dehydrate` keeps the client it was given, so a test sees which client the
// hydration boundary and the prefetch helper use.
const STUBS: Record<string, string> = {
  'react.mjs': `${REACT_ELEMENT_STUB}
export const cache = (fn) => {
  let result;
  let called = false;
  return (...args) => {
    if (!called) {
      result = fn(...args);
      called = true;
    }
    return result;
  };
};`,
  'react-query.mjs': `export const dehydrate = (client) => ({ dehydratedFrom: client });
export const HydrationBoundary = () => null;`,
  'query-client.mjs': `export const makeQueryClient = () => ({
  prefetched: [],
  prefetchQuery(options) {
    this.prefetched.push(options);
    return Promise.resolve();
  },
});`,
  'trpc-client.mjs': `export const createTRPCClient = () => ({});
export const unstable_localLink = () => ({});`,
  'trpc-react-query.mjs': 'export const createTRPCOptionsProxy = () => ({});',
  'superjson.mjs': 'export default {};',
  'next-headers.mjs': 'export const headers = async () => new Headers();',
  'next-navigation.mjs': 'export const unstable_rethrow = () => {};',
  'server-only.mjs': '',
  'api.mjs': `export const appRouter = {};
export const createTRPCContext = async () => ({});`,
};

const IMPORTS: Record<string, string> = {
  react: './react.mjs',
  '@tanstack/react-query': './react-query.mjs',
  '@/trpc/query-client': './query-client.mjs',
  '@trpc/client': './trpc-client.mjs',
  '@trpc/tanstack-react-query': './trpc-react-query.mjs',
  superjson: './superjson.mjs',
  'next/headers': './next-headers.mjs',
  'next/navigation': './next-navigation.mjs',
  'server-only': './server-only.mjs',
  '@repo/api': './api.mjs',
  '@/trpc/routers/_app': './api.mjs',
  '@/trpc/init': './api.mjs',
};

const PROJECTS = [
  { name: 'single', args: ['--app', 'web:nextjs:trpc,tanstack-query'], server: 'src/trpc/server.tsx' },
  {
    name: 'turborepo',
    args: ['--app', 'web:nextjs:trpc,tanstack-query', '--app', 'api:hono'],
    server: 'apps/web/src/trpc/server.tsx',
  },
];

// Pages that await a record load it through the exported `getQueryClient`, and `HydrateClient` dehydrates that
// same client: without the export a page does not compile, and with another client the data never reaches the browser.
describe.each(PROJECTS)('the generated trpc/server.tsx of a $name project', ({ name, args, server }) => {
  let tempDir: string;
  let module: ServerModule;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);
    const source = await readTextFile(join(tempDir, name, server));
    module = await evaluateGeneratedModule<ServerModule>(source, join(stubs, 'generated-server.mjs'), IMPORTS, 'tsx');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('exports getQueryClient, one client per request', () => {
    expect(typeof module.getQueryClient).toBe('function');
    expect(module.getQueryClient?.()).toBe(module.getQueryClient?.());
  });

  test('hydrates the client the pages fetch into, and prefetch fills it too', () => {
    const client = module.getQueryClient?.();
    expect(client).toBeDefined();

    const boundary = module.HydrateClient({ children: null });
    expect(boundary.props.state?.dehydratedFrom).toBe(client);

    module.prefetch({ queryKey: ['users', 'list'] });
    expect(client?.prefetched).toEqual([{ queryKey: ['users', 'list'] }]);
  });
});
