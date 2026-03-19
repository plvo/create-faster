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
      ['test-conflict', '--blueprint', 'org-dashboard', '--app', 'web:nextjs', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --database are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-db', '--blueprint', 'org-dashboard', '--database', 'postgres', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint and --orm are mutually exclusive', async () => {
    const result = await runCli(
      ['test-conflict-orm', '--blueprint', 'org-dashboard', '--orm', 'drizzle', '--no-install'],
      tempDir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('cannot be combined');
  });

  test('--blueprint can be combined with --linter', async () => {
    const result = await runCli(
      ['test-bp-linter', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  test('--blueprint can be combined with --tooling', async () => {
    const result = await runCli(
      [
        'test-bp-tooling',
        '--blueprint',
        'org-dashboard',
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

describe('Blueprint generation - org-dashboard', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates project with --blueprint org-dashboard', async () => {
    const result = await runCli(
      ['test-dashboard', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--git'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);

    const projectPath = join(tempDir, 'test-dashboard');

    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/.env.example'))).toBe(true);

    const webPkg = await readJsonFile<{ dependencies: Record<string, string> }>(
      join(projectPath, 'apps/web/package.json'),
    );
    expect(webPkg.dependencies.sonner).toBeDefined();

    expect(await fileExists(join(projectPath, 'apps/web/src/app/(dashboard)/page.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/app-sidebar.tsx'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web/src/components/navigation/app-header.tsx'))).toBe(true);
  });

  test('env file includes better-auth envs', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const envContent = await readTextFile(join(projectPath, 'apps/web/.env.example'));
    expect(envContent).toContain('BETTER_AUTH_SECRET');
  });

  test('output shows --blueprint in recreate command', async () => {
    const result = await runCli(
      ['test-bp-cmd', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint org-dashboard');
  });

  test('blueprint with --linter includes linter config', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const pkg = await readJsonFile<{ devDependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
  });

  test('blueprint recreate command includes linter flag', async () => {
    const result = await runCli(
      ['test-bp-linter-cmd', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--blueprint org-dashboard');
    expect(result.stdout).toContain('--linter biome');
  });

  test('dashboard layout redirects unauthenticated users to login', async () => {
    const projectPath = join(tempDir, 'test-dashboard');
    const layoutContent = await readTextFile(join(projectPath, 'apps/web/src/app/(dashboard)/layout.tsx'));
    expect(layoutContent).toContain('redirect');
    expect(layoutContent).toContain('/login');
  });
});
