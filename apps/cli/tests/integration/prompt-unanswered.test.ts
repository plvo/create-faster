import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import type { ProjectCategoryName } from '@/types/meta';
import {
  accept,
  cleanupTempDir,
  createTempDir,
  fileExists,
  pickFirstOption,
  runCli,
  runCliOnTerminal,
} from './helpers';

const categoryNames = Object.keys(META.project) as ProjectCategoryName[];
const promptOf = (name: ProjectCategoryName) => META.project[name].prompt;

describe('project prompts for categories no flag answered', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('an interactive terminal is asked every category the flags left out', async () => {
    const asked = categoryNames.filter((name) => name !== 'database').map((name) => accept(promptOf(name)));

    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs', '--database', 'postgres', '--no-git', '--no-install'],
      tempDir,
      asked,
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain(promptOf('database'));
    expect(await fileExists(join(tempDir, 'demo', 'package.json'))).toBe(true);
  }, 90_000);

  test('a blueprint run is asked the categories neither the blueprint nor a flag answered', async () => {
    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--blueprint', 'dapp-privy-nextjs', '--linter', 'biome', '--no-git', '--no-install'],
      tempDir,
      [accept(promptOf('deployment')), accept(promptOf('tooling'))],
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain(promptOf('linter'));
  }, 90_000);

  test('a blueprint that fixes its deployment is not asked for one', async () => {
    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--blueprint', 'lambda-sst-hono', '--no-git', '--no-install'],
      tempDir,
      [accept(promptOf('linter')), accept(promptOf('tooling'))],
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain(promptOf('deployment'));
  }, 90_000);

  test('a library requirement a prompt can satisfy prompts the database and the orm instead of failing', async () => {
    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs:better-auth', '--no-git', '--no-install'],
      tempDir,
      [
        accept(promptOf('deployment')),
        pickFirstOption(promptOf('database')),
        pickFirstOption(promptOf('orm')),
        accept(promptOf('linter')),
        accept(promptOf('tooling')),
      ],
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain("library 'better-auth' on app");
    expect(output).not.toContain('undefined');
    expect(await fileExists(join(tempDir, 'demo', 'package.json'))).toBe(true);
  }, 90_000);

  test('a requirement the prompts leave unmet is rejected after the prompts', async () => {
    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs:better-auth', '--no-git', '--no-install'],
      tempDir,
      [accept(promptOf('deployment')), accept(promptOf('database')), accept(promptOf('linter')), accept(promptOf('tooling'))],
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("library 'better-auth' on app 'demo' requires");
    expect(await fileExists(join(tempDir, 'demo'))).toBe(false);
  }, 90_000);

  test('a tooling flag that needs a linter prompts the linter', async () => {
    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs', '--tooling', 'husky', '--git', '--no-install'],
      tempDir,
      [
        accept(promptOf('deployment')),
        accept(promptOf('database')),
        pickFirstOption(promptOf('linter')),
      ],
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain("tooling 'husky' requires");
    expect(output).not.toContain(promptOf('tooling'));
  }, 90_000);

  test('a run without a terminal asks nothing and leaves omitted categories empty', async () => {
    const result = await runCli(
      ['demo', '--app', 'demo:nextjs', '--database', 'postgres', '--no-git', '--no-install'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);
    for (const name of categoryNames) {
      expect(result.stdout).not.toContain(promptOf(name));
    }
    expect(await fileExists(join(tempDir, 'demo', 'package.json'))).toBe(true);
  });
});
