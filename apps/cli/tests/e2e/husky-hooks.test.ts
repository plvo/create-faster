import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, PNPM_AVAILABLE, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 600_000;
const UNFORMATTED_SOURCE = 'export const answer   =   42\n';
const FORMATTED_SOURCE = 'export const answer = 42;\n';

describe.each(['bun', 'npm', 'pnpm'])('husky hooks after a generation with %s', (pm) => {
  const unavailable = pm === 'pnpm' && !PNPM_AVAILABLE;
  const title = 'core.hooksPath is set and a commit runs the pre-commit and commit-msg hooks';

  test.skipIf(unavailable)(
    unavailable ? `${title} (skipped: pnpm is not installed)` : title,
    async () => {
      const tempDir = await createTempDir();
      try {
        const generated = await runCli(
          ['hooks', '--app', 'web:hono', '--linter', 'biome', '--tooling', 'husky', '--git', '--pm', pm],
          tempDir,
        );
        expect(generated.exitCode).toBe(0);
        const projectDir = join(tempDir, 'hooks');

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
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    TIMEOUT_PROJECT,
  );
});
