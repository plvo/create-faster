import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, runCli } from './helpers';

describe('--help output', () => {
  let dir: string;
  let help: string;

  beforeAll(async () => {
    dir = await createTempDir();
    help = (await runCli(['--help'], dir)).stdout;
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('every blueprint used in an example exists in META', () => {
    const examples = [...help.matchAll(/--blueprint (\S+)/g)]
      .map(([, name = '']) => name)
      .filter((name) => !name.startsWith('<'));

    expect(examples.length).toBeGreaterThan(0);
    for (const name of examples) {
      expect(META.blueprints).toHaveProperty(name);
    }
  });
});
