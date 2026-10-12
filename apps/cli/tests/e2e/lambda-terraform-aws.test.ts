import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readTerraformLambdas, type TerraformLambda } from '../integration/helpers';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';
import { functionUrlEvent, invokeInLambdaRuntime } from './lambda-handler';

const TIMEOUT_INSTALL = 300_000;
const TIMEOUT_INVOKE = 300_000;

const dockerAvailable = Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
if (!dockerAvailable) {
  console.warn('Skipping lambda-terraform-aws e2e: no Docker daemon reachable (`docker info` failed)');
}
const describeWithDocker = describe.skipIf(!dockerAvailable);

const QUEUE_MESSAGE = { type: 'e2e', payload: {}, timestamp: '2026-01-01T00:00:00.000Z', traceId: 'e2e-trace' };

// What each Lambda's trigger in infra/main.tf sends it, and what the handler answers.
const INVOCATIONS: [name: string, event: unknown, reply: unknown][] = [
  [
    'api',
    // API Gateway HTTP API payload 2.0, the format function URLs share.
    functionUrlEvent('/health/e2e'),
    expect.objectContaining({
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: 'Health check', data: { id: 'e2e' } }),
    }),
  ],
  [
    'cron',
    {
      version: '0',
      id: 'e2e-event',
      'detail-type': 'Scheduled Event',
      source: 'aws.events',
      account: '123456789012',
      time: '2026-01-01T00:00:00Z',
      region: 'us-east-1',
      resources: ['arn:aws:events:us-east-1:123456789012:rule/e2e'],
      detail: {},
    },
    null,
  ],
  [
    'worker',
    {
      Records: [
        {
          messageId: 'e2e-message',
          receiptHandle: 'e2e-receipt',
          body: JSON.stringify(QUEUE_MESSAGE),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1767225600000',
            SenderId: 'e2e',
            ApproximateFirstReceiveTimestamp: '1767225600000',
          },
          messageAttributes: {},
          md5OfBody: 'e2e',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:e2e',
          awsRegion: 'us-east-1',
        },
      ],
    },
    { batchItemFailures: [] },
  ],
];

// Test-only routes added to the api before it is built. The first throws, to see what the error handler answers;
// the second reads the literal `process.env.NODE_ENV`, which the build inlines into the bundle.
const E2E_ROUTES = `
app.get('/e2e/throw', () => {
  throw new Error('e2e boom');
});

app.get('/e2e/node-env', (c) => c.json({ nodeEnv: process.env.NODE_ENV }));
`;

async function addE2eRoutes(appFile: string): Promise<void> {
  const source = await readFile(appFile, 'utf-8');
  await writeFile(appFile, source.replace('export default app;', `${E2E_ROUTES}\nexport default app;`));
}

describeWithDocker('lambda-terraform-aws blueprint in the Lambda runtime', () => {
  let projectDir: string;
  let installResult: CommandResult;
  let buildResult: CommandResult;
  let lambdas: TerraformLambda[];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['lambda-tf', '--blueprint', 'lambda-terraform-aws', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'lambda-tf');
    await addE2eRoutes(join(projectDir, 'apps/api/src/app.ts'));
    installResult = await runCommand(['bun', 'install'], projectDir);
    buildResult = await runCommand(['bun', 'run', 'build'], projectDir);
    lambdas = await readTerraformLambdas(projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test('installs dependencies', () => {
    expect(installResult.exitCode).toBe(0);
  });

  test('builds every app', () => {
    expect(buildResult.exitCode).toBe(0);
  });

  test('every Lambda in infra/main.tf is invoked below', () => {
    expect(lambdas.map(({ name }) => name)).toEqual(INVOCATIONS.map(([name]) => name));
  });

  test.each(INVOCATIONS)(
    '%s answers its trigger with the handler, runtime and timeout Terraform deploys',
    async (name, event, reply) => {
      const lambda = lambdas.find((candidate) => candidate.name === name);
      if (!lambda) throw new Error(`infra/main.tf declares no "${name}" Lambda`);

      expect(await invokeInLambdaRuntime(lambda, event)).toEqual(reply);
    },
    TIMEOUT_INVOKE,
  );

  // Lambda sets no NODE_ENV, so what the api reports is what `bun build` inlined, not the runtime environment.
  describe('api built for production', () => {
    const invokeApi = async (path: string): Promise<{ statusCode: number; body: string }> => {
      const lambda = lambdas.find(({ name }) => name === 'api');
      if (!lambda) throw new Error('infra/main.tf declares no "api" Lambda');
      return (await invokeInLambdaRuntime(lambda, functionUrlEvent(path))) as { statusCode: number; body: string };
    };

    test('inlines production into the bundle', async () => {
      const { body } = await invokeApi('/e2e/node-env');
      expect(JSON.parse(body)).toEqual({ nodeEnv: 'production' });
    }, TIMEOUT_INVOKE);

    test('answers a throwing route without its stack trace', async () => {
      const { statusCode, body } = await invokeApi('/e2e/throw');
      expect(statusCode).toBe(500);
      expect(JSON.parse(body)).toEqual({ ok: false, message: 'e2e boom' });
      expect(body).not.toContain('stack');
      expect(body).not.toContain('at ');
    }, TIMEOUT_INVOKE);
  });
});
