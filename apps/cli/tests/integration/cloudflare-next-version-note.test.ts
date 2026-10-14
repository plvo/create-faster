import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const PIN_ISSUE = 'opennextjs/opennextjs-cloudflare#1355';

describe('Cloudflare agent notes explain the Next.js pin', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function rootAgentNotes(name: string, args: string[]): Promise<string> {
    const result = await runCli(
      [name, ...args, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    return readTextFile(join(tempDir, name, 'AGENTS.md'));
  }

  test('a Next.js app on cloudflare is told not to upgrade next', async () => {
    const notes = await rootAgentNotes('next-cf', ['--app', 'next-cf:nextjs']);

    expect(notes).toContain('`next` is held on 16.3');
    expect(notes).toContain(PIN_ISSUE);
  });

  test('a Hono-only cloudflare project gets no Next.js pin note', async () => {
    const notes = await rootAgentNotes('hono-cf', ['--app', 'hono-cf:hono']);

    expect(notes).not.toContain(PIN_ISSUE);
  });
});
