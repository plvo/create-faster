import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { META } from '@/__meta__';
import { accept, cleanupTempDir, createTempDir, interrupt, runCli, runCliOnTerminal } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('mandatory answers without a terminal', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each<{ title: string; args: string[] }>([
    { title: 'a project name and --yes', args: ['demo', '--yes'] },
    { title: 'a project name alone', args: ['demo'] },
    { title: 'a project name and --no-install', args: ['demo', '--no-git', '--no-install'] },
  ])('$title without --app or --blueprint exits 1 naming both flags and writes nothing', async ({ args }) => {
    const result = await runCli(args, tempDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--app');
    expect(result.stderr).toContain('--blueprint');
    expect(result.stdout).toBe('');
    expect(await readdir(tempDir)).toEqual([]);
  });

  test.each<{ title: string; args: string[] }>([
    { title: '--yes with an app', args: ['--yes', '--app', 'demo:nextjs'] },
    { title: 'a blueprint', args: ['--blueprint', Object.keys(META.blueprints)[0] as string] },
  ])('$title without a project name exits 1 naming the argument and writes nothing', async ({ args }) => {
    const result = await runCli(args, tempDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('project name');
    expect(result.stdout).toBe('');
    expect(await readdir(tempDir)).toEqual([]);
  });

  test('no argument and no flag exits 1 naming the project name, the apps and the blueprint', async () => {
    const result = await runCli([], tempDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('project name');
    expect(result.stderr).toContain('--app');
    expect(result.stderr).toContain('--blueprint');
    expect(result.stdout).toBe('');
    expect(await readdir(tempDir)).toEqual([]);
  });
});

describe('cancelled prompt', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each<{ title: string; args: string[]; answers: ReturnType<typeof accept>[] }>([
    {
      title: 'a project category select',
      args: ['demo', '--app', 'demo:nextjs'],
      answers: [interrupt(META.project.deployment.prompt)],
    },
    {
      title: 'the stack select',
      args: ['demo'],
      answers: [accept('What would you like to create?'), accept('How many apps?'), interrupt('Stack for')],
    },
    {
      title: 'the library multiselect',
      args: ['demo'],
      answers: [
        accept('What would you like to create?'),
        accept('How many apps?'),
        accept('Stack for'),
        interrupt('libraries to'),
      ],
    },
  ])('Ctrl-C at $title exits 1 and writes nothing', async ({ args, answers }) => {
    const { exitCode } = await runCliOnTerminal(args, tempDir, answers);

    expect(exitCode).toBe(1);
    expect(await readdir(tempDir)).toEqual([]);
  }, 90_000);
});
