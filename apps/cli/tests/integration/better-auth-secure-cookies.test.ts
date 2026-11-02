import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadGeneratedAuth } from './generated-auth-harness';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const SECRET = 'integration-secret-integration-secret-0123';
const SESSION_COOKIE = 'better-auth.session_token';
const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;

const GUARD_STAND_IN = { './guard-administrators': "export const guardAdministrators = () => ({ id: 'guard-administrators' });" };
const ADMIN_MODULES = ['email-change-guard', 'permissions', 'refuse-own-role-change'];

const resolve = (specifier: string): string => Bun.resolveSync(specifier, import.meta.dir);

// The wallet blueprint keeps its auth in the app, over `@/lib/db`, and verifies signatures with viem.
const WALLET_STAND_INS = {
  '@/lib/db': `export const db = {};
export const userTable = {};
export const userAccountTable = {};
export const userSessionTable = {};
export const userVerificationTable = {};
export const walletAddressTable = {};`,
  viem: 'export const verifyMessage = async () => true;',
  'better-auth/crypto': `export * from ${JSON.stringify(resolve('better-auth/crypto'))};`,
};

interface Factory {
  name: string;
  args: string[];
  modules: string[];
  call: string;
  standIns?: Record<string, string>;
  authFile?: string;
}

// Every `createAuth` that gives better-auth an object `baseURL` (a dynamic one, with `protocol: 'auto'` in
// production), and one that leaves it to `BETTER_AUTH_URL`, which already follows the scheme.
const FACTORIES: Factory[] = [
  {
    name: 'the better-auth library',
    args: ['--app', 'web:nextjs:better-auth', '--app', 'api:hono', '--database', 'postgres', '--orm', 'drizzle'],
    modules: [],
    call: 'createAuth()',
  },
  {
    name: 'multitenant-saas-nextjs',
    args: ['--blueprint', 'multitenant-saas-nextjs'],
    modules: ['email-change-guard', 'invitation-link', 'permissions'],
    call: 'createAuth()',
  },
  {
    name: 'cloudflare-fullstack-nextjs',
    args: ['--blueprint', 'cloudflare-fullstack-nextjs'],
    modules: ADMIN_MODULES,
    standIns: GUARD_STAND_IN,
    call: 'createAuth({})',
  },
  {
    name: 'dapp-rainbowkit-nextjs',
    args: ['--blueprint', 'dapp-rainbowkit-nextjs'],
    modules: [],
    standIns: WALLET_STAND_INS,
    authFile: 'src/lib/auth/create-auth.ts',
    call: 'createAuth()',
  },
  {
    name: 'org-dashboard-nextjs',
    args: ['--blueprint', 'org-dashboard-nextjs'],
    modules: ADMIN_MODULES,
    standIns: GUARD_STAND_IN,
    call: 'createAuth()',
  },
];

interface Scenario {
  name: string;
  nodeEnv: 'production' | 'development';
  baseUrl: string | undefined;
  secure: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: 'a production server on https', nodeEnv: 'production', baseUrl: 'https://app.example.com', secure: true },
  { name: 'a production build served over plain http', nodeEnv: 'production', baseUrl: 'http://localhost:3000', secure: false },
  { name: 'a dev server behind an https proxy', nodeEnv: 'development', baseUrl: 'https://web.localhost', secure: true },
  { name: 'a dev server on plain http', nodeEnv: 'development', baseUrl: 'http://localhost:3000', secure: false },
];

// Without a configured origin the scheme is unknown, so better-auth keeps its own rule, Secure in production. Only the
// library factory starts without one: the blueprints name no allowed host then and better-auth refuses to start.
const NO_ORIGIN: Scenario = {
  name: 'a production server with no BETTER_AUTH_URL',
  nodeEnv: 'production',
  baseUrl: undefined,
  secure: true,
};

// Prints the session cookie of the generated factory as better-auth builds it. It runs in a process of its own because
// better-auth reads NODE_ENV once, when it is imported, and the test run has its own.
const PROBE = `const [factoryModule, call] = process.argv.slice(2);
const { createAuth } = await import(factoryModule);
const { authCookies } = await new Function('createAuth', 'return ' + call)(createAuth).$context;
console.log(JSON.stringify({ name: authCookies.sessionToken.name, secure: authCookies.sessionToken.attributes.secure === true }));`;

describe('the session cookie of the generated better-auth factories follows the scheme of BETTER_AUTH_URL', () => {
  let tempDir: string;
  const probes = new Map<string, { factoryModule: string; call: string }>();

  beforeAll(async () => {
    tempDir = await createTempDir();
    await Bun.write(join(tempDir, 'session-cookie-probe.mjs'), PROBE);
    for (const factory of FACTORIES) {
      const result = await runCli(
        [factory.name.replace(/\W+/g, '-'), ...factory.args, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const workDir = join(tempDir, `work-${factory.name.replace(/\W+/g, '-')}`);
      await loadGeneratedAuth(join(tempDir, factory.name.replace(/\W+/g, '-')), workDir, factory);
      probes.set(factory.name, { factoryModule: join(workDir, 'auth-stubs', 'auth.mjs'), call: factory.call });
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function sessionCookie(factory: Factory, scenario: Scenario): Promise<{ name: string; secure: boolean }> {
    const { factoryModule, call } = probes.get(factory.name) as { factoryModule: string; call: string };
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      NODE_ENV: scenario.nodeEnv,
      BETTER_AUTH_SECRET: SECRET,
      ...(scenario.baseUrl ? { BETTER_AUTH_URL: scenario.baseUrl } : {}),
    };
    const child = Bun.spawn([process.execPath, 'run', join(tempDir, 'session-cookie-probe.mjs'), factoryModule, call], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    return JSON.parse(stdout.trim().split('\n').at(-1) as string);
  }

  for (const factory of FACTORIES) {
    describe(factory.name, () => {
      for (const scenario of factory === FACTORIES[0] ? [...SCENARIOS, NO_ORIGIN] : SCENARIOS) {
        test(`${scenario.name}: ${scenario.secure ? 'Secure' : 'not Secure'}`, async () => {
          expect(await sessionCookie(factory, scenario)).toEqual({
            name: scenario.secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE,
            secure: scenario.secure,
          });
        });
      }
    });
  }
});
