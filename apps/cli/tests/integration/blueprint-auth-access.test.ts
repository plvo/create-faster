import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('blueprint auth access', () => {
  let tempDir: string;

  const generated = new Map<string, Promise<string>>();

  const generate = (blueprint: string): Promise<string> => {
    const existing = generated.get(blueprint);
    if (existing) return existing;
    const created = runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir).then(
      (result) => {
        expect(result.exitCode).toBe(0);
        return join(tempDir, blueprint);
      },
    );
    generated.set(blueprint, created);
    return created;
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('org-dashboard', () => {
    test('public self sign-up is closed in the auth config, users are created by admins', async () => {
      const projectPath = await generate('org-dashboard');
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toMatch(/emailAndPassword: \{[^}]*disableSignUp: true/);
    });

    test('every page that prefetches protected data requires the session first', async () => {
      const projectPath = await generate('org-dashboard');
      const appDir = join(projectPath, 'apps/web/src/app');
      const pages = (await readdir(appDir, { recursive: true })).filter((file) => file.endsWith('page.tsx'));
      const prefetchingPages = [];
      for (const page of pages) {
        const source = await readTextFile(join(appDir, page));
        if (!source.includes('prefetch(')) continue;
        prefetchingPages.push(page);
        const guard = source.indexOf('await requireSession()');
        expect(guard, `${page} must await requireSession() before prefetching`).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(source.indexOf('prefetch('));
      }
      expect(prefetchingPages.length).toBeGreaterThan(0);
    });
  });

  describe('multitenant-saas', () => {
    test('the login page sends a signed-in user away', async () => {
      const projectPath = await generate('multitenant-saas');
      const page = await readTextFile(join(projectPath, 'apps/web/src/app/(auth)/login/page.tsx'));
      expect(page).toContain("from '@/lib/auth/auth'");
      expect(page).toMatch(/auth\.api\.getSession\(\{ headers: await headers\(\) \}\)/);
      expect(page).toMatch(/if \(session\) redirect\('\/'\)/);
    });
  });
});
