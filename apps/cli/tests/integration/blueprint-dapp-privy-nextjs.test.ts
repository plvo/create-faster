import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const PRIVY_APP_ID_LENGTH = 25;

describe('dapp-privy-nextjs blueprint', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the placeholder Privy app ID passes the SDK format check, so the first build prerenders', async () => {
    const result = await runCli(
      ['privy-env', '--blueprint', 'dapp-privy-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);

    const env = await readTextFile(join(tempDir, 'privy-env', '.env.example'));
    const appId = env.match(/^NEXT_PUBLIC_PRIVY_APP_ID=(.+)$/m)?.[1];
    expect(appId?.length).toBe(PRIVY_APP_ID_LENGTH);
  });
});
