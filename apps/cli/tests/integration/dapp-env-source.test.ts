import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

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
    variables: [],
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
    test(`${blueprint} never asserts an environment read is set, and names each variable it requires in an error`, async () => {
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
