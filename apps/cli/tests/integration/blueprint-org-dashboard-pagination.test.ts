import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start'];

const API = 'packages/api/src';

interface PageParams {
  page: number;
  pageSize: number;
}

interface Pagination {
  PAGE_SIZES: readonly number[];
  DEFAULT_PAGE_SIZE: number;
  parsePageParams: (search: unknown) => PageParams;
  pageSearch: (search: unknown) => Partial<PageParams>;
}

interface Row {
  id: string;
  createdAt: number;
}

interface Page<T> {
  items: T[];
  total: number;
}

type ListCaller = (input?: unknown) => Promise<Page<Row>>;

interface Caller {
  contact: { list: ListCaller };
  user: { list: ListCaller };
}

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  zod: Bun.resolveSync('zod', import.meta.dir),
};

const ROWS = 25;

// Rows share a creation time in groups of five, so only a tie-break on the id keeps the order stable.
const tableRows = (): Row[] =>
  Array.from({ length: ROWS }, (_, index) => ({ id: `r${String(index).padStart(2, '0')}`, createdAt: Math.floor(index / 5) }));

const STUBS: Record<string, string> = {
  // A real tRPC instance: the procedures of the generated routers are the ones tRPC runs.
  'trpc.mjs': `import { initTRPC } from '${REAL.trpcServer}';
const t = initTRPC.context().create();
export const router = t.router;
export const protectedProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;`,
  'rbac.mjs': `import { protectedProcedure } from './trpc.mjs';
export const adminProcedure = protectedProcedure;
export const permissionProcedure = () => protectedProcedure;`,
  'auth.mjs': 'export const auth = {};',
  'password.mjs': "export const generatePassword = () => 'x';",
  // Column names stand for columns; the query builder applies orderBy, limit and offset to an array of rows.
  'db.mjs': `export const contactTable = { id: 'id', createdAt: 'createdAt' };
export const userTable = { id: 'id', createdAt: 'createdAt' };
export const desc = (column) => ({ column, direction: -1 });
export const asc = (column) => ({ column, direction: 1 });
export const eq = (column, value) => ({ column, value });
export const count = () => ({ aggregate: 'count' });`,
  'database.mjs': `const compare = (orders) => (a, b) => {
  for (const { column, direction } of orders) {
    if (a[column] !== b[column]) return (a[column] < b[column] ? -1 : 1) * direction;
  }
  return 0;
};
// The rows a query selects, once it is awaited: counted for count(), else ordered, offset and limited.
const query = (rows, columns) => {
  const state = { orders: [], limit: Infinity, offset: 0 };
  const run = () => {
    if (columns && Object.values(columns).some((column) => column?.aggregate === 'count')) return [{ count: rows.length }];
    const ordered = [...rows].sort(compare(state.orders));
    return ordered.slice(state.offset, state.offset + state.limit);
  };
  const builder = {
    orderBy: (...orders) => { state.orders = orders; return builder; },
    limit: (limit) => { state.limit = limit; return builder; },
    offset: (offset) => { state.offset = offset; return builder; },
    where: () => builder,
    then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
  };
  return builder;
};
export const databaseOf = (rows) => ({ select: (columns) => ({ from: () => query(rows, columns) }) });`,
};

describe.each(BLUEPRINTS)('%s pagination', (blueprint) => {
  let tempDir: string;
  let pagination: Pagination;
  let caller: (rows: Row[]) => Caller;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const project = join(tempDir, blueprint);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    pagination = await evaluateGeneratedModule<Pagination>(
      await readTextFile(join(project, API, 'pagination.ts')),
      join(stubs, 'pagination.mjs'),
      { zod: REAL.zod },
    );

    const imports = {
      zod: REAL.zod,
      '@repo/db': './db.mjs',
      '@repo/auth/password': './password.mjs',
      '../trpc': './trpc.mjs',
      '../middleware/rbac': './rbac.mjs',
      '../auth': './auth.mjs',
      '../pagination': './pagination.mjs',
    };
    const routers = await Promise.all(
      (['contact', 'user'] as const).map(async (name) =>
        evaluateGeneratedModule<Record<string, unknown>>(
          await readTextFile(join(project, API, 'router', `${name}.ts`)),
          join(stubs, `${name}-router.mjs`),
          imports,
        ),
      ),
    );
    const { router, createCallerFactory } = (await import(join(stubs, 'trpc.mjs'))) as {
      router: (procedures: Record<string, unknown>) => unknown;
      createCallerFactory: (appRouter: unknown) => (ctx: unknown) => Caller;
    };
    const { databaseOf } = (await import(join(stubs, 'database.mjs'))) as { databaseOf: (rows: Row[]) => unknown };
    const [contact, user] = routers;
    const appRouter = router({ contact: contact?.contactRouter, user: user?.userRouter });
    caller = (rows) => createCallerFactory(appRouter)({ db: databaseOf(rows), session: { user: { id: 'u1', role: 'admin' } } });
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('page parameters', () => {
    test('absent parameters are the first page of the default size', () => {
      expect(pagination.parsePageParams({})).toEqual({ page: 1, pageSize: pagination.DEFAULT_PAGE_SIZE });
      expect(pagination.parsePageParams(undefined)).toEqual({ page: 1, pageSize: pagination.DEFAULT_PAGE_SIZE });
    });

    test('strings from a query string and numbers from a router give the same page', () => {
      expect(pagination.parsePageParams({ page: '3', pageSize: '25' })).toEqual({ page: 3, pageSize: 25 });
      expect(pagination.parsePageParams({ page: 3, pageSize: 25 })).toEqual({ page: 3, pageSize: 25 });
    });

    test('the first value of a repeated parameter wins, as when the server and the browser read the same URL', () => {
      expect(pagination.parsePageParams({ page: ['4', '2'] }).page).toBe(4);
    });

    test('a page that is not a positive integer is the first page', () => {
      for (const page of ['0', '-3', '1.5', 'abc', '', ' ', 'NaN', 'Infinity', null, undefined, {}, '9999999999999999999']) {
        expect(pagination.parsePageParams({ page, pageSize: 25 }), String(page)).toEqual({ page: 1, pageSize: 25 });
      }
    });

    test('a page size outside the allowed set is the default size', () => {
      for (const pageSize of ['0', '-10', '7', '101', '1000000', 'abc', '', '10.5', null]) {
        expect(pagination.parsePageParams({ page: 2, pageSize }), String(pageSize)).toEqual({
          page: 2,
          pageSize: pagination.DEFAULT_PAGE_SIZE,
        });
      }
    });

    test('every allowed page size is accepted', () => {
      for (const pageSize of pagination.PAGE_SIZES) {
        expect(pagination.parsePageParams({ pageSize: String(pageSize) }).pageSize).toBe(pageSize);
      }
      expect(pagination.PAGE_SIZES).toContain(pagination.DEFAULT_PAGE_SIZE);
    });

    test('the search of a URL keeps only what differs from the defaults', () => {
      expect(pagination.pageSearch({})).toEqual({});
      expect(pagination.pageSearch({ page: 1, pageSize: pagination.DEFAULT_PAGE_SIZE })).toEqual({});
      expect(pagination.pageSearch({ page: '2' })).toEqual({ page: 2 });
      expect(pagination.pageSearch({ pageSize: 50 })).toEqual({ pageSize: 50 });
      expect(pagination.pageSearch({ page: 'abc', pageSize: '7', other: 'kept out' })).toEqual({});
    });
  });

  describe.each(['contact', 'user'] as const)('%s.list', (name) => {
    const list = (input?: unknown, rows = tableRows()) => caller(rows)[name].list(input);

    test('without input it returns the first page and the total', async () => {
      const result = await list();
      expect(result.total).toBe(ROWS);
      expect(result.items).toHaveLength(pagination.DEFAULT_PAGE_SIZE);
    });

    test('pages cover every row exactly once, in a stable order', async () => {
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const result = await list({ page, pageSize: 10 });
        expect(result.total).toBe(ROWS);
        seen.push(...result.items.map((row) => row.id));
      }
      expect(seen).toHaveLength(ROWS);
      expect(new Set(seen).size).toBe(ROWS);
      // Newest first, and the highest id first among rows created together.
      const expected = tableRows()
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
        .map((row) => row.id);
      expect(seen).toEqual(expected);
    });

    test('the last page holds the remainder', async () => {
      const result = await list({ page: 3, pageSize: 10 });
      expect(result.items).toHaveLength(5);
    });

    test('a page past the end is empty and still reports the total', async () => {
      const result = await list({ page: 4, pageSize: 10 });
      expect(result).toEqual({ items: [], total: ROWS });
    });

    test('a table without rows has no items and a total of zero', async () => {
      expect(await list({ page: 1, pageSize: 10 }, [])).toEqual({ items: [], total: 0 });
    });

    test('the page size sets how many rows a page holds', async () => {
      expect((await list({ page: 1, pageSize: 25 })).items).toHaveLength(ROWS);
      expect((await list({ page: 2, pageSize: 25 })).items).toHaveLength(0);
    });

    test('an invalid page or page size reads the default one, never the whole table', async () => {
      for (const input of [
        { page: 0, pageSize: 10 },
        { page: -2, pageSize: 10 },
        { page: 1.5, pageSize: 10 },
        { page: 'abc', pageSize: 10 },
        { page: 1, pageSize: 100000 },
        { page: 1, pageSize: 0 },
        { page: 1, pageSize: 'all' },
      ]) {
        const result = await list(input, Array.from({ length: 300 }, (_, index) => ({ id: `r${index}`, createdAt: index })));
        expect(result.items, JSON.stringify(input)).toHaveLength(pagination.DEFAULT_PAGE_SIZE);
        expect(result.total).toBe(300);
      }
    });

    test('an input that is not an object is refused', async () => {
      await expect(list('everything')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });
});
