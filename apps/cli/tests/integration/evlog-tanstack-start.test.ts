import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

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

    test('generates nitro.config.ts at project root', async () => {
      const config = await readTextFile(join(projectPath, 'nitro.config.ts'));
      expect(config).toContain("from 'evlog/nitro/v3'");
      expect(config).toContain('asyncContext: true');
      expect(config).toContain("service: 'evlog-start-nitro'");
    });

    test('generates no Workers entry', async () => {
      expect(await fileExists(join(projectPath, 'src/server.ts'))).toBe(false);
    });

    test('src/lib/evlog.ts reads the request logger from the Nitro request context, with a non-throwing lookup', async () => {
      const logger = await readTextFile(join(projectPath, 'src/lib/evlog.ts'));
      expect(logger).toContain("import { useRequest as getNitroRequest } from 'nitro/context'");
      expect(logger).toContain('getNitroRequest().context?.log as RequestLogger | undefined');
      expect(logger).toContain('export function findLogger()');
      expect(logger).toContain('export function useLogger()');
      expect(logger).not.toContain('createLoggerStorage');
    });

    test('src/start.ts logs request and server function errors without replacing them when no logger is found', async () => {
      const start = await readTextFile(join(projectPath, 'src/start.ts'));
      expect(start).toContain("createMiddleware({ type: 'request' })");
      expect(start).toContain("createMiddleware({ type: 'function' })");
      expect(start).toContain('requestMiddleware: [csrfMiddleware, logRequestErrors]');
      expect(start).toContain('functionMiddleware: [logServerFnErrors]');
      expect(start).toContain("import { findLogger } from '@/lib/evlog'");
      expect(start).toContain('findLogger()?.error(toError(error))');
      expect(start).not.toContain('useLogger');
      expect(start).toContain('EvlogError.isEvlogError(error)');
      expect(start).toContain('throw new Response(JSON.stringify(error.toJSON())');
      expect(start).not.toContain('evlogErrorHandler');
      expect(start).not.toContain('nitro/context');
    });

    test('src/start.ts keeps the server function CSRF protection Start only applies when start.ts is absent', async () => {
      const start = await readTextFile(join(projectPath, 'src/start.ts'));
      expect(start).toContain(
        "import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'",
      );
      expect(start).toContain("createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })");
    });

    test('agent docs tell to keep csrfMiddleware first in start.ts', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('Keep `csrfMiddleware` first in `requestMiddleware` of `src/start.ts`');
    });

    test('root route carries no evlog code', async () => {
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).not.toContain('EvlogError');
      expect(root).not.toContain('useLogger');
      expect(root).not.toContain('server: {');
    });
  });

  describe('single repo on Nitro without evlog', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-nitro-plain', ['--app', 'start-nitro-plain:tanstack-start']);
    });

    test('generates no Start-wide entry nor logger files', async () => {
      expect(await fileExists(join(projectPath, 'src/start.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/evlog.ts'))).toBe(false);
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).not.toContain('EvlogError');
      expect(root).not.toContain('useLogger');
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

    test('wrangler main points at the Worker entry', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"main": "src/server.ts"');
      expect(wrangler).not.toContain('@tanstack/react-start/server-entry"');
    });

    test('Worker entry wraps Start fetch with withEvlog, passes the logger as context.log and binds it to useLogger', async () => {
      const server = await readTextFile(join(projectPath, 'src/server.ts'));
      expect(server).toContain("import handler from '@tanstack/react-start/server-entry'");
      expect(server).toContain("from 'evlog/workers'");
      expect(server).toContain("initWorkersLogger({ env: { service: 'evlog-start-cf' } })");
      expect(server).toContain('export default withEvlog(');
      expect(server).toContain('loggerStorage.run(log');
      expect(server).toContain('handler.fetch(request, { context: { log } })');
      expect(server).toContain('requestContext: { log: RequestLogger }');
    });

    test('project-local useLogger comes from AsyncLocalStorage, with a non-throwing lookup', async () => {
      const logger = await readTextFile(join(projectPath, 'src/lib/evlog.ts'));
      expect(logger).toContain("from 'evlog/toolkit/storage'");
      expect(logger).toContain('createLoggerStorage');
      expect(logger).toContain('useLogger');
      expect(logger).toContain('findLogger');
    });

    test('agent docs tell where the logger comes from', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('`src/server.ts`');
      expect(agents).toContain('`useLogger()` from `@/lib/evlog`');
    });

    test('start.ts logs through the same findLogger as Nitro', async () => {
      const start = await readTextFile(join(projectPath, 'src/start.ts'));
      expect(start).toContain('requestMiddleware: [csrfMiddleware, logRequestErrors]');
      expect(start).toContain('functionMiddleware: [logServerFnErrors]');
      expect(start).toContain("import { findLogger } from '@/lib/evlog'");
      expect(start).toContain('findLogger()?.error(toError(error))');
      expect(start).toContain("createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })");
      expect(start).not.toContain('nitro/context');
    });

    test('root route carries no evlog code', async () => {
      const root = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
      expect(root).not.toContain('EvlogError');
      expect(root).not.toContain('useLogger');
    });
  });

  describe('cloudflare-static with evlog', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('evlog-start-static', [
        '--app',
        'evlog-start-static:tanstack-start:evlog',
        '--deployment',
        'cloudflare-static',
      ]);
    });

    test('generates no server-side logging files: nothing runs per request', async () => {
      expect(await fileExists(join(projectPath, 'nitro.config.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/start.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/evlog.ts'))).toBe(false);
    });

    test('agent docs carry no start.ts CSRF note', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).not.toContain('csrfMiddleware');
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

    test('wrangler main points at a Worker entry that serves Start as is', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"main": "src/server.ts"');
      const server = await readTextFile(join(projectPath, 'src/server.ts'));
      expect(server).toContain("import handler from '@tanstack/react-start/server-entry'");
      expect(server).toContain('export default handler');
      expect(server).not.toContain('evlog');
    });

    test('generates no evlog files', async () => {
      expect(await fileExists(join(projectPath, 'src/start.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/evlog.ts'))).toBe(false);
    });

    test('agent docs name the Worker entry without evlog', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('`src/server.ts`');
      expect(agents).not.toContain('withEvlog');
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

    test('every Start app has a Worker entry, only the app with evlog wraps it', async () => {
      for (const app of ['web', 'admin']) {
        const wrangler = await readTextFile(join(projectPath, `apps/${app}/wrangler.jsonc`));
        expect(wrangler).toContain('"main": "src/server.ts"');
      }
      expect(await readTextFile(join(projectPath, 'apps/web/src/server.ts'))).toContain('export default withEvlog(');
      const admin = await readTextFile(join(projectPath, 'apps/admin/src/server.ts'));
      expect(admin).toContain('export default handler');
      expect(admin).not.toContain('evlog');
    });

    test('only the app with evlog gets start.ts', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/src/start.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/admin/src/start.ts'))).toBe(false);
    });

    test('agent docs name the Worker entry and where evlog changes it', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('`src/server.ts`');
      expect(agents).toContain('in an app with evlog');
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

    test('only the app with evlog gets the Nitro module, the logger and the error middlewares', async () => {
      expect(await fileExists(join(projectPath, 'apps/web/nitro.config.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/start.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/web/src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/nitro.config.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/src/start.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/admin/src/server.ts'))).toBe(false);
      expect(await fileExists(join(projectPath, 'apps/web/src/lib/evlog.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/admin/src/lib/evlog.ts'))).toBe(false);
    });
  });
});
