import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { NEXTJS_PAGES } from './org-dashboard-pages';

const BLUEPRINT = 'org-dashboard-nextjs';

// The pages and tables below are rendered from partials that the TanStack Start blueprint renders too, with the
// router parts behind the stack name. Each assertion pins a part the Next.js file must keep.
const SHARED_FILES = Object.values(NEXTJS_PAGES).map((page) => page.file);

describe(`${BLUEPRINT} pages shared with the TanStack Start blueprint`, () => {
  let tempDir: string;
  let web: string;
  const read = (file: string): Promise<string> => readTextFile(join(web, file));

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([BLUEPRINT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    web = join(tempDir, BLUEPRINT, 'apps/web');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('no shared file uses the TanStack Router', async () => {
    for (const file of SHARED_FILES) {
      expect(await read(file), file).not.toMatch(/@tanstack\/react-router|useNavigate|params=\{\{/);
    }
  });

  test('every client component keeps its use client directive first', async () => {
    for (const file of SHARED_FILES.filter((path) => path !== NEXTJS_PAGES.roles.file)) {
      expect((await read(file)).startsWith("'use client';\n\n"), file).toBe(true);
    }
  });

  test('the contact table links to a contact through next/link', async () => {
    const table = await read('src/components/contacts/contact-table.tsx');
    expect(table).toContain("import Link from 'next/link';");
    expect(table).toContain('<Link href={`/contacts/${contact.id}`} className=');
  });

  test('the user table links to a user through next/link', async () => {
    const table = await read('src/components/admin/user-table.tsx');
    expect(table).toContain("import Link from 'next/link';");
    expect(table).toContain('<Link href={`/admin/users/${user.id}`} className=');
  });

  test('the contact page navigates with next/navigation and links back through next/link', async () => {
    const page = await read(NEXTJS_PAGES.contactDetail.file);
    expect(page).toContain("import { notFound, useRouter } from 'next/navigation';");
    expect(page).toContain("import Link from 'next/link';");
    expect(page).toContain("router.push('/contacts');");
    expect(page).toContain("<Link href='/contacts'>");
  });

  test('the user page links back through next/link', async () => {
    const page = await read(NEXTJS_PAGES.userDetail.file);
    expect(page).toContain("import Link from 'next/link';");
    expect(page).toContain("<Link href='/admin/users'>");
  });

  test('the contacts page keeps the create permission gate', async () => {
    expect(await read(NEXTJS_PAGES.contactsClient.file)).toContain("<Can permissions={{ contact: ['create'] }}>");
  });

  test('the roles page requires an admin before it renders', async () => {
    const page = await read(NEXTJS_PAGES.roles.file);
    expect(page).toContain("import { requireAdmin } from '@/lib/auth/session';");
    expect(page).toContain('export default async function RolesPage() {\n  await requireAdmin();\n');
  });
});
