import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;

const LOCAL_D1_DIR = '.wrangler/v3/d1/miniflare-D1DatabaseObject';

async function generateInstalledProject(name: string, flags: string[]): Promise<string> {
  const tempDir = await createTempDir();
  const result = await runCli([name, ...flags, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode).toBe(0);

  const projectDir = join(tempDir, name);
  const install = await runCommand(['bun', 'install'], projectDir);
  expect(install.exitCode).toBe(0);
  return projectDir;
}

function countRows(projectDir: string, table: string): number {
  const dir = join(projectDir, LOCAL_D1_DIR);
  const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  expect(file, `no local D1 sqlite file under ${dir}`).toBeDefined();
  const db = new Database(join(dir, file ?? ''), { readonly: true });
  try {
    return (db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  } finally {
    db.close();
  }
}

const D1_FLAGS = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];

const D1_PROJECTS = [
  { name: 'd1-seed-hono', appFlags: ['--app', 'api:hono'], seedDirs: ['.'], localSetupDir: '.' },
  { name: 'd1-seed-nextjs', appFlags: ['--app', 'web:nextjs'], seedDirs: ['.'], localSetupDir: '.' },
  {
    name: 'd1-seed-turbo',
    appFlags: ['--app', 'api:hono', '--app', 'web:nextjs'],
    seedDirs: ['.', 'packages/db'],
    localSetupDir: 'packages/db',
  },
];

describe.each(D1_PROJECTS)('$name: db:seed reads the database that db:migrate writes', ({
  name,
  appFlags,
  seedDirs,
  localSetupDir,
}) => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generateInstalledProject(name, [...appFlags, ...D1_FLAGS]);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'db:seed fills the migrated local database',
    async () => {
      const generate = await runCommand(['bun', 'run', 'db:generate'], projectDir);
      expect(generate.exitCode, generate.stderr).toBe(0);
      const migrate = await runCommand(['bun', 'run', 'db:migrate'], projectDir);
      expect(migrate.exitCode, migrate.stderr).toBe(0);

      for (const dir of seedDirs) {
        const seed = await runCommand(['bun', 'run', 'db:seed'], join(projectDir, dir));
        expect(seed.exitCode, `${dir}\n${seed.stdout}\n${seed.stderr}`).toBe(0);
        expect(countRows(projectDir, 'users')).toBe(2);
        expect(countRows(projectDir, 'posts')).toBe(3);
      }
    },
    TIMEOUT_DB * 2,
  );

  test(
    'local-setup migrates and seeds in one go',
    async () => {
      const result = await runCommand(['bun', 'run', 'local-setup'], join(projectDir, localSetupDir));
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(countRows(projectDir, 'users')).toBe(2);
    },
    TIMEOUT_DB,
  );
});

const UNREACHABLE_DATABASE_URL = 'postgres://user:pass@127.0.0.1:1/db';

const POSTGRES_ORMS = [
  { orm: 'drizzle', ormFlags: ['--deployment', 'cloudflare'], unreachable: 'ECONNREFUSED', prepare: [] as string[] },
  { orm: 'prisma', ormFlags: [] as string[], unreachable: 'reach database server', prepare: ['bun', 'run', 'db:generate'] },
];

describe.each(POSTGRES_ORMS)('postgres turborepo ($orm): the seed resolves its imports without a root drizzle-orm', ({
  orm,
  ormFlags,
  unreachable,
  prepare,
}) => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generateInstalledProject(`pg-seed-turbo-${orm}`, [
      '--app',
      'api:hono',
      '--app',
      'web:nextjs',
      '--database',
      'postgres',
      '--orm',
      orm,
      ...ormFlags,
    ]);
    const dbDir = join(projectDir, 'packages/db');
    await writeFile(join(dbDir, '.env'), `DATABASE_URL="${UNREACHABLE_DATABASE_URL}"\n`);
    if (prepare.length > 0) {
      const prepared = await runCommand(prepare, dbDir);
      expect(prepared.exitCode, prepared.stderr).toBe(0);
    }
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'db:seed fails on the database connection, not on module resolution, from the root and from packages/db',
    async () => {
      for (const dir of ['.', 'packages/db']) {
        const result = await runCommand(['bun', 'run', 'db:seed'], join(projectDir, dir));
        const output = `${result.stdout}\n${result.stderr}`;
        expect(result.exitCode).not.toBe(0);
        expect(output).not.toContain('Cannot find module');
        expect(output).toContain(unreachable);
      }
    },
    TIMEOUT_DB,
  );
});
