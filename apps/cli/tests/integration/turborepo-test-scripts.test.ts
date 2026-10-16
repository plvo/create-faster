import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

interface TurboTask {
  dependsOn?: string[];
  cache?: boolean;
}

async function generateTurborepo(tempDir: string, name: string, args: string[]) {
  const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode).toBe(0);
  const projectPath = join(tempDir, name);
  const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
  const turbo = await readJsonFile<{ tasks: Record<string, TurboTask> }>(join(projectPath, 'turbo.json'));
  return { scripts: pkg.scripts, tasks: turbo.tasks };
}

describe('Turborepo root test scripts', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('test runs every app suite through turbo once an app declares test', async () => {
    const { scripts, tasks } = await generateTurborepo(tempDir, 'test-both', [
      '--app',
      'web:nextjs:vitest',
      '--app',
      'docs:tanstack-start:vitest',
    ]);
    expect(scripts.test).toBe('turbo test');
    expect(tasks.test?.dependsOn).toEqual(['^build']);
    expect(scripts['test:e2e']).toBeUndefined();
    expect(tasks['test:e2e']).toBeUndefined();
  });

  test('test:e2e is an uncached turbo task when an app declares it', async () => {
    const { scripts, tasks } = await generateTurborepo(tempDir, 'test-e2e', [
      '--app',
      'web:nextjs:playwright',
      '--app',
      'api:hono',
    ]);
    expect(scripts['test:e2e']).toBe('turbo test:e2e');
    expect(tasks['test:e2e']?.cache).toBe(false);
    expect(scripts.test).toBeUndefined();
    expect(tasks.test).toBeUndefined();
  });

  test('no test script or task when no app declares one', async () => {
    const { scripts, tasks } = await generateTurborepo(tempDir, 'test-none', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
    ]);
    expect(scripts.test).toBeUndefined();
    expect(tasks.test).toBeUndefined();
  });
});
