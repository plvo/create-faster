import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, exportedNames, readTextFile, runCli } from './helpers';

// `default` is what `bun run src/index.ts` (dev, start) and wrangler (`main`) serve; `handler` is the Lambda entry.
const ENTRIES = [
  { name: 'hono-plain', args: ['--app', 'hono-plain:hono'], exports: ['default'] },
  {
    name: 'hono-cloudflare',
    args: ['--app', 'hono-cloudflare:hono', '--deployment', 'cloudflare'],
    exports: ['default'],
  },
  { name: 'hono-sst', args: ['--app', 'hono-sst:hono', '--deployment', 'sst'], exports: ['default', 'handler'] },
  { name: 'hono-lambda', args: ['--app', 'hono-lambda:hono:aws-lambda'], exports: ['default', 'handler'] },
  {
    name: 'hono-lambda-sst',
    args: ['--app', 'hono-lambda-sst:hono:aws-lambda', '--deployment', 'sst'],
    exports: ['default', 'handler'],
  },
  {
    name: 'hono-lambda-terraform',
    args: ['--app', 'hono-lambda-terraform:hono:aws-lambda', '--deployment', 'terraform-aws'],
    exports: ['default', 'handler'],
  },
  {
    name: 'hono-lambda-cloudflare',
    args: ['--app', 'hono-lambda-cloudflare:hono:aws-lambda', '--deployment', 'cloudflare'],
    exports: ['default', 'handler'],
  },
];

describe('Hono entry exports', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(ENTRIES)('$name exports $exports', async ({ name, args, exports }) => {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    const entry = join(tempDir, name, 'src/index.ts');
    const content = await readTextFile(entry);
    expect((await exportedNames(entry)).sort()).toEqual(exports);
    expect(content.includes("from 'hono/aws-lambda'")).toBe(exports.includes('handler'));
    expect(content).toEndWith('export default app;\n');
  });
});
