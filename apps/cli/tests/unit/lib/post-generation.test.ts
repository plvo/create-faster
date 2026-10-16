import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { runPostGeneration } from '@/lib/post-generation';
import { buildInstallFailureMessage } from '@/tui/install-failure';
import { displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';
import { cleanupTempDir, createTempDir, fileExists } from '../../integration/helpers';

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

  async function writeManifestWithFormatScript(formatScript: string) {
    await mkdir(join(projectPath, 'dependency'));
    await writeFile(
      join(projectPath, 'dependency', 'package.json'),
      JSON.stringify({ name: 'dependency', version: '1.0.0' }),
    );
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        dependencies: { dependency: 'file:./dependency' },
        scripts: { format: formatScript },
      }),
    );
  }

  test('runs the script of a selected addon after the install, inside the repository', async () => {
    await writeManifestWithFormatScript('test -d node_modules/dependency && test -d .git && echo ran > formatted.txt');

    const result = await runPostGeneration(contextWith({ pm: 'bun', git: true, project: { tooling: [], linter: 'prettier' } }), projectPath);

    expect(result.pendingPostGenerate).toEqual([]);
    expect(await readFile(join(projectPath, 'formatted.txt'), 'utf8')).toBe('ran\n');
  });

  test('initializes git before the install so an install script finds the repository', async () => {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        scripts: { prepare: 'test -d .git && echo ran > prepared.txt' },
      }),
    );

    const result = await runPostGeneration(contextWith({ pm: 'bun', git: true }), projectPath);

    expect(result.installFailure).toBeUndefined();
    expect(await readFile(join(projectPath, 'prepared.txt'), 'utf8')).toBe('ran\n');
  });

  test('keeps the repository when the install fails', async () => {
    await writeManifest({ unresolvable: 'file:./does-not-exist' });

    const result = await runPostGeneration(contextWith({ pm: 'bun', git: true }), projectPath);

    expect(result.installFailure).toBeDefined();
    expect(await fileExists(join(projectPath, '.git'))).toBe(true);
  });

  test('a failing step does not fail the run and is reported with its command', async () => {
    await writeManifestWithFormatScript('echo "cannot parse src/app.ts" >&2; exit 1');

    const result = await runPostGeneration(
      contextWith({ pm: 'bun', git: true, project: { tooling: [], linter: 'prettier' } }),
      projectPath,
    );

    expect(result.installFailure).toBeUndefined();
    expect(result.gitFailure).toBeUndefined();
    expect(result.pendingPostGenerate).toEqual([
      { description: expect.any(String), command: 'bun run format', output: expect.stringContaining('cannot parse') },
    ]);
    expect(await fileExists(join(projectPath, '.git'))).toBe(true);
  });

  test('does not run the steps with skipInstall and reports them as still to run', async () => {
    await writeManifestWithFormatScript('echo ran > formatted.txt');

    const result = await runPostGeneration(
      contextWith({ pm: 'bun', skipInstall: true, project: { tooling: [], linter: 'prettier' } }),
      projectPath,
    );

    expect(await fileExists(join(projectPath, 'formatted.txt'))).toBe(false);
    expect(result.pendingPostGenerate.map(({ command }) => command)).toEqual(['bun run format']);
  });

  test('does not run the steps when the install fails', async () => {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        dependencies: { unresolvable: 'file:./does-not-exist' },
        scripts: { format: 'echo ran > formatted.txt' },
      }),
    );

    const result = await runPostGeneration(
      contextWith({ pm: 'bun', project: { tooling: [], linter: 'prettier' } }),
      projectPath,
    );

    expect(result.installFailure).toBeDefined();
    expect(await fileExists(join(projectPath, 'formatted.txt'))).toBe(false);
  });

  test('reports a failed git init separately from the install', async () => {
    const missingDirectory = join(projectPath, 'missing');

    const result = await runPostGeneration(contextWith({ git: true, skipInstall: true }), missingDirectory);

    expect(result.gitFailure).toBeDefined();
    expect(result.installFailure).toBeUndefined();
  });

  test('reports a git init that fails with no output as a failure and hints at the manual git init', async () => {
    const silentGitDirectory = join(projectPath, 'silent-git-bin');
    await mkdir(silentGitDirectory);
    await writeFile(join(silentGitDirectory, 'git'), '#!/bin/sh\nexit 1\n');
    await chmod(join(silentGitDirectory, 'git'), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${silentGitDirectory}${delimiter}${originalPath}`;
    const ctx = contextWith({ git: true, skipInstall: true });
    const written: string[] = [];
    spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    try {
      const result = await runPostGeneration(ctx, projectPath);
      displaySummaryNote(ctx, result.gitFailure, result.pendingPostGenerate);

      expect(result.gitFailure).toEqual({ output: '' });
      expect(written.join('')).toContain('# git init failed');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('buildInstallFailureMessage', () => {
  const failure = { command: 'pnpm install', output: 'ERR_PNPM_NO_MATCHING_VERSION' };

  test('says the files were generated and the install failed, without claiming success', () => {
    const message = buildInstallFailureMessage('../out/demo', failure);

    expect(message).toContain('Project files were generated');
    expect(message).toContain('dependency install failed');
    expect(message).toContain('ERR_PNPM_NO_MATCHING_VERSION');
    expect(message).not.toContain('created successfully');
  });

  test('gives the exact command to retry in the project directory', () => {
    expect(buildInstallFailureMessage('../out/demo', failure)).toContain('cd ../out/demo && pnpm install');
  });

  test('quotes a project directory the shell would split', () => {
    expect(buildInstallFailureMessage('../my dir/demo', failure)).toContain("cd '../my dir/demo' && pnpm install");
  });
});
