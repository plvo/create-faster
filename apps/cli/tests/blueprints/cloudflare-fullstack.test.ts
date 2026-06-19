import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('cloudflare-fullstack blueprint META', () => {
  const bp = META.blueprints['cloudflare-fullstack'];

  test('exists with the cloudflare composition', () => {
    expect(bp).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(bp!.context.project).toEqual({ database: 'd1', orm: 'drizzle', deployment: 'cloudflare' });
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    const apps = Object.fromEntries(bp!.context.apps.map((a) => [a.appName, a]));
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.web!.stackName).toBe('nextjs');
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.web!.libraries).toEqual(
      expect.arrayContaining(['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form']),
    );
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.cron!.stackName).toBe('hono');
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.cron!.libraries).toEqual([]);
  });

  test('only adds blueprint-specific extras to packageJson', () => {
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated in prior test
    expect(bp!.packageJson?.dependencies).toMatchObject({ 'lucide-react': '^0.487.0', sonner: '^2.0.7', zod: '^4.2.1' });
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated in prior test
    expect(bp!.rootPackageJson?.devDependencies).toMatchObject({ '@faker-js/faker': '^10.4.0' });
  });

  test('ships a sqlite schema with admin columns + documents table', () => {
    const schema = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs'),
      'utf8',
    );
    expect(schema).toContain("sqliteTable('documents'");
    expect(schema).toContain("role: text('role')");
    expect(schema).toContain("banned: integer('banned'");
    expect(schema).toContain('expiresAt');
  });

  test('auth override uses createAuth factory + admin plugin', () => {
    const auth = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/lib/auth/auth.ts.hbs'),
      'utf8',
    );
    expect(auth).toContain('export function createAuth(db: Database)');
    expect(auth).toContain("admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] })");
  });

  test('registers a documents router using d1 per-request auth', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/trpc');
    expect(readFileSync(join(base, 'routers/_app.ts.hbs'), 'utf8')).toContain('documents: documentsRouter');
    expect(readFileSync(join(base, 'middleware/rbac.ts.hbs'), 'utf8')).toContain('createAuth(opts.ctx.db)');
    expect(readFileSync(join(base, 'routers/documents.ts.hbs'), 'utf8')).toContain('STORAGE.delete(doc.r2Key)');
  });

  test('adds the R2 STORAGE binding, env field, and upload route', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack');
    expect(readFileSync(join(base, 'wrangler.jsonc.nextjs.hbs'), 'utf8')).toContain('"binding": "STORAGE"');
    expect(readFileSync(join(base, 'src/lib/env.ts.nextjs.hbs'), 'utf8')).toContain('STORAGE: R2Bucket');
    expect(readFileSync(join(base, 'src/app/api/documents/upload/route.ts.hbs'), 'utf8')).toContain('STORAGE.put(key');
  });

  test('ships a cron worker with scheduled purge + triggers.crons', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack');
    const idx = readFileSync(join(base, 'src/index.ts.hono.hbs'), 'utf8');
    expect(idx).toContain('async scheduled(');
    expect(idx).toContain('createDb(env.DB)');
    const wr = readFileSync(join(base, 'wrangler.jsonc.hono.hbs'), 'utf8');
    expect(wr).toContain('"crons"');
    expect(wr).toContain('"binding": "STORAGE"');
  });

  test('ships (auth) layout using getAuth per-request seam (not singleton)', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/app/(auth)');
    const layout = readFileSync(join(base, 'layout.tsx.hbs'), 'utf8');
    expect(layout).toContain("import { getAuth } from '@/lib/server'");
    expect(layout).not.toContain("import { auth } from '@repo/auth/auth'");
    expect(layout).toContain('const auth = await getAuth()');
    expect(layout).toContain("auth.api.getSession({ headers: await headers() })");
    expect(layout).toContain("redirect('/')");
  });

  test('ships login and signup pages', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/app/(auth)');
    const loginPage = readFileSync(join(base, 'login/page.tsx.hbs'), 'utf8');
    expect(loginPage).toContain('LoginForm');
    const signupPage = readFileSync(join(base, 'signup/page.tsx.hbs'), 'utf8');
    expect(signupPage).toContain('SignupForm');
  });

  test('login-form and signup-form use authClient (db-agnostic)', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/app/(auth)');
    const loginForm = readFileSync(join(base, 'login/login-form.tsx.hbs'), 'utf8');
    expect(loginForm).toContain("authClient.signIn.email");
    expect(loginForm).not.toContain("import { auth } from");
    const signupForm = readFileSync(join(base, 'signup/signup-form.tsx.hbs'), 'utf8');
    expect(signupForm).toContain("authClient.signUp.email");
    expect(signupForm).not.toContain("import { auth } from");
  });

  test('ships can.tsx and use-permission.ts (verbatim from org-dashboard)', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src');
    const can = readFileSync(join(base, 'components/can.tsx.hbs'), 'utf8');
    expect(can).toContain("import { usePermission } from '@/hooks/use-permission'");
    expect(can).toContain('usePermission(permissions)');
    expect(can).toContain('{{{{raw}}}}');
    const usePerm = readFileSync(join(base, 'hooks/use-permission.ts.hbs'), 'utf8');
    expect(usePerm).toContain("import type { AppRole } from '@repo/auth/permissions'");
    expect(usePerm).toContain('authClient.admin.checkRolePermission');
    expect(usePerm).toContain('{{{{raw}}}}');
  });

  test('(dashboard) layout uses getAuth per-request seam (not singleton)', () => {
    const layout = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/app/(dashboard)/layout.tsx.hbs'),
      'utf8',
    );
    expect(layout).toContain("import { getAuth } from '@/lib/server'");
    expect(layout).not.toContain("import { auth } from '@repo/auth/auth'");
    expect(layout).toContain('const auth = await getAuth()');
    expect(layout).toContain("auth.api.getSession({ headers: await headers() })");
    expect(layout).toContain("redirect('/login')");
  });

  test('documents page references tRPC documents.list/delete and upload endpoint', () => {
    const page = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/app/(dashboard)/page.tsx.hbs'),
      'utf8',
    );
    expect(page).toContain('documents.list');
    expect(page).toContain('documents.delete');
    expect(page).toContain('/api/documents/upload');
    expect(page).toContain('{{{{raw}}}}');
    expect(page).toContain("permissions={{ document: ['create'] }}");
    expect(page).toContain("permissions={{ document: ['delete'] }}");
  });

  test('profile page uses authClient.useSession', () => {
    const page = readFileSync(
      join(
        import.meta.dir,
        '../../templates/blueprints/cloudflare-fullstack/src/app/(dashboard)/profile/page.tsx.hbs',
      ),
      'utf8',
    );
    expect(page).toContain('authClient.useSession()');
    expect(page).toContain('{{{{raw}}}}');
  });

  test('admin layout exists and server-gates non-admin users', () => {
    const layout = readFileSync(
      join(
        import.meta.dir,
        '../../templates/blueprints/cloudflare-fullstack/src/app/(dashboard)/admin/layout.tsx.hbs',
      ),
      'utf8',
    );
    expect(layout).toContain("import { getAuth } from '@/lib/server'");
    expect(layout).not.toContain("import { auth } from '@repo/auth/auth'");
    expect(layout).toContain('const auth = await getAuth()');
    expect(layout).toContain("auth.api.getSession({ headers: await headers() })");
    expect(layout).toContain("session?.user.role !== 'admin'");
    expect(layout).toContain("redirect('/')");
  });

  test('admin users page exists and uses authClient.admin methods', () => {
    const page = readFileSync(
      join(
        import.meta.dir,
        '../../templates/blueprints/cloudflare-fullstack/src/app/(dashboard)/admin/users/page.tsx.hbs',
      ),
      'utf8',
    );
    expect(page).toContain('{{{{raw}}}}');
    expect(page).toContain("authClient.admin.listUsers");
    expect(page).toContain("authClient.admin.setRole");
    expect(page).toContain("authClient.admin.banUser");
    expect(page).toContain("authClient.admin.unbanUser");
    expect(page).toContain("permissions={{ user: ['list'] }}");
    expect(page).toContain("import { authClient } from '@repo/auth/auth-client'");
  });
});
