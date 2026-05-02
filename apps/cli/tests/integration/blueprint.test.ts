import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

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

  test('--blueprint and --app are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict', '--blueprint', 'org-dashboard', '--app', 'web:nextjs', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --database are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-db', '--blueprint', 'org-dashboard', '--database', 'postgres', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --orm are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-orm', '--blueprint', 'org-dashboard', '--orm', 'drizzle', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint can be combined with --linter', async () => {
    const result = await runCli(
      ['test-bp-linter', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  test('--blueprint can be combined with --tooling', async () => {
    const result = await runCli(
      [
        'test-bp-tooling',
        '--blueprint',
        'org-dashboard',
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

describe('Blueprint generation - org-dashboard', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint org-dashboard', async () => {
    const result = await runCli(
      ['test-dashboard', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--git'],
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

    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/app-sidebar.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/app-header.tsx'))).toBe(true);
  });

  test('env file includes better-auth envs', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const envContent = await readTextFile(join(projectPath, 'apps/web/.env.example'));
    expect(envContent).toContain('BETTER_AUTH_SECRET');
  });

  test('output shows --blueprint in recreate command', async () => {
    const result = await runCli(
      ['test-bp-cmd', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint org-dashboard');
  });

  test('blueprint with --linter includes linter config', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const pkg = await readJsonFile<{ devDependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
  });

  test('blueprint recreate command includes linter flag', async () => {
    const result = await runCli(
      ['test-bp-linter-cmd', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint org-dashboard');
    expect(result.stdout).toContain('--linter biome');
  });

  test('dashboard layout redirects unauthenticated users to login', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const layoutContent = await readTextFile(join(projectPath, 'apps/web/src/app/(dashboard)/layout.tsx'));
    expect(layoutContent).toContain('redirect');
    expect(layoutContent).toContain('/login');
  });
});

describe('Blueprint generation - multitenant-saas', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint multitenant-saas', async () => {
    const result = await runCli(
      ['test-mt', '--blueprint', 'multitenant-saas', '--linter', 'biome', '--no-install', '--git'],
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
    expect(await fileExists(join(projectPath, 'apps/web/src/middleware.ts'))).toBe(true);

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

    // Profile pages (reused from org-dashboard)
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
      ['test-mt-env', '--blueprint', 'multitenant-saas', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const envContent = await readTextFile(join(tempDir, 'test-mt-env/apps/web/.env.example'));
    expect(envContent).toContain('NEXT_PUBLIC_APP_URL');
  });

  test('output shows --blueprint multitenant-saas in recreate command', async () => {
    const result = await runCli(
      ['test-mt-cmd', '--blueprint', 'multitenant-saas', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint multitenant-saas');
  });
});
