import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 300_000;
const TIMEOUT_BUILD = 120_000;

const BLUEPRINTS = ['lambda-sst-hono', 'lambda-terraform-aws-hono'];
const PACKAGE_MANAGERS = ['bun', 'npm'];
const APPS = ['api', 'cron', 'worker'];

// Imports the bundle the way the Lambda runtime does and reports the type of its `handler` export.
const IMPORT_HANDLER = 'const bundle = await import(process.argv[1]); console.log(typeof bundle.handler);';

describe.each(BLUEPRINTS)('%s bundles in Node', (blueprint) => {
  describe.each(PACKAGE_MANAGERS)('built with %s', (pm) => {
    let projectDir: string;
    let buildResult: CommandResult;

    beforeAll(async () => {
      const tempDir = await createTempDir();
      const name = `${blueprint}-${pm}`;
      const result = await runCli([name, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', pm], tempDir);
      expect(result.exitCode).toBe(0);

      projectDir = join(tempDir, name);
      expect((await runCommand([pm, 'install'], projectDir)).exitCode).toBe(0);
      buildResult = await runCommand([pm, 'run', 'build'], projectDir);
    }, TIMEOUT_INSTALL + TIMEOUT_BUILD);

    afterAll(async () => {
      if (projectDir) await cleanupTempDir(join(projectDir, '..'));
    });

    test('builds every app', () => {
      expect(buildResult.exitCode).toBe(0);
    });

    // A bundle in a `.js` file of a package without "type": "module" makes Node warn MODULE_TYPELESS_PACKAGE_JSON.
    test.each(APPS)('%s loads without a warning and exports a handler', async (app) => {
      const bundle = join(projectDir, 'apps', app, 'dist/index.mjs');
      const result = await runCommand(['node', '--input-type=module', '-e', IMPORT_HANDLER, bundle], projectDir);

      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe('function');
    });
  });
});
