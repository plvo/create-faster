import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

describe('library requirements checked against flags without project answers', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(['nextjs', 'tanstack-start'])(
    '--app with better-auth on %s and no project flag names the requirement',
    async (stack) => {
      const result = await runCli(['x', '--app', `x:${stack}:better-auth`, '--no-git', '--no-install'], tempDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).not.toContain('Cannot read properties');
      expect(result.stderr).toContain("library 'better-auth' on app 'x' requires");
      expect(result.stderr).toContain('database: postgres or mysql or sqlite or d1');
      expect(result.stderr).toContain('orm: drizzle or prisma');
      expect(await readdir(tempDir)).toEqual([]);
    },
  );

  test('a partial project flag set reports the same requirement', async () => {
    const result = await runCli(
      ['x', '--app', 'x:nextjs:better-auth', '--database', 'postgres', '--no-git', '--no-install'],
      tempDir,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("library 'better-auth' on app 'x' requires");
    expect(await readdir(tempDir)).toEqual([]);
  });
});
