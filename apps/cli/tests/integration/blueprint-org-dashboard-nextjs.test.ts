import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

// The sources the blueprint and its stack and libraries generate. Root manifests and config files are left
// out: they change with unrelated work, while a file dropped or moved by a template rename shows up here.
const GENERATED_SOURCES = /^(apps\/[^/]+\/src\/|packages\/[^/]+\/src\/|scripts\/|docs\/)/;

const SOURCES_OF_ORG_DASHBOARD_NEXTJS = [
    'apps/batch/src/index.ts',
    'apps/web/src/app/(auth)/layout.tsx',
    'apps/web/src/app/(auth)/login/login-form.tsx',
    'apps/web/src/app/(auth)/login/page.tsx',
    'apps/web/src/app/(dashboard)/admin/roles/page.tsx',
    'apps/web/src/app/(dashboard)/admin/users/[id]/page.tsx',
    'apps/web/src/app/(dashboard)/admin/users/[id]/user-detail.tsx',
    'apps/web/src/app/(dashboard)/admin/users/page.tsx',
    'apps/web/src/app/(dashboard)/admin/users/users.client.tsx',
    'apps/web/src/app/(dashboard)/contacts/[id]/contact.client.tsx',
    'apps/web/src/app/(dashboard)/contacts/[id]/page.tsx',
    'apps/web/src/app/(dashboard)/contacts/contacts.client.tsx',
    'apps/web/src/app/(dashboard)/contacts/page.tsx',
    'apps/web/src/app/(dashboard)/dashboard.client.tsx',
    'apps/web/src/app/(dashboard)/layout.tsx',
    'apps/web/src/app/(dashboard)/page.tsx',
    'apps/web/src/app/(dashboard)/profile/account/page.tsx',
    'apps/web/src/app/(dashboard)/profile/layout.tsx',
    'apps/web/src/app/(dashboard)/profile/page.tsx',
    'apps/web/src/app/(dashboard)/profile/preferences/page.tsx',
    'apps/web/src/app/(dashboard)/profile/security/page.tsx',
    'apps/web/src/app/(dashboard)/profile/sessions/page.tsx',
    'apps/web/src/app/api/auth/[...all]/route.ts',
    'apps/web/src/app/api/trpc/[trpc]/route.ts',
    'apps/web/src/app/error.tsx',
    'apps/web/src/app/icon.svg',
    'apps/web/src/app/layout.tsx',
    'apps/web/src/app/not-found.tsx',
    'apps/web/src/components/admin/create-user-dialog.tsx',
    'apps/web/src/components/admin/user-actions.tsx',
    'apps/web/src/components/admin/user-table.tsx',
    'apps/web/src/components/app-providers.tsx',
    'apps/web/src/components/can.tsx',
    'apps/web/src/components/contacts/contact-dialog.tsx',
    'apps/web/src/components/contacts/contact-form.tsx',
    'apps/web/src/components/contacts/contact-table.tsx',
    'apps/web/src/components/devtools.tsx',
    'apps/web/src/components/navigation/app-header.tsx',
    'apps/web/src/components/navigation/app-sidebar.tsx',
    'apps/web/src/components/navigation/nav-user.tsx',
    'apps/web/src/components/navigation/sidebar-links.tsx',
    'apps/web/src/components/profile/account-form.tsx',
    'apps/web/src/components/profile/preferences.tsx',
    'apps/web/src/components/profile/security-form.tsx',
    'apps/web/src/components/profile/session-list.tsx',
    'apps/web/src/components/profile/tab-nav.tsx',
    'apps/web/src/components/query-boundary.tsx',
    'apps/web/src/hooks/use-mobile.ts',
    'apps/web/src/hooks/use-mounted.ts',
    'apps/web/src/hooks/use-permission.ts',
    'apps/web/src/lib/auth/auth.ts',
    'apps/web/src/lib/auth/session.ts',
    'apps/web/src/lib/constants.ts',
    'apps/web/src/lib/get-app-url.ts',
    'apps/web/src/lib/safe-redirect.ts',
    'apps/web/src/proxy.ts',
    'apps/web/src/styles/fonts/geist-mono-vf.woff',
    'apps/web/src/styles/fonts/geist-sans-vf.woff',
    'apps/web/src/styles/globals.css',
    'apps/web/src/trpc/client.ts',
    'apps/web/src/trpc/providers.tsx',
    'apps/web/src/trpc/query-client.ts',
    'apps/web/src/trpc/server.tsx',
    'apps/web/src/types/next-page.ts',
    'docs/agents/auth.md',
    'docs/agents/data-layer.md',
    'packages/api/src/auth.ts',
    'packages/api/src/index.ts',
    'packages/api/src/middleware/rbac.ts',
    'packages/api/src/root.ts',
    'packages/api/src/router/contact.ts',
    'packages/api/src/router/hello.ts',
    'packages/api/src/router/session.ts',
    'packages/api/src/router/user.ts',
    'packages/api/src/trpc.ts',
    'packages/auth/src/auth-client.ts',
    'packages/auth/src/auth.ts',
    'packages/auth/src/password.ts',
    'packages/auth/src/permissions.ts',
    'packages/auth/src/types.ts',
    'packages/db/src/index.ts',
    'packages/db/src/schema.ts',
    'packages/db/src/types.ts',
    'packages/ui/src/base.css',
    'packages/ui/src/components/block/shuip/responsive-dialog.tsx',
    'packages/ui/src/components/ui/breadcrumb.tsx',
    'packages/ui/src/components/ui/button.tsx',
    'packages/ui/src/components/ui/card.tsx',
    'packages/ui/src/components/ui/checkbox.tsx',
    'packages/ui/src/components/ui/drawer.tsx',
    'packages/ui/src/components/ui/dropdown-menu.tsx',
    'packages/ui/src/components/ui/field.tsx',
    'packages/ui/src/components/ui/input-group.tsx',
    'packages/ui/src/components/ui/input.tsx',
    'packages/ui/src/components/ui/label.tsx',
    'packages/ui/src/components/ui/select.tsx',
    'packages/ui/src/components/ui/separator.tsx',
    'packages/ui/src/components/ui/sheet.tsx',
    'packages/ui/src/components/ui/shuip/side-dialog.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/checkbox-field.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/form-context.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/input-field.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/password-field.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/select-field.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/submit-button.tsx',
    'packages/ui/src/components/ui/shuip/tanstack-form/textarea-field.tsx',
    'packages/ui/src/components/ui/sidebar.tsx',
    'packages/ui/src/components/ui/skeleton.tsx',
    'packages/ui/src/components/ui/textarea.tsx',
    'packages/ui/src/components/ui/tooltip.tsx',
    'packages/ui/src/hooks/use-mobile.ts',
    'packages/ui/src/lib/form.ts',
    'packages/ui/src/lib/utils.ts',
    'scripts/local-setup.ts',
    'scripts/seed.ts',
];

describe('blueprint org-dashboard-nextjs destinations', () => {
  let tempDir: string;
  let sources: string[];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['dashboard', '--blueprint', 'org-dashboard-nextjs', '--yes', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const files = await Array.fromAsync(
      new Bun.Glob('**/*').scan({ cwd: join(tempDir, 'dashboard'), dot: true, onlyFiles: true }),
    );
    sources = files.filter((file) => GENERATED_SOURCES.test(file)).sort();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates the same source files at the same destinations', () => {
    expect(sources).toEqual(SOURCES_OF_ORG_DASHBOARD_NEXTJS);
  });
});
