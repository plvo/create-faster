import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

const GENERATE_FLAGS = ['--no-git', '--no-install', '--pm', 'bun'];

describe('evlog + TanStack Start', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, args: string[]): Promise<string> {
    const result = await runCli([projectName, ...args, ...GENERATE_FLAGS], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  describe('single repo on Nitro', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('evlog-start-nitro', ['--app', 'evlog-start-nitro:tanstack-start:evlog']);
    });

    test('registers the evlog Nitro module', async () => {
      const config = await readTextFile(join(projectPath, 'nitro.config.ts'));
      expect(config).toContain("from 'evlog/nitro/v3'");
    });

    test('generates no Workers entry nor project-local logger', async () => {
      expect(await fileExists(join(projectPath, 'src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/evlog.ts'))).toBe(false);
    });

    test('root route replaces evlogErrorHandler with a middleware that logs into the Nitro request logger', async () => {
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).not.toContain('evlogErrorHandler');
      expect(root).not.toContain('evlog/nitro/v3');
      expect(root).toContain("import { useRequest } from 'nitro/context'");
      expect(root).toContain('useRequest().context?.log');
      expect(root).toContain('EvlogError.isEvlogError(error)');
      expect(root).toContain('throw new Response(JSON.stringify(error.toJSON())');
    });

    test('start.ts logs server function errors into the Nitro request logger', async () => {
      const start = await readTextFile(join(projectPath, 'src/start.ts'));
      expect(start).toContain('createStart');
      expect(start).toContain("createMiddleware({ type: 'function' })");
      expect(start).toContain('functionMiddleware: [');
      expect(start).toContain("import { useRequest } from 'nitro/context'");
      expect(start).toContain('useRequest().context?.log');
    });
  });

  describe('single repo on cloudflare', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('evlog-start-cf', [
        '--app',
        'evlog-start-cf:tanstack-start:evlog',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('generates no nitro.config.ts', async () => {
      expect(await fileExists(join(projectPath, 'nitro.config.ts'))).toBe(false);
    });

    test('wrangler main points at the custom server entry', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"main": "src/server.ts"');
      expect(wrangler).not.toContain('@tanstack/react-start/server-entry');
    });

    test('server entry wraps Start fetch with withEvlog, passes the logger as context.log and binds it to useLogger', async () => {
      const server = await readTextFile(join(projectPath, 'src/server.ts'));
      expect(server).toContain("from '@tanstack/react-start/server-entry'");
      expect(server).toContain("from 'evlog/workers'");
      expect(server).toContain("initWorkersLogger({ env: { service: 'evlog-start-cf' } })");
      expect(server).toContain('withEvlog');
      expect(server).toContain('loggerStorage.run(log');
      expect(server).toContain('handler.fetch(request, { context: { log } })');
      expect(server).toContain('requestContext: { log: RequestLogger }');
    });

    test('project-local useLogger comes from AsyncLocalStorage, not from evlog/toolkit barrel', async () => {
      const logger = await readTextFile(join(projectPath, 'src/lib/evlog.ts'));
      expect(logger).toContain("from 'evlog/toolkit/storage'");
      expect(logger).toContain('createLoggerStorage');
      expect(logger).toContain('useLogger');
    });

    test('root route middleware reads context.log, never Nitro', async () => {
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).toContain('context.log?.error(error)');
      expect(root).toContain('EvlogError.isEvlogError(error)');
      expect(root).not.toContain('nitro/context');
      expect(root).not.toContain('evlogErrorHandler');
    });

    test('agent docs tell where the logger comes from', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('`src/server.ts`');
      expect(agents).toContain("`useLogger()` from `@/lib/evlog`");
    });

    test('start.ts logs server function errors from context.log', async () => {
      const start = await readTextFile(join(projectPath, 'src/start.ts'));
      expect(start).toContain("createMiddleware({ type: 'function' })");
      expect(start).toContain('functionMiddleware: [');
      expect(start).toContain('context.log?.error(error)');
      expect(start).not.toContain('nitro/context');
    });
  });

  describe('cloudflare without evlog', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-cf-plain', [
        '--app',
        'start-cf-plain:tanstack-start',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('agent docs keep the default server entry', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).not.toContain('withEvlog');
    });

    test('keeps the default Start server entry and generates no evlog files', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"main": "@tanstack/react-start/server-entry"');
      expect(await fileExists(join(projectPath, 'src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/start.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/evlog.ts'))).toBe(false);
    });
  });

  describe('turborepo with evlog on one of two Start apps, cloudflare', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('evlog-start-cf-turbo', [
        '--app',
        'web:tanstack-start:evlog',
        '--app',
        'admin:tanstack-start',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('only the app with evlog gets the custom entry', async () => {
      const web = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
      const admin = await readTextFile(join(projectPath, 'apps/admin/wrangler.jsonc'));
      expect(web).toContain('"main": "src/server.ts"');
      expect(admin).toContain('"main": "@tanstack/react-start/server-entry"');
      expect(await fileExists(join(projectPath, 'apps/web/src/server.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/start.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/admin/src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/src/start.ts'))).toBe(false);
    });

    test('agent docs describe the custom entry as specific to apps with evlog', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('or at `src/server.ts` in an app with evlog');
    });

    test('the service name is the app name', async () => {
      const server = await readTextFile(join(projectPath, 'apps/web/src/server.ts'));
      expect(server).toContain("service: 'web'");
    });
  });

  describe('turborepo with evlog on one of two Start apps, Nitro', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('evlog-start-nitro-turbo', [
        '--app',
        'web:tanstack-start:evlog',
        '--app',
        'admin:tanstack-start',
      ]);
    });

    test('only the app with evlog gets the Nitro module and the error middlewares', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/nitro.config.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/start.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/nitro.config.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/src/start.ts'))).toBe(false);
      const adminRoot = await readTextFile(join(projectPath, 'apps/admin/src/routes/__root.tsx'));
      expect(adminRoot).not.toContain('EvlogError');
    });
  });
});
