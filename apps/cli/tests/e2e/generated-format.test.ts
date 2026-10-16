import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 1_200_000;
const OUTPUT_TAIL_LINES = 60;

// The check each formatter runs on its own, from the project root, with the binaries the install provides.
const FORMATTER_CHECKS: Record<string, string[]> = {
  biome: ['node_modules/.bin/biome', 'check', '.'],
  oxc: ['node_modules/.bin/oxfmt', '--check'],
  prettier: ['bun', 'run', 'format:check'],
  'eslint-prettier': ['bun', 'run', 'format:check'],
};

const PROJECTS: { name: string; startApp?: string; args: string[] }[] = [
  {
    name: 'next-single',
    args: [
      '--app',
      'next-single:nextjs:shadcn,next-themes,mdx,pwa,tanstack-query,tanstack-devtools,react-hook-form,tanstack-form,better-auth,trpc,posthog,evlog,vitest,playwright',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ],
  },
  {
    name: 'start-single',
    startApp: '.',
    args: ['--app', 'start-single:tanstack-start:tanstack-query'],
  },
  {
    name: 'org-dashboard-tanstack-start',
    startApp: 'apps/web',
    args: ['--blueprint', 'org-dashboard-tanstack-start'],
  },
  {
    name: 'start-hono-turbo',
    startApp: 'apps/admin',
    args: [
      '--app',
      'admin:tanstack-start:shadcn,next-themes,tanstack-query,tanstack-devtools,react-hook-form,better-auth,trpc,evlog,vitest',
      '--app',
      'api:hono:vitest-node',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ],
  },
];

// The README's first-run step: drizzle-kit writes the migrations, which a formatter must leave alone.
async function generateMigrations(projectDir: string): Promise<void> {
  for (const dir of ['.', 'packages/db']) {
    const example = join(projectDir, dir, '.env.example');
    if (await fileExists(example)) await copyFile(example, join(projectDir, dir, '.env'));
  }
  const result = await runCommand(['bun', 'run', 'db:generate'], projectDir);
  if (result.exitCode !== 0) throw new Error(`db:generate exited ${result.exitCode}:\n${tail(result)}`);
}

function tail(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
}

describe('a freshly generated project passes its own formatter check and type-checks after the format step', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const [linter, check] of Object.entries(FORMATTER_CHECKS)) {
    for (const { name, args, startApp } of PROJECTS) {
      test(
        `${linter}: ${name}`,
        async () => {
          const generated = await runCli([name, ...args, '--linter', linter, '--git', '--pm', 'bun'], tempDir);
          const output = `${generated.stdout}\n${generated.stderr}`;
          if (generated.exitCode !== 0) throw new Error(`generation failed:\n${output}`);
          expect(output).not.toContain('failed:');

          const projectDir = join(tempDir, name);
          try {
            if (args.includes('drizzle')) await generateMigrations(projectDir);
            const result = await runCommand(check, projectDir);
            if (result.exitCode !== 0) throw new Error(`${check.join(' ')} exited ${result.exitCode}:\n${tail(result)}`);

            if (startApp) {
              const routeTree = join(projectDir, startApp, 'src/routeTree.gen.ts');
              const formatted = await readFile(routeTree, 'utf8');
              const regenerated = await runCommand(['bun', 'run', 'tsr', 'generate'], join(projectDir, startApp));
              if (regenerated.exitCode !== 0) throw new Error(`tsr generate failed:\n${tail(regenerated)}`);
              expect(await readFile(routeTree, 'utf8')).toBe(formatted);

              const typecheck = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, startApp));
              if (typecheck.exitCode !== 0) throw new Error(`tsc --noEmit after the format step failed:\n${tail(typecheck)}`);
            }
            expect(await fileExists(join(projectDir, '.git'))).toBe(true);
          } finally {
            await cleanupTempDir(projectDir);
          }
        },
        TIMEOUT_PROJECT,
      );
    }
  }
});
