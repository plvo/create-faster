import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

// Destinations of the files the org-dashboard-nextjs templates generate in a turborepo. A rename that drops or
// moves one makes the blueprint lose it, so each must still exist in the generated project.
const ORG_DASHBOARD_NEXTJS_DESTINATIONS = [
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
  'apps/web/src/app/layout.tsx',
  'apps/web/src/components/admin/create-user-dialog.tsx',
  'apps/web/src/components/admin/user-actions.tsx',
  'apps/web/src/components/admin/user-table.tsx',
  'apps/web/src/components/can.tsx',
  'apps/web/src/components/contacts/contact-dialog.tsx',
  'apps/web/src/components/contacts/contact-form.tsx',
  'apps/web/src/components/contacts/contact-table.tsx',
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
  'apps/web/src/hooks/use-permission.ts',
  'apps/web/src/lib/auth/session.ts',
  'apps/web/src/lib/constants.ts',
  'apps/web/src/lib/safe-redirect.ts',
  'apps/web/src/styles/globals.css',
  'docs/agents/auth.md',
  'docs/agents/data-layer.md',
  'packages/api/src/middleware/rbac.ts',
  'packages/api/src/root.ts',
  'packages/api/src/router/contact.ts',
  'packages/api/src/router/session.ts',
  'packages/api/src/router/user.ts',
  'packages/auth/src/auth-client.ts',
  'packages/auth/src/auth.ts',
  'packages/auth/src/password.ts',
  'packages/auth/src/permissions.ts',
  'packages/auth/src/types.ts',
  'packages/db/src/schema.ts',
  'packages/ui/src/components/block/shuip/responsive-dialog.tsx',
  'packages/ui/src/components/ui/breadcrumb.tsx',
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
  'scripts/local-setup.ts',
  'scripts/seed.ts',
];

describe('Blueprint CLI flag', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('invalid blueprint name produces an error', async () => {
    const result = await runCli(['test-bp', '--blueprint', 'nonexistent', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid blueprint');
  });

  const UNSUFFIXED_BLUEPRINT_NAMES = [
    'dapp-privy',
    'dapp-rainbowkit',
    'org-dashboard',
    'multitenant-saas',
    'cloudflare-static-site',
    'cloudflare-fullstack',
    'showcase',
    'lambda-sst',
    'lambda-terraform-aws',
  ];

  test.each(UNSUFFIXED_BLUEPRINT_NAMES)('%s without its stack suffix is rejected like any unknown name', async (name) => {
    const unknown = await runCli(['test-bp-unknown', '--blueprint', 'nonexistent', '--no-install', '--no-git'], tempDir);
    const unsuffixed = await runCli(['test-bp-old', '--blueprint', name, '--no-install', '--no-git'], tempDir);
    expect(unsuffixed.exitCode).toBe(1);
    expect(unsuffixed.stderr).toContain(`Invalid blueprint '${name}'`);
    expect(unsuffixed.stderr.replace(name, 'x')).toBe(unknown.stderr.replace('nonexistent', 'x'));
  });

  test('the suffixed blueprint name generates the project', async () => {
    const result = await runCli(['test-bp-suffixed', '--blueprint', 'org-dashboard-nextjs', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'test-bp-suffixed', 'package.json'))).toBe(true);
  });

  test('--blueprint and --app are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict', '--blueprint', 'org-dashboard-nextjs', '--app', 'web:nextjs', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --database are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-db', '--blueprint', 'org-dashboard-nextjs', '--database', 'postgres', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --orm are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-orm', '--blueprint', 'org-dashboard-nextjs', '--orm', 'drizzle', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint can be combined with --linter', async () => {
    const result = await runCli(
      ['test-bp-linter', '--blueprint', 'org-dashboard-nextjs', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  test('--blueprint can be combined with --tooling', async () => {
    const result = await runCli(
      [
        'test-bp-tooling',
        '--blueprint',
        'org-dashboard-nextjs',
        '--linter',
        'biome',
        '--tooling',
        'husky',
        '--git',
        '--no-install',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
});

describe('Blueprint generation - org-dashboard-nextjs', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint org-dashboard-nextjs', async () => {
    const result = await runCli(
      ['test-dashboard', '--blueprint', 'org-dashboard-nextjs', '--linter', 'biome', '--no-install', '--git'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);

    const projectPath = join(tempDir, 'test-dashboard');

    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/.env.example'))).toBe(true);

    const webPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
      join(projectPath, 'apps/web/package.json'),
    );
    expect(webPkg.dependencies.sonner).toBeDefined();
  });

  test('every template destination of the blueprint is generated', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const generated = new Set(
      await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: projectPath, dot: true, onlyFiles: true })),
    );
    expect(ORG_DASHBOARD_NEXTJS_DESTINATIONS.filter((destination) => !generated.has(destination))).toEqual([]);
  });

  test('auth notes name the Next.js cookie plugin, session guard and redirect helper usage', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const notes = await readTextFile(join(projectPath, 'docs/agents/auth.md'));
    expect(notes).toContain('with `createAuth(nextCookies())`');
    expect(notes).toContain('## Reading the session server-side');
    expect(notes).toContain('Call `requireSession()` from `apps/web/src/lib/auth/session.ts`');
    expect(notes).toContain('## Post-login redirect');
    expect(notes).toContain('(`apps/web/src/lib/safe-redirect.ts`) before `router.push`: only an internal path');
    expect(notes).toContain('straight to `router.push` or `redirect`');
  });

  test('env file includes better-auth envs', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const envContent = await readTextFile(join(projectPath, 'apps/web/.env.example'));
    expect(envContent).toContain('BETTER_AUTH_SECRET');
  });

  test('output shows --blueprint in recreate command', async () => {
    const result = await runCli(
      ['test-bp-cmd', '--blueprint', 'org-dashboard-nextjs', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint org-dashboard-nextjs');
  });

  test('blueprint with --linter includes linter config', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const pkg = await readJsonFile<{ devDependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
  });

  test('blueprint recreate command includes linter flag', async () => {
    const result = await runCli(
      ['test-bp-linter-cmd', '--blueprint', 'org-dashboard-nextjs', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint org-dashboard-nextjs');
    expect(result.stdout).toContain('--linter biome');
  });

  test('dashboard layout redirects unauthenticated users to login', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const layoutContent = await readTextFile(join(projectPath, 'apps/web/src/app/(dashboard)/layout.tsx'));
    expect(layoutContent).toContain('await requireSession()');
    const sessionContent = await readTextFile(join(projectPath, 'apps/web/src/lib/auth/session.ts'));
    expect(sessionContent).toContain("redirect('/login')");
  });
});

describe('Blueprint generation - multitenant-saas-nextjs', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint multitenant-saas-nextjs', async () => {
    const result = await runCli(
      ['test-mt', '--blueprint', 'multitenant-saas-nextjs', '--linter', 'biome', '--no-install', '--git'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);

    const projectPath = join(tempDir, 'test-mt');

    // Auth package
    expect(await fileExists(join(projectPath, 'packages/auth/src/auth.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/auth/src/auth-client.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/auth/src/permissions.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/auth/src/types.ts'))).toBe(true);

    // Permissions catalog content
    const permsContent = await readTextFile(join(projectPath, 'packages/auth/src/permissions.ts'));
    expect(permsContent).toContain('createAccessControl');
    expect(permsContent).toContain('owner');
    expect(permsContent).toContain('admin');

    // Auth.ts has the organization plugin
    const authContent = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(authContent).toContain('organization');
    expect(authContent).toContain('dynamicAccessControl');

    // DB schema with project entity
    const schemaContent = await readTextFile(join(projectPath, 'packages/db/src/schema.ts'));
    expect(schemaContent).toContain('project');
    expect(schemaContent).toContain('organizationId');
    expect(schemaContent).toContain('createdById');

    // tRPC routers (in packages/api/src/router/ in mono mode)
    expect(await fileExists(join(projectPath, 'packages/api/src/router/project.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/api/src/router/member.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/api/src/router/role.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/api/src/router/invitation.ts'))).toBe(true);

    // Root router registers all four
    const rootContent = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
    expect(rootContent).toContain('projectRouter');
    expect(rootContent).toContain('memberRouter');
    expect(rootContent).toContain('roleRouter');
    expect(rootContent).toContain('invitationRouter');

    // RBAC middleware
    const rbacContent = await readTextFile(join(projectPath, 'packages/api/src/middleware/rbac.ts'));
    expect(rbacContent).toContain('orgProcedure');
    expect(rbacContent).toContain('permissionProcedure');
    expect(rbacContent).toContain('assertInScope');

    // OrgSwitcher
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/org-switcher.tsx'))).toBe(true);

    // Sidebar links + AppSidebar
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/sidebar-links.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/app-sidebar.tsx'))).toBe(true);

    // Settings pages
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/settings/general/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/settings/members/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/settings/roles/page.tsx'))).toBe(true);

    // Members management components
    expect(await fileExists(join(projectPath, 'apps/web/src/components/members/members-table.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/members/invite-dialog.tsx'))).toBe(true);
    expect(
      await fileExists(join(projectPath, 'apps/web/src/components/members/invitation-link-dialog.tsx')),
    ).toBe(true);
    expect(
      await fileExists(join(projectPath, 'apps/web/src/components/members/pending-invitations-table.tsx')),
    ).toBe(true);

    // Roles management components
    expect(await fileExists(join(projectPath, 'apps/web/src/components/roles/roles-table.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/roles/role-form-dialog.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/roles/permissions-grid.tsx'))).toBe(true);

    // Project entity UI
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/projects/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/projects/[id]/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/projects/project-table.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/projects/project-form.tsx'))).toBe(true);

    // Onboarding
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(onboarding)/onboarding/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/proxy.ts'))).toBe(true);

    // Password reset flow
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(auth)/forgot-password/page.tsx'))).toBe(true);
    expect(
      await fileExists(join(projectPath, 'apps/web/src/app/(auth)/forgot-password/forgot-password-form.tsx')),
    ).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(auth)/reset-password/page.tsx'))).toBe(true);
    expect(
      await fileExists(join(projectPath, 'apps/web/src/app/(auth)/reset-password/reset-password-form.tsx')),
    ).toBe(true);

    // Accept invitation page
    expect(
      await fileExists(join(projectPath, 'apps/web/src/app/(auth)/accept-invitation/[id]/page.tsx')),
    ).toBe(true);
    expect(
      await fileExists(join(projectPath, 'apps/web/src/app/(auth)/accept-invitation/[id]/accept-button.tsx')),
    ).toBe(true);

    // Permission helpers
    expect(await fileExists(join(projectPath, 'apps/web/src/hooks/use-permission.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/can.tsx'))).toBe(true);

    // Profile pages (reused from org-dashboard-nextjs)
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/profile/account/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/profile/security/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/profile/sessions/page.tsx'))).toBe(true);

    // Seed script
    expect(await fileExists(join(projectPath, 'scripts/seed.ts'))).toBe(true);

    // Hugeicons dependency
    const webPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
      join(projectPath, 'apps/web/package.json'),
    );
    expect(webPkg.dependencies['@hugeicons/react']).toBeDefined();
    expect(webPkg.dependencies['@hugeicons/core-free-icons']).toBeDefined();
    expect(webPkg.dependencies.sonner).toBeDefined();

    // Shipped shadcn UI components
    expect(await fileExists(join(projectPath, 'packages/ui/src/components/ui/dialog.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/ui/src/components/ui/card.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/ui/src/components/ui/select.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/ui/src/components/ui/table.tsx'))).toBe(true);
  });

  test('env file includes NEXT_PUBLIC_APP_URL', async () => {
    const result = await runCli(
      ['test-mt-env', '--blueprint', 'multitenant-saas-nextjs', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const envContent = await readTextFile(join(tempDir, 'test-mt-env/apps/web/.env.example'));
    expect(envContent).toContain('NEXT_PUBLIC_APP_URL');
  });

  test('password reset is wired into auth config and route protection', async () => {
    const projectPath = join(tempDir, 'test-mt');

    const authContent = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(authContent).toContain('sendResetPassword');

    const proxyContent = await readTextFile(join(projectPath, 'apps/web/src/proxy.ts'));
    expect(proxyContent).toContain('/forgot-password');
    expect(proxyContent).toContain('/reset-password');
  });

  test('project table declares foreign keys for tenant integrity', async () => {
    const projectPath = join(tempDir, 'test-mt');
    const schemaContent = await readTextFile(join(projectPath, 'packages/db/src/schema.ts'));

    const appSection = schemaContent.slice(schemaContent.indexOf('Application tables'));
    expect(appSection).toContain('references(() => organizationTable.id');
    expect(appSection).toContain('references(() => userTable.id');
  });

  test('ships the shuip tanstack-form system and migrates forms onto it', async () => {
    const projectPath = join(tempDir, 'test-mt');

    expect(await fileExists(join(projectPath, 'packages/ui/src/lib/form.ts'))).toBe(true);
    expect(
      await fileExists(join(projectPath, 'packages/ui/src/components/ui/shuip/tanstack-form/form-context.tsx')),
    ).toBe(true);
    expect(
      await fileExists(join(projectPath, 'packages/ui/src/components/ui/shuip/tanstack-form/input-field.tsx')),
    ).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/ui/src/components/ui/field.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/ui/src/components/ui/input-group.tsx'))).toBe(true);

    const loginForm = await readTextFile(join(projectPath, 'apps/web/src/app/(auth)/login/login-form.tsx'));
    expect(loginForm).toContain('useAppForm');
    expect(loginForm).toContain('form.AppField');
  });

  test('routes data mutations through tRPC routers, not auth in pages', async () => {
    const projectPath = join(tempDir, 'test-mt');

    // organization router exists and is registered
    expect(await fileExists(join(projectPath, 'packages/api/src/router/organization.ts'))).toBe(true);
    const root = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
    expect(root).toContain('organizationRouter');

    // user router owns profile + password mutations
    const userRouter = await readTextFile(join(projectPath, 'packages/api/src/router/user.ts'));
    expect(userRouter).toContain('updateProfile');
    expect(userRouter).toContain('changePassword');

    // data-mutation forms call tRPC, not authClient directly
    const accountForm = await readTextFile(join(projectPath, 'apps/web/src/components/profile/account-form.tsx'));
    expect(accountForm).toContain('user.updateProfile');
    expect(accountForm).not.toContain('authClient');
  });

  test('output shows --blueprint multitenant-saas-nextjs in recreate command', async () => {
    const result = await runCli(
      ['test-mt-cmd', '--blueprint', 'multitenant-saas-nextjs', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint multitenant-saas-nextjs');
  });
});

describe('Blueprint generation - dapp-privy-nextjs seed', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['test-dapp-privy', '--blueprint', 'dapp-privy-nextjs', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('ships its own seed in place of the generic orm seed', async () => {
    const seed = await readTextFile(join(tempDir, 'test-dapp-privy', 'scripts/seed.ts'));
    expect(seed).not.toContain('Getting Started with Drizzle ORM');
  });
});
