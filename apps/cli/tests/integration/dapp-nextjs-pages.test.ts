import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe.each(['dapp-rainbowkit-nextjs', 'dapp-privy-nextjs'])('%s protected page', (blueprint) => {
  let tempDir: string;
  let page: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['dapp', '--blueprint', blueprint, '--no-install', '--no-git'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    page = await readTextFile(join(tempDir, 'dapp/src/app/protected/page.tsx'));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('is a server page that sets its own title, since a client page cannot export metadata', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain('export const metadata');
    expect(page).toContain("title: 'Dashboard'");
  });

  test('renders the wallet dashboard from a client component', async () => {
    const client = await readTextFile(join(tempDir, 'dapp/src/app/protected/protected.client.tsx'));
    expect(client).toContain("'use client'");
    expect(client).toContain('useAccount');
    expect(page).toContain("from './protected.client'");
  });
});
