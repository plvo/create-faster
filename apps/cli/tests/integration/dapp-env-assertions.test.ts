import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

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

describe('dapp blueprints read their environment without non-null assertions', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const { blueprint, file, variables } of DAPP_ENV_FILES) {
    test(`${blueprint} fails with the variable name when one is missing`, async () => {
      const result = await runCli(
        [blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode, result.stderr).toBe(0);

      const source = await readTextFile(join(tempDir, blueprint, file));
      expect(source).not.toMatch(/process\.env\.\w+!/);
      for (const variable of variables) {
        expect(source).toContain(`throw new Error('${variable} environment variable is not set')`);
      }
    });
  }
});
