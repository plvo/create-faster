import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, REACT_ELEMENT_STUB, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const FULLSTACK = 'cloudflare-fullstack-nextjs';
const ORG_DASHBOARD = 'org-dashboard-nextjs';
const APP = 'src/app/(dashboard)';

const redirectTo = (path: string): RegExp => new RegExp(`^redirect:${path}$`);

// Stand-ins for the modules the generated files import. The generated files run for real; the stand-ins record
// what they are called with, in `calls`, so a test asserts on behaviour and not on how the source is written.
const STUBS: Record<string, string> = {
  'recorder.mjs': `export const calls = [];
export const state = { denied: false, session: null, data: [], total: 0, sort: '-createdAt', search: '' };`,
  'react.mjs': `${REACT_ELEMENT_STUB}
export const Suspense = ({ children }) => children;
export const cache = (fn) => fn;
export const useRef = () => ({ current: null });`,
  'next-headers.mjs': 'export const headers = async () => new Headers();',
  'next-navigation.mjs': `export const redirect = (path) => { throw new Error('redirect:' + path); };
export const notFound = () => { throw new Error('not-found'); };
export const useParams = () => ({ id: 'u1' });`,
  'guards.mjs': `import { calls, state } from './recorder.mjs';
const guard = (name) => async () => {
  calls.push(name);
  if (state.denied) throw new Error('denied by ' + name);
  return state.session;
};
export const requireSession = guard('requireSession');
export const requireAdmin = guard('requireAdmin');
export const requirePermission = guard('requirePermission');
export const getSession = async () => {
  calls.push('getSession');
  return state.session;
};`,
  'server.mjs': `import { state } from './recorder.mjs';
export const getAuth = async () => ({ api: { getSession: async () => state.session } });
export const auth = { api: { getSession: async () => state.session } };`,
  'trpc.mjs': `import { calls, state } from './recorder.mjs';
// trpc.users.get.queryOptions(input) is { path: 'users.get', input }: two calls build the same key only when they name the same procedure and input.
const make = (path) => new Proxy({}, {
  get: (_, key) => {
    if (key === 'queryOptions') return (input) => ({ path: path.join('.'), input });
    if (key === 'mutationOptions' || key === 'queryFilter') return () => ({});
    return make([...path, key]);
  },
});
export const trpc = make([]);
export const useTRPC = () => trpc;
export const HydrateClient = ({ children }) => children;
export const prefetch = (options) => { calls.push(['prefetch', options]); };
// A query resolves to state.data; null stands for an id that matches no row.
export const getQueryClient = () => ({ fetchQuery: async (options) => { calls.push(['fetch', options]); return state.data; } });`,
  'react-query.mjs': `import { calls, state } from './recorder.mjs';
export const useSuspenseQuery = (options) => { calls.push(['read', options]); return { data: state.data }; };
export const useSuspenseQueries = ({ queries }) => queries.map((options) => {
  calls.push(['read', options]);
  return { data: options.path.endsWith('count') ? state.total : state.data };
});
export const useMutation = () => ({ mutate() {}, isPending: false });
export const useQueryClient = () => ({ invalidateQueries() {} });`,
  'form.mjs': 'export const useAppForm = () => ({ handleSubmit() {} });',
  // The hooks that read the page from the URL: the first page of the default size, and a record of what they write.
  'url-hooks.mjs': `import { calls, state } from './recorder.mjs';
const write = (name) => (...args) => { calls.push([name, ...args]); };
export const useUserListParams = () => ({
  page: 1, pageSize: 10, search: state.search, sort: state.sort,
  setPage: write('setPage'), setPageSize: write('setPageSize'), setSearch: write('setSearch'), setSort: write('setSort'),
});
export const usePageParams = () => ({ page: 1, pageSize: 10, setPage: write('setPage'), setPageSize: write('setPageSize') });`,
  'zod.mjs': 'export const z = new Proxy(() => {}, { get: () => z, apply: () => z });',
  'permissions.mjs': `export const statement = { user: ['list'] };
export const roleDefinitions = { admin: { user: ['list'] }, user: {} };`,
  'clients.mjs': `export const UsersClient = () => null;
export const UserClient = () => null;
export const DocumentsClient = () => null;`,
};

const SHARED_IMPORTS: Record<string, string> = {
  react: './react.mjs',
  'next/headers': './next-headers.mjs',
  'next/navigation': './next-navigation.mjs',
  '@tanstack/react-query': './react-query.mjs',
  '@/trpc/server': './trpc.mjs',
  '@/trpc/providers': './trpc.mjs',
  '@repo/ui/lib/form': './form.mjs',
  '@repo/auth/permissions': './permissions.mjs',
  zod: './zod.mjs',
  './users.client': './clients.mjs',
  './user.client': './clients.mjs',
  './documents.client': './clients.mjs',
  '@/hooks/use-user-list-params': './url-hooks.mjs',
  '@/hooks/use-page-params': './url-hooks.mjs',
  '@repo/api/pagination': './pagination.mjs',
  '@repo/api/user-list': './user-list.mjs',
};

interface Recorder {
  calls: unknown[];
  state: { denied: boolean; session: unknown; data: unknown; total: number; sort: string; search: string };
}

type Component = (props?: unknown) => unknown;
interface Element {
  type: unknown;
  props: { children?: unknown };
}

function* descendants(node: unknown): Generator<Element> {
  if (Array.isArray(node)) {
    for (const child of node) yield* descendants(child);
  } else if (node && typeof node === 'object' && 'type' in node) {
    yield node as Element;
    yield* descendants((node as Element).props.children);
  }
}

// Every page of the dashboard whose client tree reads a protected query through useSuspenseQuery. The page
// prefetches the key its client reads, behind the guard that matches the procedure.
const FIRST_PAGE = { page: 1, pageSize: 10 };

const PROTECTED_PAGES = [
  {
    title: 'the users list',
    page: `${APP}/admin/users/page.tsx`,
    props: { searchParams: Promise.resolve({}) },
    guard: 'requireAdmin',
    keys: [
      { path: 'users.list', input: { ...FIRST_PAGE, search: '', sort: '-createdAt' } },
      { path: 'users.count', input: { search: '' } },
    ],
    loads: 'prefetch',
    reader: { file: 'src/components/admin/user-table.tsx', exportName: 'UserTable' },
    client: 'UsersClient',
  },
  {
    title: 'a user',
    page: `${APP}/admin/users/[id]/page.tsx`,
    props: { params: Promise.resolve({ id: 'u1' }) },
    guard: 'requireAdmin',
    keys: [{ path: 'users.get', input: { id: 'u1' } }],
    loads: 'fetch',
    reader: { file: `${APP}/admin/users/[id]/user.client.tsx`, exportName: 'UserClient' },
    client: 'UserClient',
  },
  {
    title: 'the documents',
    page: `${APP}/page.tsx`,
    props: { searchParams: Promise.resolve({}) },
    guard: 'requireSession',
    keys: [{ path: 'documents.list', input: FIRST_PAGE }, { path: 'documents.count' }],
    loads: 'prefetch',
    reader: { file: `${APP}/documents.client.tsx`, exportName: 'DocumentsClient' },
    client: 'DocumentsClient',
  },
];

describe(`${FULLSTACK} protected pages on the server`, () => {
  let tempDir: string;
  let web: string;
  let stubs: string;
  let loaded = 0;
  let recorder: Recorder;
  let clients: Record<string, unknown>;
  let trpcStub: { HydrateClient: unknown };

  // Every import the explicit map does not cover renders nothing: each name it imports is an empty component.
  async function stubUnmapped(source: string, explicit: Record<string, string>): Promise<Record<string, string>> {
    const imports = { ...explicit };
    const declarations = source.matchAll(/^import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm);
    for (const [, clause, specifier] of declarations) {
      if (!clause || !specifier || specifier in imports) continue;
      const names = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '' && !name.startsWith('type '))
        .map((name) => name.split(/\s+as\s+/)[0] ?? name);
      const lines = names.map((name) => `export const ${name} = () => null;`);
      if (clause.split('{')[0]?.replace(/,\s*$/, '').trim()) lines.push('export default () => null;');
      const file = `unmapped-${loaded++}.mjs`;
      await Bun.write(join(stubs, file), lines.join('\n'));
      imports[specifier] = `./${file}`;
    }
    return imports;
  }

  async function load<T = Record<string, Component>>(
    file: string,
    extraImports: Record<string, string> = {},
    root = web,
  ): Promise<T> {
    const source = await readTextFile(join(root, file));
    const imports = await stubUnmapped(source, { ...SHARED_IMPORTS, '@/lib/auth/session': './guards.mjs', ...extraImports });
    const loader = file.endsWith('.tsx') ? 'tsx' : 'ts';
    return evaluateGeneratedModule<T>(source, join(stubs, `generated-${loaded++}.mjs`), imports, loader);
  }

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of [FULLSTACK, ORG_DASHBOARD]) {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    web = join(tempDir, FULLSTACK, 'apps/web');
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(stubs, name), source);
    recorder = await import(join(stubs, 'recorder.mjs'));
    clients = await import(join(stubs, 'clients.mjs'));
    trpcStub = await import(join(stubs, 'trpc.mjs'));

    // The page rules the pages and tables apply to the URL run for real, on the real zod.
    const real = { zod: Bun.resolveSync('zod', import.meta.dir) };
    const api = join(tempDir, FULLSTACK, 'packages/api/src');
    await evaluateGeneratedModule(await readTextFile(join(api, 'pagination.ts')), join(stubs, 'pagination.mjs'), real);
    await evaluateGeneratedModule(await readTextFile(join(api, 'user-list.ts')), join(stubs, 'user-list.mjs'), {
      ...real,
      './pagination': './pagination.mjs',
    });
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    recorder.calls.length = 0;
    recorder.state.denied = false;
    recorder.state.session = null;
    recorder.state.data = [];
    recorder.state.total = 0;
    recorder.state.sort = '-createdAt';
    recorder.state.search = '';
  });

  describe.each(PROTECTED_PAGES)('$title', ({ page, props, guard, keys, loads, reader, client }) => {
    test(`loads the keys its client reads, after ${guard}`, async () => {
      const route = await load(page);
      await route.default?.(props);
      expect(recorder.calls).toEqual([guard, ...keys.map((key) => [loads, key])]);

      recorder.calls.length = 0;
      const readerModule = await load(reader.file);
      await readerModule[reader.exportName]?.();
      expect(recorder.calls).toEqual(keys.map((key) => ['read', key]));
    });

    test(`never starts the query when ${guard} refuses`, async () => {
      recorder.state.denied = true;
      const route = await load(page);
      await expect(route.default?.(props)).rejects.toThrow(`denied by ${guard}`);
      expect(recorder.calls).toEqual([guard]);
    });

    test('hydrates the prefetched query into the client it renders', async () => {
      const route = await load(page);
      const root = (await route.default?.(props)) as Element;
      expect(root.type).toBe(trpcStub.HydrateClient);
      const rendered = [...descendants(root.props.children)].map((element) => element.type);
      expect(rendered).toContain(clients[client]);
    });
  });

  test('the user page asks for the user named in the URL', async () => {
    const route = await load(`${APP}/admin/users/[id]/page.tsx`);
    await route.default?.({ params: Promise.resolve({ id: 'someone-else' }) });
    expect(recorder.calls).toEqual(['requireAdmin', ['fetch', { path: 'users.get', input: { id: 'someone-else' } }]]);
  });

  test('the users page prefetches the list and the count the URL names', async () => {
    const route = await load(`${APP}/admin/users/page.tsx`);
    const searchParams = Promise.resolve({ page: '2', pageSize: '25', search: 'ada', sort: '-name' });
    await route.default?.({ searchParams });
    expect(recorder.calls).toEqual([
      'requireAdmin',
      ['prefetch', { path: 'users.list', input: { page: 2, pageSize: 25, search: 'ada', sort: '-name' } }],
      ['prefetch', { path: 'users.count', input: { search: 'ada' } }],
    ]);
  });

  test('the documents page prefetches the page the URL names', async () => {
    const route = await load(`${APP}/page.tsx`);
    await route.default?.({ searchParams: Promise.resolve({ page: '3', pageSize: '50' }) });
    expect(recorder.calls).toEqual([
      'requireSession',
      ['prefetch', { path: 'documents.list', input: { page: 3, pageSize: 50 } }],
      ['prefetch', { path: 'documents.count' }],
    ]);
  });

  test('a hostile URL prefetches the first page, in the default order, with no search', async () => {
    const users = await load(`${APP}/admin/users/page.tsx`);
    await users.default?.({
      searchParams: Promise.resolve({ page: '-1', pageSize: '100000', sort: 'password', search: ['x'.repeat(500), 'y'] }),
    });
    expect(recorder.calls[1]).toEqual([
      'prefetch',
      { path: 'users.list', input: { ...FIRST_PAGE, search: 'x'.repeat(100), sort: '-createdAt' } },
    ]);
    recorder.calls.length = 0;
    const documents = await load(`${APP}/page.tsx`);
    await documents.default?.({ searchParams: Promise.resolve({ page: 'abc', pageSize: '1e9' }) });
    expect(recorder.calls[1]).toEqual(['prefetch', { path: 'documents.list', input: FIRST_PAGE }]);
  });

  describe('the users table', () => {
    interface TableProps {
      onSortingChange: (updater: unknown) => void;
      state: { sorting: unknown; pagination: unknown };
      toolbarStart: Element;
      renderBody: (table: string) => Element;
    }

    const render = async (): Promise<TableProps> => {
      const reader = await load('src/components/admin/user-table.tsx');
      const element = reader.UserTable?.() as unknown as { props: TableProps };
      recorder.calls.length = 0;
      return element.props;
    };
    const propsOf = (element: Element | undefined) => (element?.props ?? {}) as Record<string, unknown>;
    const elementsOf = (node: unknown) => [...descendants(node)];
    const textOf = (node: unknown): string =>
      Array.isArray(node)
        ? node.map(textOf).join('')
        : typeof node === 'string'
          ? node
          : node && typeof node === 'object' && 'props' in node
            ? textOf((node as Element).props.children)
            : '';

    test('hands the table the sorting the URL names and the page on screen', async () => {
      recorder.state.sort = '-email';
      const { state } = await render();
      expect(state).toEqual({ sorting: [{ id: 'email', desc: true }], pagination: { pageIndex: 0, pageSize: 10 } });
      recorder.state.sort = '-createdAt';
      expect((await render()).state.sorting).toEqual([]);
    });

    test('a sort picked in a column header is written into the URL, and no sort is the default order', async () => {
      const { onSortingChange } = await render();
      onSortingChange([{ id: 'name', desc: true }]);
      onSortingChange((current: unknown[]) => [...current, { id: 'email', desc: false }]);
      onSortingChange([{ id: 'role', desc: false }]);
      onSortingChange([]);
      expect(recorder.calls).toEqual([
        ['setSort', '-name'],
        ['setSort', 'email'],
        ['setSort', '-createdAt'],
        ['setSort', '-createdAt'],
      ]);
    });

    test('the search box shows the search of the URL and writes what is typed', async () => {
      recorder.state.search = 'ada';
      const { toolbarStart } = await render();
      const [search] = elementsOf(toolbarStart).filter((element) => String(propsOf(element).placeholder).startsWith('Search'));
      expect(propsOf(search)).toMatchObject({ value: 'ada' });
      (propsOf(search).onChange as (text: string) => void)('grace');
      expect(recorder.calls).toEqual([['setSearch', 'grace']]);
    });

    test('a sorted list offers a way back to the default order, and the default order does not', async () => {
      const clear = (props: TableProps) =>
        elementsOf(props.toolbarStart).filter((element) => 'onClick' in propsOf(element) && textOf(element) === 'Clear sort');
      expect(clear(await render())).toHaveLength(0);

      recorder.state.sort = 'name';
      const [button] = clear(await render());
      (propsOf(button).onClick as () => void)();
      expect(recorder.calls).toEqual([['setSort', '-createdAt']]);
    });

    test.each([
      ['', 'No users yet.'],
      ['  ', 'No users yet.'],
      ['zzz', 'No users match your search.'],
    ])('with the search %p an empty list says %p', async (search, message) => {
      recorder.state.search = search;
      const { renderBody } = await render();
      const list = renderBody('the table');
      expect(propsOf(list)).toMatchObject({ itemName: 'users', emptyMessage: message, page: 1, pageSize: 10 });
      expect(list.props.children).toEqual(['the table']);
    });

    test('counts the page against the total of the search, not against the rows it loaded', async () => {
      recorder.state.total = 27;
      recorder.state.data = Array.from({ length: 10 }, (_, index) => ({ id: `u${index}` }));
      const { renderBody } = await render();
      expect(propsOf(renderBody('the table'))).toMatchObject({ total: 27, rowCount: 10 });
    });
  });

  // An id that matches no row answers 404 from the server, before anything is hydrated: a rejected prefetch
  // would be dehydrated as pending and reject in the browser, with the server logging an error.
  describe.each([
    {
      title: 'the fullstack user page',
      blueprint: FULLSTACK,
      page: `${APP}/admin/users/[id]/page.tsx`,
      guard: 'requireAdmin',
      key: { path: 'users.get', input: { id: 'nobody' } },
    },
    {
      title: 'the org dashboard user page',
      blueprint: ORG_DASHBOARD,
      page: `${APP}/admin/users/[id]/page.tsx`,
      guard: 'requireAdmin',
      key: { path: 'user.getById', input: { id: 'nobody' } },
    },
    {
      title: 'the org dashboard contact page',
      blueprint: ORG_DASHBOARD,
      page: `${APP}/contacts/[id]/page.tsx`,
      guard: 'requirePermission',
      key: { path: 'contact.getById', input: { id: 'nobody' } },
    },
  ])('$title with an unknown id', ({ blueprint, page, guard, key }) => {
    const props = { params: Promise.resolve({ id: 'nobody' }) };
    const root = () => join(tempDir, blueprint, 'apps/web');

    test('answers not found after loading the record once, and hydrates nothing', async () => {
      recorder.state.data = null;
      const route = await load(page, {}, root());
      await expect(route.default?.(props)).rejects.toThrow('not-found');
      expect(recorder.calls).toEqual([guard, ['fetch', key]]);
    });

    test('renders the record it loaded, inside the hydration boundary, when the id exists', async () => {
      const route = await load(page, {}, root());
      const rendered = (await route.default?.(props)) as Element;
      expect(rendered.type).toBe(trpcStub.HydrateClient);
      expect(recorder.calls).toEqual([guard, ['fetch', key]]);
    });
  });

  test('the user client answers not found when the user is gone after a refetch', async () => {
    recorder.state.data = null;
    const reader = await load(`${APP}/admin/users/[id]/user.client.tsx`);
    expect(() => reader.UserClient?.()).toThrow('not-found');
  });

  describe('every session lookup goes through the cached guards', () => {
    test('the dashboard layout requires a session', async () => {
      const layout = await load(`${APP}/layout.tsx`);
      await layout.default?.({ children: 'body' });
      expect(recorder.calls).toEqual(['requireSession']);

      recorder.state.denied = true;
      await expect(layout.default?.({ children: 'body' })).rejects.toThrow('denied by requireSession');
    });

    test('the admin layout and the roles page require an admin', async () => {
      recorder.state.session = { user: { role: 'admin' } };
      for (const file of [`${APP}/admin/layout.tsx`, `${APP}/admin/roles/page.tsx`]) {
        recorder.calls.length = 0;
        recorder.state.denied = false;
        const route = await load(file);
        await route.default?.({ children: 'body' });
        expect(recorder.calls, file).toEqual(['requireAdmin']);

        recorder.state.denied = true;
        await expect(route.default?.({ children: 'body' }), file).rejects.toThrow('denied by requireAdmin');
      }
    });

    test('the account page requires a session', async () => {
      recorder.state.session = { user: { name: 'Ada', email: 'ada@example.com', image: null, createdAt: '2026-01-01' } };
      const route = await load(`${APP}/profile/account/page.tsx`);
      await route.default?.();
      expect(recorder.calls).toEqual(['requireSession']);
    });

    test('the auth layout sends a signed-in visitor home and leaves an anonymous one on the page', async () => {
      const layout = await load('src/app/(auth)/layout.tsx');

      await layout.default?.({ children: 'login form' });
      expect(recorder.calls).toEqual(['getSession']);

      recorder.state.session = { user: { role: 'user' } };
      await expect(layout.default?.({ children: 'login form' })).rejects.toThrow(redirectTo('/'));
    });

    test('the auth layout leaves a visitor the dashboard refuses on the login page, so the two never redirect to each other', async () => {
      const layout = await load('src/app/(auth)/layout.tsx');
      recorder.state.session = { user: { role: null } };
      await layout.default?.({ children: 'login form' });
    });
  });

  describe.each([
    { blueprint: FULLSTACK, root: 'apps/web', authImport: '@/lib/server' },
    { blueprint: ORG_DASHBOARD, root: 'apps/web', authImport: '@/lib/auth/auth' },
  ])('$blueprint session guards', ({ blueprint, root, authImport }) => {
    // The guards import the header name and the redirect helper the blueprint generates: they run for real.
    const guards = async () => {
      const projectRoot = join(tempDir, blueprint, root);
      const generated: Record<string, string> = {};
      const realModules: [string, string][] = [
        ['@/lib/auth/request-path', 'src/lib/auth/request-path.ts'],
        ['@/lib/safe-redirect', 'src/lib/safe-redirect.ts'],
      ];
      for (const [specifier, file] of realModules) {
        const name = `real-${blueprint}-${file.replace(/\W/g, '_')}.mjs`;
        await evaluateGeneratedModule(await readTextFile(join(projectRoot, file)), join(stubs, name), {}, 'ts');
        generated[specifier] = `./${name}`;
      }
      return load<Record<string, () => Promise<unknown>>>(
        'src/lib/auth/session.ts',
        { [authImport]: './server.mjs', ...generated },
        projectRoot,
      );
    };

    test('an anonymous visitor is sent to the login by both guards', async () => {
      const { requireSession, requireAdmin } = await guards();
      await expect(requireSession?.()).rejects.toThrow(redirectTo('/login'));
      await expect(requireAdmin?.()).rejects.toThrow(redirectTo('/login'));
    });

    test('a session without a role counts as anonymous', async () => {
      recorder.state.session = { user: { role: null } };
      const { requireSession } = await guards();
      await expect(requireSession?.()).rejects.toThrow(redirectTo('/login'));
    });

    test('a signed-in user passes requireSession and is sent home by requireAdmin', async () => {
      recorder.state.session = { user: { role: 'user' } };
      const { requireSession, requireAdmin } = await guards();
      expect(await requireSession?.()).toBe(recorder.state.session);
      await expect(requireAdmin?.()).rejects.toThrow(redirectTo('/'));
    });

    test('an admin gets the session back from both guards', async () => {
      recorder.state.session = { user: { role: 'admin' } };
      const { requireSession, requireAdmin } = await guards();
      expect(await requireSession?.()).toBe(recorder.state.session);
      expect(await requireAdmin?.()).toBe(recorder.state.session);
    });
  });
});
