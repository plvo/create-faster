import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('Terraform (AWS) deployment agent docs for TanStack Start', () => {
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
    expect(agents).toContain('NITRO_PRESET=aws-lambda bun run build');
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
