import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SERVER_DRIVER_PACKAGES = ['pg', '@types/pg', 'mysql2', 'mariadb', '@prisma/adapter-pg', '@prisma/adapter-mariadb'];

function expectNoServerDriverDeps(pkg: PackageJson): void {
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const dep of SERVER_DRIVER_PACKAGES) {
    expect(allDeps[dep], `${dep} must not be present with sqlite`).toBeUndefined();
  }
}

describe('SQLite database option', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('rejects --database sqlite --orm prisma with a clear message', async () => {
    const result = await runCli(
      ['sqlite-prisma', '--app', 'web:nextjs', '--database', 'sqlite', '--orm', 'prisma', '--no-git', '--no-install'],
      tempDir,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("orm 'prisma'");
    expect(result.stderr).toContain('database: postgres or mysql');
  });

  test('generates single repo with sqlite + drizzle', async () => {
    const result = await runCli(
      [
        'sqlite-single',
        '--app',
        'sqlite-single:nextjs',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
        '--no-git',
        '--no-install',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const projectDir = join(tempDir, 'sqlite-single');

    const config = await readTextFile(join(projectDir, 'drizzle.config.ts'));
    expect(config).toContain("dialect: 'sqlite'");
    expect(config).not.toContain('postgresql');

    const schema = await readTextFile(join(projectDir, 'src/lib/db/schema.ts'));
    expect(schema).toContain('sqliteTable');
    expect(schema).toContain("from 'drizzle-orm/sqlite-core'");
    expect(schema).not.toContain('pgTable');
    expect(schema).not.toContain('mysqlTable');

    const client = await readTextFile(join(projectDir, 'src/lib/db/index.ts'));
    expect(client).toContain("from 'drizzle-orm/libsql'");
    expect(client).not.toContain('bun-sqlite');

    const env = await readTextFile(join(projectDir, '.env.example'));
    expect(env).toContain('DATABASE_URL="file:./db.sqlite"');

    expect(await fileExists(join(projectDir, 'docker-compose.yml'))).toBe(false);

    const gitignore = await readTextFile(join(projectDir, '.gitignore'));
    expect(gitignore).toContain('*.sqlite');

    expectNoServerDriverDeps(await readJsonFile<PackageJson>(join(projectDir, 'package.json')));

    const seed = await readTextFile(join(projectDir, 'scripts/seed.ts'));
    expect(seed).toContain("import { db, postTable, userTable }");
    expect(seed).toContain("from '../src/lib/db'");
    expect(seed).not.toContain("bun:sqlite");
  });

  test('generates turborepo with sqlite + drizzle', async () => {
    const result = await runCli(
      [
        'sqlite-turbo',
        '--app',
        'web:nextjs',
        '--app',
        'api:hono',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
        '--no-git',
        '--no-install',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const projectDir = join(tempDir, 'sqlite-turbo');

    const config = await readTextFile(join(projectDir, 'packages/db/drizzle.config.ts'));
    expect(config).toContain("dialect: 'sqlite'");

    const schema = await readTextFile(join(projectDir, 'packages/db/src/schema.ts'));
    expect(schema).toContain('sqliteTable');

    const env = await readTextFile(join(projectDir, 'packages/db/.env.example'));
    expect(env).toContain('DATABASE_URL="file:./db.sqlite"');

    expect(await fileExists(join(projectDir, 'docker-compose.yml'))).toBe(false);

    expectNoServerDriverDeps(await readJsonFile<PackageJson>(join(projectDir, 'packages/db/package.json')));
    expectNoServerDriverDeps(await readJsonFile<PackageJson>(join(projectDir, 'apps/web/package.json')));
    expectNoServerDriverDeps(await readJsonFile<PackageJson>(join(projectDir, 'package.json')));
  });

  test('turborepo root exposes the db workflow', async () => {
    const projectDir = join(tempDir, 'sqlite-turbo');
    const pkg = await readJsonFile<PackageJson & { scripts: Record<string, string> }>(
      join(projectDir, 'package.json'),
    );

    expect(pkg.dependencies?.['@repo/db']).toBe('*');
    expect(pkg.scripts['db:push']).toBe('turbo db:push');
    expect(pkg.scripts['db:seed']).toContain('scripts/seed.ts');
    expect(pkg.scripts['db:seed']).toContain('--env-file=packages/db/.env');
  });
});
