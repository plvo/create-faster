import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface TurboConfig {
  tasks: Record<string, { env?: string[] }>;
}

describe('turbo.json declares the variables a seed reads', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function readSeedEnv(name: string, args: string[]): Promise<string[] | undefined> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return (await readJsonFile<TurboConfig>(join(tempDir, name, 'turbo.json'))).tasks['db:seed']?.env;
  }

  test('a turborepo with an ORM declares the database URL', async () => {
    const env = await readSeedEnv('seed-env-orm', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    expect(env).toEqual(['DATABASE_URL']);
  });

  test('a blueprint seed that reads its demo password declares it too', async () => {
    const env = await readSeedEnv('seed-env-blueprint', ['--blueprint', 'org-dashboard-nextjs']);
    expect(env).toEqual(['SEED_PASSWORD', 'DATABASE_URL']);
  });

  test('a D1 blueprint has no database URL to declare', async () => {
    const env = await readSeedEnv('seed-env-d1', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    expect(env).toEqual(['SEED_PASSWORD']);
  });
});
