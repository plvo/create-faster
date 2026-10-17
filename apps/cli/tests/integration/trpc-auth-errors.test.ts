import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = [
  'org-dashboard-nextjs',
  'org-dashboard-tanstack-start',
  'cloudflare-fullstack-nextjs',
  'multitenant-saas-nextjs',
];

const API_INIT = 'packages/api/src/trpc.ts';
const API_AUTH_ERRORS = 'packages/api/src/auth-errors.ts';

// The shape better-auth's APIError (better-call) has: name, HTTP status as a number, the message of its body.
const authApiError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { name: 'APIError', statusCode, status: statusCode, body: { message } });

// What the generated file needs from @trpc/server: a TRPCError that keeps its code, message and cause.
const TRPC_SERVER_STUB = `export class TRPCError extends Error {
  constructor({ code, message, cause }) {
    super(message);
    this.name = 'TRPCError';
    this.code = code;
    this.cause = cause;
  }
}`;

interface AuthErrors {
  trpcErrorFromAuthError: (error: unknown) => (Error & { code: string; cause: unknown }) | undefined;
}

describe('better-auth errors reach the client as tRPC errors', () => {
  let tempDir: string;
  let authErrors: AuthErrors;

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of BLUEPRINTS) {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'trpc-server.mjs'), TRPC_SERVER_STUB);
    const source = await readTextFile(join(tempDir, BLUEPRINTS[0] as string, API_AUTH_ERRORS));
    authErrors = await evaluateGeneratedModule<AuthErrors>(source, join(stubs, 'auth-errors.mjs'), {
      '@trpc/server': './trpc-server.mjs',
    });
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('an APIError keeps its message and takes the tRPC code of its HTTP status', () => {
    const expected: [number, string][] = [
      [400, 'BAD_REQUEST'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
      [429, 'TOO_MANY_REQUESTS'],
    ];
    for (const [statusCode, code] of expected) {
      const cause = authApiError(statusCode, 'You cannot ban yourself');
      const mapped = authErrors.trpcErrorFromAuthError(cause);
      expect(mapped?.code, String(statusCode)).toBe(code);
      expect(mapped?.message).toBe('You cannot ban yourself');
      expect(mapped?.cause).toBe(cause);
    }
  });

  test('a client error status without a tRPC counterpart is a bad request, never an internal error', () => {
    expect(authErrors.trpcErrorFromAuthError(authApiError(418, 'teapot'))?.code).toBe('BAD_REQUEST');
    expect(authErrors.trpcErrorFromAuthError(authApiError(422, 'Invalid body'))?.code).toBe('UNPROCESSABLE_CONTENT');
  });

  test('a server error status stays an internal error', () => {
    expect(authErrors.trpcErrorFromAuthError(authApiError(500, 'boom'))?.code).toBe('INTERNAL_SERVER_ERROR');
  });

  test('anything that is not an APIError is left to tRPC', () => {
    expect(authErrors.trpcErrorFromAuthError(new Error('db down'))).toBeUndefined();
    expect(authErrors.trpcErrorFromAuthError(Object.assign(new Error('x'), { statusCode: 400 }))).toBeUndefined();
    expect(authErrors.trpcErrorFromAuthError('APIError')).toBeUndefined();
    expect(authErrors.trpcErrorFromAuthError(undefined)).toBeUndefined();
  });

  describe.each(BLUEPRINTS)('%s', (blueprint) => {
    test('every procedure runs behind the mapping', async () => {
      const init = await readTextFile(join(tempDir, blueprint, API_INIT));
      expect(init).toContain("import { trpcErrorFromAuthError } from './auth-errors';");
      expect(init).toMatch(/const mapAuthErrors = t\.middleware\(/);
      expect(init).toMatch(/export const publicProcedure = t\.procedure\.use\(mapAuthErrors\);/);
      expect(init).toMatch(/export const protectedProcedure = publicProcedure\.use\(/);
    });

    test('the mapping is the one file of the api package', async () => {
      const source = await readTextFile(join(tempDir, blueprint, API_AUTH_ERRORS));
      expect(source).toContain('export function trpcErrorFromAuthError');
    });
  });
});

describe('single repo with better-auth and tRPC', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [
        'single-auth-errors',
        '--app',
        'web:nextjs:trpc,tanstack-query,better-auth',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, 'single-auth-errors');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the mapping sits next to the tRPC instance', async () => {
    expect(await fileExists(join(projectPath, 'src/trpc/auth-errors.ts'))).toBe(true);
    const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
    expect(init).toContain("import { trpcErrorFromAuthError } from './auth-errors';");
    expect(init).toMatch(/export const publicProcedure = t\.procedure\.use\(mapAuthErrors\);/);
  });
});

describe('tRPC without better-auth', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['trpc-only', '--app', 'web:nextjs:trpc,tanstack-query', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    projectPath = join(tempDir, 'trpc-only');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('has no mapping to maintain', async () => {
    expect(await fileExists(join(projectPath, 'src/trpc/auth-errors.ts'))).toBe(false);
    const init = await readTextFile(join(projectPath, 'src/trpc/init.ts'));
    expect(init).not.toContain('auth-errors');
    expect(init).toContain('export const publicProcedure = t.procedure;');
  });
});
