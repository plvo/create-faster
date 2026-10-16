import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

const PNG_SIGNATURE = '89504e470d0a1a0a';

async function readPngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('Images referenced by the SEO blueprints', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const blueprint of ['showcase-nextjs', 'cloudflare-static-site-nextjs']) {
    test(`${blueprint} ships the Open Graph image and the logo at the sizes its README states`, async () => {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install'], tempDir);
      expect(result.exitCode).toBe(0);
      const projectPath = join(tempDir, blueprint);
      expect(await readPngSize(join(projectPath, 'public/og.png'))).toEqual({ width: 1200, height: 630 });
      expect(await readPngSize(join(projectPath, 'public/logo.png'))).toEqual({ width: 200, height: 200 });
    });
  }
});
