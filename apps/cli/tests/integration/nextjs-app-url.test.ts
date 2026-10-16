import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

interface AppUrlModule {
  getAppUrl: () => string;
}

describe('Next.js getAppUrl', () => {
  let tempDir: string;
  let getAppUrl: AppUrlModule['getAppUrl'];
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['app-url', '--app', 'web:nextjs', '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    getAppUrl = ((await import(join(tempDir, 'app-url/src/lib/get-app-url.ts'))) as AppUrlModule).getAppUrl;
  });

  afterAll(async () => {
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    await cleanupTempDir(tempDir);
  });

  test('falls back to the local dev url of the app', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  test('returns NEXT_PUBLIC_APP_URL as is when it has no trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
    expect(getAppUrl()).toBe('https://example.com');
  });

  test('drops the trailing slashes of NEXT_PUBLIC_APP_URL so a joined path has a single slash', () => {
    for (const value of ['https://example.com/', 'https://example.com//']) {
      process.env.NEXT_PUBLIC_APP_URL = value;
      expect(`${getAppUrl()}/api/trpc`).toBe('https://example.com/api/trpc');
    }
  });

  test('keeps the path of an app served under a sub path', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/docs/';
    expect(getAppUrl()).toBe('https://example.com/docs');
  });
});
