import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnyRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
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

interface AuthErrors {
  trpcErrorFromAuthError: (error: unknown) => (Error & { code: string; cause: unknown }) | undefined;
}

// What the generated trpc.ts imports from the other packages of the project. A name a blueprint does not import
// is exported anyway, so one stand-in serves every blueprint.
const PROJECT_STUB = `export const db = {};
export const prisma = {};
export const auth = { api: { getSession: async () => null } };
export const createAuth = () => auth;
export const getRequestSession = async () => null;`;

const REAL = {
  trpcServer: Bun.resolveSync('@trpc/server', import.meta.dir),
  superjson: Bun.resolveSync('superjson', import.meta.dir),
};

const SESSION = { user: { id: 'u1', role: 'admin' } };

interface TRPCInit {
  router: (procedures: Record<string, unknown>) => unknown;
  publicProcedure: Procedure;
  protectedProcedure: Procedure;
}
interface Procedure {
  input: (parser: (value: unknown) => number) => Procedure;
  query: (resolver: (opts: { input: number }) => unknown) => unknown;
}

describe('better-auth errors reach the client as tRPC errors', () => {
  let tempDir: string;
  let authErrors: AuthErrors;
  const calls = new Map<string, (procedure: string, input?: number) => Promise<{ status: number; error: Record<string, unknown> }>>();

  beforeAll(async () => {
    tempDir = await createTempDir();
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'project.mjs'), PROJECT_STUB);

    // The generated instance reads NODE_ENV once, when it loads: production is what hides unexpected errors.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      for (const blueprint of BLUEPRINTS) {
        const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
        expect(result.exitCode, result.stderr).toBe(0);

        const errorsFile = join(stubs, `${blueprint}-auth-errors.mjs`);
        const loaded = await evaluateGeneratedModule<AuthErrors>(
          await readTextFile(join(tempDir, blueprint, API_AUTH_ERRORS)),
          errorsFile,
          { '@trpc/server': REAL.trpcServer },
        );
        authErrors ??= loaded;

        const imports = {
          '@trpc/server': REAL.trpcServer,
          superjson: REAL.superjson,
          './auth-errors': errorsFile,
          './auth': './project.mjs',
          '@repo/db': './project.mjs',
          '@repo/auth/auth': './project.mjs',
          '@repo/auth/session-cache': './project.mjs',
        };
        const { router, publicProcedure, protectedProcedure } = await evaluateGeneratedModule<TRPCInit>(
          await readTextFile(join(tempDir, blueprint, API_INIT)),
          join(stubs, `${blueprint}-trpc.mjs`),
          imports,
        );
        const failWith = (procedure: Procedure) =>
          procedure
            .input((value) => value as number)
            .query(({ input }) => {
              throw authApiError(input, `refused with ${input}`);
            });
        const appRouter = router({
          publicRefusal: failWith(publicProcedure),
          protectedRefusal: failWith(protectedProcedure),
          bug: publicProcedure.query(() => {
            throw new Error('connection to db-primary.internal:5432 refused');
          }),
        });

        calls.set(blueprint, async (procedure, input) => {
          const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
          const response = await fetchRequestHandler({
            endpoint: '/api/trpc',
            req: new Request(`http://localhost/api/trpc/${procedure}${query}`),
            router: appRouter as AnyRouter,
            createContext: () => ({ session: SESSION, headers: new Headers(), db: {} }),
          });
          const body = (await response.json()) as { error: { json: Record<string, unknown> } };
          return { status: response.status, error: body.error.json };
        });
      }
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
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
    const call = (procedure: string, input?: number) => (calls.get(blueprint) as NonNullable<ReturnType<typeof calls.get>>)(procedure, input);

    test.each(['publicRefusal', 'protectedRefusal'])('an APIError thrown in %s answers its status, code and message', async (procedure) => {
      const expected: [number, string][] = [
        [400, 'BAD_REQUEST'],
        [401, 'UNAUTHORIZED'],
        [403, 'FORBIDDEN'],
        [404, 'NOT_FOUND'],
      ];
      for (const [statusCode, code] of expected) {
        const { status, error } = await call(procedure, statusCode);
        expect(status, `${procedure} ${statusCode}`).toBe(statusCode);
        expect(error.message).toBe(`refused with ${statusCode}`);
        expect((error.data as { code: string }).code).toBe(code);
      }
    });

    test('an error that is not an APIError is still an internal error that does not leak its message', async () => {
      const { status, error } = await call('bug');
      expect(status).toBe(500);
      expect((error.data as { code: string }).code).toBe('INTERNAL_SERVER_ERROR');
      expect(error.message).toBe('Internal server error');
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
