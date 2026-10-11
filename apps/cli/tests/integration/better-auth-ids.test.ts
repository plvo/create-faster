import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const UUID_ID_GENERATOR = 'generateId: () => crypto.randomUUID()';

interface Combination {
  database: string;
  orm: string;
  generatesUuids: boolean;
}

const COMBINATIONS: Combination[] = [
  { database: 'postgres', orm: 'drizzle', generatesUuids: true },
  { database: 'postgres', orm: 'prisma', generatesUuids: true },
  { database: 'mysql', orm: 'drizzle', generatesUuids: false },
  { database: 'sqlite', orm: 'drizzle', generatesUuids: false },
];

describe('better-auth ids match the database id column', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const { database, orm, generatesUuids } of COMBINATIONS) {
    test(`${orm} + ${database}: auth ${generatesUuids ? 'generates uuids' : 'keeps the default id generator'}`, async () => {
      const projectName = `ids-${orm}-${database}`;
      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:better-auth',
          '--database',
          database,
          '--orm',
          orm,
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      const auth = await readTextFile(join(tempDir, projectName, 'src/lib/auth/auth.ts'));
      if (generatesUuids) {
        expect(auth).toContain(UUID_ID_GENERATOR);
      } else {
        expect(auth).not.toContain('generateId');
      }
    });
  }

  test('drizzle + postgres: the users id column is a uuid that better-auth ids must satisfy', async () => {
    const schema = await readTextFile(join(tempDir, 'ids-drizzle-postgres', 'src/lib/db/schema.ts'));
    expect(schema).toContain("id: uuid('id').defaultRandom().primaryKey()");
    expect(schema).toContain("userId: uuid('user_id')");
  });
});
