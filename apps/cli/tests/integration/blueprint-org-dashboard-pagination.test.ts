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

interface PageControls extends PageParams {
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

interface Pagination {
  PAGE_SIZES: readonly number[];
  DEFAULT_PAGE: number;
  DEFAULT_PAGE_SIZE: number;
  MAX_PAGE: number;
  parsePageParams: (search: unknown) => PageParams;
  pageSearch: (search: Record<string, unknown>) => Partial<PageParams>;
  pageCountOf: (total: number, pageSize: number) => number;
  pageControls: (params: PageParams, write: (search: Partial<PageParams>) => void) => PageControls;
}

interface Row {
  id: string;
  createdAt: number;
}

interface ListCaller {
  list: (input?: unknown) => Promise<Row[]>;
  count: () => Promise<number>;
}

interface Caller {
  contact: ListCaller;
  user: ListCaller;
}

interface Database {
  countQueries: number;
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
  'permissions.mjs': "export const DEFAULT_ROLE = 'user'; export const ROLE_ID = /^[a-z0-9-]+$/;",
  'role-assignment.mjs': 'export const listAssignableRoles = async () => [];',
  // Column names stand for columns; the query builder applies orderBy, limit and offset to an array of rows.
  // The next/navigation and TanStack Router the generated hooks call: they record where the hook navigates.
  'next-navigation.mjs': `export const navigation = { pushed: [], path: '/contacts', query: '' };
export const useRouter = () => ({ push: (url) => navigation.pushed.push(url) });
export const usePathname = () => navigation.path;
export const useSearchParams = () => new URLSearchParams(navigation.query);`,
  'tanstack-router.mjs': `export const router = { navigations: [], search: {} };
export const useNavigate = () => (options) => router.navigations.push(options);
export const useSearch = () => router.search;`,
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
export const databaseOf = (rows) => {
  const database = { countQueries: 0, select: (columns) => {
    if (columns) database.countQueries++;
    return { from: () => query(rows, columns) };
  } };
  return database;
};`,
};

describe.each(BLUEPRINTS)('%s pagination', (blueprint) => {
  let tempDir: string;
  let project: string;
  let stubs: string;
  let pagination: Pagination;
  let database: (rows: Row[]) => Database;
  let caller: (db: Database) => Caller;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, blueprint);

    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(STUBS)) await Bun.write(join(stubs, file), source);

    pagination = await evaluateGeneratedModule<Pagination>(
      await readTextFile(join(project, API, 'pagination.ts')),
      join(stubs, 'pagination.mjs'),
      { zod: REAL.zod },
    );

    await evaluateGeneratedModule(
      await readTextFile(join(project, API, 'page-query.ts')),
      join(stubs, 'page-query.mjs'),
      { '@repo/db': './db.mjs', './pagination': './pagination.mjs' },
    );

    await evaluateGeneratedModule(await readTextFile(join(project, API, 'role-input.ts')), join(stubs, 'role-input.mjs'), {
      zod: REAL.zod,
      '@repo/auth/permissions': './permissions.mjs',
    });

    const imports = {
      zod: REAL.zod,
      '@repo/db': './db.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@repo/auth/role-assignment': './role-assignment.mjs',
      '../role-input': './role-input.mjs',
      '../page-query': './page-query.mjs',
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
    ({ databaseOf: database } = (await import(join(stubs, 'database.mjs'))) as { databaseOf: (rows: Row[]) => Database });
    const [contact, user] = routers;
    const appRouter = router({ contact: contact?.contactRouter, user: user?.userRouter });
    caller = (db) => createCallerFactory(appRouter)({ db, session: { user: { id: 'u1', role: 'admin' } } });
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

    test('a page that is not a positive integer, or is past the cap, is the first page', () => {
      expect(pagination.MAX_PAGE).toBe(10_000);
      expect(pagination.parsePageParams({ page: String(pagination.MAX_PAGE) }).page).toBe(pagination.MAX_PAGE);
      for (const page of ['0', '-3', '1.5', 'abc', '', ' ', 'NaN', 'Infinity', null, undefined, {}, '10001', '9999999999999999999']) {
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

    test('the page count is at least one and rounds up', () => {
      expect(pagination.pageCountOf(0, 10)).toBe(1);
      expect(pagination.pageCountOf(10, 10)).toBe(1);
      expect(pagination.pageCountOf(11, 10)).toBe(2);
      expect(pagination.pageCountOf(25, 25)).toBe(1);
    });

    test('the controls write the page as a URL carries it: page one and the default size are left out', () => {
      const written: Partial<PageParams>[] = [];
      const controls = pagination.pageControls({ page: 3, pageSize: 25 }, (search) => written.push(search));
      expect([controls.page, controls.pageSize]).toEqual([3, 25]);
      controls.setPage(4);
      controls.setPage(pagination.DEFAULT_PAGE);
      controls.setPageSize(50);
      controls.setPageSize(pagination.DEFAULT_PAGE_SIZE);
      expect(written).toEqual([{ page: 4, pageSize: 25 }, { pageSize: 25 }, { pageSize: 50 }, {}]);
    });
  });

  describe.each(['contact', 'user'] as const)('%s.list and %s.count', (name) => {
    const list = (input?: unknown, rows = tableRows()) => caller(database(rows))[name].list(input);

    test('without input it returns the first page of the default size', async () => {
      expect(await list()).toHaveLength(pagination.DEFAULT_PAGE_SIZE);
    });

    test('the list returns rows only and never counts, the total is the count procedure', async () => {
      const db = database(tableRows());
      expect(Array.isArray(await caller(db)[name].list({ page: 2, pageSize: 10 }))).toBe(true);
      expect(db.countQueries).toBe(0);
      expect(await caller(db)[name].count()).toBe(ROWS);
      expect(db.countQueries).toBe(1);
      expect(await caller(database([]))[name].count()).toBe(0);
    });

    test('pages cover every row exactly once, in a stable order', async () => {
      const seen: string[] = [];
      for (const page of [1, 2, 3]) seen.push(...(await list({ page, pageSize: 10 })).map((row) => row.id));
      expect(seen).toHaveLength(ROWS);
      expect(new Set(seen).size).toBe(ROWS);
      // Newest first, and the highest id first among rows created together.
      const expected = tableRows()
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
        .map((row) => row.id);
      expect(seen).toEqual(expected);
    });

    test('the last page holds the remainder', async () => {
      expect(await list({ page: 3, pageSize: 10 })).toHaveLength(5);
    });

    test('a page past the end is empty', async () => {
      expect(await list({ page: 4, pageSize: 10 })).toEqual([]);
    });

    test('a table without rows has no items', async () => {
      expect(await list({ page: 1, pageSize: 10 }, [])).toEqual([]);
    });

    test('the page size sets how many rows a page holds', async () => {
      expect(await list({ page: 1, pageSize: 25 })).toHaveLength(ROWS);
      expect(await list({ page: 2, pageSize: 25 })).toHaveLength(0);
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
        expect(result, JSON.stringify(input)).toHaveLength(pagination.DEFAULT_PAGE_SIZE);
      }
    });

    test('an input that is not an object is refused', async () => {
      await expect(list('everything')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('usePageParams', () => {
    const load = async () => {
      const hook = await readTextFile(join(project, 'apps/web/src/hooks/use-page-params.ts'));
      return evaluateGeneratedModule<{ usePageParams: () => PageControls }>(hook, join(stubs, 'use-page-params.mjs'), {
        '@repo/api/pagination': './pagination.mjs',
        'next/navigation': './next-navigation.mjs',
        '@tanstack/react-router': './tanstack-router.mjs',
      });
    };

    if (blueprint === 'org-dashboard-nextjs') {
      const visit = async (query: string) => {
        const { navigation } = (await import(join(stubs, 'next-navigation.mjs'))) as {
          navigation: { pushed: string[]; path: string; query: string };
        };
        navigation.pushed = [];
        navigation.query = query;
        const { usePageParams } = await load();
        return { controls: usePageParams(), pushed: navigation.pushed };
      };

      test('reads the page from the URL, the first value of a repeated parameter and the defaults for a bad one', async () => {
        expect(pickPage((await visit('page=3&pageSize=25')).controls)).toEqual({ page: 3, pageSize: 25 });
        expect(pickPage((await visit('page=4&page=2')).controls)).toEqual({ page: 4, pageSize: 10 });
        expect(pickPage((await visit('page=abc&pageSize=7')).controls)).toEqual({ page: 1, pageSize: 10 });
        expect(pickPage((await visit('')).controls)).toEqual({ page: 1, pageSize: 10 });
      });

      test('a page change keeps the other parameters and leaves page one out', async () => {
        const { controls, pushed } = await visit('other=x&page=3&pageSize=25');
        controls.setPage(4);
        controls.setPage(1);
        expect(pushed).toEqual(['/contacts?other=x&page=4&pageSize=25', '/contacts?other=x&pageSize=25']);
      });

      test('a page size change goes back to page one and leaves the default size out', async () => {
        const { controls, pushed } = await visit('other=x&page=3&pageSize=25');
        controls.setPageSize(50);
        controls.setPageSize(10);
        expect(pushed).toEqual(['/contacts?other=x&pageSize=50', '/contacts?other=x']);
      });

      test('with nothing else in the URL, page one is the bare path', async () => {
        const { controls, pushed } = await visit('page=2');
        controls.setPage(1);
        expect(pushed).toEqual(['/contacts']);
      });
    } else {
      const visit = async (search: Record<string, unknown>) => {
        const { router } = (await import(join(stubs, 'tanstack-router.mjs'))) as {
          router: { navigations: { to: string; search: (previous: Record<string, unknown>) => Record<string, unknown> }[]; search: unknown };
        };
        router.navigations = [];
        router.search = search;
        const { usePageParams } = await load();
        return { controls: usePageParams(), navigations: router.navigations };
      };

      test('reads the page from the route search, and the defaults for a bad one', async () => {
        expect(pickPage((await visit({ page: 3, pageSize: 25 })).controls)).toEqual({ page: 3, pageSize: 25 });
        expect(pickPage((await visit({ page: 'abc', pageSize: 7 })).controls)).toEqual({ page: 1, pageSize: 10 });
        expect(pickPage((await visit({})).controls)).toEqual({ page: 1, pageSize: 10 });
      });

      test('a page change keeps the other search values and leaves page one out', async () => {
        const { controls, navigations } = await visit({ other: 'x', page: 3, pageSize: 25 });
        controls.setPage(4);
        controls.setPage(1);
        expect(navigations.map((navigation) => navigation.to)).toEqual(['.', '.']);
        const previous = { other: 'x', page: 3, pageSize: 25 };
        expect(navigations.map((navigation) => navigation.search(previous))).toEqual([
          { other: 'x', page: 4, pageSize: 25 },
          { other: 'x', page: undefined, pageSize: 25 },
        ]);
      });

      test('a page size change goes back to page one and leaves the default size out', async () => {
        const { controls, navigations } = await visit({ other: 'x', page: 3, pageSize: 25 });
        controls.setPageSize(50);
        controls.setPageSize(10);
        const previous = { other: 'x', page: 3, pageSize: 25 };
        expect(navigations.map((navigation) => navigation.search(previous))).toEqual([
          { other: 'x', page: undefined, pageSize: 50 },
          { other: 'x', page: undefined, pageSize: undefined },
        ]);
      });
    }
  });
});

const pickPage = ({ page, pageSize }: PageParams): PageParams => ({ page, pageSize });
