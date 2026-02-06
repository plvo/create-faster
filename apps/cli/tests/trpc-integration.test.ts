// ABOUTME: Integration tests for tRPC library template generation
// ABOUTME: Tests standalone, tanstack-query, and better-auth integration combinations

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('tRPC Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: tRPC standalone', () => {
    const projectName = 'test-trpc-standalone';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:trpc`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates core tRPC files', async () => {
      expect(await fileExists(join(projectPath, 'src/trpc/init.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/server.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/routers/_app.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/routers/hello.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/app/api/trpc/[trpc]/route.ts'))).toBe(true);
    });

    test('does NOT generate tanstack-query files', async () => {
      expect(await fileExists(join(projectPath, 'src/trpc/query-client.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/trpc/providers.tsx'))).toBe(false);
    });

    test('server.tsx uses createCaller (not createTRPCOptionsProxy)', async () => {
      const content = await readTextFile(join(projectPath, 'src/trpc/server.tsx'));
      expect(content).toContain('createCaller');
      expect(content).not.toContain('createTRPCOptionsProxy');
      expect(content).not.toContain('HydrateClient');
    });

    test('init.ts has no auth imports', async () => {
      const content = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
      expect(content).not.toContain('better-auth');
      expect(content).not.toContain('auth');
      expect(content).not.toContain('session');
      expect(content).toContain('publicProcedure');
      expect(content).not.toContain('protectedProcedure');
    });

    test('package.json has tRPC dependencies', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['@trpc/client']).toBeDefined();
      expect(pkg.dependencies['@trpc/server']).toBeDefined();
      expect(pkg.dependencies.superjson).toBeDefined();
      expect(pkg.dependencies.zod).toBeDefined();
    });
  });

  describe('Single repo: tRPC + TanStack Query', () => {
    const projectName = 'test-trpc-tanstack';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:trpc,tanstack-query`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates tanstack-query integration files', async () => {
      expect(await fileExists(join(projectPath, 'src/trpc/query-client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/trpc/providers.tsx'))).toBe(true);
    });

    test('server.tsx uses createTRPCOptionsProxy', async () => {
      const content = await readTextFile(join(projectPath, 'src/trpc/server.tsx'));
      expect(content).toContain('createTRPCOptionsProxy');
      expect(content).toContain('HydrateClient');
      expect(content).toContain('prefetch');
    });

    test('providers.tsx has TRPCReactProvider', async () => {
      const content = await readTextFile(join(projectPath, 'src/trpc/providers.tsx'));
      expect(content).toContain('TRPCReactProvider');
      expect(content).toContain('createTRPCContext');
      expect(content).toContain('QueryClientProvider');
      expect(content).toContain('useTRPC');
    });

    test('app-providers.tsx uses TRPCReactProvider instead of QueryClientProvider', async () => {
      const content = await readTextFile(join(projectPath, 'src/components/app-providers.tsx'));
      expect(content).toContain('TRPCReactProvider');
      expect(content).not.toContain('QueryClientProvider');
    });

    test('package.json has both tRPC and TanStack Query deps', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['@trpc/client']).toBeDefined();
      expect(pkg.dependencies['@trpc/tanstack-react-query']).toBeDefined();
      expect(pkg.dependencies['@tanstack/react-query']).toBeDefined();
    });
  });

  describe('Single repo: tRPC + Better Auth + Drizzle', () => {
    const projectName = 'test-trpc-auth';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:nextjs:trpc,better-auth`,
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('init.ts has auth context and protectedProcedure', async () => {
      const content = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
      expect(content).toContain('auth');
      expect(content).toContain('session');
      expect(content).toContain('protectedProcedure');
      expect(content).toContain('UNAUTHORIZED');
    });

    test('init.ts has db in context', async () => {
      const content = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
      expect(content).toContain('db');
    });

    test('route.ts passes headers to context', async () => {
      const content = await readTextFile(join(projectPath, 'src/app/api/trpc/[trpc]/route.ts'));
      expect(content).toContain('headers: req.headers');
    });
  });

  describe('Turborepo: tRPC is app-scoped', () => {
    const projectName = 'test-trpc-turborepo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'web:nextjs:trpc,tanstack-query', '--app', 'api:hono', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('tRPC files are in the app directory, not packages', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/init.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/server.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/routers/_app.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'))).toBe(true);
    });

    test('no tRPC package in packages/', async () => {
      expect(await fileExists(join(projectPath, 'packages/trpc'))).toBe(false);
    });

    test('tRPC files are NOT in the hono app', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/src/trpc/init.ts'))).toBe(false);
    });
  });

  describe('TanStack Query without tRPC still uses QueryClientProvider', () => {
    const projectName = 'test-tanstack-no-trpc';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:tanstack-query`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('app-providers.tsx uses QueryClientProvider (not TRPCReactProvider)', async () => {
      const content = await readTextFile(join(projectPath, 'src/components/app-providers.tsx'));
      expect(content).toContain('QueryClientProvider');
      expect(content).not.toContain('TRPCReactProvider');
    });
  });
});
