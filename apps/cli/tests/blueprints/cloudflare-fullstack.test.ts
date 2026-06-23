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

  test('profile is a tabbed account/security/sessions/preferences area', () => {
    const base = 'src/app/(dashboard)/profile';
    expect(bpFile(`${base}/page.tsx.hbs`)).toContain("redirect('/profile/account')");
    expect(bpFile(`${base}/layout.tsx.hbs`)).toContain('ProfileTabNav');
    expect(bpFile(`${base}/security/page.tsx.hbs`)).toContain('SecurityForm');
    expect(bpFile(`${base}/sessions/page.tsx.hbs`)).toContain('SessionList');
    expect(bpFile(`${base}/preferences/page.tsx.hbs`)).toContain('Preferences');

    const tabNav = bpFile('src/components/profile/tab-nav.tsx.hbs');
    for (const href of ['/profile/account', '/profile/security', '/profile/sessions', '/profile/preferences']) {
      expect(tabNav).toContain(href);
    }
  });

  test('account page reads the session server-side and renders avatar + account form', () => {
    const page = bpFile('src/app/(dashboard)/profile/account/page.tsx.hbs');
    expect(page).toContain("import { getAuth } from '@/lib/server'");
    expect(page).toContain('<AvatarUpload name={name} image={image ?? null} />');
    expect(page).toContain('<AccountForm initialName={name}');
  });

  test('profile forms update via authClient (no extra trpc routers)', () => {
    expect(bpFile('src/components/profile/account-form.tsx.hbs')).toContain('authClient.updateUser({ name: value.name })');
    expect(bpFile('src/components/profile/security-form.tsx.hbs')).toContain('authClient.changePassword');
    const sessions = bpFile('src/components/profile/session-list.tsx.hbs');
    expect(sessions).toContain('authClient.listSessions()');
    expect(sessions).toContain('authClient.revokeSession({ token })');
    expect(sessions).toContain('authClient.revokeOtherSessions()');
    expect(bpFile('src/components/profile/preferences.tsx.hbs')).toContain("useTheme");
  });

  test('avatar uploads to R2 and is served back through a binding route', () => {
    const post = bpFile('src/app/api/avatar/route.ts.hbs');
    expect(post).toContain('STORAGE.put(key, file,');
    expect(post).not.toContain('file.stream()');
    expect(post).toContain('avatars/${session.user.id}');
    expect(post).toContain('/api/avatar/${session.user.id}?v=');
    const get = bpFile('src/app/api/avatar/[userId]/route.ts.hbs');
    expect(get).toContain('STORAGE.get(`avatars/${userId}`)');
    // headers are built from object.httpMetadata, not writeHttpMetadata(headers): passing a
    // Headers instance into the binding breaks the `next dev` Cloudflare proxy (devalue).
    expect(get).toContain('object.httpMetadata?.contentType');
    expect(get).not.toContain('writeHttpMetadata');
    // gated: avatars require an authenticated session.
    expect(get).toContain('if (!session?.user)');
  });

  test('roles page renders the static role × permission matrix (read-only)', () => {
    const page = bpFile('src/app/(dashboard)/admin/roles/page.tsx.hbs');
    expect(page).toContain("import { roleDefinitions, statement } from '@repo/auth/permissions'");
    // the duplicate page h1 is gone (breadcrumb + sidebar already name the page); the matrix stays read-only.
    expect(page).not.toContain("<h1");
    expect(page).toContain('read-only');
    expect(page).toContain('isGranted(role, resource, action)');
    expect(page).toContain("session?.user.role !== 'admin'");
    // current viewer's column is highlighted.
    expect(page).toContain('role === currentRole');
  });

  test('sidebar route labels rename access control to "Roles"', () => {
    const constants = bpFile('src/lib/constants.ts.hbs');
    expect(constants).toContain("title: 'Roles'");
    expect(constants).not.toContain("'Access control'");
  });

  test('ships the navigation shell components + ROUTES', () => {
    for (const f of ['app-sidebar', 'app-header', 'nav-user', 'sidebar-links']) {
      expect(() => bpFile(`src/components/navigation/${f}.tsx.hbs`)).not.toThrow();
    }
    const constants = bpFile('src/lib/constants.ts.hbs');
    expect(constants).toContain('export const ROUTES');
    expect(constants).toContain("url: '/admin/roles'");
    expect(constants).toContain("url: '/admin/users'");
  });

  test('ships the @repo/ui shadcn components the shell needs (registry, in packages/ui)', () => {
    for (const c of ['sidebar', 'sheet', 'skeleton', 'dropdown-menu', 'breadcrumb', 'avatar']) {
      const file = bpFile(`packages/ui/src/components/ui/${c}.tsx.hbs`);
      expect(file).toContain('mono:');
      expect(file).toContain('{{{{raw}}}}');
    }
    expect(() => bpFile('packages/ui/src/hooks/use-mobile.ts.hbs')).not.toThrow();
  });

  test('ships an auth Session type derived from the createAuth factory', () => {
    const types = bpFile('src/lib/auth/types.ts.hbs');
    expect(types).toContain("import type { Auth } from './auth'");
    expect(types).toContain("export type Session = Auth['$Infer']['Session']");
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

  test('admin users page composes the datatable + create dialog behind a permission gate', () => {
    const page = bpFile('src/app/(dashboard)/admin/users/page.tsx.hbs');
    expect(page).toContain('<CreateUserDialog />');
    expect(page).toContain('<UserTable />');
    expect(page).toContain("permissions={{ user: ['list'] }}");
    // the duplicate page h1 is gone.
    expect(page).not.toContain('<h1');
  });

  test('user table renders through the shuip DataTableShell over trpc.users.list', () => {
    const table = bpFile('src/components/admin/user-table.tsx.hbs');
    expect(table).toContain("import { DataTableShell, type DataTableShellColumn } from '@/components/shared/data-table-shell'");
    expect(table).toContain('trpc.users.list.queryOptions()');
    expect(table).toContain('href={`/admin/users/${row.original.id}`}');
  });

  test('create-user dialog creates via trpc + reveals the generated password once', () => {
    const dialog = bpFile('src/components/admin/create-user-dialog.tsx.hbs');
    expect(dialog).toContain('trpc.users.create');
    expect(dialog).toContain('createdPassword');
    expect(dialog).toContain("import { roleDefinitions } from '@repo/auth/permissions'");
    // creation uses normal inputs (not inline edit).
    expect(dialog).toContain('f.InputField');
    expect(dialog).toContain('f.SelectField');
  });

  test('per-user page edits a single user by id with inline edit + admin actions', () => {
    const page = bpFile('src/app/(dashboard)/admin/users/[id]/page.tsx.hbs');
    expect(page).toContain('useParams<{ id: string }>()');
    expect(page).toContain('trpc.users.get.queryOptions({ id })');
    const edit = bpFile('src/components/admin/edit-user.tsx.hbs');
    // dynamic single-field changes use inline edit; password/ban stay explicit actions.
    expect(edit).toContain('f.InlineEditField');
    expect(edit).toContain('trpc.users.update');
    expect(edit).toContain('trpc.users.setRole');
    expect(edit).toContain('trpc.users.setPassword');
    expect(edit).toContain('trpc.users.setBanned');
    expect(edit).toContain('trpc.users.remove');
  });

  test('users tRPC router is admin-gated and uses the better-auth admin API per-request', () => {
    const router = bpFile('src/trpc/routers/users.ts.hbs');
    expect(router).toContain("import { adminProcedure } from '../middleware/rbac'");
    expect(router).toContain('auth.api.createUser(');
    expect(router).toContain('headers: ctx.headers');
    expect(router).toContain('auth.api.setRole(');
    expect(router).toContain('auth.api.setUserPassword(');
    expect(router).toContain('auth.api.banUser(');
    expect(router).toContain('auth.api.unbanUser(');
    expect(router).toContain('auth.api.removeUser(');
    expect(bpFile('src/trpc/routers/_app.ts.hbs')).toContain('users: usersRouter');
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

  test('dashboard shell mounts the sidebar provider, app sidebar, and header', () => {
    const layout = bpFile('src/app/(dashboard)/layout.tsx.hbs');
    expect(layout).toContain('if (!session?.user)');
    expect(layout).toContain('<SidebarProvider defaultOpen>');
    expect(layout).toContain('<AppSidebar session={session} />');
    expect(layout).toContain('<AppHeader />');
    // logout moved into the sidebar user menu; the standalone button is gone.
    expect(layout).not.toContain('<SignOutButton />');
  });

  test('the sidebar user menu owns sign-out, the theme toggle, and the avatar', () => {
    const navUser = bpFile('src/components/navigation/nav-user.tsx.hbs');
    expect(navUser).toContain('authClient.signOut()');
    expect(navUser).toContain("import { useTheme } from 'next-themes'");
    expect(navUser).toContain('<AvatarImage src={session.user.image ?? undefined}');
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

  test('upload hands the File (Blob) to R2 — known length, no full-buffer arrayBuffer', () => {
    const route = bpFile('src/app/api/documents/upload/route.ts.hbs');
    // A bare file.stream() has no known length and R2.put rejects it; the File/Blob carries its size.
    expect(route).toContain('STORAGE.put(key, file,');
    expect(route).not.toContain('file.stream()');
    expect(route).not.toContain('await file.arrayBuffer()');
  });

  test('seed enables sqlite foreign keys so reset cascades', () => {
    expect(bpFile('scripts/seed.ts.hbs')).toContain("PRAGMA foreign_keys = ON");
  });

  test('seed wiring: drizzle-orm at root, local-setup, and a resolvable better-auth baseURL', () => {
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated earlier
    expect(bp!.rootPackageJson?.devDependencies).toHaveProperty('drizzle-orm');
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated earlier
    const scripts = bp!.rootPackageJson?.scripts ?? {};
    expect(scripts['db:seed']).toContain('BETTER_AUTH_URL=');
    expect(scripts['local-setup']).toBe('bun scripts/local-setup.ts');
  });

  test('ships a local-setup script that resets D1 and runs generate → migrate → typegen → seed', () => {
    const setup = bpFile('scripts/local-setup.ts.hbs');
    expect(setup).toContain('.env.example');
    expect(setup).toContain('db:generate');
    expect(setup).toContain('.wrangler/v3/d1');
    expect(setup).toContain('db:migrate');
    // wrangler d1 migrations apply prompts for confirmation; CI forces the non-interactive "yes".
    expect(setup).toContain("{ CI: 'true' }");
    expect(setup).toContain('cf:typegen');
    expect(setup).toContain('apps/web');
    expect(setup).toContain('db:seed');
    expect(setup).not.toContain('#!/usr/bin/env');
  });

  test('next dev wires Cloudflare bindings at the CLI-migrate persist path (d1)', () => {
    const nextConfig = readFileSync(
      join(import.meta.dir, '../../templates/stack/nextjs/next.config.ts.hbs'),
      'utf8',
    );
    expect(nextConfig).toContain("persist: { path: '{{#if (isMono)}}../../{{/if}}.wrangler/v3' }");
  });

  test('auth config sends a reset link via an email stub, logging it in dev', () => {
    const auth = bpFile('src/lib/auth/auth.ts.hbs');
    expect(auth).toContain('sendResetPassword');
    expect(auth).toContain('sendResetPasswordEmail');
    expect(auth).toContain('Password reset link for');
    const email = bpFile('src/lib/auth/email.ts.hbs');
    expect(email).toContain('export async function sendResetPasswordEmail');
    expect(email).toContain('TODO');
  });

  test('ships forgot-password and reset-password flows wired to authClient', () => {
    const forgot = bpFile('src/app/(auth)/forgot-password/forgot-password-form.tsx.hbs');
    expect(forgot).toContain('authClient.requestPasswordReset');
    expect(forgot).toContain("redirectTo: '/reset-password'");
    const reset = bpFile('src/app/(auth)/reset-password/reset-password-form.tsx.hbs');
    expect(reset).toContain('authClient.resetPassword({ newPassword: value.newPassword, token })');
    // reset page reads the token from the query (?token=) provided by better-auth.
    expect(bpFile('src/app/(auth)/reset-password/page.tsx.hbs')).toContain('searchParams');
    // login links to the forgot-password flow.
    expect(bpFile('src/app/(auth)/login/login-form.tsx.hbs')).toContain("href='/forgot-password'");
  });

  test('every form validates on submit (not on change)', () => {
    for (const f of [
      'src/app/(auth)/login/login-form.tsx.hbs',
      'src/app/(auth)/signup/signup-form.tsx.hbs',
      'src/components/profile/account-form.tsx.hbs',
      'src/components/profile/security-form.tsx.hbs',
    ]) {
      const form = bpFile(f);
      expect(form).toContain('onSubmit: schema');
      expect(form).not.toContain('onChange: schema');
    }
  });

  test('sidebar hides a permission category when none of its routes are visible', () => {
    const links = bpFile('src/components/navigation/sidebar-links.tsx.hbs');
    expect(links).toContain("import { useCan } from '@/hooks/use-permission'");
    expect(links).toContain('const can = useCan();');
    // groupedPages only holds categories with at least one visible route, so empty groups never render.
    expect(links).toContain('ROUTES.filter((item) => can(item.permissions ?? {}))');
    expect(bpFile('src/hooks/use-permission.ts.hbs')).toContain('export function useCan()');
  });

  test('sidebar user menu keeps the dropdown open when confirming logout', () => {
    const navUser = bpFile('src/components/navigation/nav-user.tsx.hbs');
    // onSelect + preventDefault stops the menu from closing on the first Logout click.
    expect(navUser).toContain('onSelect={(e) => {');
    expect(navUser).toContain('e.preventDefault();');
    expect(navUser).toContain('setShowLogout(true);');
  });

  test('account display name uses an inline-edit field; documents upload uses a normal input', () => {
    const account = bpFile('src/components/profile/account-form.tsx.hbs');
    expect(account).toContain('f.InlineEditField');
    expect(account).toContain('authClient.updateUser({ name: value.name })');
    const docs = bpFile('src/app/(dashboard)/page.tsx.hbs');
    expect(docs).toContain("import { useAppForm } from '@repo/ui/lib/form'");
    expect(docs).toContain('f.InputField');
  });

  test('profile tab navigation is vertical on desktop', () => {
    expect(bpFile('src/components/profile/tab-nav.tsx.hbs')).toContain('md:flex-col');
    expect(bpFile('src/app/(dashboard)/profile/layout.tsx.hbs')).toContain('md:flex-row');
  });

  test('ships the shuip data-table block + search-input + inline-edit + base ui (registry, packages/ui)', () => {
    for (const c of ['table', 'badge', 'dialog', 'popover', 'command', 'search-input']) {
      const file = bpFile(`packages/ui/src/components/ui/${c}.tsx.hbs`);
      expect(file).toContain('mono:');
      expect(file).toContain('{{{{raw}}}}');
    }
    const dataTable = bpFile('packages/ui/src/components/block/shuip/data-table.tsx.hbs');
    expect(dataTable).toContain('@tanstack/react-table');
    // anglicized — no leftover French from the kodex source.
    expect(dataTable).not.toContain('Rechercher');
    expect(() => bpFile('packages/ui/src/components/ui/shuip/tanstack-form/inline-edit.tsx.hbs')).not.toThrow();
    const form = bpFile('packages/ui/src/lib/form.ts.hbs');
    expect(form).toContain('InlineEditField');
  });

  test('blueprint adds the datatable/inline-edit ui deps', () => {
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated earlier
    const uiDeps = bp!.pkgPackageJson?.ui?.dependencies ?? {};
    expect(uiDeps).toHaveProperty('@tanstack/react-table');
    expect(uiDeps).toHaveProperty('@dnd-kit/core');
    expect(uiDeps).toHaveProperty('cmdk');
  });
});
