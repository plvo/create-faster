import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, fileExists, PNPM_AVAILABLE, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 180_000;

if (!PNPM_AVAILABLE) {
  console.warn('Skipping pnpm workspace e2e: pnpm is not installed');
}
const describeWithPnpm = describe.skipIf(!PNPM_AVAILABLE);

const PNPM_PROJECTS = [
  {
    name: 'pnpm-turborepo',
    args: ['--app', 'web:nextjs', '--app', 'api:hono', '--database', 'postgres', '--orm', 'drizzle', '--linter', 'biome'],
  },
  { name: 'pnpm-blueprint', args: ['--blueprint', 'org-dashboard-nextjs', '--linter', 'biome'] },
];

describeWithPnpm.each(PNPM_PROJECTS)('$name', ({ name, args }) => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'pnpm'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['pnpm', 'install'], projectDir);
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

  test('installs every app, not only the root', async () => {
    expect(await fileExists(join(projectDir, 'apps/web/node_modules'))).toBe(true);
  });

  test(
    'builds',
    async () => {
      const result = await runCommand(['pnpm', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );
});
