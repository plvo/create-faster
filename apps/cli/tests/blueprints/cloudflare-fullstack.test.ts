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

  test('root layout override mounts AppProviders + Toaster (no missing devtools deps)', () => {
    const layout = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/app/layout.tsx.hbs'),
      'utf8',
    );
    expect(layout).toContain("import { AppProviders } from '@/components/app-providers'");
    expect(layout).toContain("import { Toaster } from 'sonner'");
    expect(layout).toContain('<AppProviders>');
    expect(layout).toContain('<Toaster richColors />');
    expect(layout).not.toContain('@tanstack/react-devtools');
  });

  test('ships a local-D1 seed (no DATABASE_URL, no shebang)', () => {
    const seed = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/scripts/seed.ts.hbs'),
      'utf8',
    );
    expect(seed).toContain("import { Database as BunSqlite } from 'bun:sqlite'");
    expect(seed).toContain('createAuth(db)');
    expect(seed).toContain('auth.api.signUpEmail');
    expect(seed).toContain('miniflare-D1DatabaseObject');
    expect(seed).not.toContain('DATABASE_URL');
    expect(seed).not.toContain('#!/usr/bin/env');
  });

  test('ships the four agent docs', () => {
    const base = join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/docs/agents');
    for (const f of ['auth-rbac.md.hbs', 'data-layer.md.hbs', 'storage.md.hbs', 'cloudflare-deploy.md.hbs']) {
      expect(() => readFileSync(join(base, f), 'utf8')).not.toThrow();
    }
  });

  // Regression guards for bugs found by dogfood typecheck + the code-review pass.
  const bpFile = (p: string) =>
    readFileSync(join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack', p), 'utf8');

  test('ships a db types override matching its schema (no postTable)', () => {
    const types = bpFile('src/lib/db/types.ts.hbs');
    expect(types).toContain('export type Document =');
    expect(types).not.toContain('postTable');
  });

  test('ships the shuip tanstack-form ui kit the auth forms import', () => {
    expect(() => bpFile('packages/ui/src/lib/form.ts.hbs')).not.toThrow();
    expect(() => bpFile('packages/ui/src/components/ui/card.tsx.hbs')).not.toThrow();
    expect(() => bpFile('packages/ui/src/components/ui/shuip/tanstack-form/input-field.tsx.hbs')).not.toThrow();
  });

  test('env seam exposes only the bindings (no dead better-auth secret fields)', () => {
    const env = bpFile('src/lib/env.ts.nextjs.hbs');
    expect(env).toContain('DB: D1Database');
    expect(env).toContain('STORAGE: R2Bucket');
    expect(env).not.toContain('BETTER_AUTH_SECRET');
  });

  test('documents.delete reaches R2 without the app-only @/ alias', () => {
    const router = bpFile('src/trpc/routers/documents.ts.hbs');
    expect(router).not.toContain("import('@/lib/env')");
    expect(router).toContain("import('@opennextjs/cloudflare')");
    expect(router).toContain('env.STORAGE.delete');
  });

  test('dashboard guards on session presence and signs out via client (POST)', () => {
    const layout = bpFile('src/app/(dashboard)/layout.tsx.hbs');
    expect(layout).toContain('if (!session?.user)');
    expect(layout).toContain('<SignOutButton />');
    expect(layout).not.toContain("href='/api/auth/sign-out'");
    expect(bpFile('src/app/(dashboard)/sign-out-button.tsx.hbs')).toContain('authClient.signOut()');
  });

  test('cron purge counts actual R2 successes and batches the row delete', () => {
    const cron = bpFile('src/index.ts.hono.hbs');
    expect(cron).toContain('inArray(documentTable.id, purgedIds)');
    expect(cron).toContain('purgedIds.length} of ${expired.length}');
  });

  test('both wrangler configs share one project-scoped D1 name', () => {
    expect(bpFile('wrangler.jsonc.nextjs.hbs')).toContain('"database_name": "{{projectName}}-db"');
    expect(bpFile('wrangler.jsonc.hono.hbs')).toContain('"database_name": "{{projectName}}-db"');
  });

  test('upload streams the file to R2 (no full-buffer arrayBuffer)', () => {
    const route = bpFile('src/app/api/documents/upload/route.ts.hbs');
    expect(route).toContain('STORAGE.put(key, file.stream()');
    expect(route).not.toContain('await file.arrayBuffer()');
  });

  test('seed enables sqlite foreign keys so reset cascades', () => {
    expect(bpFile('scripts/seed.ts.hbs')).toContain("PRAGMA foreign_keys = ON");
  });
});
