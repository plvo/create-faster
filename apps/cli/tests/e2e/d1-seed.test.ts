import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
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
