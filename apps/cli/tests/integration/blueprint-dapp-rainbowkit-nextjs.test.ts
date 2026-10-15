import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const CDP_SDK = "'@coinbase/cdp-sdk'";

describe('dapp-rainbowkit-nextjs blueprint', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, args: string[]): Promise<string> {
    const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return join(tempDir, projectName);
  }

  describe('production build', () => {
    test('keeps the CDP SDK out of the server bundle, where its optional x402 peers cannot resolve', async () => {
      const projectPath = await generate('rainbowkit-build', ['--blueprint', 'dapp-rainbowkit-nextjs', '--linter', 'biome']);
      const config = await readTextFile(join(projectPath, 'next.config.ts'));
      expect(config).toMatch(/serverExternalPackages: \[[^\]]*'@coinbase\/cdp-sdk'/);
    });

    test('an app without RainbowKit does not externalize the CDP SDK', async () => {
      const projectPath = await generate('rainbowkit-absent', ['--app', 'web:nextjs']);
      const config = await readTextFile(join(projectPath, 'next.config.ts'));
      expect(config).not.toContain(CDP_SDK);
    });
  });

  describe('SIWE domain', () => {
    test('is the host of the server-side BETTER_AUTH_URL, not a build-time public variable', async () => {
      const projectPath = await generate('rainbowkit-siwe', ['--blueprint', 'dapp-rainbowkit-nextjs', '--linter', 'biome']);
      const factory = await readTextFile(join(projectPath, 'src/lib/auth/create-auth.ts'));
      expect(factory).toMatch(/const siweDomain = new URL\(process\.env\.BETTER_AUTH_URL \?\? '[^']+'\)\.host;/);
      expect(factory).toContain('domain: siweDomain,');
      expect(factory).not.toContain('getAppUrl');
      expect(factory).not.toContain('NEXT_PUBLIC_APP_URL');
    });

    test('BETTER_AUTH_URL is declared in .env.example', async () => {
      const projectPath = await generate('rainbowkit-env', ['--blueprint', 'dapp-rainbowkit-nextjs', '--linter', 'biome']);
      const env = await readTextFile(join(projectPath, '.env.example'));
      expect(env).toMatch(/^BETTER_AUTH_URL=http:\/\/localhost:3000$/m);
    });
  });
});
