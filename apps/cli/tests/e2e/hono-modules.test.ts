import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_SERVER = 60_000;

const HEALTH_RESPONSE = { ok: true, message: 'Health check', data: { id: '1' } };

// A Lambda function URL event (API Gateway payload v2), the shape sst.aws.Function with `url: true` receives.
const INVOKE_LAMBDA_HANDLER = `
const { handler } = await import('./src/index.ts');
const response = await handler({
  version: '2.0',
  routeKey: '$default',
  rawPath: '/health/1',
  rawQueryString: '',
  headers: { host: 'example.lambda-url.us-east-1.on.aws' },
  requestContext: {
    domainName: 'example.lambda-url.us-east-1.on.aws',
    http: { method: 'GET', path: '/health/1', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'e2e' },
  },
  isBase64Encoded: false,
}, {});
console.log(JSON.stringify(response));
`;

describe('hono-lambda', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['hono-lambda', '--app', 'hono-lambda:hono:aws-lambda', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'hono-lambda');
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
});

describe('hono-sst', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['hono-sst', '--app', 'hono-sst:hono', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'hono-sst');
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
    'the handler sst.aws.Function points to answers a function URL event',
    async () => {
      const result = await runCommand(['bun', '-e', INVOKE_LAMBDA_HANDLER], projectDir);
      expect(result.exitCode).toBe(0);
      const response = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '');
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(HEALTH_RESPONSE);
    },
    TIMEOUT_SERVER,
  );

  test(
    'start still serves the app locally',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir, { readyPath: '/health/1' });
      try {
        const response = await fetch(`${server.url}/health/1`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(HEALTH_RESPONSE);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_SERVER,
  );
});
