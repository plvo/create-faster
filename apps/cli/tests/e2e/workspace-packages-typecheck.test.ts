import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 240_000;
const TIMEOUT_TYPECHECK = 120_000;

interface Project {
  name: string;
  args: string[];
}

const PROJECTS: Project[] = [
  {
    name: 'next + start + hono, better-auth trpc shadcn, postgres drizzle',
    args: [
      '--app',
      'web:nextjs:better-auth,trpc,shadcn',
      '--app',
      'docs:tanstack-start:better-auth,trpc,shadcn',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ],
  },
  {
    name: 'start + hono on cloudflare d1, better-auth trpc',
    args: [
      '--app',
      'web:tanstack-start:better-auth,trpc',
      '--app',
      'api:hono',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ],
  },
  {
    name: 'blueprint cloudflare-fullstack',
    args: ['--blueprint', 'cloudflare-fullstack'],
  },
];

async function workspaceDirs(projectPath: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const group of ['apps', 'packages']) {
    const entries = await readdir(join(projectPath, group), { withFileTypes: true });
    for (const entry of entries) {
      const dir = join(group, entry.name);
      if (entry.isDirectory() && (await fileExists(join(projectPath, dir, 'tsconfig.json')))) dirs.push(dir);
    }
  }
  return dirs;
}

describe.each(PROJECTS)('workspace packages typecheck: $name', ({ args }) => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['typecheck-test', ...args, '--no-git', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'typecheck-test');
  }, TIMEOUT_INSTALL * 2);

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test(
    'every app and every package type-checks on its own',
    async () => {
      const failures: string[] = [];

      for (const dir of await workspaceDirs(projectPath)) {
        const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectPath, dir));
        if (result.exitCode !== 0) failures.push(`${dir}\n${result.stdout}`);
      }

      expect(failures).toEqual([]);
    },
    TIMEOUT_TYPECHECK,
  );
});
