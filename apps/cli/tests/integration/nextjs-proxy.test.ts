import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

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
      expect(proxy).not.toMatch(/@\/lib\/auth\/(auth|session)/);
      expect(proxy).not.toContain('user.id');
    });

    test('better-auth: the proxy hands the requested path to server components', async () => {
      const projectPath = await generate('proxy-path', ['--app', 'web:nextjs:better-auth', ...SQLITE_DRIZZLE]);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).toContain("import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path';");
      expect(proxy).toContain('requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${request.nextUrl.search}`);');
      expect(proxy).toContain('NextResponse.next({ request: { headers: requestHeaders } })');
      expect(await readTextFile(join(projectPath, 'src/lib/auth/request-path.ts'))).toContain(
        "export const REQUEST_PATH_HEADER = 'x-request-path';",
      );
    });

    test('without better-auth the proxy forwards nothing and has no header module', async () => {
      const projectPath = await generate('proxy-no-path', ['--app', 'web:nextjs']);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).not.toContain('REQUEST_PATH_HEADER');
      expect(proxy).toContain('NextResponse.next()');
    });

    test('better-auth with posthog keeps the ingest exclusion of the matcher', async () => {
      const projectPath = await generate('proxy-posthog', ['--app', 'web:nextjs:better-auth,posthog', ...SQLITE_DRIZZLE]);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).toContain('api|ingest|_next/static');
      expect(proxy).toContain('REQUEST_PATH_HEADER');
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
      expect(proxy).toContain('withEvlog(new NextRequest(request, { headers: requestHeaders }))');
      expect(proxy).toContain("import { NextRequest } from 'next/server';");
    });

    test('evlog without better-auth: the proxy only wraps the request with evlog', async () => {
      const projectPath = await generate('proxy-evlog-only', ['--app', 'web:nextjs:evlog']);
      const proxy = await readTextFile(join(projectPath, 'src/proxy.ts'));
      expect(proxy).toContain('withEvlog(request)');
      expect(proxy).not.toContain('REQUEST_PATH_HEADER');
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
      ['org-dashboard-nextjs', 'apps/web/src/proxy.ts'],
      ['cloudflare-fullstack-nextjs', 'apps/web/src/middleware.ts'],
    ])('%s blueprint: no session lookup in the proxy', async (blueprint, file) => {
      const projectPath = await generate(`proxy-${blueprint}`, ['--blueprint', blueprint]);
      const proxy = await readTextFile(join(projectPath, file));
      expect(proxy).not.toMatch(SESSION_LOOKUP);
      expect(proxy).not.toContain('user.id');
    });
  });

  describe('blueprints with a protecting proxy', () => {
    test.each([
      ['multitenant-saas-nextjs', 'apps/web/src/proxy.ts'],
      ['dapp-rainbowkit-nextjs', 'src/proxy.ts'],
    ])('%s: the proxy checks the session cookie and leaves API routes alone', async (blueprint, file) => {
      const projectPath = await generate(`proxy-${blueprint}`, ['--blueprint', blueprint]);
      const proxy = await readTextFile(join(projectPath, file));
      expect(proxy).toContain("import { getSessionCookie } from 'better-auth/cookies'");
      expect(proxy).not.toMatch(SESSION_LOOKUP);
      expect(proxy).toMatch(/matcher: \['\/\(\(\?!api\|/);
    });
  });
});
