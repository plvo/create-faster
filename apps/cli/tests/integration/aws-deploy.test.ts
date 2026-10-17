import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const WORKFLOW_PATH = '.github/workflows/deploy.yml';
const WORKFLOW_SECRET = /secrets\.(?!GITHUB_TOKEN)(\w+)/g;
const WORKFLOW_VARIABLE = /vars\.(\w+)/g;
const WORKFLOW_ENVIRONMENT_OPTIONS = /options:\n((?:\s+- \S+\n)+)/;
const TERRAFORM_OUTPUT_READ = /output -raw (\w+)/g;
const BACKEND_FILE_REFERENCE = /backend\/(\w+)\.hcl/g;

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(name: string, args: string[], pm = 'npm'): Promise<string> {
  const result = await runCli([name, ...args, '--no-install', '--no-git', '--pm', pm], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, name);
}

const read = (project: string, path: string): Promise<string> => readTextFile(join(project, path));

const matches = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map(([, name]) => name ?? '');

const deploySection = (readme: string): string => readme.slice(readme.indexOf('## Deploying to AWS'));

const unique = (values: string[]): string[] => [...new Set(values)];

function expectInOrder(text: string, steps: string[]): void {
  const positions = steps.map((step) => {
    const position = text.indexOf(step);
    expect(position, `"${step}" is missing`).toBeGreaterThanOrEqual(0);
    return position;
  });
  expect(positions, `the steps ${steps.join(' / ')} are out of order`).toEqual([...positions].sort((a, b) => a - b));
}

async function workflowEnvironments(project: string): Promise<string[]> {
  const workflow = await read(project, WORKFLOW_PATH);
  const options = workflow.match(WORKFLOW_ENVIRONMENT_OPTIONS)?.[1] ?? '';
  return options.split('\n').flatMap((line) => line.match(/- (\S+)/)?.[1] ?? []);
}

describe('Terraform (AWS) state backend and region', () => {
  const PROJECTS = [
    { name: 'tf-blueprint', args: ['--blueprint', 'lambda-terraform-aws-hono'] },
    { name: 'tf-single', args: ['--app', 'tf-single:hono', '--deployment', 'terraform-aws'] },
  ];

  describe.each(PROJECTS)('$name', ({ name, args }) => {
    let project: string;

    beforeAll(async () => {
      project = await generate(name, args);
    });

    test.each(['dev', 'prod'])('backend/%s.hcl holds nothing that differs between a laptop and CI', async (env) => {
      const backend = await read(project, `infra/backend/${env}.hcl`);

      expect(backend).toContain('bucket');
      expect(backend).toContain(`key          = "${name}/${env}/state.tfstate"`);
      expect(backend).toContain('use_lockfile = true');
      expect(backend).not.toMatch(/^\s*profile\s*=/m);
      expect(backend).not.toMatch(/^\s*region\s*=/m);
    });

    test('the region comes from AWS_REGION alone', async () => {
      const [tfvars, variables, providers] = await Promise.all([
        read(project, 'infra/variables.auto.tfvars'),
        read(project, 'infra/variables.tf'),
        read(project, 'infra/providers.tf'),
      ]);

      expect(tfvars).not.toMatch(/region/);
      expect(variables).not.toMatch(/region/);
      expect(providers).not.toMatch(/region\s*=/);
      expect(await read(project, 'README.md')).toContain('export AWS_REGION=');
    });
  });

  describe('lambda-terraform-aws-hono', () => {
    let project: string;

    beforeAll(async () => {
      project = await generate('tf-guide', ['--blueprint', 'lambda-terraform-aws-hono']);
    });

    test('the workflow takes its region from the GitHub variable the README tells to set', async () => {
      const [workflow, readme] = await Promise.all([read(project, WORKFLOW_PATH), read(project, 'README.md')]);

      expect(workflow).toContain('aws-region: ${{ vars.AWS_REGION }}');
      for (const variable of unique(matches(workflow, WORKFLOW_VARIABLE))) {
        expect(readme, `variable ${variable}`).toContain(`gh variable set ${variable} `);
      }
      for (const secret of unique(matches(workflow, WORKFLOW_SECRET))) {
        expect(readme, `secret ${secret}`).toContain(`gh secret set ${secret} `);
      }
    });

    test('the README sets up every environment the workflow can deploy', async () => {
      const readme = await read(project, 'README.md');
      const environments = await workflowEnvironments(project);

      expect(environments).toEqual(['dev', 'prod']);
      expect(readme).toContain(`for ENVIRONMENT in ${environments.join(' ')}; do`);
    });

    test('the README is an ordered first deploy, from credentials to a live URL, then CI', async () => {
      const readme = deploySection(await read(project, 'README.md'));

      expectInOrder(readme, [
        'export AWS_PROFILE=',
        'export AWS_REGION=',
        'aws sts get-caller-identity',
        'aws s3 mb "s3://$STATE_BUCKET"',
        'put-bucket-versioning',
        'sed -i.bak "s/<BUCKET_NAME>/',
        'npm run build',
        'terraform -chdir=infra init -backend-config=backend/dev.hcl',
        'terraform -chdir=infra apply -var="env=dev"',
        'output -raw api_url',
        'create-open-id-connect-provider',
        'gh secret set AWS_ROLE_ARN',
      ]);
    });

    test('every file and output the README names exists in the project', async () => {
      const readme = await read(project, 'README.md');
      const outputs = await read(project, 'infra/outputs.tf');

      for (const output of unique(matches(readme, TERRAFORM_OUTPUT_READ))) {
        expect(outputs, `output ${output}`).toContain(`output "${output}"`);
      }
      for (const env of unique(matches(readme, BACKEND_FILE_REFERENCE))) {
        expect(await fileExists(join(project, `infra/backend/${env}.hcl`)), `backend/${env}.hcl`).toBe(true);
      }
      expect(await read(project, 'infra/backend/dev.hcl')).toContain('<BUCKET_NAME>');
    });

    test('the README asks for the lockfile the frozen install of the workflow needs', async () => {
      expect(await read(project, 'README.md')).toContain('package-lock.json');
    });

    test('the agent guide says to install just and why the backend has no profile or region', async () => {
      const guide = await read(project, 'docs/agents/infrastructure.md');

      expect(guide).toContain('Install `just`');
      expect(guide).toContain('AWS_PROFILE');
      expect(guide).toContain('AWS_REGION');
    });
  });

  describe('a Terraform project with no Lambda provisioned', () => {
    test('stops the first deploy at the backend, with nothing to apply or open', async () => {
      const project = await generate('tf-plain', ['--app', 'tf-plain:nextjs', '--deployment', 'terraform-aws'], 'bun');
      const readme = await read(project, 'README.md');

      expectInOrder(readme, [
        'export AWS_PROFILE=',
        'aws s3 mb "s3://$STATE_BUCKET"',
        'terraform -chdir=infra init -backend-config=backend/dev.hcl',
      ]);
      expect(readme).not.toContain('output -raw');
      expect(readme).not.toContain('create-open-id-connect-provider');
    });
  });
});

describe('.build/ of the Terraform Lambda module', () => {
  const PROJECTS = [
    { name: 'build-blueprint', args: ['--blueprint', 'lambda-terraform-aws-hono'] },
    { name: 'build-single', args: ['--app', 'build-single:hono', '--deployment', 'terraform-aws'] },
    { name: 'build-turbo', args: ['--app', 'web:nextjs', '--app', 'api:hono', '--deployment', 'terraform-aws'] },
  ];

  test.each(PROJECTS)('$name ignores it', async ({ name, args }) => {
    const project = await generate(name, args);

    expect((await read(project, '.gitignore')).split('\n')).toContain('.build/');
  });

  test('the module writes its zips where the .gitignore line points', async () => {
    const project = await generate('build-module', ['--blueprint', 'lambda-terraform-aws-hono']);

    expect(await read(project, 'infra/modules/lambda/main.tf')).toContain('${path.module}/../../../.build/');
  });

  test('a project without Terraform does not ignore it', async () => {
    const project = await generate('build-none', ['--app', 'build-none:nextjs']);

    expect((await read(project, '.gitignore')).split('\n')).not.toContain('.build/');
  });
});

describe('SST first deploy guide', () => {
  describe('lambda-sst-hono', () => {
    let project: string;

    beforeAll(async () => {
      project = await generate('sst-guide', ['--blueprint', 'lambda-sst-hono']);
    });

    test('the README is an ordered first deploy, from credentials to a live URL, then CI', async () => {
      const readme = deploySection(await read(project, 'README.md'));

      expectInOrder(readme, [
        'export AWS_PROFILE=',
        'export AWS_REGION=',
        'aws sts get-caller-identity',
        'npx sst install',
        'npx sst dev',
        'npx sst deploy --stage staging',
        ".sst/outputs.json').api",
        'create-open-id-connect-provider',
        'gh secret set AWS_ROLE_ARN',
      ]);
    });

    test('says why the root tsc fails until sst install has run', async () => {
      const readme = await read(project, 'README.md');

      expect(readme).toContain("Cannot find name '$config'");
    });

    test('the README sets up every stage the workflow can deploy, with the names it reads', async () => {
      const [readme, workflow] = await Promise.all([read(project, 'README.md'), read(project, WORKFLOW_PATH)]);
      const stages = await workflowEnvironments(project);

      expect(stages).toEqual(['staging', 'production']);
      expect(readme).toContain(`for ENVIRONMENT in ${stages.join(' ')}; do`);
      expect(readme).toContain('npx sst deploy --stage staging');
      for (const variable of unique(matches(workflow, WORKFLOW_VARIABLE))) {
        expect(readme, `variable ${variable}`).toContain(`gh variable set ${variable} `);
      }
      for (const secret of unique(matches(workflow, WORKFLOW_SECRET))) {
        expect(readme, `secret ${secret}`).toContain(`gh secret set ${secret} `);
      }
    });

    test('the output the README reads is one sst.config.ts returns', async () => {
      expect(await read(project, 'sst.config.ts')).toContain('api: api.url');
    });
  });

  describe('an SST project with no workflow', () => {
    test('covers the deploy, not the GitHub setup, under the package manager of the project', async () => {
      const project = await generate('sst-plain', ['--app', 'sst-plain:nextjs', '--deployment', 'sst'], 'bun');
      const readme = await read(project, 'README.md');

      expectInOrder(readme, [
        'export AWS_PROFILE=',
        'export AWS_REGION=',
        'bunx sst install',
        'bunx sst deploy --stage',
      ]);
      expect(readme).not.toContain('create-open-id-connect-provider');
      expect(await fileExists(join(project, WORKFLOW_PATH))).toBe(false);
    });
  });

  describe('a project with no AWS deployment', () => {
    test('has no AWS section', async () => {
      const project = await generate('no-aws', ['--app', 'no-aws:nextjs']);

      expect(await read(project, 'README.md')).not.toContain('AWS_PROFILE');
    });
  });
});
