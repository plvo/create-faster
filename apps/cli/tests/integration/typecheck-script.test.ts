import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface Manifest {
  scripts?: Record<string, string>;
}

interface TurboConfig {
  tasks: Record<string, { dependsOn?: string[] }>;
}

const TYPECHECK = 'tsc --noEmit';

const TURBOREPOS: { name: string; args: string[] }[] = [
  {
    name: 'every-stack',
    args: [
      '--app',
      'web:nextjs:better-auth,trpc,shadcn',
      '--app',
      'docs:tanstack-start',
      '--app',
      'api:hono',
      '--app',
      'worker:node',
      '--app',
      'mobile:expo',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ],
  },
  { name: 'prisma', args: ['--app', 'web:nextjs', '--app', 'api:hono', '--database', 'postgres', '--orm', 'prisma'] },
  { name: 'blueprint-cloudflare-fullstack', args: ['--blueprint', 'cloudflare-fullstack-nextjs'] },
  { name: 'blueprint-org-dashboard-start', args: ['--blueprint', 'org-dashboard-tanstack-start'] },
  { name: 'blueprint-lambda-terraform', args: ['--blueprint', 'lambda-terraform-aws-hono'] },
];

const SINGLE_REPOS: { name: string; args: string[] }[] = [
  { name: 'single-nextjs', args: ['--app', 'single-nextjs:nextjs'] },
  { name: 'single-start', args: ['--app', 'single-start:tanstack-start'] },
  { name: 'single-hono', args: ['--app', 'single-hono:hono'] },
  { name: 'single-node', args: ['--app', 'single-node:node'] },
  { name: 'single-expo', args: ['--app', 'single-expo:expo'] },
];

async function typecheckableWorkspaces(projectPath: string): Promise<string[]> {
  const workspaces: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const entry of await readdir(join(projectPath, group), { withFileTypes: true })) {
      const dir = join(group, entry.name);
      if (entry.isDirectory() && (await fileExists(join(projectPath, dir, 'tsconfig.json')))) workspaces.push(dir);
    }
  }
  return workspaces;
}

describe('typecheck script', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return join(tempDir, name);
  }

  describe.each(TURBOREPOS)('turborepo $name', ({ name, args }) => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate(name, args);
    });

    test('the root runs the type check of every workspace through turbo', async () => {
      const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
      expect(root.scripts?.typecheck).toBe('turbo typecheck');
      const turbo = await readJsonFile<TurboConfig>(join(projectPath, 'turbo.json'));
      expect(turbo.tasks.typecheck?.dependsOn, 'a change in a package invalidates the cache of the apps that use it').toEqual(
        name === 'prisma' ? ['^typecheck', 'db:generate'] : ['^typecheck'],
      );
    });

    test('every app and package that has a tsconfig type-checks itself', async () => {
      const missing: string[] = [];
      const workspaces = await typecheckableWorkspaces(projectPath);
      expect(workspaces.length).toBeGreaterThan(1);
      for (const workspace of workspaces) {
        const manifest = await readJsonFile<Manifest>(join(projectPath, workspace, 'package.json'));
        if (manifest.scripts?.typecheck !== TYPECHECK) missing.push(workspace);
      }
      expect(missing).toEqual([]);
    });

    test('the README lists it among the scripts', async () => {
      expect(await readTextFile(join(projectPath, 'README.md'))).toContain('`bun run typecheck` - ');
    });
  });

  describe.each(SINGLE_REPOS)('single repo $name', ({ name, args }) => {
    test('the app type-checks with the same script', async () => {
      const projectPath = await generate(name, args);
      const manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
      expect(manifest.scripts?.typecheck).toBe(TYPECHECK);
    });
  });
});
