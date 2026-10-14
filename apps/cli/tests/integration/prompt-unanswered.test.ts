import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import type { ProjectCategoryName } from '@/types/meta';
import { PLAIN_OUTPUT_ENV } from '../plain-output-env';
import { cleanupTempDir, createTempDir, fileExists, runCli } from './helpers';

const ENTER = '\r';
const PROMPT_TIMEOUT_MS = 30_000;

const categoryNames = Object.keys(META.project) as ProjectCategoryName[];
const promptOf = (name: ProjectCategoryName) => META.project[name].prompt;

/** Runs the CLI on a pseudo-terminal and presses enter on each expected prompt as it appears. */
async function runCliOnTerminal(args: string[], cwd: string, expectedPrompts: string[]) {
  const cliPath = join(import.meta.dir, '../../src/index.ts');
  let output = '';

  const proc = Bun.spawn([process.execPath, 'run', cliPath, ...args], {
    cwd,
    env: { ...process.env, ...PLAIN_OUTPUT_ENV },
    terminal: {
      cols: 120,
      rows: 40,
      data: (_terminal, chunk) => {
        output += new TextDecoder().decode(chunk);
      },
    },
  });

  try {
    let searchFrom = 0;
    for (const prompt of expectedPrompts) {
      const deadline = Date.now() + PROMPT_TIMEOUT_MS;
      while (output.indexOf(prompt, searchFrom) === -1) {
        if (Date.now() > deadline) throw new Error(`Prompt "${prompt}" never appeared. Output:\n${output}`);
        await Bun.sleep(50);
      }
      searchFrom = output.length;
      await Bun.sleep(100);
      proc.terminal?.write(ENTER);
    }
    return { exitCode: await proc.exited, output };
  } finally {
    proc.kill();
  }
}

describe('project prompts for categories no flag answered', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('an interactive terminal is asked every category the flags left out', async () => {
    const asked = categoryNames.filter((name) => name !== 'database').map(promptOf);

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
      ['demo', '--blueprint', 'dapp-privy', '--linter', 'biome', '--no-git', '--no-install'],
      tempDir,
      [promptOf('deployment'), promptOf('tooling')],
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain(promptOf('linter'));
  }, 90_000);

  test('a blueprint that fixes its deployment is not asked for one', async () => {
    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--blueprint', 'lambda-sst', '--no-git', '--no-install'],
      tempDir,
      [promptOf('linter'), promptOf('tooling')],
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain(promptOf('deployment'));
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
