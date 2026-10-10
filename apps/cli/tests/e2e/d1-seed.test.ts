import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;

const LOCAL_D1_DIR = '.wrangler/v3/d1/miniflare-D1DatabaseObject';

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

interface D1SeedProject {
  name: string;
  appFlags: string[];
  localSetupDir: string;
}

const PROJECTS: D1SeedProject[] = [
  { name: 'd1-seed-hono', appFlags: ['--app', 'api:hono'], localSetupDir: '.' },
  { name: 'd1-seed-nextjs', appFlags: ['--app', 'web:nextjs'], localSetupDir: '.' },
  {
    name: 'd1-seed-turbo',
    appFlags: ['--app', 'api:hono', '--app', 'web:nextjs'],
    localSetupDir: 'packages/db',
  },
];

for (const { name, appFlags, localSetupDir } of PROJECTS) {
  describe(`${name}: db:seed reads the database that db:migrate writes`, () => {
    let projectDir: string;
    let installResult: CommandResult;

    beforeAll(async () => {
      const tempDir = await createTempDir();
      const result = await runCli(
        [
          name,
          ...appFlags,
          '--database',
          'd1',
          '--orm',
          'drizzle',
          '--deployment',
          'cloudflare',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      projectDir = join(tempDir, name);
      installResult = await runCommand(['bun', 'install'], projectDir);
    }, TIMEOUT_INSTALL + 30_000);

    afterAll(async () => {
      if (projectDir) await cleanupTempDir(join(projectDir, '..'));
    });

    test(
      'installs dependencies',
      () => {
        expect(installResult.exitCode).toBe(0);
      },
      TIMEOUT_INSTALL,
    );

    test(
      'db:seed fills the migrated local database',
      async () => {
        const generate = await runCommand(['bun', 'run', 'db:generate'], projectDir);
        expect(generate.exitCode, generate.stderr).toBe(0);
        const migrate = await runCommand(['bun', 'run', 'db:migrate'], projectDir);
        expect(migrate.exitCode, migrate.stderr).toBe(0);

        const seed = await runCommand(['bun', 'run', 'db:seed'], projectDir);
        expect(seed.exitCode, `${seed.stdout}\n${seed.stderr}`).toBe(0);

        expect(countRows(projectDir, 'users')).toBe(2);
        expect(countRows(projectDir, 'posts')).toBe(3);
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
}

describe('d1-seed-turbo-db-package: the seed also runs from inside the db package', () => {
  let projectDir: string;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'd1-seed-turbo-db',
        '--app',
        'api:hono',
        '--app',
        'web:nextjs',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, 'd1-seed-turbo-db');
    const install = await runCommand(['bun', 'install'], projectDir);
    expect(install.exitCode).toBe(0);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'bun run db:seed from packages/db seeds the migrated database',
    async () => {
      const dbDir = join(projectDir, 'packages/db');
      expect((await runCommand(['bun', 'run', 'db:generate'], dbDir)).exitCode).toBe(0);
      expect((await runCommand(['bun', 'run', 'db:migrate'], dbDir)).exitCode).toBe(0);
      const seed = await runCommand(['bun', 'run', 'db:seed'], dbDir);
      expect(seed.exitCode, `${seed.stdout}\n${seed.stderr}`).toBe(0);
      expect(countRows(projectDir, 'users')).toBe(2);
    },
    TIMEOUT_DB * 2,
  );
});

const UNREACHABLE_DATABASE_URL = 'postgres://user:pass@127.0.0.1:1/db';

const POSTGRES_ORMS = [
  { orm: 'drizzle', deployment: ['--deployment', 'cloudflare'], unreachable: 'ECONNREFUSED', prepare: [] as string[] },
  { orm: 'prisma', deployment: [] as string[], unreachable: 'reach database server', prepare: ['bun', 'run', 'db:generate'] },
];

describe.each(POSTGRES_ORMS)('postgres turborepo ($orm): the seed resolves its imports without a root drizzle-orm', ({
  orm,
  deployment,
  unreachable,
  prepare,
}) => {
  const name = `pg-seed-turbo-${orm}`;
  let projectDir: string;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        name,
        '--app',
        'api:hono',
        '--app',
        'web:nextjs',
        '--database',
        'postgres',
        '--orm',
        orm,
        ...deployment,
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, name);
    const install = await runCommand(['bun', 'install'], projectDir);
    expect(install.exitCode).toBe(0);
    await writeFile(join(projectDir, 'packages/db/.env'), `DATABASE_URL="${UNREACHABLE_DATABASE_URL}"\n`);
    if (prepare.length > 0) {
      const prepared = await runCommand(prepare, join(projectDir, 'packages/db'));
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
