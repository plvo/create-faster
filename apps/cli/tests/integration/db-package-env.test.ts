import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

const DATABASES = [
  { database: 'postgres', extraArgs: [] },
  { database: 'mysql', extraArgs: [] },
  { database: 'sqlite', extraArgs: [] },
  { database: 'd1', extraArgs: ['--deployment', 'cloudflare'] },
];

const TURBOREPO_ARGS = ['--app', 'web:nextjs', '--app', 'api:hono', '--no-git', '--no-install'];

describe.each(DATABASES)('turborepo with $database and no ORM', ({ database, extraArgs }) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['mono', ...TURBOREPO_ARGS, '--database', database, ...extraArgs], dir);
    project = join(dir, 'mono');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('has no packages/db, since only an ORM creates that package', async () => {
    expect(await fileExists(join(project, 'packages', 'db'))).toBe(false);
  });

  test('keeps the database variables in each app env file', async () => {
    for (const app of ['web', 'api']) {
      const env = await readTextFile(join(project, 'apps', app, '.env.example'));
      expect(env, `apps/${app}/.env.example`).toMatch(/^(DATABASE_URL|CLOUDFLARE_ACCOUNT_ID)=/m);
    }
  });

  test('README and agent doc do not describe packages/db', async () => {
    expect(await readTextFile(join(project, 'README.md'))).not.toContain('packages/db');
    expect(await readTextFile(join(project, 'AGENTS.md'))).not.toContain('packages/db');
  });
});

describe('turborepo with d1 and no ORM', () => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['mono', ...TURBOREPO_ARGS, '--database', 'd1', '--deployment', 'cloudflare'], dir);
    project = join(dir, 'mono');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('wrangler binding has no migrations_dir pointing at a missing package', async () => {
    const wrangler = await readTextFile(join(project, 'apps', 'web', 'wrangler.jsonc'));
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"database_id": "REPLACE_WITH_D1_DATABASE_ID"\n    }');
    expect(wrangler).not.toContain('migrations_dir');
  });

  test('has no drizzle-kit credentials, which only an ORM consumes', async () => {
    expect(await fileExists(join(project, 'apps', 'web', '.env.example'))).toBe(false);
  });
});

describe.each([
  { name: 'turborepo', args: ['--app', 'web:nextjs', '--app', 'api:hono'], wrangler: 'apps/web/wrangler.jsonc', dir: '../../packages/db/drizzle' },
  { name: 'single repo', args: ['--app', 'web:nextjs'], wrangler: 'wrangler.jsonc', dir: 'drizzle' },
])('$name with d1 and drizzle', ({ args, wrangler, dir: migrationsDir }) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['mono', ...args, '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install'], dir);
    project = join(dir, 'mono');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('keeps the migrations directory of the ORM', async () => {
    expect(await readTextFile(join(project, wrangler))).toContain(`"migrations_dir": "${migrationsDir}"`);
  });

  test('keeps the drizzle-kit credentials', async () => {
    const envPath = join(project, wrangler === 'wrangler.jsonc' ? '.env.example' : 'apps/web/.env.example');
    expect(await readTextFile(envPath)).toContain('CLOUDFLARE_ACCOUNT_ID=');
  });
});

describe.each([{ orm: 'drizzle' }, { orm: 'prisma' }])('turborepo with postgres and $orm', ({ orm }) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['mono', ...TURBOREPO_ARGS, '--database', 'postgres', '--orm', orm], dir);
    project = join(dir, 'mono');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('generates the db package env file', async () => {
    expect(await readTextFile(join(project, 'packages', 'db', '.env.example'))).toContain('DATABASE_URL=');
  });

  test('README describes packages/db', async () => {
    const readme = await readTextFile(join(project, 'README.md'));
    expect(readme).toContain('### `packages/db`');
    expect(readme).toContain(`Uses shared database package (\`packages/db\`) with ${orm} ORM.`);
  });
});
