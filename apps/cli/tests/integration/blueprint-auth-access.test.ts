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
    const GUARDS = { adminProcedure: 'requireAdmin', permissionProcedure: 'requirePermission' } as const;

    const strictProcedures = async (projectPath: string): Promise<Map<string, string>> => {
      const routerDir = join(projectPath, 'packages/api/src/router');
      const strict = new Map<string, string>();
      for (const file of await readdir(routerDir)) {
        const source = await readTextFile(join(routerDir, file));
        for (const [, name, kind] of source.matchAll(/^ {2}(\w+): (adminProcedure|permissionProcedure)\b/gm)) {
          strict.set(`${file.replace(/\.ts$/, '')}.${name}`, GUARDS[kind as keyof typeof GUARDS]);
        }
      }
      return strict;
    };

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
        const guard = source.search(/await require(Session|Admin|Permission)\(/);
        expect(guard, `${page} must await a session guard before prefetching`).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(source.indexOf('prefetch('));
      }
      expect(prefetchingPages.length).toBeGreaterThan(0);
    });

    test('every page that prefetches an admin or permission procedure runs the matching guard first', async () => {
      const projectPath = await generate('org-dashboard');
      const strict = await strictProcedures(projectPath);
      expect(strict.size).toBeGreaterThan(0);
      const appDir = join(projectPath, 'apps/web/src/app');
      const pages = (await readdir(appDir, { recursive: true })).filter((file) => file.endsWith('page.tsx'));
      const guardedPages = [];
      for (const page of pages) {
        const source = await readTextFile(join(appDir, page));
        const procedure = source.match(/prefetch\(trpc\.(\w+\.\w+)\./)?.[1] ?? '';
        const guardName = strict.get(procedure);
        if (!guardName) continue;
        guardedPages.push(page);
        const guard = source.indexOf(`await ${guardName}(`);
        expect(guard, `${page} must await ${guardName}() before prefetching ${procedure}`).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(source.indexOf('prefetch('));
      }
      expect(guardedPages.length).toBeGreaterThan(0);
    });
  });

  describe('multitenant-saas', () => {
    test.each(['login', 'signup'])('the %s page sends a signed-in user away', async (route) => {
      const projectPath = await generate('multitenant-saas');
      const page = await readTextFile(join(projectPath, `apps/web/src/app/(auth)/${route}/page.tsx`));
      expect(page).toContain("from '@/lib/auth/auth'");
      expect(page).toMatch(/auth\.api\.getSession\(\{ headers: await headers\(\) \}\)/);
      expect(page).toMatch(/if \(session\) redirect\('\/'\)/);
    });

    test('the invitation page stays open to a signed-in invitee', async () => {
      const projectPath = await generate('multitenant-saas');
      const page = await readTextFile(join(projectPath, 'apps/web/src/app/(auth)/accept-invitation/[id]/page.tsx'));
      expect(page).not.toMatch(/if \(session\) redirect/);
      expect(page).toMatch(/if \(!session\) \{/);
    });
  });
});
