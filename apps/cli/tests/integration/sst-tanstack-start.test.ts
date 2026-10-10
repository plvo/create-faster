import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
}

describe('SST deployment with TanStack Start', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo: TanStack Start alone', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, 'sst-start');
      const result = await runCli(
        ['sst-start', '--app', 'sst-start:tanstack-start', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('deploys the app with sst.aws.TanStackStart at the project root', async () => {
      const config = await readTextFile(join(projectPath, 'sst.config.ts'));
      expect(config).toContain("new sst.aws.TanStackStart('sst-start'");
      expect(config).not.toContain('sst.aws.Function');
      expect(config).not.toContain('path:');
      expect(config).toContain("'sst-start': sstStart.url");
    });

    test('selects the aws-lambda Nitro preset for the SST build only', async () => {
      const config = await readTextFile(join(projectPath, 'sst.config.ts'));
      expect(config).toContain("NITRO_PRESET: 'aws-lambda'");

      const viteConfig = await readTextFile(join(projectPath, 'vite.config.ts'));
      expect(viteConfig).not.toContain('aws-lambda');

      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'package.json'));
      expect(pkg.scripts.build).toBe('vite build');
      expect(pkg.scripts.build).not.toContain('NITRO_PRESET');
      expect(pkg.scripts.start).toBe('node --env-file=.env.start .output/server/index.mjs');
    });
  });

  describe('Turborepo: TanStack Start mixed with Next.js and Hono', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, 'sst-mixed');
      const result = await runCli(
        [
          'sst-mixed',
          '--app',
          'web:nextjs',
          '--app',
          'site:tanstack-start',
          '--app',
          'api:hono',
          '--deployment',
          'sst',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('points sst.aws.TanStackStart at the app directory', async () => {
      const config = await readTextFile(join(projectPath, 'sst.config.ts'));
      expect(config).toContain("new sst.aws.TanStackStart('site', {");
      expect(config).toContain("path: 'apps/site/'");
      expect(config).toContain("NITRO_PRESET: 'aws-lambda'");
    });

    test('keeps the Next.js and Hono resources unchanged', async () => {
      const config = await readTextFile(join(projectPath, 'sst.config.ts'));
      expect(config).toContain("new sst.aws.Nextjs('web', {");
      expect(config).toContain("path: 'apps/web/'");
      expect(config).toContain("handler: 'apps/api/src/index.handler'");
      expect(config.match(/NITRO_PRESET/g)).toHaveLength(1);
    });

    test('keeps the default build of the Start app free of the preset', async () => {
      const pkg = await readJsonFile<PackageJsonShape>(join(projectPath, 'apps', 'site', 'package.json'));
      expect(pkg.scripts.build).toBe('vite build');
      const viteConfig = await readTextFile(join(projectPath, 'apps', 'site', 'vite.config.ts'));
      expect(viteConfig).not.toContain('aws-lambda');
    });
  });

  describe('Without a TanStack Start app', () => {
    test('does not set the Nitro preset', async () => {
      const result = await runCli(
        ['sst-next', '--app', 'sst-next:nextjs', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      const config = await readTextFile(join(tempDir, 'sst-next', 'sst.config.ts'));
      expect(config).not.toContain('NITRO_PRESET');
      expect(config).not.toContain('TanStackStart');
    });
  });
});

describe('terraform-aws agent docs for TanStack Start', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('documents the Lambda deploy in AGENTS.md of a single repo with a Start app', async () => {
    const result = await runCli(
      ['tf-start', '--app', 'tf-start:tanstack-start', '--deployment', 'terraform-aws', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const agents = await readTextFile(join(tempDir, 'tf-start', 'AGENTS.md'));
    expect(agents).toContain('## Terraform (AWS)');
    expect(agents).toContain('NITRO_PRESET=aws-lambda');
    expect(agents).toContain("serveStatic: 'inline'");
    expect(agents).toContain('6 MB');
    expect(agents).toContain('.output/server');
  });

  test('documents it once at the root of a Turborepo, naming only the Start apps', async () => {
    const result = await runCli(
      [
        'tf-mixed',
        '--app',
        'web:nextjs',
        '--app',
        'site:tanstack-start',
        '--deployment',
        'terraform-aws',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const agents = await readTextFile(join(tempDir, 'tf-mixed', 'AGENTS.md'));
    expect(agents).toContain('NITRO_PRESET=aws-lambda');
    expect(agents).toContain('apps/site/.output/server');
    expect(agents).not.toContain('apps/web/.output');
  });

  test('stays silent when no app is TanStack Start', async () => {
    const result = await runCli(
      ['tf-next', '--app', 'tf-next:nextjs', '--deployment', 'terraform-aws', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const agents = await readTextFile(join(tempDir, 'tf-next', 'AGENTS.md'));
    expect(agents).not.toContain('aws-lambda');
    expect(agents).not.toContain('## Terraform (AWS)');
  });

  test('does not document the Lambda deploy under SST, which provisions it', async () => {
    const result = await runCli(
      ['sst-docs', '--app', 'sst-docs:tanstack-start', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const agents = await readTextFile(join(tempDir, 'sst-docs', 'AGENTS.md'));
    expect(agents).not.toContain('serveStatic');
  });
});
