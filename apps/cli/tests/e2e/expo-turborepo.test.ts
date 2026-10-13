import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 240_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_TEST = 120_000;
const TIMEOUT_BUNDLE = 300_000;

const pnpmAvailable = Bun.spawnSync(['pnpm', '--version'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
if (!pnpmAvailable) {
  console.warn('Skipping pnpm Expo turborepo e2e: pnpm is not installed (`pnpm --version` failed)');
}

const PACKAGE_MANAGERS = [
  { pm: 'bun', exec: ['bunx'], available: true },
  { pm: 'pnpm', exec: ['pnpm', 'exec'], available: pnpmAvailable },
];

for (const { pm, exec, available } of PACKAGE_MANAGERS) {
  describe.skipIf(!available)(`expo next to a React 19 app in a turborepo (${pm})`, () => {
    const name = `expo-turbo-${pm}`;
    let projectDir: string;
    let mobileDir: string;
    let installResult: CommandResult;

    beforeAll(async () => {
      const tempDir = await createTempDir();
      const result = await runCli(
        [
          name,
          '--app',
          'web:tanstack-start:mdx,next-themes,shadcn',
          '--app',
          'mobile:expo:nativewind,jest-expo',
          '--no-git',
          '--no-install',
          '--pm',
          pm,
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      projectDir = join(tempDir, name);
      mobileDir = join(projectDir, 'apps/mobile');
      installResult = await runCommand([pm, 'install'], projectDir);
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
      'type-checks the mobile app',
      async () => {
        const result = await runCommand([...exec, 'tsc', '--noEmit'], mobileDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_TYPECHECK,
    );

    test(
      'runs jest',
      async () => {
        const result = await runCommand([pm, 'run', 'test'], mobileDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_TEST,
    );

    test(
      'bundles the mobile app with Metro',
      async () => {
        const result = await runCommand([...exec, 'expo', 'export', '--platform', 'ios'], mobileDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_BUNDLE,
    );
  });
}
