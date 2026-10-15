import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const NON_NULL_ENV_READ = /process\.env(\.\w+|\[[^\]]+\])!/;

const DAPP_ENV_FILES = [
  {
    blueprint: 'dapp-privy-nextjs',
    file: 'src/trpc/init.ts',
    variables: ['NEXT_PUBLIC_PRIVY_APP_ID', 'PRIVY_APP_SECRET'],
  },
  {
    blueprint: 'dapp-rainbowkit-nextjs',
    file: 'src/lib/wagmi.ts',
    variables: ['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'],
  },
];

describe('dapp blueprint sources that read the environment', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const { blueprint, file, variables } of DAPP_ENV_FILES) {
    test(`${blueprint} names each variable in an error instead of asserting it is set`, async () => {
      const result = await runCli(
        [blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode, result.stderr).toBe(0);

      const source = await readTextFile(join(tempDir, blueprint, file));
      expect(source).not.toMatch(NON_NULL_ENV_READ);
      for (const variable of variables) {
        expect(source).toMatch(new RegExp(`throw new Error\\([^)]*${variable}`));
      }
    });
  }
});
