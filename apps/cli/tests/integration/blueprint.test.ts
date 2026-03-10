import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('Blueprint CLI flag', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('invalid blueprint name produces an error', async () => {
    const result = await runCli(['test-bp', '--blueprint', 'nonexistent', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid blueprint');
  });

  test('--blueprint and --app are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict', '--blueprint', 'dashboard', '--app', 'web:nextjs', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --database are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-db', '--blueprint', 'dashboard', '--database', 'postgres', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --orm are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-orm', '--blueprint', 'dashboard', '--orm', 'drizzle', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint can be combined with --linter', async () => {
    const result = await runCli(
      ['test-bp-linter', '--blueprint', 'dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  test('--blueprint can be combined with --tooling', async () => {
    const result = await runCli(
      [
        'test-bp-tooling',
        '--blueprint',
        'dashboard',
        '--linter',
        'biome',
        '--tooling',
        'husky',
        '--git',
        '--no-install',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
});

describe('Blueprint generation - dashboard', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint dashboard', async () => {
    const result = await runCli(
      ['test-dashboard', '--blueprint', 'dashboard', '--linter', 'biome', '--no-install', '--git'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);

    const projectPath = join(tempDir, 'test-dashboard');

    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
    expect(await fileExists(join(projectPath, '.env.example'))).toBe(true);

    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies.recharts).toBeDefined();
    expect(pkg.dependencies.next).toBeDefined();

    expect(await fileExists(join(projectPath, 'src/app/(dashboard)/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'src/components/sidebar.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'src/components/header.tsx'))).toBe(true);
  });

  test('env file includes blueprint envs', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const envContent = await readTextFile(join(projectPath, '.env.example'));
    expect(envContent).toContain('ADMIN_EMAIL');
  });

  test('output shows --blueprint in recreate command', async () => {
    const result = await runCli(
      ['test-bp-cmd', '--blueprint', 'dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint dashboard');
  });

  test('blueprint with --linter includes linter config', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const pkg = await readJsonFile<{ devDependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
  });

  test('blueprint recreate command includes linter flag', async () => {
    const result = await runCli(
      ['test-bp-linter-cmd', '--blueprint', 'dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint dashboard');
    expect(result.stdout).toContain('--linter biome');
  });

  test('blueprint page.tsx overrides default Next.js page', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const pageContent = await readTextFile(join(projectPath, 'src/app/page.tsx'));
    expect(pageContent).toContain('redirect');
    expect(pageContent).toContain('/dashboard');
  });
});
