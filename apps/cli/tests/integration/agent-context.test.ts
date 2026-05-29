import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('agent context generation (integration)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(
      ['myapp', '--app', 'myapp:nextjs:better-auth', '--database', 'postgres', '--orm', 'drizzle', '--no-git', '--no-install'],
      dir,
    );
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('writes AGENTS.md', async () => {
    expect(await fileExists(join(dir, 'myapp', 'AGENTS.md'))).toBe(true);
  });

  test('writes CLAUDE.md importing AGENTS.md', async () => {
    const content = await readTextFile(join(dir, 'myapp', 'CLAUDE.md'));
    expect(content).toBe('@AGENTS.md\n');
  });

  test('does not emit a stray .agent.md file', async () => {
    expect(await fileExists(join(dir, 'myapp', '.agent.md'))).toBe(false);
    expect(await fileExists(join(dir, 'myapp', 'src', '.agent.md'))).toBe(false);
  });
});
