import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

// Columns the better-auth admin plugin writes: better-auth fails every request with SCHEMA_MISMATCH
// when the Drizzle schema lacks one of them.
const ADMIN_USER_COLUMNS = ['role: ', 'banned: ', 'banReason: ', 'banExpires: '];
const ADMIN_SESSION_COLUMN = 'impersonatedBy: ';

const ADMIN_BLUEPRINTS = ['org-dashboard', 'cloudflare-fullstack'];

describe('blueprints with the better-auth admin plugin carry its schema columns', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(ADMIN_BLUEPRINTS)('%s', async (blueprint) => {
    const projectName = `admin-schema-${blueprint}`;
    const result = await runCli([projectName, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    const schema = await readTextFile(join(tempDir, projectName, 'packages/db/src/schema.ts'));
    const [userTable, sessionTable] = [
      schema.slice(schema.indexOf("Table('users'")),
      schema.slice(schema.indexOf("Table('user_sessions'")),
    ].map((fromTable) => fromTable.slice(0, fromTable.indexOf('});')));

    for (const column of ADMIN_USER_COLUMNS) expect(userTable).toContain(column);
    expect(sessionTable).toContain(ADMIN_SESSION_COLUMN);
  });
});
