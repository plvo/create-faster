import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, PNPM_AVAILABLE, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 600_000;
const UNFORMATTED_SOURCE = 'export const answer   =   42\n';
const FORMATTED_SOURCE = 'export const answer = 42;\n';
const UNFORMATTED_DB_SOURCE = UNFORMATTED_SOURCE.replace('answer', 'dbAnswer');
const FORMATTED_DB_SOURCE = FORMATTED_SOURCE.replace('answer', 'dbAnswer');
const UNUSED_VARIABLE = 'const unused = 1;\n';
const DB_SOURCE = join('packages', 'db', 'src', 'index.ts');
const DATABASE_ARGS = ['--database', 'sqlite', '--orm', 'drizzle'];

async function commitAll(projectDir: string, message: string): Promise<{ exitCode: number; output: string }> {
  await runCommand(['git', 'add', '-A'], projectDir);
  const commit = await runCommand(
    ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message],
    projectDir,
  );
  return { exitCode: commit.exitCode, output: commit.stdout + commit.stderr };
}

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
        const commit = await commitAll(projectDir, 'not conventional');

        expect(commit.exitCode).toBe(0);
        expect(await readFile(join(projectDir, 'src', 'answer.ts'), 'utf8')).toBe(FORMATTED_SOURCE);
        expect(commit.output).toContain('Invalid commit message format');
        expect(commit.output).not.toContain('Commit message is valid');

        await writeFile(join(projectDir, 'src', 'second.ts'), FORMATTED_SOURCE);
        const conventional = await commitAll(projectDir, 'chore: initial commit');

        expect(conventional.exitCode).toBe(0);
        expect(conventional.output).toContain('Commit message is valid');
        expect(conventional.output).not.toContain('Invalid commit message format');
      } finally {
        await cleanupTempDir(tempDir);
      }
    },
    TIMEOUT_PROJECT,
  );
});

interface EslintTurborepo {
  name: string;
  apps: string[];
  appSource: string;
  linters: string[];
  pms: string[];
}

const ESLINT_TURBOREPOS: EslintTurborepo[] = [
  {
    name: 'hono and node apps',
    apps: ['--app', 'api:hono', '--app', 'worker:node'],
    appSource: join('apps', 'api', 'src', 'app.ts'),
    linters: ['eslint', 'eslint-prettier'],
    pms: ['bun', 'npm', 'pnpm'],
  },
  {
    name: 'next.js app with shadcn',
    apps: ['--app', 'web:nextjs:shadcn', '--app', 'worker:node'],
    appSource: join('apps', 'web', 'src', 'app', 'page.tsx'),
    linters: ['eslint-prettier'],
    pms: ['bun'],
  },
];

describe.each(['bun', 'npm', 'pnpm'])('lint-staged of an ESLint turborepo with %s', (pm) => {
  const unavailable = pm === 'pnpm' && !PNPM_AVAILABLE;

  describe.each(ESLINT_TURBOREPOS.filter((turborepo) => turborepo.pms.includes(pm)))('$name', (turborepo) => {
    describe.each(turborepo.linters)('%s', (linter) => {
      const title = 'lints the staged files of an app and of a package with their own config';

      test.skipIf(unavailable)(
        unavailable ? `${title} (skipped: pnpm is not installed)` : title,
        async () => {
          const tempDir = await createTempDir();
          try {
            const generated = await runCli(
              [
                'staged',
                ...turborepo.apps,
                ...DATABASE_ARGS,
                ...['--linter', linter, '--tooling', 'husky', '--git', '--pm', pm],
              ],
              tempDir,
            );
            expect(generated.exitCode).toBe(0);
            const projectDir = join(tempDir, 'staged');

            const first = await commitAll(projectDir, 'feat: first commit');
            expect(first.output).not.toContain('Task failed to spawn');
            expect(first.exitCode).toBe(0);

            const appSource = join(projectDir, turborepo.appSource);
            const dbSource = join(projectDir, DB_SOURCE);
            await writeFile(appSource, `${await readFile(appSource, 'utf8')}\n${UNFORMATTED_SOURCE}`);
            await writeFile(dbSource, `${await readFile(dbSource, 'utf8')}\n${UNFORMATTED_DB_SOURCE}`);
            const clean = await commitAll(projectDir, 'feat: clean app and package');
            expect(clean.output).toContain('eslint --fix');
            expect(clean.exitCode).toBe(0);
            if (linter === 'eslint-prettier') {
              expect(await readFile(appSource, 'utf8')).toEndWith(FORMATTED_SOURCE);
              expect(await readFile(dbSource, 'utf8')).toEndWith(FORMATTED_DB_SOURCE);
            }

            await writeFile(appSource, `${await readFile(appSource, 'utf8')}${UNUSED_VARIABLE}`);
            const appError = await commitAll(projectDir, 'feat: lint error in the app');
            expect(appError.exitCode).not.toBe(0);
            expect(appError.output).toContain('@typescript-eslint/no-unused-vars');
            await runCommand(
              ['git', 'restore', '--source=HEAD', '--staged', '--worktree', '--', turborepo.appSource],
              projectDir,
            );

            await writeFile(dbSource, `${await readFile(dbSource, 'utf8')}${UNUSED_VARIABLE}`);
            const packageError = await commitAll(projectDir, 'feat: lint error in the package');
            expect(packageError.exitCode).not.toBe(0);
            expect(packageError.output).toContain('@typescript-eslint/no-unused-vars');
          } finally {
            await cleanupTempDir(tempDir);
          }
        },
        TIMEOUT_PROJECT,
      );
    });
  });
});
