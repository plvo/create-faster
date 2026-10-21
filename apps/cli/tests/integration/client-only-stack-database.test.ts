import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const MOBILE_FIRST = ['--app', 'mobile:expo', '--app', 'web:nextjs', '--app', 'api:hono'];

async function dependenciesOf(project: string, appName: string): Promise<string[]> {
  const manifest = await readJsonFile<Manifest>(join(project, 'apps', appName, 'package.json'));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
}

describe.each([
  { database: 'postgres', orm: 'drizzle' },
  { database: 'postgres', orm: 'prisma' },
  { database: 'mysql', orm: 'drizzle' },
  { database: 'sqlite', orm: 'drizzle' },
])('turborepo with an Expo app first, $database and $orm', ({ database, orm }) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    const result = await runCli(
      ['mono', ...MOBILE_FIRST, '--database', database, '--orm', orm, '--no-git', '--no-install'],
      dir,
    );
    expect(result.exitCode).toBe(0);
    project = join(dir, 'mono');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('the Expo app does not depend on the db package, the server apps do', async () => {
    expect(await dependenciesOf(project, 'mobile')).not.toContain('@repo/db');
    expect(await dependenciesOf(project, 'web')).toContain('@repo/db');
    expect(await dependenciesOf(project, 'api')).toContain('@repo/db');
  });

  test('the Expo app has no env file, the server apps and the db package keep DATABASE_URL', async () => {
    expect(await fileExists(join(project, 'apps', 'mobile', '.env.example'))).toBe(false);
    for (const path of [join('apps', 'web'), join('apps', 'api'), join('packages', 'db')]) {
      expect(await readTextFile(join(project, path, '.env.example')), path).toMatch(/^DATABASE_URL=/m);
    }
  });

  test('the README and AGENTS.md do not give the Expo app the database', async () => {
    const readme = await readTextFile(join(project, 'README.md'));
    const agents = await readTextFile(join(project, 'AGENTS.md'));

    expect(readme).toContain('### `packages/db`');
    expect(agents).not.toContain('apps/mobile/.env');
    expect(agents).toContain('apps/web/.env');
    expect(agents).toContain('packages/db/.env');
  });

  test('the db tasks keep the variable the seed reads', async () => {
    const turbo = await readJsonFile<{ tasks: Record<string, { env?: string[] }> }>(join(project, 'turbo.json'));

    expect(turbo.tasks['db:seed']?.env).toContain('DATABASE_URL');
  });
});

describe('turborepo with an Expo app first, d1 and drizzle', () => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    const result = await runCli(
      ['mono', ...MOBILE_FIRST.slice(0, 4), '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install'],
      dir,
    );
    expect(result.exitCode).toBe(0);
    project = join(dir, 'mono');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('the Expo app does not depend on the db package, the Worker app does', async () => {
    expect(await dependenciesOf(project, 'mobile')).not.toContain('@repo/db');
    expect(await dependenciesOf(project, 'web')).toContain('@repo/db');
  });
});

describe('single repo with an Expo app and a database', () => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    const result = await runCli(
      ['mobile', '--app', 'mobile:expo', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install'],
      dir,
    );
    expect(result.exitCode).toBe(0);
    project = join(dir, 'mobile');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('the only app owns the database tooling, with its variable', async () => {
    const manifest = await readJsonFile<Manifest>(join(project, 'package.json'));

    expect(Object.keys(manifest.dependencies ?? {})).toEqual(expect.arrayContaining(['drizzle-orm', 'pg']));
    expect(await readTextFile(join(project, '.env.example'))).toMatch(/^DATABASE_URL=/m);
  });
});
