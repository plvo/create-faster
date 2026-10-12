import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('blueprint auth access', () => {
  let tempDir: string;

  const generate = async (blueprint: string): Promise<string> => {
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, blueprint);
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('org-dashboard', () => {
    test('public self sign-up is closed in the auth config, users are created by admins', async () => {
      const projectPath = await generate('org-dashboard');
      const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
      expect(auth).toMatch(/emailAndPassword: \{[^}]*disableSignUp: true/);
    });
  });
});
