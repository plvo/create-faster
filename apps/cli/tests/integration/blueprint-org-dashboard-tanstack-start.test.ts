import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

const BLUEPRINT = 'org-dashboard-tanstack-start';
const WEB = 'apps/web';
const NEXT_IMPORT = /\b(?:from|import|require)\s*\(?\s*['"]next(?:\/[^'"]*)?['"]/;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
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
      'src/lib/auth/guards.ts',
      'src/components/navigation/app-sidebar.tsx',
      'src/components/navigation/nav-user.tsx',
      'src/components/navigation/sidebar-links.tsx',
    ]) {
      expect(await fileExists(join(project, WEB, file)), file).toBe(true);
    }

    expect(await fileExists(join(project, WEB, 'src/routes/index.tsx'))).toBe(false);
    expect(await fileExists(join(project, WEB, 'src/app'))).toBe(false);
    expect(await fileExists(join(project, WEB, 'src/styles/globals.css'))).toBe(false);
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
    expect(instance).toContain('createAuth(tanstackStartCookies())');

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

  test('a route checks its permission in beforeLoad, before its loader prefetches', async () => {
    const home = await read(`${WEB}/src/routes/_dashboard/index.tsx`);
    const beforeLoad = home.indexOf('beforeLoad:');
    const loader = home.indexOf('loader:');
    expect(beforeLoad).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(beforeLoad);
    expect(home).toContain("requirePermission(context.session, { contact: ['read'] })");
    expect(home).toMatch(/void context\.queryClient\.prefetchQuery\(/);
    expect(home).not.toMatch(/await context\.queryClient/);

    const guards = await read(`${WEB}/src/lib/auth/guards.ts`);
    expect(guards).toMatch(/export function requirePermission[^]*throw notFound\(\)/);
    expect(guards).toMatch(/export function requireAdmin[^]*throw redirect\(\{ to: '\/' \}\)/);
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
    expect(setup.length).toBeGreaterThan(0);
    expect(batch).toContain('Processing batch event');
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
