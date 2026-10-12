import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJson {
  scripts: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(projectName: string, args: string[]): Promise<string> {
  const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, projectName);
}

// Bun runs these stacks from source, so nothing replaces process.env.NODE_ENV at build time.
describe('Bun server stacks run production with NODE_ENV=production', () => {
  test.each([
    { stack: 'hono', app: 'api' },
    { stack: 'node', app: 'jobs' },
  ])('$stack: start sets NODE_ENV=production, dev leaves it to the runtime', async ({ stack, app }) => {
    const projectDir = await generate(`node-env-${stack}`, ['--app', 'web:nextjs', '--app', `${app}:${stack}`]);
    const pkg = await readJsonFile<PackageJson>(join(projectDir, 'apps', app, 'package.json'));
    expect(pkg.scripts.start).toBe('NODE_ENV=production bun run src/index.ts');
    expect(pkg.scripts.dev).toBe('bun run --hot src/index.ts');
  });

  test('SST sets NODE_ENV in the Hono function environment, production on deploy and development under sst dev', async () => {
    const projectDir = await generate('node-env-sst-hono', ['--app', 'node-env-sst-hono:hono', '--deployment', 'sst']);
    const config = await readTextFile(join(projectDir, 'sst.config.ts'));
    expect(config).toContain(`new sst.aws.Function('node-env-sst-hono', {
      url: true,
      handler: 'src/index.handler',
      environment: {
        NODE_ENV: $dev ? 'development' : 'production',
      },
    });`);
  });
});
