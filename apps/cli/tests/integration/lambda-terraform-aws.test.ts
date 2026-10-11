import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  readJsonFile,
  readTerraformLambdas,
  runCli,
  type TerraformLambda,
} from './helpers';

const BUILD_OUTFILE = /--outfile[= ](\S+)/;
const NODE_RUNTIME_MAJOR = /^nodejs(\d+)\./;

describe('lambda-terraform-aws blueprint', () => {
  let tempDir: string;
  let projectDir: string;
  let lambdas: TerraformLambda[];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['lambda-tf', '--blueprint', 'lambda-terraform-aws', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, 'lambda-tf');
    lambdas = await readTerraformLambdas(projectDir);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('Terraform deploys the build output of the api, cron and worker apps', () => {
    expect(lambdas.map(({ name, sourceDir }) => ({ name, sourceDir }))).toEqual(
      ['api', 'cron', 'worker'].map((name) => ({ name, sourceDir: join(projectDir, 'apps', name, 'dist') })),
    );
  });

  test('reads each function timeout, the module default or its override', () => {
    expect(lambdas.map(({ name, timeout }) => ({ name, timeout }))).toEqual([
      { name: 'api', timeout: 30 },
      { name: 'cron', timeout: 30 },
      { name: 'worker', timeout: 60 },
    ]);
  });

  test('every app types Node against the Lambda runtime major', async () => {
    const nodeTypes = await Promise.all(
      lambdas.map(async ({ name, sourceDir }) => {
        const { devDependencies } = await readJsonFile<{ devDependencies: Record<string, string> }>(
          join(dirname(sourceDir), 'package.json'),
        );
        return { name, nodeTypes: devDependencies['@types/node'] };
      }),
    );

    expect(nodeTypes).toEqual(
      lambdas.map(({ name, runtime }) => ({ name, nodeTypes: `^${runtime.match(NODE_RUNTIME_MAJOR)?.[1]}` })),
    );
  });

  // Terraform zips only `source_dir`, so no package.json `"type": "module"` reaches Lambda:
  // the bundled ES module loads only as `.mjs`, which the handler's module name resolves to.
  test('each app builds the module of its Lambda handler as an .mjs file', async () => {
    const built = await Promise.all(
      lambdas.map(async ({ name, sourceDir }) => {
        const appDir = dirname(sourceDir);
        const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(join(appDir, 'package.json'));
        return { name, outfile: join(appDir, scripts.build?.match(BUILD_OUTFILE)?.[1] ?? 'no --outfile') };
      }),
    );

    expect(built).toEqual(
      lambdas.map(({ name, sourceDir, handler }) => ({
        name,
        outfile: join(sourceDir, `${handler.slice(0, handler.lastIndexOf('.'))}.mjs`),
      })),
    );
  });
});

describe('readTerraformLambdas', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createTempDir();
    await mkdir(join(projectDir, 'infra/modules/lambda'), { recursive: true });
    await writeFile(
      join(projectDir, 'infra/main.tf'),
      'module "cron" {\n  source     = "./modules/lambda"\n  source_dir = "${var.apps_dir}/cron/dist"\n}\n',
    );
    await writeFile(
      join(projectDir, 'infra/modules/lambda/variables.tf'),
      'variable "handler" {\n  default = "index.handler"\n}\n\nvariable "runtime" {\n  default = "nodejs22.x"\n}\n\nvariable "timeout" {\n  default = 30\n}\n',
    );
  });

  afterAll(async () => {
    await cleanupTempDir(projectDir);
  });

  test('rejects a reference it cannot resolve instead of dropping it from the path', async () => {
    await expect(readTerraformLambdas(projectDir)).rejects.toThrow('var.apps_dir');
  });
});
