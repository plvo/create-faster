import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, printedScriptsMissingFrom, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface TurboTask {
  dependsOn?: string[];
}

async function generateTurborepo(tempDir: string, name: string, args: string[], pm = 'bun') {
  const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', pm], tempDir);
  expect(result.exitCode).toBe(0);
  const projectPath = join(tempDir, name);
  const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
  const turbo = await readJsonFile<{ tasks: Record<string, TurboTask> }>(join(projectPath, 'turbo.json'));
  return { projectPath, scripts: pkg.scripts, tasks: turbo.tasks };
}

describe('Turborepo root build', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const noBuildCases: { name: string; args: string[]; tasks?: string[] }[] = [
    { name: 'expo-only', args: ['--app', 'a:expo', '--app', 'b:expo'] },
    { name: 'hono-bun-only', args: ['--app', 'api:hono', '--app', 'worker:hono'] },
    {
      name: 'hono-bun-tests',
      args: ['--app', 'api:hono:vitest-node', '--app', 'worker:hono:vitest-node'],
      tasks: ['test'],
    },
    {
      name: 'expo-tests-lint',
      args: ['--app', 'a:expo:jest-expo', '--app', 'b:expo:jest-expo', '--linter', 'eslint'],
      tasks: ['test', 'lint'],
    },
    {
      name: 'hono-bun-drizzle-lint',
      args: ['--app', 'api:hono', '--app', 'worker:hono', '--database', 'sqlite', '--orm', 'drizzle', '--linter', 'eslint'],
      tasks: ['dev', 'start', 'db:push', 'lint'],
    },
    {
      name: 'hono-bun-database',
      args: ['--app', 'api:hono', '--app', 'worker:hono', '--database', 'postgres', '--orm', 'prisma'],
    },
  ];

  for (const { name, args, tasks: otherTasks = [] } of noBuildCases) {
    test(`${name}: no app declares build, so the root has no build script, task or printed step`, async () => {
      const { projectPath, scripts, tasks } = await generateTurborepo(tempDir, name, args);

      expect(scripts).not.toHaveProperty(['build']);
      expect(tasks).not.toHaveProperty(['build']);
      for (const task of otherTasks) expect(tasks).toHaveProperty([task]);
      for (const task of Object.values(tasks)) expect(task.dependsOn ?? []).not.toContain('^build');

      for (const document of ['README.md', 'AGENTS.md']) {
        const text = await readTextFile(join(projectPath, document));
        expect(text).not.toContain('bun run build');
        expect(await printedScriptsMissingFrom(projectPath, text)).toEqual([]);
      }
    });
  }

  test('a turborepo with a Next.js app keeps the root build, its task and the printed step', async () => {
    const { projectPath, scripts, tasks } = await generateTurborepo(tempDir, 'nextjs-hono', [
      '--app',
      'web:nextjs:vitest',
      '--app',
      'api:hono',
    ]);

    expect(scripts.build).toBe('turbo build');
    expect(tasks.build?.dependsOn).toEqual(['^build']);
    expect(tasks.test?.dependsOn).toEqual(['^build']);
    expect(await readTextFile(join(projectPath, 'README.md'))).toContain('`bun run build`');
  });

  test('a turborepo whose only builder is one app keeps the root build', async () => {
    const { scripts, tasks } = await generateTurborepo(tempDir, 'expo-tanstack', [
      '--app',
      'mobile:expo',
      '--app',
      'web:tanstack-start',
    ]);

    expect(scripts.build).toBe('turbo build');
    expect(tasks).toHaveProperty(['build']);
  });

  for (const blueprint of ['lambda-sst-hono', 'lambda-terraform-aws-hono']) {
    test(`${blueprint}: the workflow that runs the root build finds a build script`, async () => {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode).toBe(0);
      const projectPath = join(tempDir, blueprint);
      const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
      const workflow = await readTextFile(join(projectPath, '.github/workflows/deploy.yml'));

      expect(workflow).toContain('run: bun run build');
      expect(pkg.scripts).toHaveProperty(['build']);
    });
  }
});
