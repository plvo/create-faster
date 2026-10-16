import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir } from '../integration/helpers';

const INTEGRATION_DIR = join(import.meta.dir, '../integration');
const IMPORT_LINE = /^import \{ setIntegrationTimeout \} from '\.\/timeout';$/m;
const CALL_LINE = /^setIntegrationTimeout\(\);$/m;

describe('integration test timeout', () => {
  test('every integration test file sets the integration timeout itself', async () => {
    const files = (await readdir(INTEGRATION_DIR)).filter((name) => name.endsWith('.test.ts'));
    const sources = await Promise.all(files.map((name) => readFile(join(INTEGRATION_DIR, name), 'utf8')));
    const withoutTimeout = files.filter((_, index) => {
      const source = sources[index] ?? '';
      return !IMPORT_LINE.test(source) || !CALL_LINE.test(source);
    });

    expect(withoutTimeout).toEqual([]);
  });

  describe('in a run of several files', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await createTempDir();
      const timeoutModule = join(INTEGRATION_DIR, 'timeout');
      const hookAndTestOutlastTheFlag = `
        import { beforeAll, expect, test } from 'bun:test';
        import { setIntegrationTimeout } from '${timeoutModule}';

        setIntegrationTimeout();

        beforeAll(() => Bun.sleep(300));
        test('outlasts the flag', async () => {
          await Bun.sleep(300);
          expect(true).toBe(true);
        });
      `;
      await Promise.all(
        ['first', 'second', 'third'].map((name) => writeFile(join(dir, `${name}.test.ts`), hookAndTestOutlastTheFlag)),
      );
    });

    afterAll(() => cleanupTempDir(dir));

    test('the hooks and tests of every file outlast a 100 ms command line timeout', async () => {
      const run = Bun.spawn([process.execPath, 'test', '--timeout', '100'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [output, errors, exitCode] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);

      expect({ exitCode, summary: `${output}${errors}`.match(/\d+ (pass|fail)/g) }).toEqual({
        exitCode: 0,
        summary: ['3 pass', '0 fail'],
      });
    });
  });
});
