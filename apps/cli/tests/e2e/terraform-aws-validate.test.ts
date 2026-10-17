import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INIT = 300_000;

const terraformAvailable = Boolean(Bun.which('terraform'));
if (!terraformAvailable) {
  console.warn('Skipping terraform-aws validate e2e: terraform is not installed');
}
const describeWithTerraform = describe.skipIf(!terraformAvailable);

// No profile, no region and no credentials: `terraform validate` must not need any, as in a fresh CI job before the OIDC step.
const NO_AWS_ENVIRONMENT = {
  AWS_CONFIG_FILE: '/dev/null',
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
  AWS_PROFILE: '',
  AWS_REGION: '',
  AWS_DEFAULT_REGION: '',
  AWS_ACCESS_KEY_ID: '',
  AWS_SECRET_ACCESS_KEY: '',
  AWS_SESSION_TOKEN: '',
};

// Both projects download the same providers once.
const PLUGIN_CACHE_DIR = join(tmpdir(), 'create-faster-terraform-plugin-cache');

const PROJECTS = [
  { name: 'tf-blueprint', args: ['--blueprint', 'lambda-terraform-aws-hono'] },
  { name: 'tf-single', args: ['--app', 'tf-single:hono', '--deployment', 'terraform-aws'] },
];

describeWithTerraform.each(PROJECTS)('Terraform (AWS) configuration of $name', ({ name, args }) => {
  let infraDir: string;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    infraDir = join(tempDir, name, 'infra');
    await mkdir(PLUGIN_CACHE_DIR, { recursive: true });
    const init = await runCommand(['terraform', 'init', '-backend=false', '-input=false'], infraDir, {
      ...NO_AWS_ENVIRONMENT,
      TF_PLUGIN_CACHE_DIR: PLUGIN_CACHE_DIR,
    });
    expect(init.exitCode, init.stderr).toBe(0);
  }, TIMEOUT_INIT);

  afterAll(async () => {
    if (infraDir) await cleanupTempDir(join(infraDir, '../..'));
  });

  test('validates without a profile, a region or credentials', async () => {
    const result = await runCommand(['terraform', 'validate'], infraDir, NO_AWS_ENVIRONMENT);

    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  });

  test('is formatted', async () => {
    const result = await runCommand(['terraform', 'fmt', '-check', '-recursive'], infraDir, NO_AWS_ENVIRONMENT);

    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  });
});
