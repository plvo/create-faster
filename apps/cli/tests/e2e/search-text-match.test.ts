import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { integer, pgTable, varchar as pgVarchar } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';
import { evaluateGeneratedModule } from '../integration/helpers';
import { cleanupTempDir, createTempDir } from './helpers';
import { type DatabaseContainer, describeWithDocker, removeDatabase, startDatabase } from './docker-database';

const TIMEOUT_DATABASE = 180_000;

interface Row {
  id: number;
  name: string | null;
}

// Rows chosen so that a LIKE, a regular expression or a collation reads one of them wrongly.
const ROWS: Row[] = [
  { id: 1, name: 'Ada Lovelace' },
  { id: 2, name: 'ADA the Great' },
  { id: 3, name: '100% sure' },
  { id: 4, name: '100 sure' },
  { id: 5, name: 'snake_case' },
  { id: 6, name: 'snakeXcase' },
  { id: 7, name: 'Café Noir' },
  { id: 8, name: 'Cafe Noir' },
  { id: 9, name: "O'Brien \\ Sons" },
  { id: 10, name: 'a.b' },
  { id: 11, name: 'axb' },
  { id: 12, name: null },
];

// What the text must find, the same on every database.
const CASES: [text: string, ids: number[]][] = [
  ['ada', [1, 2]],
  ['ADA', [1, 2]],
  ['lovelace', [1]],
  ['great', [2]],
  ['%', [3]],
  ['0%', [3]],
  ['%%', []],
  ['_', [5]],
  ['e_c', [5]],
  ['__', []],
  ['café', [7]],
  ['cafe', [8]],
  ['é', [7]],
  ["o'brien", [9]],
  ['\\', [9]],
  ['n \\ s', [9]],
  ['a.b', [10]],
  ['a.*', []],
  ['a%b', []],
  ['nothing like this', []],
];

const postgresContext: TemplateContext = {
  projectName: 'my-project',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
  project: { database: 'postgres', tooling: [] },
  git: false,
};

describeWithDocker('search text match')('containsText on a real Postgres', () => {
  let tempDir: string;
  let database: DatabaseContainer | undefined;
  let pool: Pool | undefined;
  let matching: (text: string) => Promise<number[]>;

  // The generated text-match module of the project, over the SQL builder of Drizzle.
  const generatedContainsText = async (): Promise<(column: unknown, text: string) => unknown> => {
    setupTemplateEngine();
    const source = renderTemplate('{{> search/text-match}}', { ...postgresContext, ...postgresContext.apps[0] });
    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'db.mjs'), `export * from '${Bun.resolveSync('drizzle-orm', import.meta.dir)}';`);
    const module = await evaluateGeneratedModule<{ containsText: (column: unknown, text: string) => unknown }>(
      source,
      join(stubs, 'text-match.mjs'),
      { '@repo/db': './db.mjs' },
    );
    return module.containsText;
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    database = await startDatabase('postgres', 'search-text-match-postgres');
    pool = new Pool({ connectionString: database.connectionString });
    const db = drizzlePostgres(pool);
    const table = pgTable('things', { id: integer('id').primaryKey(), name: pgVarchar('name', { length: 255 }) });
    await pool.query('CREATE TABLE things (id integer PRIMARY KEY, name varchar(255))');
    await db.insert(table).values(ROWS);
    const containsText = await generatedContainsText();
    matching = async (text) =>
      (await db.select({ id: table.id }).from(table).where(containsText(table.name, text) as never).orderBy(table.id)).map(
        (row) => row.id,
      );
  }, TIMEOUT_DATABASE);

  afterAll(async () => {
    await pool?.end();
    if (database) await removeDatabase(database.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test.each(CASES)('"%s" finds the rows %p', async (text, ids) => {
    expect(await matching(text)).toEqual(ids);
  });
});
