import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, PNPM_AVAILABLE, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 600_000;
const UNFORMATTED_SOURCE = 'export const answer   =   42\n';
const FORMATTED_SOURCE = 'export const answer = 42;\n';

if (!PNPM_AVAILABLE) {
  console.warn('Skipping the pnpm husky hooks e2e: pnpm is not installed');
}
const PACKAGE_MANAGERS = ['bun', 'npm', ...(PNPM_AVAILABLE ? ['pnpm'] : [])];

describe.each(PACKAGE_MANAGERS)('husky hooks after a generation with %s', (pm) => {
  let tempDir: string;
  let projectDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['hooks', '--app', 'web:hono', '--linter', 'biome', '--tooling', 'husky', '--git', '--pm', pm],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, 'hooks');
  }, TIMEOUT_PROJECT);

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test(
    'core.hooksPath is set and a commit runs the pre-commit and commit-msg hooks',
    async () => {
      const hooksPath = await runCommand(['git', 'config', 'core.hooksPath'], projectDir);
      expect(hooksPath.stdout.trim()).toBe('.husky/_');

      await writeFile(join(projectDir, 'src', 'answer.ts'), UNFORMATTED_SOURCE);
      await runCommand(['git', 'add', '-A'], projectDir);
      const commit = await runCommand(
        ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'not conventional'],
        projectDir,
      );

      expect(commit.exitCode).toBe(0);
      expect(await readFile(join(projectDir, 'src', 'answer.ts'), 'utf8')).toBe(FORMATTED_SOURCE);
      expect(commit.stdout + commit.stderr).toContain('Invalid commit message format');
    },
    TIMEOUT_PROJECT,
  );
});
