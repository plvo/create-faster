import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const DRIZZLE_TLS_IN_PRODUCTION = `connection: {
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production',
    },`;
const PRISMA_TLS_IN_PRODUCTION =
  "new PrismaPg({ connectionString: process.env.DATABASE_URL!, ssl: process.env.NODE_ENV === 'production' })";
const LOCAL_URL_WITHOUT_TLS = /^DATABASE_URL="postgresql:\/\/postgres:password@localhost:\d+\/postgres-[\w-]+\?sslmode=disable"/m;

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

const TOPOLOGIES = [
  {
    name: 'pg-ssl-next-drizzle',
    args: ['--app', 'pg-ssl-next-drizzle:nextjs', '--orm', 'drizzle'],
    client: 'src/lib/db/index.ts',
    clientConfig: DRIZZLE_TLS_IN_PRODUCTION,
    envFiles: ['.env.example'],
  },
  {
    name: 'pg-ssl-start-drizzle',
    args: ['--app', 'pg-ssl-start-drizzle:tanstack-start', '--orm', 'drizzle'],
    client: 'src/lib/db/index.ts',
    clientConfig: DRIZZLE_TLS_IN_PRODUCTION,
    envFiles: ['.env.example'],
  },
  {
    name: 'pg-ssl-turbo-drizzle',
    args: [...TURBO_APPS, '--orm', 'drizzle'],
    client: 'packages/db/src/index.ts',
    clientConfig: DRIZZLE_TLS_IN_PRODUCTION,
    envFiles: ['packages/db/.env.example', 'apps/web/.env.example', 'apps/start/.env.example', 'apps/api/.env.example'],
  },
  {
    name: 'pg-ssl-next-prisma',
    args: ['--app', 'pg-ssl-next-prisma:nextjs', '--orm', 'prisma'],
    client: 'src/lib/db/index.ts',
    clientConfig: PRISMA_TLS_IN_PRODUCTION,
    envFiles: ['.env.example'],
  },
  {
    name: 'pg-ssl-turbo-prisma',
    args: [...TURBO_APPS, '--orm', 'prisma'],
    client: 'packages/db/src/index.ts',
    clientConfig: PRISMA_TLS_IN_PRODUCTION,
    envFiles: ['packages/db/.env.example', 'apps/web/.env.example', 'apps/start/.env.example', 'apps/api/.env.example'],
  },
];

describe.each(TOPOLOGIES)('$name', ({ name, args, client, clientConfig, envFiles }) => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generate(name, [...args, '--database', 'postgres']);
  });

  test('the client turns TLS on in production unless DATABASE_URL sets sslmode', async () => {
    expect(await readTextFile(join(projectDir, client))).toContain(clientConfig);
  });

  test('the local DATABASE_URL disables TLS for the Docker database', async () => {
    for (const envFile of envFiles) {
      expect(await readTextFile(join(projectDir, envFile)), envFile).toMatch(LOCAL_URL_WITHOUT_TLS);
    }
  });

  test('AGENTS.md explains TLS in production and the local sslmode=disable', async () => {
    const agents = await readTextFile(join(projectDir, 'AGENTS.md'));
    expect(agents).toContain('`NODE_ENV=production`');
    expect(agents).toContain('`?sslmode=disable`');
    expect(agents).toContain('Never copy the local `DATABASE_URL` to production');
  });
});

describe('postgres without an ORM', () => {
  test('the local DATABASE_URL disables TLS for the Docker database', async () => {
    const projectDir = await generate('pg-ssl-no-orm', ['--app', 'pg-ssl-no-orm:nextjs', '--database', 'postgres']);
    expect(await readTextFile(join(projectDir, '.env.example'))).toMatch(LOCAL_URL_WITHOUT_TLS);
  });
});

describe('postgres through Hyperdrive', () => {
  test('the Worker client keeps the binding connection string alone', async () => {
    const projectDir = await generate('pg-ssl-hyperdrive', [
      '--app',
      'web:nextjs',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]);
    const index = await readTextFile(join(projectDir, 'src/lib/db/index.ts'));
    expect(index).toContain('new Client({ connectionString: hyperdrive.connectionString })');
    expect(index).not.toContain('ssl');
    expect(await readTextFile(join(projectDir, '.env.example'))).toMatch(LOCAL_URL_WITHOUT_TLS);
  });
});

describe('postgres blueprints', () => {
  const postgresBlueprints = Object.entries(META.blueprints)
    .filter(([, blueprint]) => blueprint.context.project.database === 'postgres')
    .map(([blueprint, { context }]) => ({
      blueprint,
      client: context.apps.length > 1 ? 'packages/db/src/index.ts' : 'src/lib/db/index.ts',
    }));

  test('every postgres blueprint is covered', () => {
    expect(postgresBlueprints.map(({ blueprint }) => blueprint).sort()).toEqual([
      'dapp-privy',
      'dapp-rainbowkit',
      'multitenant-saas',
      'org-dashboard',
    ]);
  });

  test.each(postgresBlueprints)('$blueprint: the drizzle client turns TLS on in production', async ({
    blueprint,
    client,
  }) => {
    const projectDir = await generate(`pg-ssl-${blueprint}`, ['--blueprint', blueprint]);
    expect(await readTextFile(join(projectDir, client))).toContain(DRIZZLE_TLS_IN_PRODUCTION);
  });
});
