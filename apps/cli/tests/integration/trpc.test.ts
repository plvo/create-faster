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

    test('package.json has all tRPC deps flat (no @repo/*)', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['@trpc/client']).toBeDefined();
      expect(pkg.dependencies['@trpc/server']).toBeDefined();
      expect(pkg.dependencies.superjson).toBeDefined();
      expect(pkg.dependencies.zod).toBeDefined();
      const repoRefs = Object.keys(pkg.dependencies).filter((k) => k.startsWith('@repo/'));
      expect(repoRefs).toEqual([]);
    });

    test('uses local imports (not @repo/*)', async () => {
      const client = await readTextFile(join(projectPath, 'src/trpc/client.ts'));
      expect(client).toContain("from '@/trpc/routers/_app'");
      expect(client).not.toContain('@repo/');

      const server = await readTextFile(join(projectPath, 'src/trpc/server.tsx'));
      expect(server).not.toContain('@repo/');
    });

    test('no mono-only files generated', async () => {
      expect(await fileExists(join(projectPath, 'src/index.ts'))).toBe(false);
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

  describe('Turborepo: tRPC shared package', () => {
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

    test('server-side files are in packages/api/', async () => {
      expect(await fileExists(join(projectPath, 'packages/api/src/trpc.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/src/root.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/src/router/hello.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/src/index.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/tsconfig.json'))).toBe(true);
    });

    test('client-side files are in apps/web/', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/server.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/query-client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/providers.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'))).toBe(true);
    });

    test('client-side files import from @repo/api', async () => {
      const client = await readTextFile(join(projectPath, 'apps/web/src/trpc/client.ts'));
      expect(client).toContain("from '@repo/api'");

      const server = await readTextFile(join(projectPath, 'apps/web/src/trpc/server.tsx'));
      expect(server).toContain("from '@repo/api'");

      const route = await readTextFile(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'));
      expect(route).toContain("from '@repo/api'");

      const providers = await readTextFile(join(projectPath, 'apps/web/src/trpc/providers.tsx'));
      expect(providers).toContain("from '@repo/api'");
    });

    test('server.tsx passes headers to createTRPCContext', async () => {
      const content = await readTextFile(join(projectPath, 'apps/web/src/trpc/server.tsx'));
      expect(content).toContain('headers');
      expect(content).toContain('createTRPCContext');
    });

    test('route.ts passes headers to createTRPCContext', async () => {
      const content = await readTextFile(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'));
      expect(content).toContain('headers: req.headers');
    });

    test('package-level files use relative imports', async () => {
      const root = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
      expect(root).toContain("from './trpc'");
      expect(root).toContain("from './router/hello'");

      const hello = await readTextFile(join(projectPath, 'packages/api/src/router/hello.ts'));
      expect(hello).toContain("from '../trpc'");
    });

    test('tRPC files are NOT in the hono app', async () => {
      expect(await fileExists(join(projectPath, 'apps/api/src/trpc'))).toBe(false);
    });

    test('app package.json has @repo/api and client deps', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(pkg.dependencies['@repo/api']).toBe('*');
      expect(pkg.dependencies['@trpc/client']).toBeDefined();
      expect(pkg.dependencies['@trpc/tanstack-react-query']).toBeDefined();
    });

    test('packages/api/package.json has server deps', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/api/package.json'));
      expect(pkg.dependencies['@trpc/server']).toBeDefined();
      expect(pkg.dependencies.superjson).toBeDefined();
      expect(pkg.dependencies.zod).toBeDefined();
    });
  });

  describe('Turborepo: tRPC standalone (no TanStack Query)', () => {
    const projectName = 'test-trpc-turbo-standalone';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', 'web:nextjs:trpc', '--app', 'api:hono', '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('server-side files are in packages/api/', async () => {
      expect(await fileExists(join(projectPath, 'packages/api/src/trpc.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/src/root.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/src/router/hello.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/api/src/index.ts'))).toBe(true);
    });

    test('client-side files are in apps/web/', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/client.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/server.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'))).toBe(true);
    });

    test('does NOT generate tanstack-query files', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/query-client.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/web/src/trpc/providers.tsx'))).toBe(false);
    });

    test('server.tsx uses createCaller (not createTRPCOptionsProxy)', async () => {
      const content = await readTextFile(join(projectPath, 'apps/web/src/trpc/server.tsx'));
      expect(content).toContain('createCaller');
      expect(content).not.toContain('createTRPCOptionsProxy');
      expect(content).not.toContain('HydrateClient');
    });

    test('server.tsx passes headers to createTRPCContext in mono mode', async () => {
      const content = await readTextFile(join(projectPath, 'apps/web/src/trpc/server.tsx'));
      expect(content).toContain('headers');
      expect(content).toContain("from '@repo/api'");
    });

    test('route.ts passes headers to createTRPCContext', async () => {
      const content = await readTextFile(join(projectPath, 'apps/web/src/app/api/trpc/[trpc]/route.ts'));
      expect(content).toContain('headers: req.headers');
      expect(content).toContain("from '@repo/api'");
    });

    test('packages/api/package.json has no @repo/auth or @repo/db', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/api/package.json'));
      expect(pkg.dependencies['@repo/auth']).toBeUndefined();
      expect(pkg.dependencies['@repo/db']).toBeUndefined();
      expect(pkg.dependencies['@trpc/server']).toBeDefined();
    });

    test('init.ts has no auth or db imports', async () => {
      const content = await readTextFile(join(projectPath, 'packages/api/src/trpc.ts'));
      expect(content).not.toContain('@repo/auth');
      expect(content).not.toContain('@repo/db');
      expect(content).not.toContain('protectedProcedure');
      expect(content).toContain('publicProcedure');
    });

    test('barrel index.ts does not export protectedProcedure', async () => {
      const content = await readTextFile(join(projectPath, 'packages/api/src/index.ts'));
      expect(content).not.toContain('protectedProcedure');
      expect(content).toContain('publicProcedure');
    });
  });

  describe('Turborepo: tRPC + Better Auth + ORM', () => {
    const projectName = 'test-trpc-turbo-auth';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:trpc,tanstack-query,better-auth',
          '--app',
          'api:hono',
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

    test('packages/api has @repo/auth and @repo/db deps', async () => {
      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/api/package.json'));
      expect(pkg.dependencies['@repo/auth']).toBe('*');
      expect(pkg.dependencies['@repo/db']).toBe('*');
    });

    test('trpc.ts has auth and db imports', async () => {
      const content = await readTextFile(join(projectPath, 'packages/api/src/trpc.ts'));
      expect(content).toContain("from '@repo/auth/auth'");
      expect(content).toContain("from '@repo/db'");
      expect(content).toContain('protectedProcedure');
    });

    test('barrel index.ts exports protectedProcedure', async () => {
      const content = await readTextFile(join(projectPath, 'packages/api/src/index.ts'));
      expect(content).toContain('protectedProcedure');
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
