import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { META } from '@/__meta__';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  generateTurborepo,
  printedScriptsMissingFrom,
  readJsonFile,
  readTextFile,
  runCli,
  type TurboTask,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

function expectBuildTaskFollowsRootBuild(scripts: Record<string, string>, tasks: Record<string, TurboTask>): void {
  expect('build' in tasks).toBe('build' in scripts);
  if (!('build' in tasks)) {
    for (const task of Object.values(tasks)) expect(task.dependsOn ?? []).not.toContain('^build');
  }
}

describe('Turborepo root build', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const noBuildCases: { name: string; args: string[]; pm?: string; tasks?: string[]; onlyTypecheckTask?: boolean }[] = [
    { name: 'expo-only', args: ['--app', 'a:expo', '--app', 'b:expo'], onlyTypecheckTask: true },
    { name: 'hono-bun-only', args: ['--app', 'api:hono', '--app', 'worker:hono'] },
    { name: 'hono-npm-only', args: ['--app', 'api:hono', '--app', 'worker:hono'], pm: 'npm' },
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
      args: [
        '--app',
        'api:hono',
        '--app',
        'worker:hono',
        '--database',
        'sqlite',
        '--orm',
        'drizzle',
        '--linter',
        'eslint',
      ],
      tasks: ['dev', 'start', 'db:push', 'lint'],
    },
    {
      name: 'hono-bun-database',
      args: ['--app', 'api:hono', '--app', 'worker:hono', '--database', 'postgres', '--orm', 'prisma'],
    },
  ];

  for (const { name, args, pm, tasks: otherTasks = [], onlyTypecheckTask = false } of noBuildCases) {
    test(`${name}: no app declares build, so the root has no build script, task or printed step`, async () => {
      const { projectPath, scripts, tasks } = await generateTurborepo(tempDir, name, args, pm);

      expect(scripts).not.toHaveProperty(['build']);
      expectBuildTaskFollowsRootBuild(scripts, tasks);
      for (const task of otherTasks) expect(tasks).toHaveProperty([task]);
      if (onlyTypecheckTask) expect(Object.keys(tasks)).toEqual(['typecheck']);

      for (const document of ['README.md', 'AGENTS.md']) {
        const text = await readTextFile(join(projectPath, document));
        expect(text).not.toMatch(/(bun|npm) run build\b(?!:)/);
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

  test('a turborepo with tests, ORM, linter and Cloudflare declares every task, and its turbo.json stays valid JSON', async () => {
    const { scripts, tasks } = await generateTurborepo(tempDir, 'full-turbo', [
      '--app',
      'web:nextjs:vitest,playwright',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'prisma',
      '--linter',
      'eslint',
      '--deployment',
      'cloudflare',
    ]);

    expectBuildTaskFollowsRootBuild(scripts, tasks);
    for (const task of ['build', 'dev', 'test', 'test:e2e', 'cf-typegen', 'db:push', 'db:studio', 'lint']) {
      expect(tasks).toHaveProperty([task]);
    }
  });

  test('every blueprint that generates a turborepo has a valid turbo.json whose build task follows the root build', async () => {
    for (const blueprint of Object.keys(META.blueprints)) {
      const result = await runCli(
        [`bp-${blueprint}`, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      const projectPath = join(tempDir, `bp-${blueprint}`);
      if (!(await fileExists(join(projectPath, 'turbo.json')))) continue;

      const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
      const { tasks } = await readJsonFile<{ tasks: Record<string, TurboTask> }>(join(projectPath, 'turbo.json'));
      expectBuildTaskFollowsRootBuild(scripts, tasks);
    }
    expect((await readdir(tempDir)).some((entry) => entry.startsWith('bp-'))).toBe(true);
  });

  for (const blueprint of ['lambda-sst-hono', 'lambda-terraform-aws-hono']) {
    test(`${blueprint}: the workflow that runs the root build finds a build script`, async () => {
      const result = await runCli(
        [blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      const projectPath = join(tempDir, blueprint);
      const pkg = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
      const workflow = await readTextFile(join(projectPath, '.github/workflows/deploy.yml'));

      expect(workflow).toContain('run: bun run build');
      expect(pkg.scripts).toHaveProperty(['build']);
    });
  }
});
