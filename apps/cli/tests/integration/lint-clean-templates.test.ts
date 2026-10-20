import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

// `tests/e2e/generated-lint.test.ts` lints whole projects with every linter and fails on a warning. These checks run
// on every CI build and keep the constructs that trip a linter out of the templates; the behaviour of the components
// is covered by dashboard-shell and blueprint-dashboard-breadcrumb.
describe('templates pass every linter with warnings denied', () => {
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

  test.each(['showcase-nextjs', 'cloudflare-static-site-nextjs'])('the %s footer reads the year once, outside the render', async (blueprint) => {
    const footer = await read(await generate(`lint-footer-${blueprint}`, ['--blueprint', blueprint]), 'src/components/layout/footer.tsx');
    expect(footer).toMatch(/^const YEAR = new Date\(\)\.getFullYear\(\);$/m);
    expect(footer).toContain('{YEAR}');
    expect(footer).not.toMatch(/\{new Date\(/);
  });

  test('the Expo footer reads the year once, outside the render', async () => {
    const appFooter = await read(await generate('lint-expo', ['--app', 'mobile:expo']), 'src/components/app-footer.tsx');
    expect(appFooter).toMatch(/^const YEAR = new Date\(\)\.getFullYear\(\);$/m);
    expect(appFooter).not.toMatch(/\{new Date\(/);
  });

  describe.each([
    ['org-dashboard-nextjs', false],
    ['multitenant-saas-nextjs', false],
    ['cloudflare-fullstack-nextjs', true],
  ])('%s user menu', (blueprint, hasImage) => {
    test('links with next/link and passes the avatar only the props it uses', async () => {
      const navUser = await read(await generate(`lint-nav-${blueprint}`, ['--blueprint', blueprint]), 'apps/web/src/components/navigation/nav-user.tsx');
      expect(navUser).toMatch(/import Link from 'next\/link';/);
      expect(navUser).toMatch(/<Link href='\/profile\/account'>/);
      expect(navUser).not.toMatch(/<a\b/);
      if (hasImage) {
        expect(navUser).toMatch(/function UserAvatar\(\{ user, initials \}/);
        expect(navUser).toMatch(/<UserAvatar user=\{session\.user\} initials=\{initials\} \/>/);
      } else {
        expect(navUser).toMatch(/function UserAvatar\(\{ initials \}: \{ initials: string \}\)/);
        expect(navUser).not.toMatch(/<UserAvatar user=/);
      }
    });
  });

  test('the TanStack Start user menu keeps the router link', async () => {
    const navUser = await read(await generate('lint-nav-start', ['--blueprint', 'org-dashboard-tanstack-start']), 'apps/web/src/components/navigation/nav-user.tsx');
    expect(navUser).toMatch(/<Link to='\/profile\/account'>/);
    expect(navUser).not.toMatch(/next\/link/);
  });

  test('the logout focus effect lists no dependency it does not read', async () => {
    const navUser = await read(await generate('lint-logout-focus', ['--blueprint', 'org-dashboard-nextjs']), 'apps/web/src/components/navigation/nav-user.tsx');
    expect(navUser).not.toMatch(/\}, \[showLogout\]\);/);
  });

  test('the theme choice is a labelled fieldset, not a div with a group role', async () => {
    const preferences = await read(await generate('lint-preferences', ['--blueprint', 'org-dashboard-nextjs']), 'apps/web/src/components/profile/preferences.tsx');
    expect(preferences).toMatch(/<fieldset\b[\s\S]*<legend\b[^>]*>Theme<\/legend>/);
    expect(preferences).not.toMatch(/role='group'/);
  });

  test('the breadcrumb does not set state in the body of its effect', async () => {
    const breadcrumb = await read(await generate('lint-breadcrumb', ['--blueprint', 'org-dashboard-nextjs']), 'apps/web/src/components/navigation/app-breadcrumb.tsx');
    expect(breadcrumb).toMatch(/queueMicrotask\(\(\) => setHasCommitted\(true\)\)/);
    expect(breadcrumb).not.toMatch(/useEffect\(\(\) => setHasCommitted/);
  });

  test('blueprint classes are scale values, not arbitrary ones', async () => {
    const notFound = await read(await generate('lint-org-start', ['--blueprint', 'org-dashboard-tanstack-start']), 'apps/web/src/components/dashboard-not-found.tsx');
    expect(notFound).not.toMatch(/\b(min|max)-h-\[/);

    const dialog = await read(await generate('lint-fullstack-dialog', ['--blueprint', 'cloudflare-fullstack-nextjs']), 'apps/web/src/components/admin/create-user-dialog.tsx');
    expect(dialog).toMatch(/<DialogContent className='max-h-11\/12 /);
  });

  test('the multitenant badge declares no prop it ignores', async () => {
    const badge = await read(await generate('lint-multitenant', ['--blueprint', 'multitenant-saas-nextjs']), 'packages/ui/src/components/ui/badge.tsx');
    expect(badge).not.toMatch(/asChild/);
  });

  test('oxlint allows the triple-slash reference of sst.config.ts, and only under sst', async () => {
    const config = await read(await generate('lint-sst', ['--blueprint', 'lambda-sst-hono', '--linter', 'oxc']), 'oxlint.config.mts');
    expect(config).toMatch(/files: \['sst\.config\.ts'\][\s\S]*'typescript\/triple-slash-reference': 'off'/);

    const plain = await read(await generate('lint-no-sst', ['--app', 'web:nextjs', '--linter', 'oxc']), 'oxlint.config.mts');
    expect(plain).not.toMatch(/sst\.config\.ts/);
  });
});
