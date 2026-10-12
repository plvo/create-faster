import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const CREDENTIALS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];

async function collectExampleFiles(root: string, dir = ''): Promise<string[]> {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectExampleFiles(root, path);
      return entry.name.startsWith('.env') && entry.name.endsWith('.example') ? [path] : [];
    }),
  );
  return nested.flat();
}

async function envFilesDeclaring(root: string, variable: string): Promise<string[]> {
  const declaring: string[] = [];
  for (const file of await collectExampleFiles(root)) {
    if ((await readTextFile(join(root, file))).includes(`${variable}=`)) declaring.push(file);
  }
  return declaring.sort();
}

describe.each([
  {
    name: 'turborepo',
    args: ['--app', 'web:tanstack-start:better-auth,trpc', '--app', 'worker:hono'],
    credentialsFile: 'packages/db/.env.d1.example',
    drizzleConfig: 'packages/db/drizzle.config.ts',
    migrateScriptOwner: 'packages/db/package.json',
  },
  {
    name: 'single repo',
    args: ['--app', 'web:nextjs'],
    credentialsFile: '.env.d1.example',
    drizzleConfig: 'drizzle.config.ts',
    migrateScriptOwner: 'package.json',
  },
])('$name with d1 and drizzle on cloudflare', ({ args, credentialsFile, drizzleConfig, migrateScriptOwner }) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    const result = await runCli(
      ['proj', ...args, '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      dir,
    );
    expect(result.exitCode).toBe(0);
    project = join(dir, 'proj');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test.each(CREDENTIALS)('%s is declared only in the credentials file, never in a .env wrangler or the framework loads', async (variable) => {
    expect(await envFilesDeclaring(project, variable)).toEqual([credentialsFile]);
  });

  test('drizzle-kit reads the credentials file', async () => {
    expect(await readTextFile(join(project, drizzleConfig))).toContain("'.env.d1'");
  });

  test('the remote migration hands the credentials file to wrangler', async () => {
    const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(project, migrateScriptOwner));
    expect(pkg.scripts['db:migrate:remote']).toContain('--env-file .env.d1');
  });

  test('the credentials file is git-ignored', async () => {
    expect(await readTextFile(join(project, '.gitignore'))).toMatch(/^\.env\.d1$/m);
  });

  test('README names the credentials file', async () => {
    expect(await readTextFile(join(project, 'README.md'))).toContain('### `' + credentialsFile.replace('.example', '') + '`');
  });
});

describe.each([
  { name: 'turborepo', args: ['--app', 'web:tanstack-start', '--app', 'worker:hono'] },
  { name: 'single repo', args: ['--app', 'web:nextjs'] },
])('$name with hyperdrive postgres on cloudflare', ({ args }) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    dir = await createTempDir();
    const result = await runCli(
      ['proj', ...args, '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      dir,
    );
    expect(result.exitCode).toBe(0);
    project = join(dir, 'proj');
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test.each(CREDENTIALS)('%s is declared nowhere', async (variable) => {
    expect(await envFilesDeclaring(project, variable)).toEqual([]);
  });

  test('has no D1 credentials file', async () => {
    expect(await fileExists(join(project, '.env.d1.example'))).toBe(false);
    expect(await fileExists(join(project, 'packages', 'db', '.env.d1.example'))).toBe(false);
  });
});
