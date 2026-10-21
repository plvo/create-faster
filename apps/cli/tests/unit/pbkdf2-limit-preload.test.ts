import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const PRELOAD = resolve(import.meta.dir, '../e2e/pbkdf2-limit.mjs');

/** Runs a script under Node with the preload and prints one JSON line per attempt. */
function runUnderNode(script: string): { name: string; message: string }[] {
  const result = Bun.spawnSync(['node', '--import', PRELOAD, '--input-type=module', '-e', script], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  expect(result.stderr.toString()).toBe('');
  return result.stdout
    .toString()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

describe('the PBKDF2 limit preload of the e2e tests', () => {
  const attempts = `
    import crypto from 'node:crypto';
    import { pbkdf2, pbkdf2Sync } from 'node:crypto';
    const outcome = async (run) => {
      try {
        await run();
        return { name: 'ok', message: '' };
      } catch (error) {
        return { name: error.name, message: error.message };
      }
    };
    const derive = (iterations) =>
      crypto.webcrypto.subtle
        .importKey('raw', new TextEncoder().encode('password'), 'PBKDF2', false, ['deriveBits'])
        .then((key) => crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(8), iterations }, key, 256));
    const callback = (iterations) => new Promise((resolve, reject) => pbkdf2('password', 'salt', iterations, 32, 'sha256', (error) => (error ? reject(error) : resolve())));
    for (const iterations of [100000, 600000]) {
      console.log(JSON.stringify(await outcome(() => callback(iterations))));
      console.log(JSON.stringify(await outcome(() => pbkdf2Sync('password', 'salt', iterations, 32, 'sha256'))));
      console.log(JSON.stringify(await outcome(() => crypto.pbkdf2Sync('password', 'salt', iterations, 32, 'sha256'))));
      console.log(JSON.stringify(await outcome(() => derive(iterations))));
    }
  `;

  test('lets 100,000 iterations through and refuses more, on every way Node derives a key', () => {
    const outcomes = runUnderNode(attempts);

    expect(outcomes.slice(0, 4).map(({ name }) => name)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(outcomes.slice(4).map(({ name }) => name)).toEqual(['NotSupportedError', 'NotSupportedError', 'NotSupportedError', 'NotSupportedError']);
    expect(outcomes[4]?.message).toBe('Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)');
  });
});
