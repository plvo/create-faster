import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
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

const PROJECTS: { name: string; routeTreeApp?: string; args: string[] }[] = [
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
    name: 'start-hono-turbo',
    routeTreeApp: 'apps/admin',
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
    for (const { name, args, routeTreeApp } of PROJECTS) {
      test(
        `${linter}: ${name}`,
        async () => {
          const generated = await runCli([name, ...args, '--linter', linter, '--git', '--pm', 'bun'], tempDir);
          const output = `${generated.stdout}\n${generated.stderr}`;
          if (generated.exitCode !== 0) throw new Error(`generation failed:\n${output}`);
          expect(output).not.toContain('failed:');

          const projectDir = join(tempDir, name);
          try {
            const result = await runCommand(check, projectDir);
            if (result.exitCode !== 0) throw new Error(`${check.join(' ')} exited ${result.exitCode}:\n${tail(result)}`);

            if (routeTreeApp) {
              const routeTree = join(projectDir, routeTreeApp, 'src/routeTree.gen.ts');
              const formatted = await readFile(routeTree, 'utf8');
              const regenerated = await runCommand(['bun', 'run', 'tsr', 'generate'], join(projectDir, routeTreeApp));
              if (regenerated.exitCode !== 0) throw new Error(`tsr generate failed:\n${tail(regenerated)}`);
              expect(await readFile(routeTree, 'utf8')).toBe(formatted);

              const typecheck = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, routeTreeApp));
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
