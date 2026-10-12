import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const SESSION_LOOKUP = /auth\.api\.(getSession|listOrganizations)/;
const SQLITE_DRIZZLE = ['--database', 'sqlite', '--orm', 'drizzle'];

describe('Next.js proxy', () => {
  let tempDir: string;

  const generate = async (name: string, args: string[]): Promise<string> => {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('generic stack template', () => {
    test('better-auth: the proxy neither queries the session nor reads the user id', async () => {
      const projectPath = await generate('proxy-auth', ['--app', 'web:nextjs:better-auth', ...SQLITE_DRIZZLE]);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).not.toMatch(SESSION_LOOKUP);
      expect(proxy).not.toContain('@/lib/auth');
      expect(proxy).not.toContain('user.id');
    });

    test('the request log only runs in development', async () => {
      const projectPath = await generate('proxy-log', ['--app', 'web:nextjs']);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).toMatch(/if \(process\.env\.NODE_ENV === 'development'\) \{\s+console\.log/);
    });

    test('better-auth with evlog: the proxy only wraps the request with evlog', async () => {
      const projectPath = await generate('proxy-evlog', ['--app', 'web:nextjs:better-auth,evlog', ...SQLITE_DRIZZLE]);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).not.toMatch(SESSION_LOOKUP);
      expect(proxy).toContain('withEvlog(request)');
    });

    test('cloudflare with d1: the middleware does not resolve auth per request', async () => {
      const projectPath = await generate('proxy-d1', [
        '--app',
        'web:nextjs:better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      const middleware = await readTextFile(join(projectPath, 'src/middleware.ts'));
      expect(middleware).not.toContain('getAuth');
      expect(middleware).not.toMatch(SESSION_LOOKUP);
    });

    test.each([
      ['org-dashboard', 'apps/web/src/proxy.ts'],
      ['cloudflare-fullstack', 'apps/web/src/middleware.ts'],
    ])('%s blueprint: no session lookup in the proxy', async (blueprint, file) => {
      const projectPath = await generate(`proxy-${blueprint}`, ['--blueprint', blueprint]);
      const proxy = await readTextFile(join(projectPath, file));
      expect(proxy).not.toMatch(SESSION_LOOKUP);
      expect(proxy).not.toContain('user.id');
    });
  });
});
