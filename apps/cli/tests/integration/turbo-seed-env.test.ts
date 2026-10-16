import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface TurboConfig {
  tasks: Record<string, { cache?: boolean; env?: string[] }>;
}

describe('turbo.json declares the variables a seed reads', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function readSeedTask(name: string, args: string[]): Promise<TurboConfig['tasks'][string] | undefined> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return (await readJsonFile<TurboConfig>(join(tempDir, name, 'turbo.json'))).tasks['db:seed'];
  }

  test('a turborepo with an ORM declares the database URL', async () => {
    const task = await readSeedTask('seed-env-orm', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    expect(task?.env).toEqual(['DATABASE_URL']);
  });

  test('a blueprint seed declares the variables its META entry names', async () => {
    const task = await readSeedTask('seed-env-blueprint', ['--blueprint', 'org-dashboard-nextjs']);
    expect(new Set(task?.env)).toEqual(new Set(['DATABASE_URL', 'SEED_PASSWORD']));
  });

  test('a D1 blueprint declares no database URL', async () => {
    const task = await readSeedTask('seed-env-d1-blueprint', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    expect(task?.env).toEqual(['SEED_PASSWORD']);
  });

  test('a D1 turborepo without a blueprint has a valid seed task with no env key', async () => {
    const task = await readSeedTask('seed-env-d1', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]);
    expect(task).toEqual({ cache: false });
  });
});
