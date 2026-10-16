import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

const LOCAL_URL_WITHOUT_TLS = /^DATABASE_URL="mysql:\/\/mysql:password@localhost:\d+\/mysql-[\w-]+\?ssl=false"/m;
const PRODUCTION_TLS = 'function withProductionTls(databaseUrl: string): string {';
const DRIZZLE_TLS_VALUE = "const TLS_VALUE = '{}';";
const PRISMA_TLS_VALUE = "const TLS_VALUE = 'true';";
const DRIZZLE_CLIENT_CALL = 'connection: withProductionTls(databaseUrl),';
const PRISMA_CLIENT_CALL = "new PrismaMariaDb(withProductionTls(process.env.DATABASE_URL ?? 'mysql://localhost:3306/db'));";
const NODE_ENV_SOURCES = {
  nextjs: '- Next.js: `next build` replaces `process.env.NODE_ENV` with `production` in the server bundle',
  'tanstack-start': '- TanStack Start: `vite build` replaces it in the server bundle the same way',
  hono: '- Hono: Bun runs the source, so the client reads the variable at runtime. The `start` script sets it (`NODE_ENV=production bun run src/index.ts`)',
};
type ProbedStack = keyof typeof NODE_ENV_SOURCES;
const BUN_APPS_ELSEWHERE = 'Any other production entry of a Bun app';

interface PackageJson {
  dependencies?: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(projectName: string, args: string[]): Promise<string> {
  const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, projectName);
}

const TURBO_APPS = ['--app', 'web:nextjs', '--app', 'start:tanstack-start', '--app', 'api:hono'];
const TURBO_STACKS: ProbedStack[] = ['nextjs', 'tanstack-start', 'hono'];
const TURBO_ENV_FILES = ['packages/db/.env.example', 'apps/web/.env.example', 'apps/start/.env.example', 'apps/api/.env.example'];

const TOPOLOGIES = [
  {
    name: 'my-ssl-next-drizzle',
    args: ['--app', 'my-ssl-next-drizzle:nextjs', '--orm', 'drizzle'],
    stacks: ['nextjs'] as ProbedStack[],
    client: 'src/lib/db/index.ts',
    tlsValue: DRIZZLE_TLS_VALUE,
    clientCall: DRIZZLE_CLIENT_CALL,
    envFiles: ['.env.example'],
  },
  {
    name: 'my-ssl-turbo-drizzle',
    args: [...TURBO_APPS, '--orm', 'drizzle'],
    stacks: TURBO_STACKS,
    client: 'packages/db/src/index.ts',
    tlsValue: DRIZZLE_TLS_VALUE,
    clientCall: DRIZZLE_CLIENT_CALL,
    envFiles: TURBO_ENV_FILES,
  },
  {
    name: 'my-ssl-next-prisma',
    args: ['--app', 'my-ssl-next-prisma:nextjs', '--orm', 'prisma'],
    stacks: ['nextjs'] as ProbedStack[],
    client: 'src/lib/db/index.ts',
    tlsValue: PRISMA_TLS_VALUE,
    clientCall: PRISMA_CLIENT_CALL,
    envFiles: ['.env.example'],
  },
  {
    name: 'my-ssl-turbo-prisma',
    args: [...TURBO_APPS, '--orm', 'prisma'],
    stacks: TURBO_STACKS,
    client: 'packages/db/src/index.ts',
    tlsValue: PRISMA_TLS_VALUE,
    clientCall: PRISMA_CLIENT_CALL,
    envFiles: TURBO_ENV_FILES,
  },
];

describe.each(TOPOLOGIES)('$name', ({ name, args, stacks, client, tlsValue, clientCall, envFiles }) => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generate(name, [...args, '--database', 'mysql']);
  });

  test('the client asks its driver for TLS in production unless DATABASE_URL sets ssl', async () => {
    const index = await readTextFile(join(projectDir, client));
    expect(index).toContain(PRODUCTION_TLS);
    expect(index).toContain(tlsValue);
    expect(index).toContain(clientCall);
  });

  test('the client needs no dependency beyond the driver', async () => {
    const dbPackage = client.startsWith('packages/') ? 'packages/db/package.json' : 'package.json';
    const pkg = await readJsonFile<PackageJson>(join(projectDir, dbPackage));
    expect(pkg.dependencies?.['pg-connection-string']).toBeUndefined();
  });

  test('the local DATABASE_URL disables TLS for the Docker database', async () => {
    for (const envFile of envFiles) {
      expect(await readTextFile(join(projectDir, envFile)), envFile).toMatch(LOCAL_URL_WITHOUT_TLS);
    }
  });

  test('AGENTS.md explains TLS in production and the local ssl=false', async () => {
    const agents = await readTextFile(join(projectDir, 'AGENTS.md'));
    expect(agents).toContain('`NODE_ENV=production`');
    expect(agents).toContain('`?ssl=false`');
    expect(agents).toContain('Never copy the local `DATABASE_URL` to production');
    expect(agents).toContain('the client logs a warning');
  });

  test('AGENTS.md says where each stack gets NODE_ENV=production', async () => {
    const agents = await readTextFile(join(projectDir, 'AGENTS.md'));
    for (const [stack, source] of Object.entries(NODE_ENV_SOURCES)) {
      if (stacks.includes(stack as ProbedStack)) expect(agents).toContain(source);
      else expect(agents).not.toContain(source);
    }
    if (stacks.includes('hono')) expect(agents).toContain(BUN_APPS_ELSEWHERE);
    else expect(agents).not.toContain(BUN_APPS_ELSEWHERE);
  });
});

describe('mysql without an ORM', () => {
  test('the local DATABASE_URL disables TLS for the Docker database', async () => {
    const projectDir = await generate('my-ssl-no-orm', ['--app', 'my-ssl-no-orm:nextjs', '--database', 'mysql']);
    expect(await readTextFile(join(projectDir, '.env.example'))).toMatch(LOCAL_URL_WITHOUT_TLS);
    expect(await readTextFile(join(projectDir, 'AGENTS.md'))).not.toContain('TLS in production');
  });
});

describe('mysql through Hyperdrive', () => {
  test.each(['drizzle', 'prisma'])('%s: the Worker client builds from the binding fields alone', async (orm) => {
    const projectDir = await generate(`my-ssl-hyperdrive-${orm}`, [
      '--app',
      'api:hono',
      '--database',
      'mysql',
      '--orm',
      orm,
      '--deployment',
      'cloudflare',
    ]);
    const index = await readTextFile(join(projectDir, 'src/lib/db/index.ts'));
    expect(index).toContain('hyperdrive.host');
    expect(index).not.toContain('withProductionTls');
    expect(await readTextFile(join(projectDir, '.env.example'))).toMatch(LOCAL_URL_WITHOUT_TLS);
    expect(await readTextFile(join(projectDir, 'AGENTS.md'))).not.toContain('TLS in production');
  });

  test('the Prisma seed reads DATABASE_URL through the same TLS default', async () => {
    const projectDir = await generate('my-ssl-hyperdrive-seed', [
      '--app',
      'api:hono',
      '--database',
      'mysql',
      '--orm',
      'prisma',
      '--deployment',
      'cloudflare',
    ]);
    const seed = await readTextFile(join(projectDir, 'scripts/seed.ts'));
    expect(seed).toContain(PRODUCTION_TLS);
    expect(seed).toContain(PRISMA_CLIENT_CALL);
  });
});
