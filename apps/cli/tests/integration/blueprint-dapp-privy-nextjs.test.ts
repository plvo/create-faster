import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('dapp-privy-nextjs blueprint', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the Privy app ID is blank, so no made-up ID reaches the SDK and the first build prerenders the setup message', async () => {
    const result = await runCli(
      ['privy-env', '--blueprint', 'dapp-privy-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const env = await readTextFile(join(tempDir, 'privy-env', '.env.example'));
    expect(env).toMatch(/^NEXT_PUBLIC_PRIVY_APP_ID=\s*(#.*)?$/m);
  });
});
