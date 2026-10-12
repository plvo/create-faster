import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const USERNAME_IDENTIFIER = /(?<!internet\.)\busername\b/;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)])),
  );
  return nested.flat();
}

async function filesNamingUsername(projectPath: string): Promise<string[]> {
  const files = (await listFiles(projectPath)).filter((file) => /\.(ts|tsx|prisma|md)$/.test(file));
  const contents = await Promise.all(files.map((file) => readTextFile(file)));
  return files.filter((_, index) => USERNAME_IDENTIFIER.test(contents[index])).map((file) => file.slice(projectPath.length));
}

describe('better-auth display name is stored in a non-unique name column', () => {
  let tempDir: string;
  let generatedProjects = 0;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(args: string[]): Promise<string> {
    const projectName = `name-col-${generatedProjects++}`;
    const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  const DRIZZLE_NAME_COLUMNS = [
    { database: 'postgres', deployment: undefined, column: "name: varchar('name', { length: 255 }).notNull()," },
    { database: 'mysql', deployment: undefined, column: "name: varchar('name', { length: 255 }).notNull()," },
    { database: 'sqlite', deployment: undefined, column: "name: text('name').notNull()," },
    { database: 'd1', deployment: 'cloudflare', column: "name: text('name').notNull()," },
  ];

  for (const { database, deployment, column } of DRIZZLE_NAME_COLUMNS) {
    test(`drizzle + ${database}: the users name column is not unique and auth maps no name field`, async () => {
      const projectPath = await generate([
        '--app',
        'web:nextjs:better-auth',
        '--database',
        database,
        '--orm',
        'drizzle',
        ...(deployment ? ['--deployment', deployment] : []),
      ]);

      const schema = await readTextFile(join(projectPath, 'src/lib/db/schema.ts'));
      expect(schema).toContain(`  ${column}\n  email:`);
      expect(await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'))).not.toMatch(/\bname:\s*'/);
      expect(await filesNamingUsername(projectPath)).toEqual([]);
    });
  }

  for (const database of ['postgres', 'mysql']) {
    test(`prisma + ${database}: the User name field is not unique and auth maps no name field`, async () => {
      const projectPath = await generate(['--app', 'web:nextjs:better-auth', '--database', database, '--orm', 'prisma']);

      const schema = await readTextFile(join(projectPath, 'prisma/schema.prisma'));
      expect(schema).toMatch(/^ {2}name {6}String\n {2}email/m);
      expect(await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'))).not.toMatch(/\bname:\s*'/);
      expect(await filesNamingUsername(projectPath)).toEqual([]);
    });
  }

  for (const blueprint of ['org-dashboard', 'multitenant-saas', 'dapp-rainbowkit', 'cloudflare-fullstack']) {
    test(`${blueprint} blueprint: no username column or mapping remains`, async () => {
      const projectName = `name-col-${blueprint}`;
      const result = await runCli(
        [projectName, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      expect(await filesNamingUsername(join(tempDir, projectName))).toEqual([]);
    });
  }
});
