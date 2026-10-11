import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
    '%s answers its trigger with the handler and runtime Terraform deploys',
    async (name, event, reply) => {
      const lambda = lambdas.find((candidate) => candidate.name === name);
      if (!lambda) throw new Error(`infra/main.tf declares no "${name}" Lambda`);

      expect(await invokeInLambdaRuntime(lambda.sourceDir, lambda.handler, lambda.runtime, event)).toEqual(reply);
    },
    TIMEOUT_INVOKE,
  );
});
