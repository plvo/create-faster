import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, exportedNames, readSstHandlers, runCli, type SstHandler } from './helpers';

const SST_PROJECTS = [
  { name: 'sst-hono', args: ['--app', 'sst-hono:hono', '--deployment', 'sst'] },
  { name: 'sst-hono-lambda', args: ['--app', 'sst-hono-lambda:hono:aws-lambda', '--deployment', 'sst'] },
  {
    name: 'sst-every-stack',
    args: [
      '--app',
      'web:nextjs',
      '--app',
      'site:tanstack-start',
      '--app',
      'api:hono',
      '--app',
      'mobile:expo',
      '--app',
      'jobs:node',
      '--deployment',
      'sst',
    ],
  },
  {
    name: 'sst-turbo-hono-lambda',
    args: ['--app', 'web:nextjs', '--app', 'api:hono:aws-lambda', '--deployment', 'sst'],
  },
  { name: 'sst-blueprint', args: ['--blueprint', 'lambda-sst'] },
];

describe('SST Node.js handlers', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe.each(SST_PROJECTS)('$name', ({ name, args }) => {
    let handlers: SstHandler[];

    beforeAll(async () => {
      const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode).toBe(0);
      handlers = await readSstHandlers(join(tempDir, name));
    });

    test('sst.config.ts names at least one handler', () => {
      expect(handlers.length).toBeGreaterThan(0);
    });

    test('every handler names a file that exports it', async () => {
      const resolved = await Promise.all(
        handlers.map(async ({ ref, file }) => ({ ref, exports: file ? await exportedNames(file) : 'no such file' })),
      );
      expect(resolved).toEqual(
        handlers.map(({ ref, exportName }) => ({ ref, exports: expect.arrayContaining([exportName]) })),
      );
    });
  });
});
