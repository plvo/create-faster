import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const DRIZZLE_URL_ONLY_CONNECTION = `connection: {
      connectionString: databaseUrl,
    },`;

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

describe('postgres client TLS follows DATABASE_URL', () => {
  test.each([
    { name: 'pg-ssl-next', args: ['--app', 'pg-ssl-next:nextjs'], client: 'src/lib/db/index.ts' },
    { name: 'pg-ssl-start', args: ['--app', 'pg-ssl-start:tanstack-start'], client: 'src/lib/db/index.ts' },
    {
      name: 'pg-ssl-turbo',
      args: ['--app', 'web:nextjs', '--app', 'start:tanstack-start', '--app', 'api:hono'],
      client: 'packages/db/src/index.ts',
    },
  ])('$name: the drizzle client connects with the URL alone', async ({ name, args, client }) => {
    const projectDir = await generate(name, [...args, '--database', 'postgres', '--orm', 'drizzle']);
    const index = await readTextFile(join(projectDir, client));
    expect(index).toContain(DRIZZLE_URL_ONLY_CONNECTION);
    expect(index).not.toContain('ssl');
    expect(index).not.toContain('NODE_ENV');
  });

  test('the prisma client connects with the URL alone', async () => {
    const projectDir = await generate('pg-ssl-prisma', [
      '--app',
      'pg-ssl-prisma:nextjs',
      '--database',
      'postgres',
      '--orm',
      'prisma',
    ]);
    const index = await readTextFile(join(projectDir, 'src/lib/db/index.ts'));
    expect(index).toContain('new PrismaPg({ connectionString: process.env.DATABASE_URL! })');
    expect(index).not.toContain('ssl');
  });

  test('the Hyperdrive client keeps the binding connection string alone', async () => {
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
  });

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

  test.each(postgresBlueprints)('blueprint $blueprint: the drizzle client connects with the URL alone', async ({
    blueprint,
    client,
  }) => {
    const projectDir = await generate(`pg-ssl-${blueprint}`, ['--blueprint', blueprint]);
    const index = await readTextFile(join(projectDir, client));
    expect(index).toContain(DRIZZLE_URL_ONLY_CONNECTION);
    expect(index).not.toContain('ssl');
  });

  test.each(['drizzle', 'prisma'])('AGENTS.md tells how to turn TLS on with %s', async (orm) => {
    const projectDir = await generate(`pg-ssl-agents-${orm}`, [
      '--app',
      `pg-ssl-agents-${orm}:nextjs`,
      '--database',
      'postgres',
      '--orm',
      orm,
    ]);
    const agents = await readTextFile(join(projectDir, 'AGENTS.md'));
    expect(agents).toContain('`sslmode`');
    expect(agents).toContain('`?sslmode=verify-full`');
    expect(agents).toContain('`NODE_ENV`');
  });
});
