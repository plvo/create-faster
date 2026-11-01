import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_ELEMENT_STUB,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  fileExists,
  readTextFile,
  renderElementTree,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'org-dashboard-tanstack-start';
const WEB = 'apps/web';
const NEXT_IMPORT = /\b(?:from|import|require)\s*\(?\s*['"]next(?:\/[^'"]*)?['"]/;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

interface Session {
  user: { id?: string; role?: string | null };
}

interface Thrown {
  kind: 'redirect' | 'notFound';
  to?: string;
  search?: { redirectTo: string };
}

interface GeneratedGuards {
  hasPermission: (role: string | null | undefined, permissions: Record<string, string[]>) => boolean;
  isSignedIn: (session: Session | null) => boolean;
  requireSession: (location: { href: string }) => Promise<Session>;
  requireAdmin: (session: Session) => void;
  requirePermission: (session: Session, permissions: Record<string, string[]>) => void;
  usePermission: (permissions: Record<string, string[]>) => boolean;
}

// Stand-ins for what the generated files import from packages: the router builds the value `throw`n by
// redirect() and notFound(), and the auth client checks a role against the generated `roleDefinitions`.
const STUBS: Record<string, string> = {
  'router.mjs': `export const redirect = (options) => ({ kind: 'redirect', ...options });
export const notFound = () => ({ kind: 'notFound' });
export const useRouteContext = ({ select }) => select(globalThis.__testRouteContext);
export const createFileRoute = (path) => (options) => ({ path, options });
export const Link = ({ to, children }) => ({ type: 'a', props: { href: to, children } });
export const useLocation = ({ select }) => select({ pathname: '/' });`,
  'react.mjs': REACT_ELEMENT_STUB,
  'sidebar-ui.mjs': `const passThrough = ({ children }) => children;
export const SidebarGroup = passThrough;
export const SidebarGroupLabel = passThrough;
export const SidebarMenu = passThrough;
export const SidebarMenuButton = passThrough;
export const SidebarMenuItem = passThrough;`,
  'access.mjs': 'export const createAccessControl = () => ({ newRole: (statements) => statements });',
  'admin-access.mjs': `export const defaultStatements = {};
export const adminAc = { statements: { user: ['list', 'create', 'set-role'], session: ['list', 'revoke'] } };`,
  'auth-client.mjs': `import { roleDefinitions } from './permissions.mjs';
// An empty requirement is never granted here, so only the short-circuit in hasPermission lets it through.
export const authClient = {
  admin: {
    checkRolePermission: ({ role, permissions }) =>
      Object.keys(permissions).length > 0 &&
      Object.entries(permissions).every(([resource, actions]) =>
        actions.every((action) => roleDefinitions[role]?.[resource]?.includes(action) ?? false)),
  },
};`,
  'session.mjs': 'export const getSession = async () => globalThis.__testSession ?? null;',
  'skeleton.mjs': 'export const Skeleton = () => null;',
  'page-parts.mjs': `export const ContactDetail = () => null;
export const DetailPending = () => null;
export const UserDetail = () => null;
export const DashboardNotFound = () => null;
export const QueryBoundary = ({ children }) => children;
export const pageTitle = (title) => title;`,
  'icons.mjs': `export const LayoutDashboard = 'LayoutDashboard';
export const Users = 'Users';
export const Shield = 'Shield';
export const ShieldCheck = 'ShieldCheck';`,
};

const IMPORT_TARGETS: Record<string, string> = {
  'better-auth/plugins/access': './access.mjs',
  'better-auth/plugins/admin/access': './admin-access.mjs',
  '@tanstack/react-router': './router.mjs',
  '@repo/auth/auth-client': './auth-client.mjs',
  '@repo/auth/permissions': './permissions.mjs',
  '@/lib/auth/permission': './permission.mjs',
  '@/lib/auth/session': './session.mjs',
  'lucide-react': './icons.mjs',
  react: './react.mjs',
  '@repo/ui/components/ui/sidebar': './sidebar-ui.mjs',
  '@/hooks/use-permission': './use-permission.mjs',
  '@/lib/constants': './constants.mjs',
  '@/lib/allowed-routes': './allowed-routes.mjs',
  '@/lib/auth/guards': './guards.mjs',
  '@/components/contacts/contact-detail': './page-parts.mjs',
  '@/components/admin/user-detail': './page-parts.mjs',
  '@/components/query-boundary': './page-parts.mjs',
  '@/components/detail-pending': './page-parts.mjs',
  '@/components/dashboard-not-found': './page-parts.mjs',
  '@/lib/page-title': './page-parts.mjs',
};

// Renders the element tree the generated components return: components are called, the stand-in Link becomes an
// `a`, and the hrefs come back in document order.
async function renderedLinks(node: unknown): Promise<string[]> {
  return elementsOf(await renderElementTree(node)).flatMap((element) =>
    element.tag === 'a' && typeof element.props.href === 'string' ? [element.props.href] : [],
  );
}

// trpc.user.getById.queryOptions(input) is { path: 'user.getById', input }: the loader and the component build the
// same query key only when they name the same procedure and input.
const recordingTrpc = (path: string[] = []): unknown =>
  new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'queryOptions'
          ? (input: unknown) => ({ path: path.join('.'), input })
          : recordingTrpc([...path, String(key)]),
    },
  );

async function thrownBy(run: () => unknown): Promise<Thrown | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error as Thrown;
  }
}

describe(`${BLUEPRINT} blueprint`, () => {
  let tempDir: string;
  let project: string;
  const read = (path: string): Promise<string> => readTextFile(join(project, path));

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    project = join(tempDir, BLUEPRINT);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates the TanStack Start routes and none of the Next.js ones', async () => {
    for (const file of [
      'src/routes/__root.tsx',
      'src/routes/_auth.tsx',
      'src/routes/_auth/login.tsx',
      'src/routes/_dashboard.tsx',
      'src/routes/_dashboard/index.tsx',
      'src/routes/_dashboard/profile.tsx',
      'src/routes/_dashboard/profile/index.tsx',
      'src/routes/_dashboard/profile/account.tsx',
      'src/routes/_dashboard/profile/security.tsx',
      'src/routes/_dashboard/profile/sessions.tsx',
      'src/routes/_dashboard/profile/preferences.tsx',
      'src/routes/_dashboard/contacts.tsx',
      'src/routes/_dashboard/contacts/index.tsx',
      'src/routes/_dashboard/contacts/$id.tsx',
      'src/routes/_dashboard/admin.tsx',
      'src/routes/_dashboard/admin/index.tsx',
      'src/routes/_dashboard/admin/users/index.tsx',
      'src/routes/_dashboard/admin/users/$id.tsx',
      'src/routes/_dashboard/admin/roles.tsx',
      'src/components/contacts/contact-table.tsx',
      'src/components/contacts/contacts-client.tsx',
      'src/components/contacts/contact-detail.tsx',
      'src/components/admin/user-table.tsx',
      'src/components/admin/users-client.tsx',
      'src/components/admin/user-detail.tsx',
      'src/components/admin/roles-page.tsx',
      'src/lib/auth/guards.ts',
      'src/components/navigation/app-sidebar.tsx',
      'src/components/navigation/nav-user.tsx',
      'src/components/navigation/sidebar-links.tsx',
    ]) {
      expect(await fileExists(join(project, WEB, file)), file).toBe(true);
    }

    expect(await fileExists(join(project, WEB, 'src/routes/index.tsx'))).toBe(false);
    expect(await fileExists(join(project, WEB, 'src/app'))).toBe(false);
    expect(await read(`${WEB}/src/components/profile/tab-nav.tsx`)).toContain("<nav aria-label='Profile sections'");
    expect(await fileExists(join(project, WEB, 'src/styles/globals.css'))).toBe(false);
    const notFound = await read(`${WEB}/src/components/not-found.tsx`);
    expect(notFound).toContain("<main className='flex min-h-screen flex-col items-center justify-center");
    expect(notFound).toContain("<h1 className='text-2xl font-semibold'>Page not found</h1>");
    expect(await fileExists(join(project, 'scripts/seed.ts'))).toBe(true);
    expect(await fileExists(join(project, 'packages/db/scripts/seed.ts'))).toBe(false);
    expect(await fileExists(join(project, 'apps/batch/src/index.ts'))).toBe(true);
  });

  test('no file of the web app imports next or a next/* module', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(project, WEB, 'src'))) {
      if (NEXT_IMPORT.test(await readTextFile(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test('the app builds its auth instance with tanstackStartCookies and the shared factory binds no framework', async () => {
    const instance = await read(`${WEB}/src/lib/auth/auth.ts`);
    expect(instance).toContain("from 'better-auth/tanstack-start'");
    expect(instance).toContain('createAuth(tanstackStartCookies(), (task) => {');

    const factory = await read('packages/auth/src/auth.ts');
    expect(factory).not.toMatch(/tanstack-start|next-js|nextCookies/);
    const reader = await read('packages/api/src/auth.ts');
    expect(reader).toContain('createAuth()');
  });

  test('the dashboard layout requires a session before any child route and the login layout agrees with it', async () => {
    const dashboard = await read(`${WEB}/src/routes/_dashboard.tsx`);
    expect(dashboard).toMatch(/beforeLoad: async \(\{ location \}\) => \(\{ session: await requireSession\(location\) \}\)/);

    const guards = await read(`${WEB}/src/lib/auth/guards.ts`);
    expect(guards).toMatch(/export function isSignedIn\(/);
    expect(guards).toMatch(/if \(!isSignedIn\(session\)\) throw redirect\(\{ to: '\/login'/);

    const auth = await read(`${WEB}/src/routes/_auth.tsx`);
    expect(auth).toMatch(/if \(isSignedIn\(await getSession\(\)\)\) throw redirect\(\{ to: '\/'/);
  });

  test('the contacts pages do not check the permission, their layout does', async () => {
    for (const page of ['index', '$id']) {
      const source = await read(`${WEB}/src/routes/_dashboard/contacts/${page}.tsx`);
      expect(source, page).not.toContain('requirePermission');
    }
    const list = await read(`${WEB}/src/routes/_dashboard/contacts/index.tsx`);
    expect(list).toMatch(/void context\.queryClient\.prefetchQuery\(/);
    expect(list).not.toMatch(/await context\.queryClient/);
    const detail = await read(`${WEB}/src/routes/_dashboard/contacts/$id.tsx`);
    expect(detail).toContain('context.trpc.contact.getById.queryOptions({ id: params.id })');
  });

  test('the admin pages do not repeat the admin check, their layout makes it once', async () => {
    for (const page of ['users/index', 'users/$id', 'roles']) {
      const source = await read(`${WEB}/src/routes/_dashboard/admin/${page}.tsx`);
      expect(source, page).not.toMatch(/requireAdmin|requirePermission/);
    }
    const list = await read(`${WEB}/src/routes/_dashboard/admin/users/index.tsx`);
    expect(list).toMatch(/void context\.queryClient\.prefetchQuery\(/);
    expect(list).not.toMatch(/await context\.queryClient/);
  });

  test('the shared tables and detail pages link through the router with typed params', async () => {
    const contactTable = await read(`${WEB}/src/components/contacts/contact-table.tsx`);
    expect(contactTable).toContain("<Link to='/contacts/$id' params={{ id: contact.id }}");
    const userTable = await read(`${WEB}/src/components/admin/user-table.tsx`);
    expect(userTable).toContain("<Link to='/admin/users/$id' params={{ id: user.id }}");
    expect(await read(`${WEB}/src/components/contacts/contact-detail.tsx`)).toContain("navigate({ to: '/contacts' })");

    for (const file of [
      'contacts/contact-table',
      'contacts/contacts-client',
      'contacts/contact-detail',
      'admin/user-table',
      'admin/users-client',
      'admin/user-detail',
    ]) {
      expect(await read(`${WEB}/src/components/${file}.tsx`), file).not.toContain("'use client'");
    }
  });

  test('a route checks its permission in beforeLoad, before its loader prefetches', async () => {
    const home = await read(`${WEB}/src/routes/_dashboard/index.tsx`);
    const beforeLoad = home.indexOf('beforeLoad:');
    const loader = home.indexOf('loader:');
    expect(beforeLoad).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(beforeLoad);
    expect(home).toContain("requirePermission(context.session, { contact: ['read'] })");
    expect(home).toMatch(/void context\.queryClient\.prefetchQuery\(/);
    expect(home).not.toMatch(/await context\.queryClient/);
  });

  describe('the generated guards, evaluated', () => {
    let guards: GeneratedGuards;
    const member = (role: string | null): Session => ({ user: { id: 'u1', role } });
    const signedInAs = (session: Session | null) => {
      (globalThis as { __testSession?: Session | null }).__testSession = session;
    };

    let guardsDir: string;
    let evaluate: <T>(source: string, name: string, loader?: 'ts' | 'tsx') => Promise<T>;
    const routeOptions = async (file: string, name: string) =>
      (
        await evaluate<{ Route: { options: { beforeLoad: (args: { context: { session: Session } }) => unknown } } }>(
          `${WEB}/src/routes/_dashboard/${file}`,
          name,
        )
      ).Route.options;
    const inRouteContext = (role: string | null) => {
      (globalThis as { __testRouteContext?: { session: Session } }).__testRouteContext = { session: member(role) };
    };

    beforeAll(async () => {
      const dir = join(tempDir, 'guards-eval');
      guardsDir = dir;
      await mkdir(dir, { recursive: true });
      for (const [name, source] of Object.entries(STUBS)) await Bun.write(join(dir, name), source);
      evaluate = async <T>(source: string, name: string, loader: 'ts' | 'tsx' = 'ts'): Promise<T> =>
        evaluateGeneratedModule<T>(await read(source), join(dir, name), IMPORT_TARGETS, loader);
      await evaluate('packages/auth/src/permissions.ts', 'permissions.mjs');
      const permission = await evaluate<Pick<GeneratedGuards, 'hasPermission'>>(`${WEB}/src/lib/auth/permission.ts`, 'permission.mjs');
      const evaluated = await evaluate<Omit<GeneratedGuards, 'hasPermission' | 'usePermission'>>(`${WEB}/src/lib/auth/guards.ts`, 'guards.mjs');
      const hook = await evaluate<Pick<GeneratedGuards, 'usePermission'>>(`${WEB}/src/hooks/use-permission.ts`, 'use-permission.mjs');
      guards = { ...permission, ...evaluated, ...hook };
    });

    afterAll(() => signedInAs(null));

    test('hasPermission refuses a missing or unknown role and checks the others against their definition', () => {
      expect(guards.hasPermission(undefined, { contact: ['read'] })).toBe(false);
      expect(guards.hasPermission(null, {})).toBe(false);
      expect(guards.hasPermission('ghost', { contact: ['read'] })).toBe(false);
      expect(guards.hasPermission('manager', {})).toBe(true);
      expect(guards.hasPermission('manager', { contact: ['read'] })).toBe(true);
      expect(guards.hasPermission('manager', { contact: ['read', 'create'] })).toBe(false);
      expect(guards.hasPermission('user', { contact: ['create', 'delete'] })).toBe(true);
      expect(guards.hasPermission('user', { user: ['list'] })).toBe(false);
      expect(guards.hasPermission('admin', { user: ['list'], contact: ['delete'] })).toBe(true);
    });

    test('requirePermission passes a role that has the permission and answers not found for one that lacks it', async () => {
      expect(await thrownBy(() => guards.requirePermission(member('manager'), { contact: ['read'] }))).toBeUndefined();
      expect(await thrownBy(() => guards.requirePermission(member('manager'), { contact: ['create'] }))).toEqual({
        kind: 'notFound',
      });
      expect(await thrownBy(() => guards.requirePermission(member('ghost'), { contact: ['read'] }))).toEqual({
        kind: 'notFound',
      });
    });

    test('requireAdmin lets an admin through and sends anyone else home', async () => {
      expect(await thrownBy(() => guards.requireAdmin(member('admin')))).toBeUndefined();
      for (const role of ['user', 'manager']) {
        expect(await thrownBy(() => guards.requireAdmin(member(role)))).toEqual({ kind: 'redirect', to: '/' });
      }
    });

    test('requireSession returns the session of a signed-in user and sends everyone else to login with the page asked for', async () => {
      signedInAs(member('user'));
      expect(await guards.requireSession({ href: '/profile' })).toEqual(member('user'));

      for (const session of [null, member(null), { user: {} }]) {
        signedInAs(session);
        expect(await thrownBy(() => guards.requireSession({ href: '/profile/sessions?x=1' }))).toEqual({
          kind: 'redirect',
          to: '/login',
          search: { redirectTo: '/profile/sessions?x=1' },
        });
      }
    });

    test('usePermission reads the role from the dashboard route context', () => {
      inRouteContext('manager');
      expect(guards.usePermission({ contact: ['read'] })).toBe(true);
      expect(guards.usePermission({ contact: ['create'] })).toBe(false);
      expect(guards.usePermission({})).toBe(true);
      inRouteContext('admin');
      expect(guards.usePermission({ user: ['list'] })).toBe(true);
      inRouteContext(null);
      expect(guards.usePermission({})).toBe(false);
      expect(guards.usePermission({ contact: ['read'] })).toBe(false);
    });

    test('the sidebar renders each role only the links its permissions open', async () => {
      await evaluate(`${WEB}/src/lib/constants.ts`, 'constants.mjs');
      await evaluate(`${WEB}/src/lib/allowed-routes.ts`, 'allowed-routes.mjs');
      const { SidebarLinks } = await evaluate<{ SidebarLinks: (props: { role: string }) => unknown }>(
        `${WEB}/src/components/navigation/sidebar-links.tsx`,
        'sidebar-links.mjs',
        'tsx',
      );
      const linksFor = (role: string): Promise<string[]> => renderedLinks(SidebarLinks({ role }));

      expect(await linksFor('admin')).toEqual(['/', '/contacts', '/admin/users', '/admin/roles']);
      expect(await linksFor('user')).toEqual(['/', '/contacts']);
      expect(await linksFor('manager')).toEqual(['/', '/contacts']);
      expect(await linksFor('ghost')).toEqual(['/']);
    });

    test('the contacts layout answers not found to a role without the contact permission', async () => {
      const { beforeLoad } = await routeOptions('contacts.tsx', 'contacts-route.mjs');
      expect(await thrownBy(() => beforeLoad({ context: { session: member('manager') } }))).toBeUndefined();
      for (const role of ['ghost', null]) {
        expect(await thrownBy(() => beforeLoad({ context: { session: member(role) } }))).toEqual({ kind: 'notFound' });
      }
    });

    test('the admin layout sends everyone but an admin home, and the bare admin route is not found', async () => {
      const { beforeLoad } = await routeOptions('admin.tsx', 'admin-route.mjs');
      expect(await thrownBy(() => beforeLoad({ context: { session: member('admin') } }))).toBeUndefined();
      for (const role of ['user', 'manager']) {
        expect(await thrownBy(() => beforeLoad({ context: { session: member(role) } }))).toEqual({ kind: 'redirect', to: '/' });
      }

      const bare = await routeOptions('admin/index.tsx', 'admin-index-route.mjs');
      expect(await thrownBy(() => bare.beforeLoad({ context: { session: member('admin') } }))).toEqual({ kind: 'notFound' });
    });

    // A loader that awaits its record leaves the old page on screen: the route shows the skeleton while it runs.
    test.each([
      { file: 'admin/users/$id.tsx', name: 'user-pending-route.mjs' },
      { file: 'contacts/$id.tsx', name: 'contact-pending-route.mjs' },
    ])('the route $file shows the detail skeleton while its loader runs', async ({ file, name }) => {
      const skeletonImports = { ...IMPORT_TARGETS, '@repo/ui/components/ui/skeleton': './skeleton.mjs' };
      const { DetailPending } = await evaluateGeneratedModule<{ DetailPending: () => { type: unknown; props: unknown } }>(
        await read(`${WEB}/src/components/detail-pending.tsx`),
        join(guardsDir, 'detail-pending.mjs'),
        skeletonImports,
        'tsx',
      );
      const { Route } = await evaluateGeneratedModule<{ Route: { options: { pendingComponent: unknown } } }>(
        await read(`${WEB}/src/routes/_dashboard/${file}`),
        join(guardsDir, name),
        { ...IMPORT_TARGETS, '@/components/detail-pending': './detail-pending.mjs' },
        'tsx',
      );
      expect(Route.options.pendingComponent).toBe(DetailPending);
      const skeleton = (await import(join(guardsDir, 'skeleton.mjs'))) as { Skeleton: unknown };
      expect(DetailPending()).toMatchObject({ type: skeleton.Skeleton, props: { className: 'h-64 w-full' } });
    });

    describe.each([
      { title: 'the user route', file: 'admin/users/$id.tsx', name: 'user-route.mjs', procedure: 'user.getById' },
      { title: 'the contact route', file: 'contacts/$id.tsx', name: 'contact-route.mjs', procedure: 'contact.getById' },
    ])('$title loader', ({ file, name, procedure }) => {
      type Loader = (args: { context: unknown; params: { id: string } }) => Promise<unknown>;
      const loaderOf = async (): Promise<Loader> =>
        (await evaluate<{ Route: { options: { loader: Loader } } }>(
          `${WEB}/src/routes/_dashboard/${file}`,
          name,
          'tsx',
        )).Route.options.loader;
      const contextFor = (record: unknown, fetched: unknown[]) => ({
        queryClient: {
          fetchQuery: async (options: unknown) => {
            fetched.push(options);
            return record;
          },
        },
        trpc: recordingTrpc(),
      });

      test('answers not found for an id that matches no record, after loading it once', async () => {
        const fetched: unknown[] = [];
        const loader = await loaderOf();
        expect(await thrownBy(() => loader({ context: contextFor(null, fetched), params: { id: 'nobody' } }))).toEqual({
          kind: 'notFound',
        });
        expect(fetched).toEqual([{ path: procedure, input: { id: 'nobody' } }]);
      });

      test('loads the record into the query cache and renders when the id exists', async () => {
        const fetched: unknown[] = [];
        const loader = await loaderOf();
        expect(await thrownBy(() => loader({ context: contextFor({ id: 'u1' }, fetched), params: { id: 'u1' } }))).toBeUndefined();
        expect(fetched).toEqual([{ path: procedure, input: { id: 'u1' } }]);
      });
    });

    test('the login layout and the dashboard layout agree on every session shape', async () => {
      for (const session of [null, member(null), { user: {} }, member('user'), member('admin')]) {
        signedInAs(session);
        const accepted = (await thrownBy(() => guards.requireSession({ href: '/' }))) === undefined;
        expect(guards.isSignedIn(session)).toBe(accepted);
      }
    });
  });

  test('the permission hook reads the session from the route context, not from a second fetch', async () => {
    const hook = await read(`${WEB}/src/hooks/use-permission.ts`);
    expect(hook).toContain("useRouteContext({ from: '/_dashboard'");
    expect(hook).not.toContain('useSession');

    const permission = await read(`${WEB}/src/lib/auth/permission.ts`);
    expect(permission).toContain('authClient.admin.checkRolePermission');
  });

  test('signing out clears the query cache after leaving the dashboard', async () => {
    const navUser = await read(`${WEB}/src/components/navigation/nav-user.tsx`);
    const signOut = navUser.indexOf('authClient.signOut()');
    const navigate = navUser.indexOf("router.navigate({ to: '/login' })");
    const clear = navUser.indexOf('queryClient.clear()');
    expect(signOut).toBeGreaterThan(-1);
    expect(navigate).toBeGreaterThan(signOut);
    expect(clear).toBeGreaterThan(navigate);
  });

  test('the root route sets the page title template, the theme and the toasts', async () => {
    const root = await read(`${WEB}/src/routes/__root.tsx`);
    expect(root).toContain('title: pageTitle()');
    expect(root).toContain('<ThemeProvider');
    expect(root).toContain('<Toaster richColors />');

    const title = await read(`${WEB}/src/lib/page-title.ts`);
    expect(title).toContain(`| ${BLUEPRINT}`);
  });

  test('declares the same data layer, seed and batch app as the Next.js blueprint', async () => {
    const [seed, setup, batch] = await Promise.all([
      read('scripts/seed.ts'),
      read('scripts/local-setup.ts'),
      read('apps/batch/src/index.ts'),
    ]);
    expect(seed).toContain('auth.api.createUser');
    expect(setup).toContain("'Seeding demo data'");
    expect(batch).toContain('Processing batch event');
  });

  test('the agent notes describe TanStack Start routing and guards, not Next.js', async () => {
    const auth = await read('docs/agents/auth.md');
    expect(auth).toContain('`_dashboard.tsx`');
    expect(auth).toContain('requireSession(location)');
    expect(auth).toContain('`validateSearch`');
    expect(auth).not.toMatch(/router\.push|next\/|Server Component/);

    const web = await read(`${WEB}/AGENTS.md`);
    expect(web).not.toContain('No protected layout is generated');
    expect(await read('AGENTS.md')).toContain('TanStack Start web app');
  });

  test('the Next.js blueprint notes carry no TanStack Start text', async () => {
    const result = await runCli(['next-notes', '--blueprint', 'org-dashboard-nextjs', '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const auth = await readTextFile(join(tempDir, 'next-notes', 'docs/agents/auth.md'));
    expect(auth).toContain('`requireSession()`');
    expect(auth).toContain('before `router.push`');
    expect(auth).not.toMatch(/TanStack|beforeLoad|_dashboard|validateSearch|history\.push|isSignedIn/);
  });

  test('the SST deployment renders the TanStack Start component', async () => {
    const result = await runCli(
      ['sst-project', '--blueprint', BLUEPRINT, '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const config = await readTextFile(join(tempDir, 'sst-project', 'sst.config.ts'));
    expect(config).toContain("new sst.aws.TanStackStart('web', {");
    expect(config).toContain("path: 'apps/web/'");
    expect(config).not.toContain('sst.aws.Nextjs');
  });

  test('the Cloudflare deployment is refused with its reason', async () => {
    const result = await runCli(
      ['cloudflare-project', '--blueprint', BLUEPRINT, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("database 'postgres' is not yet supported with library 'better-auth'");
    expect(await fileExists(join(tempDir, 'cloudflare-project'))).toBe(false);
  });
});
