import { join } from 'node:path';
import { $ } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('Blueprint generation - cloudflare-fullstack-nextjs', () => {
  const projectName = 'cf-fullstack';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--blueprint', 'cloudflare-fullstack-nextjs', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates a turborepo with web + cron apps', async () => {
    expect(await fileExists(join(projectPath, 'turbo.json'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/cron'))).toBe(true);
  });

  test('web wrangler binds both D1 and R2', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"binding": "STORAGE"');
  });

  test('Worker names carry the project name so two projects on one account do not overwrite each other', async () => {
    const web = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    const cron = await readTextFile(join(projectPath, 'apps/cron/wrangler.jsonc'));
    expect(web).toContain(`"name": "${projectName}-web"`);
    expect(cron).toContain(`"name": "${projectName}-cron"`);
  });

  test('web wrangler sets NODE_ENV=production in the Worker vars, as the generic Next.js template does', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    expect(wrangler).toContain('"vars": {\n    "NODE_ENV": "production"\n  }');
  });

  test('cron wrangler ships a schedule + the R2 binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/cron/wrangler.jsonc'));
    expect(wrangler).toContain('"crons"');
    expect(wrangler).toContain('"binding": "STORAGE"');
  });

  test('cron worker exposes a scheduled handler', async () => {
    const index = await readTextFile(join(projectPath, 'apps/cron/src/index.ts'));
    expect(index).toContain('async scheduled(');
    expect(index).toContain('createDb(env.DB)');
  });

  test('db package ships the documents table + admin role column', async () => {
    const schema = await readTextFile(join(projectPath, 'packages/db/src/schema.ts'));
    expect(schema).toContain("sqliteTable('documents'");
    expect(schema).toContain("role: text('role')");
  });

  test('auth package ships createAuth + admin plugin', async () => {
    const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(auth).toContain('createAuth');
    expect(auth).toContain('admin(');
  });

  test('api package registers the documents router', async () => {
    const root = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
    expect(root).toContain('documents: documentsRouter');
  });

  test('web ships the R2 upload route', async () => {
    expect(await fileExists(join(projectPath, 'apps/web/src/app/api/documents/upload/route.ts'))).toBe(true);
  });

  test('the upload route enforces the document:create permission after the session check', async () => {
    const route = await readTextFile(join(projectPath, 'apps/web/src/app/api/documents/upload/route.ts'));
    const sessionCheck = route.indexOf('status: 401');
    const permissionCheck = route.indexOf('userHasPermission');
    const forbidden = route.indexOf('status: 403');
    expect(permissionCheck).toBeGreaterThan(sessionCheck);
    expect(route).toContain("permissions: { document: ['create'] }");
    expect(forbidden).toBeGreaterThan(permissionCheck);
    expect(route.indexOf('req.formData()')).toBeGreaterThan(forbidden);
  });

  test('the documents page prefetches the list on the server and hydrates it into the client component', async () => {
    const dashboard = join(projectPath, 'apps/web/src/app/(dashboard)');
    const page = await readTextFile(join(dashboard, 'page.tsx'));
    expect(page).not.toContain("'use client'");
    expect(page).toContain("import { HydrateClient, prefetch, trpc } from '@/trpc/server'");
    expect(page).toContain('prefetch(trpc.documents.list.queryOptions(');
    expect(page).toContain('<HydrateClient>');
    expect(page).toContain('<DocumentsClient />');

    const client = await readTextFile(join(dashboard, 'documents.client.tsx'));
    expect(client).toContain("'use client'");
    expect(client).toContain('trpc.documents.list.queryOptions(');
  });

  test('getEnv leaves prerendering before it reads the Cloudflare context', async () => {
    const env = await readTextFile(join(projectPath, 'apps/web/src/lib/env.ts'));
    expect(env).toContain("import { connection } from 'next/server'");
    expect(env.indexOf('await connection()')).toBeGreaterThan(-1);
    expect(env.indexOf('await connection()')).toBeLessThan(env.indexOf('getCloudflareContext({ async: true })'));
  });

  test('root layout mounts AppProviders + Toaster', async () => {
    const layout = await readTextFile(join(projectPath, 'apps/web/src/app/layout.tsx'));
    expect(layout).toContain('<AppProviders>');
    expect(layout).toContain('<Toaster richColors />');
  });

  test('ships the four agent docs', async () => {
    for (const f of ['auth-rbac.md', 'data-layer.md', 'storage.md', 'cloudflare-deploy.md']) {
      expect(await fileExists(join(projectPath, 'docs/agents', f))).toBe(true);
    }
  });

  test('keeps its root seed and gets no generic seed in the db package', async () => {
    expect(await fileExists(join(projectPath, 'scripts/seed.ts'))).toBe(true);
    expect(await fileExists(join(projectPath, 'packages/db/scripts/seed.ts'))).toBe(false);

    const dbPkg = JSON.parse(await readTextFile(join(projectPath, 'packages/db/package.json')));
    expect(dbPkg.scripts['db:seed']).toBe('cd ../.. && npm run db:seed');
  });

  test('emits a root local-setup orchestrator wired into the root scripts', async () => {
    const setupPath = join(projectPath, 'scripts/local-setup.ts');
    expect(await fileExists(setupPath)).toBe(true);
    const setup = await readTextFile(setupPath);
    expect(setup).toContain('.wrangler/v3/d1');
    expect(setup).toContain('db:generate');
    expect(setup).toContain('cf-typegen');
    expect(setup).not.toContain('{{');

    const pkg = await readTextFile(join(projectPath, 'package.json'));
    expect(pkg).toContain('"local-setup": "tsx scripts/local-setup.ts"');
  });

  test('uses D1 bindings everywhere — no DATABASE_URL leaks', async () => {
    const matches = await $`grep -rl DATABASE_URL ${projectPath}`.quiet().nothrow();
    expect(matches.stdout.toString().trim()).toBe('');
  });

  test('does not leak local tool caches (.impeccable) into the generated project', async () => {
    const found = await $`find ${projectPath} -name .impeccable`.quiet().nothrow();
    expect(found.stdout.toString().trim()).toBe('');
  });

  test('generates the sidebar dashboard shell and its @repo/ui components', async () => {
    const web = join(projectPath, 'apps/web/src');
    for (const f of [
      'components/navigation/app-sidebar.tsx',
      'components/navigation/app-header.tsx',
      'components/navigation/nav-user.tsx',
      'components/navigation/sidebar-links.tsx',
      'lib/constants.ts',
    ]) {
      expect(await fileExists(join(web, f))).toBe(true);
    }
    for (const c of ['sidebar', 'sheet', 'skeleton', 'dropdown-menu', 'breadcrumb', 'avatar']) {
      expect(await fileExists(join(projectPath, `packages/ui/src/components/ui/${c}.tsx`))).toBe(true);
    }
    expect(await fileExists(join(projectPath, 'packages/ui/src/hooks/use-mobile.ts'))).toBe(true);
    // the standalone sign-out button was replaced by the sidebar user menu.
    expect(await fileExists(join(web, 'app/(dashboard)/sign-out-button.tsx'))).toBe(false);
  });

  test('generates the tabbed profile area with the R2 avatar routes', async () => {
    const web = join(projectPath, 'apps/web/src');
    for (const f of [
      'app/(dashboard)/profile/layout.tsx',
      'app/(dashboard)/profile/account/page.tsx',
      'app/(dashboard)/profile/security/page.tsx',
      'app/(dashboard)/profile/sessions/page.tsx',
      'app/(dashboard)/profile/preferences/page.tsx',
      'components/profile/avatar-upload.tsx',
      'app/api/avatar/route.ts',
      'app/api/avatar/[userId]/route.ts',
    ]) {
      expect(await fileExists(join(web, f))).toBe(true);
    }
  });

  test('generates the read-only role matrix page', async () => {
    const page = await readTextFile(
      join(projectPath, 'apps/web/src/app/(dashboard)/admin/roles/page.tsx'),
    );
    expect(page).toContain('read-only');
    expect(page).toContain('roleDefinitions');
    expect(page).not.toContain('{{');
  });

  test('generates the users datatable, create dialog, per-id page and users router', async () => {
    const web = join(projectPath, 'apps/web/src');
    for (const f of [
      'components/admin/user-table.tsx',
      'components/admin/create-user-dialog.tsx',
      'components/admin/edit-user.tsx',
      'app/(dashboard)/admin/users/[id]/page.tsx',
      'components/shared/data-table-shell.tsx',
    ]) {
      expect(await fileExists(join(web, f))).toBe(true);
    }
    expect(await fileExists(join(projectPath, 'packages/api/src/router/users.ts'))).toBe(true);
    const root = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
    expect(root).toContain('users: usersRouter');
  });

  test('generates the shuip data-table block + base ui components', async () => {
    const ui = join(projectPath, 'packages/ui/src/components');
    expect(await fileExists(join(ui, 'block/shuip/data-table.tsx'))).toBe(true);
    for (const c of ['table', 'badge', 'dialog', 'popover', 'command', 'search-input']) {
      expect(await fileExists(join(ui, `ui/${c}.tsx`))).toBe(true);
    }
    expect(await fileExists(join(ui, 'ui/shuip/tanstack-form/inline-edit.tsx'))).toBe(true);
  });

  test('generates the forgot/reset password flow with the email stub', async () => {
    const web = join(projectPath, 'apps/web/src');
    for (const f of [
      'app/(auth)/forgot-password/page.tsx',
      'app/(auth)/forgot-password/forgot-password-form.tsx',
      'app/(auth)/reset-password/page.tsx',
      'app/(auth)/reset-password/reset-password-form.tsx',
    ]) {
      expect(await fileExists(join(web, f))).toBe(true);
    }
    expect(await fileExists(join(projectPath, 'packages/auth/src/email.ts'))).toBe(true);
  });
});
