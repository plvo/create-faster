import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface TsConfig {
  exclude?: string[];
}

describe('SST deployment and the app tsconfig', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  test.each(['nextjs', 'expo'])(
    'a single %s app does not compile sst.config.ts nor the .sst platform sources',
    async (stack) => {
      const project = await generate(`sst-single-${stack}`, ['--app', `sst-single-${stack}:${stack}`, '--deployment', 'sst']);
      const tsconfig = await readJsonFile<TsConfig>(join(project, 'tsconfig.json'));

      expect(tsconfig.exclude).toContain('.sst');
      expect(tsconfig.exclude).toContain('sst.config.ts');
      expect(await readTextFile(join(project, '.gitignore'))).toContain('.sst/');
    },
  );

  test('a turborepo app keeps its default exclude: the SST files sit at the root, outside the app', async () => {
    const project = await generate('sst-turbo-nextjs', ['--app', 'web:nextjs', '--app', 'api:hono', '--deployment', 'sst']);
    const tsconfig = await readJsonFile<TsConfig>(join(project, 'apps/web/tsconfig.json'));

    expect(tsconfig.exclude).toEqual(['./node_modules']);
    expect(await readTextFile(join(project, '.gitignore'))).toContain('.sst/');
  });

  test('a Next.js app without sst keeps its default exclude', async () => {
    const project = await generate('no-sst-nextjs', ['--app', 'no-sst-nextjs:nextjs']);
    const tsconfig = await readJsonFile<TsConfig>(join(project, 'tsconfig.json'));

    expect(tsconfig.exclude).toEqual(['./node_modules']);
  });
});
