import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const TURBOREPO_APPS = ['--app', 'web:nextjs', '--app', 'api:hono'];

describe('pnpm workspace declaration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[], pm: string): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  test('turborepo with pnpm declares the workspace and links internal packages', async () => {
    const projectPath = await generate('turbo-pnpm', TURBOREPO_APPS, 'pnpm');
    const workspace = await readTextFile(join(projectPath, 'pnpm-workspace.yaml'));
    expect(workspace).toContain('packages:');
    expect(workspace).toContain('  - apps/*');
    expect(workspace).toContain('  - packages/*');
    expect(workspace).toContain('linkWorkspacePackages: true');
  });

  test('turborepo with pnpm keeps internal dependencies on the version range shared with npm and bun', async () => {
    const projectPath = await generate('turbo-pnpm-deps', [...TURBOREPO_APPS, '--database', 'postgres', '--orm', 'drizzle'], 'pnpm');
    const api = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'apps/api/package.json'));
    expect(api.dependencies['@repo/db']).toBe('*');
  });

  test('blueprint turborepo with pnpm declares the workspace', async () => {
    const projectPath = await generate('bp-pnpm', ['--blueprint', 'org-dashboard'], 'pnpm');
    expect(await fileExists(join(projectPath, 'pnpm-workspace.yaml'))).toBe(true);
  });

  test.each(['bun', 'npm'])('turborepo with %s has no pnpm-workspace.yaml', async (pm) => {
    const projectPath = await generate(`turbo-${pm}`, TURBOREPO_APPS, pm);
    expect(await fileExists(join(projectPath, 'pnpm-workspace.yaml'))).toBe(false);
    const rootPackage = await readJsonFile<{ workspaces: string[] }>(join(projectPath, 'package.json'));
    expect(rootPackage.workspaces).toEqual(['apps/*', 'packages/*']);
  });

  test('single repo with pnpm has no pnpm-workspace.yaml', async () => {
    const projectPath = await generate('single-pnpm', ['--app', 'single-pnpm:nextjs'], 'pnpm');
    expect(await fileExists(join(projectPath, 'pnpm-workspace.yaml'))).toBe(false);
  });
});
