import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

// The query client every project with TanStack Query and tRPC on Next.js, or TanStack Query on TanStack Start, gets
// from the `tanstack-query/query-client` partial (the blueprints that render it: dapp-privy-nextjs,
// dapp-rainbowkit-nextjs, org-dashboard-nextjs, org-dashboard-tanstack-start, multitenant-saas-nextjs,
// cloudflare-fullstack-nextjs).
const PROJECTS = [
  { name: 'nextjs-trpc', app: 'web:nextjs:trpc,tanstack-query', file: 'src/trpc/query-client.ts' },
  { name: 'start', app: 'web:tanstack-start:tanstack-query', file: 'src/lib/query-client.ts' },
  { name: 'start-trpc', app: 'web:tanstack-start:tanstack-query,trpc', file: 'src/lib/query-client.ts' },
];

interface Queries {
  staleTime: number;
  retry?: (failureCount: number, error: unknown) => boolean;
}
interface QueryClientModule {
  makeQueryClient: () => { options: { defaultOptions: { queries: Queries } } };
}

const globals = globalThis as { window?: unknown };

describe.each(PROJECTS)('query client of $name', ({ name, app, file }) => {
  let tempDir: string;
  let module: QueryClientModule;

  const queriesIn = (environment: 'browser' | 'server'): Queries => {
    if (environment === 'browser') globals.window = {};
    try {
      return module.makeQueryClient().options.defaultOptions.queries;
    } finally {
      delete globals.window;
    }
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([name, '--app', app, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(
      join(stubs, 'query.mjs'),
      `export const defaultShouldDehydrateQuery = () => false;
export class QueryClient { constructor(options) { this.options = options; } }`,
    );
    await Bun.write(join(stubs, 'superjson.mjs'), 'export default { serialize: (value) => value, deserialize: (value) => value };');
    module = await evaluateGeneratedModule<QueryClientModule>(
      await readTextFile(join(tempDir, name, file)),
      join(stubs, 'query-client.mjs'),
      { '@tanstack/react-query': join(stubs, 'query.mjs'), superjson: join(stubs, 'superjson.mjs') },
    );
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const refused = (httpStatus: number) => ({ data: { httpStatus } });

  test('the browser does not retry a refused query', () => {
    const retry = queriesIn('browser').retry as NonNullable<Queries['retry']>;
    for (const status of [400, 401, 403, 404, 422]) expect(retry(0, refused(status)), String(status)).toBe(false);
  });

  test('the browser retries a server error or a dropped connection three times', () => {
    const retry = queriesIn('browser').retry as NonNullable<Queries['retry']>;
    for (const error of [refused(500), refused(503), new TypeError('Failed to fetch'), null]) {
      expect(retry(0, error)).toBe(true);
      expect(retry(2, error)).toBe(true);
      expect(retry(3, error)).toBe(false);
    }
  });

  test('the server keeps TanStack default, which does not retry', () => {
    expect(queriesIn('server').retry).toBeUndefined();
  });

  test('the stale time stays on both sides', () => {
    expect(queriesIn('browser').staleTime).toBe(30_000);
    expect(queriesIn('server').staleTime).toBe(30_000);
  });
});
