import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readSstHandlers, type SstHandler } from '../integration/helpers';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';
import { bundleForLambda, probeLambdaHandler } from './lambda-handler';

const TIMEOUT_INSTALL = 300_000;
const TIMEOUT_BUNDLE = 120_000;

const SST_PROJECTS = [
  { name: 'sst-hono', args: ['--app', 'sst-hono:hono', '--deployment', 'sst'] },
  {
    name: 'sst-every-stack',
    args: ['--app', 'web:nextjs', '--app', 'site:tanstack-start', '--app', 'api:hono', '--deployment', 'sst'],
  },
  { name: 'sst-blueprint', args: ['--blueprint', 'lambda-sst'] },
];

describe.each(SST_PROJECTS)('$name', ({ name, args }) => {
  let projectDir: string;
  let installResult: CommandResult;
  let handlers: SstHandler[];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
    handlers = await readSstHandlers(projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'every handler sst.config.ts names is a function of its bundled module',
    async () => {
      expect(handlers.length).toBeGreaterThan(0);

      const probed = [];
      for (const [index, { ref, file, exportName }] of handlers.entries()) {
        if (!file) {
          probed.push({ ref, type: 'no such file' });
          continue;
        }
        const bundle = await bundleForLambda(file, join(projectDir, '..', 'lambda-bundles', String(index)));
        probed.push({ ref, type: (await probeLambdaHandler(bundle, exportName)).type });
      }

      expect(probed).toEqual(handlers.map(({ ref }) => ({ ref, type: 'function' })));
    },
    TIMEOUT_BUNDLE,
  );
});
