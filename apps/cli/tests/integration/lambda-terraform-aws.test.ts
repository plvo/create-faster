import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
