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

  test('README does not describe packages/db', async () => {
    const readme = await readTextFile(join(project, 'README.md'));
    expect(readme).not.toContain('packages/db');
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
