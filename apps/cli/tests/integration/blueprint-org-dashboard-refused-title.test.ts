import { mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, filesUnder, REACT_HOOKS_STUB, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const WEB = 'apps/web/src';
const NOT_FOUND_TITLE = 'Page not found';

interface Globals {
  __granted?: readonly string[];
  __contact?: { id: string } | null;
  __session?: { user: { id: string; role: string } };
}

const globals = globalThis as Globals;

type Metadata = { title: string };
type Page = { generateMetadata: (props?: unknown) => Promise<Metadata> };
type StartRoute = { head?: (args?: unknown) => { meta: { title?: string }[] } };

const NEXTJS_STUBS: Record<string, string> = {
  'react.mjs': REACT_HOOKS_STUB,
  'next-headers.mjs': 'export const headers = async () => new Headers();',
  'next-navigation.mjs': `export const notFound = () => { throw { kind: 'notFound' }; };
export const redirect = (to) => { throw { kind: 'redirect', to }; };`,
  'auth-instance.mjs': 'export const auth = { api: { getSession: async () => globalThis.__session } };',
  'request-path.mjs': "export const REQUEST_PATH_HEADER = 'x-request-path';",
  'safe-redirect.mjs': 'export const safeRedirectPath = (value) => value ?? "/";',
  'trpc-server.mjs': `export const trpc = {
  contact: { getById: { queryOptions: (input) => input } },
  permissions: { mine: { queryOptions: () => ({ queryKey: ['permissions', 'mine'] }) } },
};
export const getQueryClient = () => ({
  ensureQueryData: async () => globalThis.__granted,
  fetchQuery: async () => globalThis.__contact,
});
export const HydrateClient = ({ children }) => children;
export const prefetch = () => {};`,
  'page-parts.mjs': `export const QueryBoundary = ({ children }) => children;
export const ContactsClient = () => null;
export const ContactDetail = () => null;
export const parsePageParams = () => ({});`,
};

describe('org-dashboard-nextjs: a page refused for a missing permission is titled Page not found', () => {
  const blueprint = 'org-dashboard-nextjs';
  let tempDir: string;
  let project: string;
  let stubs: string;
  let list: Page;
  let detail: Page;

  const generated = async <T>(file: string, name: string, imports: Record<string, string>, loader: 'ts' | 'tsx' = 'ts'): Promise<T> =>
    evaluateGeneratedModule<T>(await readTextFile(join(project, file)), join(stubs, name), imports, loader);

  const titleFor = async (page: Page, granted: readonly string[]): Promise<string> => {
    globals.__granted = granted;
    globals.__session = { user: { id: 'u1', role: 'user' } };
    globals.__contact = { id: 'c1' };
    return (await page.generateMetadata({ params: Promise.resolve({ id: 'c1' }) })).title;
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, blueprint);
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(NEXTJS_STUBS)) await Bun.write(join(stubs, file), source);

    await generated('packages/auth/src/permissions.ts', 'permissions.mjs', {
      'better-auth/plugins/access': Bun.resolveSync('better-auth/plugins/access', import.meta.dir),
      'better-auth/plugins/admin/access': Bun.resolveSync('better-auth/plugins/admin/access', import.meta.dir),
    });
    await generated(`${WEB}/lib/auth/session.ts`, 'session.mjs', {
      react: './react.mjs',
      'next/headers': './next-headers.mjs',
      'next/navigation': './next-navigation.mjs',
      '@repo/auth/permissions': './permissions.mjs',
      '@/lib/auth/auth': './auth-instance.mjs',
      '@/lib/auth/request-path': './request-path.mjs',
      '@/lib/safe-redirect': './safe-redirect.mjs',
      '@/trpc/server': './trpc-server.mjs',
    });
    const pageImports = {
      react: './react.mjs',
      'next/navigation': './next-navigation.mjs',
      '@/lib/auth/session': './session.mjs',
      '@/trpc/server': './trpc-server.mjs',
      '@repo/api/pagination': './page-parts.mjs',
      '@/components/query-boundary': './page-parts.mjs',
      './contacts.client': './page-parts.mjs',
      './contact.client': './page-parts.mjs',
    };
    list = await generated<Page>(`${WEB}/app/(dashboard)/contacts/page.tsx`, 'contacts-page.mjs', pageImports, 'tsx');
    detail = await generated<Page>(`${WEB}/app/(dashboard)/contacts/[id]/page.tsx`, 'contact-page.mjs', pageImports, 'tsx');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the contacts list is titled after the page for a role that reads contacts and Page not found for one that does not', async () => {
    expect(await titleFor(list, ['contact.read'])).toBe('Contacts');
    for (const granted of [[], ['contact.create']]) expect(await titleFor(list, granted)).toBe(NOT_FOUND_TITLE);
  });

  test('a contact is titled after the page for a role that reads contacts and Page not found for one that does not', async () => {
    expect(await titleFor(detail, ['contact.read'])).toBe('Contact');
    for (const granted of [[], ['contact.create']]) expect(await titleFor(detail, granted)).toBe(NOT_FOUND_TITLE);
  });

  test('a contact that does not exist is titled Page not found for a role that reads contacts', async () => {
    globals.__contact = null;
    globals.__granted = ['contact.read'];
    globals.__session = { user: { id: 'u1', role: 'user' } };
    expect((await detail.generateMetadata({ params: Promise.resolve({ id: 'c1' }) })).title).toBe(NOT_FOUND_TITLE);
  });

  test('no page behind requirePermission declares a static title, which would outlive its not found', async () => {
    const appRoot = join(project, WEB, 'app');
    const guarded: string[] = [];
    for (const file of await filesUnder(appRoot)) {
      if (!/\/page\.tsx$/.test(file)) continue;
      const source = await readTextFile(file);
      if (!source.includes('requirePermission')) continue;
      guarded.push(relative(appRoot, file));
      expect(source, file).not.toMatch(/export const metadata\b/);
      expect(source, file).toContain('generateMetadata');
    }
    expect(guarded.length).toBeGreaterThan(0);
  });
});

describe('org-dashboard-tanstack-start: a route that answers not found before it loads is titled Page not found', () => {
  const blueprint = 'org-dashboard-tanstack-start';
  const ROUTES = 'routes/_dashboard';
  let tempDir: string;
  let project: string;
  let stubs: string;

  const START_STUBS: Record<string, string> = {
    'react.mjs': REACT_HOOKS_STUB,
    'router.mjs': `export const createFileRoute = () => (options) => ({ ...options });
export const notFound = () => ({ kind: 'notFound' });
export const redirect = (target) => ({ kind: 'redirect', ...target });`,
    'route-parts.mjs': `export const DashboardNotFound = () => null;
export const requirePermission = () => {};
export const requireAdmin = () => {};`,
  };

  const route = async (file: string, name: string): Promise<StartRoute> => {
    const { Route } = await evaluateGeneratedModule<{ Route: StartRoute }>(
      await readTextFile(join(project, WEB, ROUTES, file)),
      join(stubs, name),
      {
        react: './react.mjs',
        '@tanstack/react-router': './router.mjs',
        '@/components/dashboard-not-found': './route-parts.mjs',
        '@/lib/auth/guards': './route-parts.mjs',
        '@/lib/page-title': './page-title.mjs',
      },
      'tsx',
    );
    return Route;
  };

  const titleOf = (head: StartRoute['head']): string | undefined => head?.({})?.meta.find((entry) => 'title' in entry)?.title;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, blueprint);
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    for (const [file, source] of Object.entries(START_STUBS)) await Bun.write(join(stubs, file), source);
    await evaluateGeneratedModule(await readTextFile(join(project, WEB, 'lib/page-title.ts')), join(stubs, 'page-title.mjs'));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the contacts layout, which refuses a role without contact.read, is titled Page not found', async () => {
    expect(titleOf((await route('contacts.tsx', 'contacts-layout.mjs')).head)).toBe(`${NOT_FOUND_TITLE} | ${blueprint}`);
  });

  test('the admin index, which answers not found, is titled Page not found', async () => {
    expect(titleOf((await route('admin/index.tsx', 'admin-index.mjs')).head)).toBe(`${NOT_FOUND_TITLE} | ${blueprint}`);
  });

  test('every route that answers not found from beforeLoad sets a head, so the title is not the root one', async () => {
    const routesRoot = join(project, WEB, ROUTES);
    const refusing: string[] = [];
    for (const file of await filesUnder(routesRoot)) {
      const source = await readTextFile(file);
      if (!source.includes('beforeLoad') || !/requirePermission\(|throw notFound\(\)/.test(source)) continue;
      refusing.push(relative(routesRoot, file));
      expect(source, file).toContain('head:');
    }
    expect(refusing).toContain('contacts.tsx');
    expect(refusing).toContain('$.tsx');
  });
});
