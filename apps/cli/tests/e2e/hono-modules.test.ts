import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand, startServer } from './helpers';
import { bundleForLambda, functionUrlEvent, probeLambdaHandler } from './lambda-handler';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_SERVER = 60_000;

const HEALTH_RESPONSE = { ok: true, message: 'Health check', data: { id: '1' } };

// Hono entries exporting a Lambda `handler`, next to the default export that `dev` and `start` serve.
const LAMBDA_PROJECTS = [
  { name: 'hono-lambda', args: ['--app', 'hono-lambda:hono:aws-lambda'] },
  { name: 'hono-sst', args: ['--app', 'hono-sst:hono', '--deployment', 'sst'] },
  { name: 'hono-lambda-sst', args: ['--app', 'hono-lambda-sst:hono:aws-lambda', '--deployment', 'sst'] },
];

describe.each(LAMBDA_PROJECTS)('$name', ({ name, args }) => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
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
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'the bundled handler answers a function URL event',
    async () => {
      const bundle = await bundleForLambda(join(projectDir, 'src/index.ts'), join(projectDir, '..', 'lambda-bundle'));
      const probe = await probeLambdaHandler(bundle, 'handler', functionUrlEvent('/health/1'));
      expect(probe.type).toBe('function');
      expect(probe.response?.statusCode).toBe(200);
      expect(JSON.parse(probe.response?.body ?? '')).toEqual(HEALTH_RESPONSE);
    },
    TIMEOUT_SERVER,
  );

  test(
    'start serves the app locally',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir, { readyPath: '/health/1' });
      try {
        const response = await fetch(new URL('/health/1', server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(HEALTH_RESPONSE);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_SERVER,
  );
});
