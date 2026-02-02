// ABOUTME: Integration tests for create-faster CLI
// ABOUTME: Tests end-to-end project generation with various flag combinations

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, runCli } from './helpers';

describe('CLI Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo generation', () => {
    test('generates basic Next.js project', async () => {
      const projectName = 'test-nextjs-single';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', 'web:nextjs', '--no-database', '--no-orm', '--no-git', '--no-extras', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/app/page.tsx'))).toBe(true);

      const pkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.name).toBe('test-nextjs-single'); // Single repo uses project name
      expect(pkg.dependencies.next).toBeDefined();
      expect(pkg.dependencies.react).toBeDefined();
    });

    test('generates Next.js with shadcn module', async () => {
      const projectName = 'test-nextjs-shadcn';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:shadcn',
          '--no-database',
          '--no-orm',
          '--no-git',
          '--no-extras',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['radix-ui']).toBeDefined();
      expect(pkg.dependencies['class-variance-authority']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/components/ui/button.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'components.json'))).toBe(true);
    });

    test('generates Next.js with drizzle ORM', async () => {
      const projectName = 'test-nextjs-drizzle';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--no-git',
          '--no-extras',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['drizzle-orm']).toBeDefined();
      expect(pkg.devDependencies['drizzle-kit']).toBeDefined();
      expect(pkg.scripts['db:generate']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/lib/db/schema.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/lib/db/index.ts'))).toBe(true);
    });
  });

  describe('Turborepo generation', () => {
    test('generates multi-app turborepo', async () => {
      const projectName = 'test-turborepo';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'api:hono',
          '--no-database',
          '--no-orm',
          '--no-git',
          '--no-extras',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'turbo.json'))).toBe(true);

      expect(await fileExists(join(projectPath, 'apps/web/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/api/package.json'))).toBe(true);

      const webPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.name).toBe('web');
      expect(webPkg.dependencies.next).toBeDefined();

      const apiPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/api/package.json'));
      expect(apiPkg.name).toBe('api');
      expect(apiPkg.dependencies.hono).toBeDefined();
    });

    test('generates turborepo with extracted packages', async () => {
      const projectName = 'test-turborepo-packages';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:shadcn',
          '--app',
          'mobile:expo',
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--no-git',
          '--no-extras',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectPath, 'packages/ui/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/db/package.json'))).toBe(true);

      const webPkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.dependencies['@repo/ui']).toBe('*');
      expect(webPkg.dependencies['@repo/db']).toBe('*');

      const uiPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/ui/package.json'));
      expect(uiPkg.name).toBe('@repo/ui');
      expect(uiPkg.dependencies['radix-ui']).toBeDefined();

      const dbPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/db/package.json'));
      expect(dbPkg.name).toBe('@repo/db');
      expect(dbPkg.dependencies['drizzle-orm']).toBeDefined();
    });
  });
});
