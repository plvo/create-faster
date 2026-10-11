import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const LAMBDA_AND_SERVER_ENTRY = `import { handle } from 'hono/aws-lambda';
import app from './app';

export const handler = handle(app);
export default app;
`;

const LAMBDA_ONLY_ENTRY = `import { handle } from 'hono/aws-lambda';
import app from './app';

export const handler = handle(app);
`;

const SERVER_ONLY_ENTRY = `import app from './app';

export default app;
`;

describe('SST deployment with Hono', () => {
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

  describe('Single repo: Hono without the aws-lambda library', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('sst-hono', ['--app', 'sst-hono:hono', '--deployment', 'sst']);
    });

    test('points sst.aws.Function at src/index.handler', async () => {
      const config = await readTextFile(join(projectPath, 'sst.config.ts'));
      expect(config).toContain("new sst.aws.Function('sst-hono', {");
      expect(config).toContain("handler: 'src/index.handler'");
    });

    test('exports the Lambda handler and keeps the app as default export for bun dev and start', async () => {
      expect(await readTextFile(join(projectPath, 'src/index.ts'))).toBe(LAMBDA_AND_SERVER_ENTRY);
    });
  });

  describe('Turborepo: Hono without the aws-lambda library, mixed with Next.js', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('sst-hono-mixed', ['--app', 'web:nextjs', '--app', 'api:hono', '--deployment', 'sst']);
    });

    test('points sst.aws.Function at apps/api/src/index.handler', async () => {
      const config = await readTextFile(join(projectPath, 'sst.config.ts'));
      expect(config).toContain("new sst.aws.Function('api', {");
      expect(config).toContain("handler: 'apps/api/src/index.handler'");
    });

    test('exports the Lambda handler from the Hono app entry', async () => {
      expect(await readTextFile(join(projectPath, 'apps/api/src/index.ts'))).toBe(LAMBDA_AND_SERVER_ENTRY);
    });
  });

  describe('Hono with the aws-lambda library', () => {
    test('keeps the Lambda-only entry', async () => {
      const projectPath = await generate('sst-hono-lambda', [
        '--app',
        'sst-hono-lambda:hono:aws-lambda',
        '--deployment',
        'sst',
      ]);
      expect(await readTextFile(join(projectPath, 'src/index.ts'))).toBe(LAMBDA_ONLY_ENTRY);
    });
  });

  describe('Hono without SST', () => {
    test('exports the app as default only', async () => {
      const projectPath = await generate('hono-server', ['--app', 'hono-server:hono']);
      expect(await readTextFile(join(projectPath, 'src/index.ts'))).toBe(SERVER_ONLY_ENTRY);
    });
  });
});
