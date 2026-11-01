import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { int as mysqlInt, mysqlTable, varchar as mysqlVarchar } from 'drizzle-orm/mysql-core';
import { integer, pgTable, varchar as pgVarchar } from 'drizzle-orm/pg-core';
import { createPool } from 'mysql2/promise';
import { Pool } from 'pg';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';
import { evaluateGeneratedModule } from '../integration/helpers';
import { cleanupTempDir, createTempDir } from './helpers';
import { type DatabaseContainer, type DatabaseEngine, describeWithDocker, removeDatabase, startDatabase } from './docker-database';

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

interface Probe {
  matching: (text: string) => Promise<number[]>;
  close: () => Promise<void>;
}

const hostContext = (database: DatabaseEngine): TemplateContext => ({
  projectName: 'my-project',
  repo: 'turborepo',
  apps: [{ appName: 'web', stackName: 'nextjs', libraries: [] }],
  project: { database, tooling: [] },
  git: false,
});

describeWithDocker('search text match')('containsText on a real database', () => {
  let tempDir: string;
  const databases: Partial<Record<DatabaseEngine, DatabaseContainer>> = {};
  const probes: Partial<Record<DatabaseEngine, Probe>> = {};

  // The generated text-match module of the dialect, over the SQL builder of Drizzle.
  const containsTextFor = async (engine: DatabaseEngine): Promise<(column: unknown, text: string) => unknown> => {
    setupTemplateEngine();
    const context = hostContext(engine);
    const source = renderTemplate('{{> search/text-match}}', { ...context, ...context.apps[0] });
    const stubs = join(tempDir, engine);
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'db.mjs'), `export * from '${Bun.resolveSync('drizzle-orm', import.meta.dir)}';`);
    const module = await evaluateGeneratedModule<{ containsText: (column: unknown, text: string) => unknown }>(
      source,
      join(stubs, 'text-match.mjs'),
      { '@repo/db': './db.mjs' },
    );
    return module.containsText;
  };

  const postgresProbe = async (url: string): Promise<Probe> => {
    const pool = new Pool({ connectionString: url });
    const db = drizzlePostgres(pool);
    const table = pgTable('things', { id: integer('id').primaryKey(), name: pgVarchar('name', { length: 255 }) });
    await pool.query('CREATE TABLE things (id integer PRIMARY KEY, name varchar(255))');
    await db.insert(table).values(ROWS);
    const containsText = await containsTextFor('postgres');
    return {
      matching: async (text) =>
        (await db.select({ id: table.id }).from(table).where(containsText(table.name, text) as never).orderBy(table.id)).map((row) => row.id),
      close: () => pool.end(),
    };
  };

  const mysqlProbe = async (url: string): Promise<Probe> => {
    const pool = createPool(url);
    const db = drizzleMysql(pool, { mode: 'default' });
    const table = mysqlTable('things', { id: mysqlInt('id').primaryKey(), name: mysqlVarchar('name', { length: 255 }) });
    await pool.query('CREATE TABLE things (id int PRIMARY KEY, name varchar(255))');
    await db.insert(table).values(ROWS);
    const containsText = await containsTextFor('mysql');
    return {
      matching: async (text) =>
        (await db.select({ id: table.id }).from(table).where(containsText(table.name, text) as never).orderBy(table.id)).map((row) => row.id),
      close: () => pool.end(),
    };
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const [postgres, mysql] = await Promise.all([
      startDatabase('postgres', 'search-text-match-postgres'),
      startDatabase('mysql', 'search-text-match-mysql'),
    ]);
    databases.postgres = postgres;
    databases.mysql = mysql;
    probes.postgres = await postgresProbe(postgres.connectionString);
    probes.mysql = await mysqlProbe(mysql.connectionString);
  }, TIMEOUT_DATABASE);

  afterAll(async () => {
    await Promise.all(Object.values(probes).map((probe) => probe.close()));
    await Promise.all(Object.values(databases).map((database) => removeDatabase(database.name)));
    if (tempDir) await cleanupTempDir(tempDir);
  });

  describe.each(['postgres', 'mysql'] as const)('%s', (engine) => {
    test.each(CASES)('"%s" finds the rows %p', async (text, ids) => {
      const probe = probes[engine];
      if (!probe) throw new Error(`${engine} is not there`);
      expect(await probe.matching(text)).toEqual(ids);
    });
  });
});
