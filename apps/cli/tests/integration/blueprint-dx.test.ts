import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface RootPkg {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

const BLUEPRINTS = ['org-dashboard', 'multitenant-saas'] as const;

describe.each(BLUEPRINTS)('Blueprint DX tooling - %s', (blueprint) => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [`test-${blueprint}`, '--blueprint', blueprint, '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, `test-${blueprint}`);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('ships a local-setup orchestrator script', async () => {
    expect(await fileExists(join(projectPath, 'scripts/local-setup.ts'))).toBe(true);

    const setup = await readTextFile(join(projectPath, 'scripts/local-setup.ts'));
    // Copies env files, brings up docker, migrates, then seeds — in order.
    expect(setup).toContain('.env.example');
    expect(setup).toContain('docker');
    expect(setup).toContain('compose');
    expect(setup).toContain('--wait');
    expect(setup).toContain('db:push');
    expect(setup).toContain('db:seed');
  });

  test('exposes local-setup and delegates db:seed to turbo in the root scripts', async () => {
    const pkg = await readJsonFile<RootPkg>(join(projectPath, 'package.json'));
    expect(pkg.scripts['local-setup']).toBeDefined();
    // db:seed delegates to the db package via turbo, like the other db: scripts.
    expect(pkg.scripts['db:seed']).toBe('turbo db:seed');
  });

  test('declares faker for demo fixtures', async () => {
    const pkg = await readJsonFile<RootPkg>(join(projectPath, 'package.json'));
    expect(pkg.devDependencies['@faker-js/faker']).toBeDefined();
  });

  test('seed script is flag-driven and idempotent', async () => {
    const seed = await readTextFile(join(projectPath, 'packages/db/scripts/seed.ts'));

    // Flag parsing via the Node built-in, not hand-rolled.
    expect(seed).toContain('parseArgs');
    expect(seed).toContain('reset');
    expect(seed).toContain('fixtures');

    // Two-tier seeding: minimal core + optional demo fixtures.
    expect(seed).toContain('seedCore');
    expect(seed).toContain('seedFixtures');

    // Demo fixtures are generated with faker.
    expect(seed).toContain('@faker-js/faker');
  });

  test('seed refuses to reset a non-local database without --force', async () => {
    const seed = await readTextFile(join(projectPath, 'packages/db/scripts/seed.ts'));
    expect(seed).toContain('DATABASE_URL');
    expect(seed).toContain('force');
    expect(seed.toLowerCase()).toContain('local');
  });
});
