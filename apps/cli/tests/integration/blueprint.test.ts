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
    const result = await runCli(['test-dashboard', '--blueprint', 'dashboard', '--no-install', '--git'], tempDir);

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
    const result = await runCli(['test-bp-cmd', '--blueprint', 'dashboard', '--no-install', '--no-git'], tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint dashboard');
  });

  test('blueprint page.tsx overrides default Next.js page', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const pageContent = await readTextFile(join(projectPath, 'src/app/page.tsx'));
    expect(pageContent).toContain('redirect');
    expect(pageContent).toContain('/dashboard');
  });
});
