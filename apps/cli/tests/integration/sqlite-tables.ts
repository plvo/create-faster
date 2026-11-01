import type { Database } from 'bun:sqlite';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';

/** Creates the table of a generated drizzle schema in a SQLite database, with its keys and its unique columns. */
export function createTable(sqlite: Database, table: SQLiteTable): void {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const defaulted = column.name === 'created_at' || column.name === 'updated_at' ? ' DEFAULT (unixepoch())' : '';
    return `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}${defaulted}`;
  });
  for (const key of config.primaryKeys) {
    columns.push(`PRIMARY KEY (${key.columns.map((column) => `"${column.name}"`).join(', ')})`);
  }
  for (const foreignKey of config.foreignKeys) {
    const reference = foreignKey.reference();
    const names = (list: { name: string }[]) => list.map((column) => `"${column.name}"`).join(', ');
    columns.push(
      `FOREIGN KEY (${names(reference.columns)}) REFERENCES "${getTableConfig(reference.foreignTable).name}" (${names(reference.foreignColumns)}) ON DELETE ${(foreignKey.onDelete ?? 'no action').toUpperCase()}`,
    );
  }
  sqlite.run(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  for (const column of config.columns.filter((each) => each.isUnique)) {
    sqlite.run(`CREATE UNIQUE INDEX "${config.name}_${column.name}_unique" ON "${config.name}" ("${column.name}")`);
  }
}
