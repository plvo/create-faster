import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 180_000;

describe('turbo-drizzle-mysql', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'turbo-drizzle-mysql',
        '--app',
        'web:nextjs:shadcn,better-auth,trpc,tanstack-query',
        '--app',
        'api:hono:aws-lambda',
        '--database',
        'mysql',
        '--orm',
        'drizzle',
        '--linter',
        'biome',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'turbo-drizzle-mysql');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'type-checks apps/web',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, 'apps/web'));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'type-checks apps/api',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, 'apps/api'));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'type-checks packages/db',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, 'packages/db'));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'type-checks packages/ui',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, 'packages/ui'));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );
});
