import './timeout';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const BLUEPRINT = 'cloudflare-fullstack-nextjs';

// A client component renders on the server too, where the tRPC client has no request cookies: a protected
// query it reads through useSuspenseQuery must already sit in the cache, prefetched by the server page.
const PROTECTED_PAGES: { page: string; client: string; guard: string; options: string }[] = [
  {
    page: 'admin/users/page.tsx',
    client: 'admin/users/users.client.tsx',
    guard: 'requireAdmin',
    options: 'trpc.users.list.queryOptions()',
  },
  {
    page: 'admin/users/[id]/page.tsx',
    client: 'admin/users/[id]/user.client.tsx',
    guard: 'requireAdmin',
    options: 'trpc.users.get.queryOptions({ id })',
  },
  {
    page: 'page.tsx',
    client: 'documents.client.tsx',
    guard: 'requireSession',
    options: 'trpc.documents.list.queryOptions()',
  },
];

describe(`${BLUEPRINT} protected pages on the server`, () => {
  let tempDir: string;
  let web: string;
  const readPage = (file: string): Promise<string> => readTextFile(join(web, 'src/app/(dashboard)', file));

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    web = join(tempDir, BLUEPRINT, 'apps/web');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(PROTECTED_PAGES)('$page prefetches $options and hydrates it into the client tree', async ({
    page,
    client,
    options,
  }) => {
    const source = await readPage(page);
    expect(source).not.toContain("'use client'");
    expect(source).toContain("import { HydrateClient, prefetch, trpc } from '@/trpc/server';");
    expect(source).toContain(`prefetch(${options});`);
    expect(source.indexOf('<HydrateClient>')).toBeGreaterThan(source.indexOf('prefetch('));

    const clientName = client.split('/').pop()?.replace('.tsx', '') ?? '';
    expect(source).toContain(`from './${clientName}';`);
  });

  test.each(PROTECTED_PAGES)('$page awaits $guard before it starts the protected query', async ({ page, guard }) => {
    const source = await readPage(page);
    expect(source).toContain(`import { ${guard} } from '@/lib/auth/session';`);
    expect(source).toContain(`await ${guard}();`);
    expect(source.indexOf(`await ${guard}();`)).toBeLessThan(source.indexOf('prefetch('));
  });

  test('the user page reads the query key the client component reads', async () => {
    const client = await readPage('admin/users/[id]/user.client.tsx');
    expect(client).toContain('useSuspenseQuery(trpc.users.get.queryOptions({ id }))');
    const page = await readPage('admin/users/[id]/page.tsx');
    expect(page).toContain('const { id } = await params;');
  });

  test('the users table reads the query the users page prefetches', async () => {
    const table = await readTextFile(join(web, 'src/components/admin/user-table.tsx'));
    expect(table).toContain('useSuspenseQuery(trpc.users.list.queryOptions())');
  });

  test('requireAdmin sends an anonymous visitor to the login and a non admin to the dashboard', async () => {
    const session = await readTextFile(join(web, 'src/lib/auth/session.ts'));
    expect(session).toContain("import { getAuth } from '@/lib/server';");
    expect(session).toContain("if (!session?.user) redirect('/login');");
    expect(session).toContain("if (session.user.role !== 'admin') redirect('/');");
  });
});
