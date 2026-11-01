import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const FULLSTACK = 'cloudflare-fullstack-nextjs';
const ORG_DASHBOARD = 'org-dashboard-nextjs';
const ORG_DASHBOARD_START = 'org-dashboard-tanstack-start';

// The files of the roles engine that both blueprints render from the same partial and that name nothing of their
// blueprint or their database: a copy that drifted would show here as a difference between the two projects.
const SHARED_FILES = [
  'packages/auth/src/guard-administrators.ts',
  'packages/auth/src/role-assignment.ts',
  'packages/auth/src/role-management.ts',
  'packages/auth/src/role-permissions.ts',
  'packages/api/src/middleware/rbac.ts',
  'packages/api/src/router/roles.ts',
  'packages/api/src/router/permissions.ts',
  'packages/api/src/user-role.ts',
  'packages/ui/src/components/ui/table.tsx',
  'apps/web/src/components/can.tsx',
  'apps/web/src/components/confirm-dialog.tsx',
  'apps/web/src/lib/role-options.ts',
  'apps/web/src/lib/allowed-routes.ts',
  'apps/web/src/hooks/use-permission.ts',
  'apps/web/src/app/(dashboard)/admin/roles/page.tsx',
  'apps/web/src/app/(dashboard)/admin/roles/roles.client.tsx',
];

// The files that name the router of the users (`users` on the Cloudflare blueprint, `user` on the org dashboards).
const NAMING_THE_USERS_ROUTER = [
  'apps/web/src/components/admin/role-matrix.tsx',
  'apps/web/src/components/admin/create-role-dialog.tsx',
  'apps/web/src/components/admin/user-role-select.tsx',
];

// What the TanStack Start blueprint inherits from the Next.js one: the engine and the screens that import no Next.js
// module. Its permission hook and its guards are its own, because its permission list is in the route context.
const INHERITED_BY_START = [
  ...SHARED_FILES.filter((file) => !file.includes('/app/') && !file.endsWith('use-permission.ts')),
  'apps/web/src/components/admin/role-matrix.tsx',
  'apps/web/src/components/admin/create-role-dialog.tsx',
  'apps/web/src/components/admin/user-role-select.tsx',
];

describe('the roles engine is rendered once for every blueprint that has it', () => {
  let tempDir: string;
  const read = (blueprint: string, file: string) => readTextFile(join(tempDir, blueprint, file));

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of [FULLSTACK, ORG_DASHBOARD, ORG_DASHBOARD_START]) {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(SHARED_FILES)('%s is the same file in the Cloudflare blueprint and in the org dashboard', async (file) => {
    const fullstack = await read(FULLSTACK, file);
    expect(fullstack.length).toBeGreaterThan(0);
    expect(await read(ORG_DASHBOARD, file)).toBe(fullstack);
  });

  test.each(NAMING_THE_USERS_ROUTER)('%s differs only by the name of the router of the users', async (file) => {
    const fullstack = await read(FULLSTACK, file);
    const org = await read(ORG_DASHBOARD, file);
    expect(fullstack).toContain('trpc.users.');
    expect(org).toContain('trpc.user.');
    // The matrix tells which commands write the default roles, and the Cloudflare blueprint has a remote one too.
    const withoutScripts = (source: string) => source.split('\n').filter((line) => !line.includes('db:roles'));
    expect(withoutScripts(org)).toEqual(withoutScripts(fullstack.replaceAll('trpc.users.', 'trpc.user.')));
  });

  // What differs is what the blueprint declares (the vocabulary, the defaults) and what the database needs (the
  // role store), and it differs through a partial of the blueprint or of the database, never through a copy of a file.
  test('the vocabulary and the defaults are the blueprint part of two otherwise identical files', async () => {
    const fullstack = await read(FULLSTACK, 'packages/auth/src/permissions.ts');
    const org = await read(ORG_DASHBOARD, 'packages/auth/src/permissions.ts');
    expect(fullstack).toContain("document: ['create', 'read', 'update', 'delete', 'read-any', 'delete-any']");
    expect(org).toContain("contact: ['create', 'read', 'update', 'delete']");
    expect(org).not.toContain('document');
    expect(fullstack).toContain("manager: { label: 'Manager', permissions: ['document.read', 'document.read-any'] }");
    expect(org).toContain("manager: { label: 'Manager', permissions: ['contact.read'] }");

    // The compiled roles are admin and the default roles, so the shared text names no other role.
    for (const source of [fullstack, org]) {
      expect(source).toContain('Object.keys(DEFAULT_ROLES)');
      expect(source.replace(/\/\/ `manager`[\s\S]*?satisfies Record<string, DefaultRole>;/, '')).not.toContain('manager');
    }

    const outside = (source: string, from: string, to: string) => source.slice(0, source.indexOf(from)) + source.slice(source.indexOf(to));
    const withoutBlueprintParts = (source: string, vocabulary: string) =>
      outside(outside(source, vocabulary, 'export const statement'), '// `manager` reads', 'type CompiledRoleId');
    expect(withoutBlueprintParts(org, 'export const businessStatement')).toBe(withoutBlueprintParts(fullstack, '// `read-any`'));
  });

  test('the role store is the one module that differs by database', async () => {
    const sqlite = await read(FULLSTACK, 'packages/auth/src/role-store.ts');
    const postgres = await read(ORG_DASHBOARD, 'packages/auth/src/role-store.ts');
    expect(sqlite).toContain('db.batch');
    expect(sqlite).not.toContain('.transaction(');
    expect(postgres).toContain('database.transaction(');
    expect(postgres).toContain('pg_advisory_xact_lock');
    expect(postgres).not.toContain('.batch(');
    for (const name of ['writeRoleUnlessLast', 'banAccountUnlessLast', 'removeAccountUnlessLast', 'grantRolePermission', 'deleteRoleUnlessHeld']) {
      expect(sqlite, name).toContain(`export async function ${name}(`);
      expect(postgres, name).toMatch(new RegExp(`export (async )?function ${name}\\(`));
    }
    expect(await read(ORG_DASHBOARD_START, 'packages/auth/src/role-store.ts')).toBe(postgres);
  });

  test.each(INHERITED_BY_START)('%s is the file of the Next.js org dashboard in the TanStack Start blueprint, and imports no Next.js module', async (file) => {
    const source = await read(ORG_DASHBOARD_START, file);
    expect(source).toBe(await read(ORG_DASHBOARD, file));
    expect(source).not.toMatch(/from 'next(\/|')/);
  });

  test.each(['apps/web/src/hooks/use-permission.ts', 'apps/web/src/lib/auth/guards.ts', 'apps/web/src/lib/auth/permissions.ts', 'apps/web/src/components/admin/roles-client.tsx'])(
    'the TanStack Start file %s imports no Next.js module',
    async (file) => {
      expect(await read(ORG_DASHBOARD_START, file)).not.toMatch(/from 'next(\/|')/);
    },
  );
});
