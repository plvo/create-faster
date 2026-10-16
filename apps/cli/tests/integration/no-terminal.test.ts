import './timeout';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, interrupt, runCli, runCliOnTerminal } from './helpers';

const UNANSWERABLE_PROMPTS = ['How many apps?', 'What would you like to create?', 'Name of your project?'];

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
    for (const prompt of UNANSWERABLE_PROMPTS) expect(result.stdout).not.toContain(prompt);
    expect(await readdir(tempDir)).toEqual([]);
  });

  test.each<{ title: string; args: string[] }>([
    { title: '--yes with an app', args: ['--yes', '--app', 'demo:nextjs'] },
    { title: 'a blueprint', args: ['--blueprint', Object.keys(META.blueprints)[0] as string] },
  ])('$title without a project name exits 1 naming the argument and writes nothing', async ({ args }) => {
    const result = await runCli(args, tempDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('project name');
    for (const prompt of UNANSWERABLE_PROMPTS) expect(result.stdout).not.toContain(prompt);
    expect(await readdir(tempDir)).toEqual([]);
  });

  test('no argument and no flag exits 1 naming the project name, the apps and the blueprint', async () => {
    const result = await runCli([], tempDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('project name');
    expect(result.stderr).toContain('--app');
    expect(result.stderr).toContain('--blueprint');
    for (const prompt of UNANSWERABLE_PROMPTS) expect(result.stdout).not.toContain(prompt);
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

  test('Ctrl-C at a prompt exits non-zero and writes nothing', async () => {
    const { exitCode } = await runCliOnTerminal(['demo', '--app', 'demo:nextjs'], tempDir, [
      interrupt(META.project.deployment.prompt),
    ]);

    expect(exitCode).not.toBe(0);
    expect(await readdir(tempDir)).toEqual([]);
  }, 90_000);
});
