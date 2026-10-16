import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const INTEGRATION_DIR = join(import.meta.dir, '../integration');

describe('integration test timeout', () => {
  test('every integration test file imports the timeout module', async () => {
    const files = (await readdir(INTEGRATION_DIR)).filter((name) => name.endsWith('.test.ts'));
    const sources = await Promise.all(files.map((name) => readFile(join(INTEGRATION_DIR, name), 'utf8')));
    const withoutTimeout = files.filter((_, index) => !/^import '\.\/timeout';$/m.test(sources[index] ?? ''));

    expect(withoutTimeout).toEqual([]);
  });
});
