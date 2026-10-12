import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPostGeneration } from '@/lib/post-generation';
import { buildInstallFailureMessage } from '@/tui/install-failure';
import type { TemplateContext } from '@/types/ctx';
import { cleanupTempDir, createTempDir } from '../../integration/helpers';

function contextWith(overrides: Partial<TemplateContext>): TemplateContext {
  return {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: false,
    ...overrides,
  };
}

describe('runPostGeneration', () => {
  let projectPath: string;

  beforeEach(async () => {
    spyOn(process.stdout, 'write').mockImplementation(() => true);
    projectPath = await createTempDir();
  });

  afterEach(async () => {
    mock.restore();
    await cleanupTempDir(projectPath);
  });

  async function writeManifest(dependencies: Record<string, string>) {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0', dependencies }),
    );
  }

  test('reports a failed install with the command and the package manager output', async () => {
    await writeManifest({ unresolvable: 'file:./does-not-exist' });

    const result = await runPostGeneration(contextWith({ pm: 'bun' }), projectPath);

    expect(result.installFailure?.command).toBe('bun install');
    expect(result.installFailure?.output).toContain('unresolvable');
  });

  test('reports no failure when the install succeeds', async () => {
    await writeManifest({});

    const result = await runPostGeneration(contextWith({ pm: 'bun' }), projectPath);

    expect(result.installFailure).toBeUndefined();
    expect(result.gitFailure).toBeUndefined();
  });

  test('does not run the install with skipInstall', async () => {
    await writeManifest({ unresolvable: 'file:./does-not-exist' });

    const result = await runPostGeneration(contextWith({ pm: 'bun', skipInstall: true }), projectPath);

    expect(result.installFailure).toBeUndefined();
  });

  test('reports a failed git init separately from the install', async () => {
    const missingDirectory = join(projectPath, 'missing');

    const result = await runPostGeneration(contextWith({ git: true, skipInstall: true }), missingDirectory);

    expect(result.gitFailure).toBeDefined();
    expect(result.installFailure).toBeUndefined();
  });
});

describe('buildInstallFailureMessage', () => {
  const failure = { command: 'pnpm install', output: 'ERR_PNPM_NO_MATCHING_VERSION' };

  test('says the files were generated and the install failed, without claiming success', () => {
    const message = buildInstallFailureMessage('demo', failure);

    expect(message).toContain('Project files were generated');
    expect(message).toContain('dependency install failed');
    expect(message).toContain('ERR_PNPM_NO_MATCHING_VERSION');
    expect(message).not.toContain('created successfully');
  });

  test('gives the exact command to retry in the project directory', () => {
    expect(buildInstallFailureMessage('demo', failure)).toContain('cd demo && pnpm install');
  });
});
