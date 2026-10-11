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
  let generatedProjects = 0;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generateAuthProject(database: string, orm: string): Promise<string> {
    const projectName = `ids-${orm}-${database}-${generatedProjects++}`;
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
    return join(tempDir, projectName);
  }

  for (const { database, orm, generatesUuids } of COMBINATIONS) {
    test(`${orm} + ${database}: auth ${generatesUuids ? 'generates uuids' : 'keeps the default id generator'}`, async () => {
      const projectPath = await generateAuthProject(database, orm);

      const auth = await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'));
      if (generatesUuids) {
        expect(auth).toContain(UUID_ID_GENERATOR);
      } else {
        expect(auth).not.toContain('generateId');
      }
    });
  }

  test('turborepo drizzle + postgres: the shared factory generates uuids for the app and tRPC instances', async () => {
    const projectName = `ids-turbo-${generatedProjects++}`;
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:nextjs:better-auth,trpc',
        '--app',
        'api:hono',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const projectPath = join(tempDir, projectName);

    expect(await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'))).toContain(UUID_ID_GENERATOR);
    expect(await readTextFile(join(projectPath, 'apps/web/src/lib/auth/auth.ts'))).toContain(
      "import { createAuth } from '@repo/auth/auth'",
    );
    expect(await readTextFile(join(projectPath, 'packages/api/src/auth.ts'))).toContain(
      "import { createAuth } from '@repo/auth/auth'",
    );
  });

  test('drizzle + postgres: the users id column is a uuid that better-auth ids must satisfy', async () => {
    const projectPath = await generateAuthProject('postgres', 'drizzle');

    const schema = await readTextFile(join(projectPath, 'src/lib/db/schema.ts'));
    expect(schema).toContain("id: uuid('id').defaultRandom().primaryKey()");
    expect(schema).toContain("userId: uuid('user_id')");
  });
});
