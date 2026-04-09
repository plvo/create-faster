import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('evlog Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: Next.js + evlog', () => {
    const projectName = 'test-evlog-nextjs';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:evlog`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates lib/evlog.ts', async () => {
      expect(await fileExists(join(projectPath, 'src/lib/evlog.ts'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'src/lib/evlog.ts'));
      expect(content).toContain("from 'evlog/next'");
      expect(content).toContain("from 'evlog/next/instrumentation'");
      expect(content).toContain('createEvlog');
      expect(content).toContain('createInstrumentation');
      expect(content).toContain(`service: '${projectName}'`);
    });

    test('generates instrumentation.ts at project root', async () => {
      expect(await fileExists(join(projectPath, 'instrumentation.ts'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'instrumentation.ts'));
      expect(content).toContain('defineNodeInstrumentation');
      expect(content).toContain("from 'evlog/next/instrumentation'");
      expect(content).toContain("import('./src/lib/evlog')");
    });

    test('proxy.ts uses evlogMiddleware', async () => {
      const content = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(content).toContain("from 'evlog/next'");
      expect(content).toContain('evlogMiddleware');
      expect(content).toContain('withEvlog(request)');
      expect(content).not.toContain('NextResponse');
    });

    test('package.json has evlog dependency', async () => {
      const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies.evlog).toBeDefined();
      expect(pkg.dependencies.evlog).toMatch(/^\^2/);
    });
  });

  describe('Single repo: Next.js + evlog + better-auth (both middleware features)', () => {
    const projectName = 'test-evlog-nextjs-auth';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:nextjs:evlog,better-auth`,
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

    test('proxy.ts has both better-auth session and evlog middleware', async () => {
      const content = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(content).toContain('auth.api.getSession');
      expect(content).toContain('evlogMiddleware');
      expect(content).toContain('withEvlog(request)');
    });
  });

  describe('Single repo: Hono + evlog', () => {
    const projectName = 'test-evlog-hono';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:hono:evlog`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('src/app.ts wires initLogger and evlog middleware', async () => {
      const content = await readTextFile(join(projectPath, 'src/app.ts'));
      expect(content).toContain("from 'evlog'");
      expect(content).toContain("from 'evlog/hono'");
      expect(content).toContain('initLogger');
      expect(content).toContain(`service: '${projectName}'`);
      expect(content).toContain('new Hono<EvlogVariables>()');
      expect(content).toContain('app.use(evlog())');
      expect(content).not.toContain("from 'hono/logger'");
    });

    test('app.onError uses structured error logging', async () => {
      const content = await readTextFile(join(projectPath, 'src/app.ts'));
      expect(content).toContain("c.get('log').error(err)");
      expect(content).toContain('parseError');
      expect(content).not.toContain('console.error');
    });

    test('package.json has evlog dependency', async () => {
      const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies.evlog).toBeDefined();
    });
  });

  describe('Single repo: TanStack Start + evlog', () => {
    const projectName = 'test-evlog-tss';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:tanstack-start:evlog`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('generates nitro.config.ts at project root', async () => {
      expect(await fileExists(join(projectPath, 'nitro.config.ts'))).toBe(true);
      const content = await readTextFile(join(projectPath, 'nitro.config.ts'));
      expect(content).toContain("from 'evlog/nitro/v3'");
      expect(content).toContain('asyncContext: true');
      expect(content).toContain(`service: '${projectName}'`);
    });

    test('__root.tsx wires evlogErrorHandler via server middleware', async () => {
      const content = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(content).toContain("from 'evlog/nitro/v3'");
      expect(content).toContain('evlogErrorHandler');
      expect(content).toContain('createMiddleware');
      expect(content).toContain('server: {');
    });
  });

  describe('Single repo: Node + evlog', () => {
    const projectName = 'test-evlog-node';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [projectName, '--app', `${projectName}:node:evlog`, '--no-git', '--no-install'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('src/index.ts uses initLogger', async () => {
      const content = await readTextFile(join(projectPath, 'src/index.ts'));
      expect(content).toContain("from 'evlog'");
      expect(content).toContain('initLogger');
      expect(content).toContain(`service: '${projectName}'`);
      expect(content).not.toContain('console.log');
    });
  });

  describe('Next.js without evlog: proxy keeps plain NextResponse', () => {
    const projectName = 'test-noevlog-nextjs';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli([projectName, '--app', `${projectName}:nextjs`, '--no-git', '--no-install'], tempDir);
      expect(result.exitCode).toBe(0);
    });

    test('proxy.ts does not import evlog', async () => {
      const content = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(content).not.toContain('evlog');
      expect(content).toContain('NextResponse.next()');
    });

    test('package.json has no evlog dep', async () => {
      const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies.evlog).toBeUndefined();
    });
  });

  describe('Turborepo: multi-stack with evlog on every app', () => {
    const projectName = 'test-evlog-turbo';
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, projectName);
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:evlog',
          '--app',
          'api:hono:evlog',
          '--app',
          'worker:node:evlog',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('web app has evlog files in apps/web', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/lib/evlog.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/instrumentation.ts'))).toBe(true);
      const proxy = await readTextFile(join(projectPath, 'apps/web/src/proxy.ts'));
      expect(proxy).toContain('evlogMiddleware');
    });

    test('api app has evlog wired in apps/api/src/app.ts', async () => {
      const content = await readTextFile(join(projectPath, 'apps/api/src/app.ts'));
      expect(content).toContain('initLogger');
      expect(content).toContain("service: 'api'");
    });

    test('worker app has evlog wired in apps/worker/src/index.ts', async () => {
      const content = await readTextFile(join(projectPath, 'apps/worker/src/index.ts'));
      expect(content).toContain('initLogger');
      expect(content).toContain("service: 'worker'");
    });

    test('each app has its own evlog dep', async () => {
      const webPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
        join(projectPath, 'apps/web/package.json'),
      );
      const apiPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
        join(projectPath, 'apps/api/package.json'),
      );
      const workerPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
        join(projectPath, 'apps/worker/package.json'),
      );
      expect(webPkg.dependencies.evlog).toBeDefined();
      expect(apiPkg.dependencies.evlog).toBeDefined();
      expect(workerPkg.dependencies.evlog).toBeDefined();
    });
  });
});
