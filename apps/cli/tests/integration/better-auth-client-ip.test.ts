import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

const CLOUDFLARE_HEADER = "ipAddressHeaders: ['cf-connecting-ip']";
const FORWARDED_HEADER = "ipAddressHeaders: ['x-forwarded-for']";

interface Generation {
  name: string;
  args: string[];
  authFile: string;
  trustedHeader: string;
}

const NEXTJS_SQLITE_ARGS = ['--app', 'web:nextjs:better-auth', '--database', 'sqlite', '--orm', 'drizzle'];
const START_NITRO_ARGS = ['--app', 'web:tanstack-start:better-auth', '--database', 'sqlite', '--orm', 'drizzle'];
const START_CLOUDFLARE_D1_ARGS = [
  '--app',
  'web:tanstack-start:better-auth',
  '--database',
  'd1',
  '--orm',
  'drizzle',
  '--deployment',
  'cloudflare',
];

const GENERATIONS: Generation[] = [
  {
    name: 'nextjs-none',
    args: NEXTJS_SQLITE_ARGS,
    authFile: 'src/lib/auth/create-auth.ts',
    trustedHeader: FORWARDED_HEADER,
  },
  {
    name: 'nextjs-postgres-prisma',
    args: ['--app', 'web:nextjs:better-auth', '--database', 'postgres', '--orm', 'prisma'],
    authFile: 'src/lib/auth/create-auth.ts',
    trustedHeader: FORWARDED_HEADER,
  },
  {
    name: 'start-cloudflare-d1',
    args: START_CLOUDFLARE_D1_ARGS,
    authFile: 'src/lib/auth/create-auth.ts',
    trustedHeader: CLOUDFLARE_HEADER,
  },
  {
    name: 'nextjs-cloudflare-d1',
    args: ['--app', 'web:nextjs:better-auth', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'],
    authFile: 'src/lib/auth/create-auth.ts',
    trustedHeader: CLOUDFLARE_HEADER,
  },
  {
    name: 'nextjs-sst',
    args: ['--app', 'web:nextjs:better-auth', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'sst'],
    authFile: 'src/lib/auth/create-auth.ts',
    trustedHeader: FORWARDED_HEADER,
  },
  {
    name: 'turbo-cloudflare-d1',
    args: [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'api:hono',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ],
    authFile: 'packages/auth/src/auth.ts',
    trustedHeader: CLOUDFLARE_HEADER,
  },
  {
    name: 'turbo-none',
    args: ['--app', 'web:nextjs:better-auth', '--app', 'api:hono', '--database', 'postgres', '--orm', 'drizzle'],
    authFile: 'packages/auth/src/auth.ts',
    trustedHeader: FORWARDED_HEADER,
  },
];

const BLUEPRINTS: { blueprint: string; authFile: string; trustedHeader: string }[] = [
  { blueprint: 'org-dashboard-nextjs', authFile: 'packages/auth/src/auth.ts', trustedHeader: FORWARDED_HEADER },
  { blueprint: 'multitenant-saas-nextjs', authFile: 'packages/auth/src/auth.ts', trustedHeader: FORWARDED_HEADER },
  { blueprint: 'dapp-rainbowkit-nextjs', authFile: 'src/lib/auth/create-auth.ts', trustedHeader: FORWARDED_HEADER },
  { blueprint: 'cloudflare-fullstack-nextjs', authFile: 'packages/auth/src/auth.ts', trustedHeader: CLOUDFLARE_HEADER },
];

const NITRO_PLUGIN = 'src/lib/nitro/client-ip.ts';
const COMMON_ARGS = ['--no-git', '--no-install', '--pm', 'bun'];

describe('better-auth trusts one client ip header for rate limiting', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, ...COMMON_ARGS], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return join(tempDir, name);
  }

  function expectOnlyTrusted(auth: string, trustedHeader: string): void {
    expect(auth).toContain(trustedHeader);
    expect(auth.match(/ipAddressHeaders/g)).toHaveLength(1);
    expect(auth.match(/^\s*advanced: \{/gm)).toHaveLength(1);
  }

  for (const { name, args, authFile, trustedHeader } of GENERATIONS) {
    test(`${name}: the factory trusts ${trustedHeader}`, async () => {
      const projectPath = await generate(name, args);
      expectOnlyTrusted(await readTextFile(join(projectPath, authFile)), trustedHeader);
    });
  }

  test('postgres keeps the uuid id generator next to the trusted header', async () => {
    const projectPath = await generate('postgres-uuids', [
      '--app',
      'web:nextjs:better-auth',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    const auth = await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'));
    expectOnlyTrusted(auth, FORWARDED_HEADER);
    expect(auth).toContain('generateId: () => crypto.randomUUID()');
  });

  for (const { blueprint, authFile, trustedHeader } of BLUEPRINTS) {
    test(`blueprint ${blueprint}: the factory trusts ${trustedHeader}`, async () => {
      const projectPath = await generate(`bp-${blueprint}`, ['--blueprint', blueprint]);
      expectOnlyTrusted(await readTextFile(join(projectPath, authFile)), trustedHeader);
    });
  }

  test('a Start app on Nitro fills x-forwarded-for with the connection address through a Nitro plugin', async () => {
    const projectPath = await generate('start-nitro', START_NITRO_ARGS);
    const plugin = await readTextFile(join(projectPath, NITRO_PLUGIN));
    expect(plugin).toContain("event.req.headers.has('x-forwarded-for')");
    expect(plugin).toContain('event.req.ip');
    expect(await readTextFile(join(projectPath, 'vite.config.ts'))).toContain(
      `nitro({ plugins: ['./${NITRO_PLUGIN}'] })`,
    );
  });

  test('a Start app in a turborepo gets the Nitro plugin in its own app', async () => {
    const projectPath = await generate('start-nitro-turbo', [
      '--app',
      'web:tanstack-start:better-auth',
      '--app',
      'api:hono',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ]);
    expect(await fileExists(join(projectPath, 'apps/web', NITRO_PLUGIN))).toBe(true);
    expect(await readTextFile(join(projectPath, 'apps/web/vite.config.ts'))).toContain(
      `nitro({ plugins: ['./${NITRO_PLUGIN}'] })`,
    );
  });

  const WITHOUT_NITRO_PLUGIN = [
    { name: 'a Start app on Cloudflare', args: START_CLOUDFLARE_D1_ARGS, viteConfig: true },
    {
      name: 'a Start app without better-auth',
      args: ['--app', 'web:tanstack-start', '--database', 'sqlite', '--orm', 'drizzle'],
      viteConfig: true,
    },
    { name: 'a Next.js app', args: NEXTJS_SQLITE_ARGS, viteConfig: false },
  ];

  for (const { name, args, viteConfig } of WITHOUT_NITRO_PLUGIN) {
    test(`${name} gets no Nitro client address plugin`, async () => {
      const projectPath = await generate(`no-plugin-${name.replaceAll(' ', '-')}`, args);
      expect(await fileExists(join(projectPath, NITRO_PLUGIN))).toBe(false);
      if (viteConfig) expect(await readTextFile(join(projectPath, 'vite.config.ts'))).not.toContain('client-ip');
    });
  }

  test('the agent notes tell a non-Cloudflare deployment to run behind a proxy that overwrites x-forwarded-for and how to set trustedProxies for a chain', async () => {
    const projectPath = await generate('notes-none', NEXTJS_SQLITE_ARGS);
    const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agents).toContain('x-forwarded-for');
    expect(agents).toContain('reverse proxy or CDN');
    expect(agents).toContain('no-trusted-ip');
    expect(agents).toContain('advanced.ipAddress.trustedProxies');
    expect(agents).not.toContain(NITRO_PLUGIN);
  });

  test('the Start agent notes name the Nitro plugin that fills x-forwarded-for, and not on Cloudflare', async () => {
    const nitro = await readTextFile(join(await generate('notes-start-nitro', START_NITRO_ARGS), 'AGENTS.md'));
    expect(nitro).toContain(NITRO_PLUGIN);
    const cloudflare = await readTextFile(join(await generate('notes-start-cf', START_CLOUDFLARE_D1_ARGS), 'AGENTS.md'));
    expect(cloudflare).not.toContain(NITRO_PLUGIN);
  });

  test('the agent notes name cf-connecting-ip on Cloudflare', async () => {
    const projectPath = await generate('notes-cloudflare', START_CLOUDFLARE_D1_ARGS);
    const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agents).toContain('cf-connecting-ip');
    expect(agents).not.toContain('reverse proxy or CDN');
  });
});
