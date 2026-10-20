import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

// `tests/e2e/generated-lint.test.ts` lints whole projects with every linter and fails on a warning; these checks keep
// the constructs that tripped a linter out of the templates between two runs of that slow e2e.
describe('templates that used to trip a linter', () => {
  let tempDir: string;

  const generate = async (name: string, args: string[]): Promise<string> => {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  };

  const read = (projectPath: string, file: string): Promise<string> => readTextFile(join(projectPath, file));

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the better-auth factory builds its plugin list without a useless spread', async () => {
    const projectPath = await generate('lint-auth', ['--app', 'web:nextjs:better-auth', '--database', 'sqlite', '--orm', 'drizzle']);
    const factory = await read(projectPath, 'src/lib/auth/create-auth.ts');
    expect(factory).toContain('plugins: cookiePlugin ? [cookiePlugin] : [],');
    expect(factory).not.toContain('...(cookiePlugin');
  });

  test('a footer reads the year once, outside the render', async () => {
    const showcase = await generate('lint-showcase', ['--blueprint', 'showcase-nextjs']);
    const footer = await read(showcase, 'src/components/layout/footer.tsx');
    expect(footer).toContain('const YEAR = new Date().getFullYear();');
    expect(footer).toContain('&copy; {YEAR} ');
    expect(footer).not.toContain('{new Date()');

    const expo = await generate('lint-expo', ['--app', 'mobile:expo']);
    const appFooter = await read(expo, 'src/components/app-footer.tsx');
    expect(appFooter).toContain('const YEAR = new Date().getFullYear();');
    expect(appFooter).not.toContain('{new Date()');
  });

  test('the dashboard navigation links with next/link, and the avatar takes only the props it uses', async () => {
    const dashboard = await generate('lint-org-next', ['--blueprint', 'org-dashboard-nextjs']);
    const navUser = await read(dashboard, 'apps/web/src/components/navigation/nav-user.tsx');
    expect(navUser).toContain("import Link from 'next/link';");
    expect(navUser).toContain("<Link href='/profile/account'>");
    expect(navUser).not.toContain('<a ');
    expect(navUser).toContain('function UserAvatar({ initials }: { initials: string })');
    expect(navUser).not.toContain('<UserAvatar user=');

    const fullstack = await generate('lint-fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    const withImage = await read(fullstack, 'apps/web/src/components/navigation/nav-user.tsx');
    expect(withImage).toContain('function UserAvatar({ user, initials }');
    expect(withImage).toContain('<UserAvatar user={session.user} initials={initials} />');
  });

  test('the logout confirmation effect lists no dependency it does not read', async () => {
    const dashboard = await generate('lint-logout-focus', ['--blueprint', 'org-dashboard-nextjs']);
    const navUser = await read(dashboard, 'apps/web/src/components/navigation/nav-user.tsx');
    expect(navUser).toContain('    itemToFocus.current = null;\n  });');
    expect(navUser).not.toContain('}, [showLogout]);');
  });

  test('the theme choice is a labelled fieldset, not a div with a group role', async () => {
    const dashboard = await generate('lint-preferences', ['--blueprint', 'org-dashboard-nextjs']);
    const preferences = await read(dashboard, 'apps/web/src/components/profile/preferences.tsx');
    expect(preferences).toContain("<legend className='text-sm font-medium'>Theme</legend>");
    expect(preferences).not.toContain("role='group'");
  });

  test('the breadcrumb sets its committed flag outside the effect body', async () => {
    const dashboard = await generate('lint-breadcrumb', ['--blueprint', 'org-dashboard-nextjs']);
    const breadcrumb = await read(dashboard, 'apps/web/src/components/navigation/app-breadcrumb.tsx');
    expect(breadcrumb).toContain('queueMicrotask(() => setHasCommitted(true));');
    expect(breadcrumb).not.toContain('useEffect(() => setHasCommitted(true)');
  });

  test('shadcn classes in blueprint pages are scale values, not arbitrary ones', async () => {
    const start = await generate('lint-org-start', ['--blueprint', 'org-dashboard-tanstack-start']);
    expect(await read(start, 'apps/web/src/components/dashboard-not-found.tsx')).toContain('min-h-96');

    const fullstack = await generate('lint-fullstack-dialog', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    const dialog = await read(fullstack, 'apps/web/src/components/admin/create-user-dialog.tsx');
    expect(dialog).toContain("<DialogContent className='max-h-11/12 overflow-y-auto'>");
  });

  test('the multitenant badge declares no prop it ignores', async () => {
    const projectPath = await generate('lint-multitenant', ['--blueprint', 'multitenant-saas-nextjs']);
    const badge = await read(projectPath, 'packages/ui/src/components/ui/badge.tsx');
    expect(badge).not.toContain('asChild');
  });

  test('oxlint allows the triple-slash reference of sst.config.ts, and only under sst', async () => {
    const sst = await generate('lint-sst', ['--blueprint', 'lambda-sst-hono', '--linter', 'oxc']);
    const config = await read(sst, 'oxlint.config.mts');
    expect(config).toContain("files: ['sst.config.ts']");
    expect(config).toContain("'typescript/triple-slash-reference': 'off'");

    const plain = await generate('lint-no-sst', ['--app', 'web:nextjs', '--linter', 'oxc']);
    expect(await read(plain, 'oxlint.config.mts')).not.toContain('sst.config.ts');
  });
});
