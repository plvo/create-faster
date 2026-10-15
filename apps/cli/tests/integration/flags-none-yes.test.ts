import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
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
const multiSelectCategories = categoryNames.filter((name) => META.project[name].selection === 'multi');
const promptOf = (name: ProjectCategoryName) => META.project[name].prompt;

describe('--yes and none', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('every project category flag accepts none', async () => {
    const result = await runCli(
      [
        'demo',
        '--app',
        'demo:nextjs',
        '--database',
        'none',
        '--orm',
        'none',
        '--deployment',
        'none',
        '--linter',
        'none',
        '--tooling',
        'none',
        '--no-git',
        '--no-install',
      ],
      tempDir,
    );

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'demo', 'package.json'))).toBe(true);
    expect(await fileExists(join(tempDir, 'demo', 'docker-compose.yml'))).toBe(false);
  });

  test.each(multiSelectCategories)('--%s none mixed with a value is rejected', async (category) => {
    const [firstOption] = Object.keys(META.project[category].options);
    const result = await runCli(
      ['demo', '--app', 'demo:nextjs', `--${category}`, 'none', `--${category}`, firstOption as string],
      tempDir,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`--${category} none`);
    expect(await readdir(tempDir)).toEqual([]);
  });

  test('--orm needs a database that --database none does not provide', async () => {
    const result = await runCli(
      ['demo', '--app', 'demo:nextjs', '--database', 'none', '--orm', 'drizzle', '--no-git', '--no-install'],
      tempDir,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ORM requires a database');
  });

  test('a blueprint run accepts none for the categories it leaves open', async () => {
    const result = await runCli(
      ['demo', '--blueprint', 'dapp-privy-nextjs', '--linter', 'none', '--no-git', '--no-install'],
      tempDir,
    );

    expect(result.exitCode).toBe(0);
  });

  test('without a terminal a missing git flag means no git and a missing package manager flag means no install', async () => {
    const result = await runCli(['demo', '--app', 'demo:nextjs'], tempDir);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(tempDir, 'demo', 'package.json'))).toBe(true);
    expect(await fileExists(join(tempDir, 'demo', '.git'))).toBe(false);
    expect(await fileExists(join(tempDir, 'demo', 'node_modules'))).toBe(false);
  });

  test('--yes in a terminal asks no project, git or package manager question', async () => {
    const { exitCode, output } = await runCliOnTerminal(['demo', '--app', 'demo:nextjs', '--yes'], tempDir, []);

    expect(exitCode).toBe(0);
    for (const name of categoryNames) {
      expect(output).not.toContain(promptOf(name));
    }
    expect(output).not.toContain('Initialize');
    expect(await fileExists(join(tempDir, 'demo', 'package.json'))).toBe(true);
    expect(await fileExists(join(tempDir, 'demo', '.git'))).toBe(false);
  }, 90_000);

  test('a category stated as none is not asked in a terminal, the others are', async () => {
    const asked = categoryNames.filter((name) => name !== 'database' && name !== 'orm');

    const { exitCode, output } = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs', '--database', 'none', '--no-git', '--no-install'],
      tempDir,
      asked.map((name) => accept(promptOf(name))),
    );

    expect(exitCode).toBe(0);
    expect(output).not.toContain(promptOf('database'));
    expect(output).not.toContain(promptOf('orm'));
  }, 90_000);

  test('the printed recreate command rebuilds the same project without a single prompt', async () => {
    const firstRun = await runCliOnTerminal(
      ['demo', '--app', 'demo:nextjs', '--no-git', '--no-install'],
      tempDir,
      categoryNames.map((name) => (name === 'database' ? pickFirstOption(promptOf(name)) : accept(promptOf(name)))),
    );
    expect(firstRun.exitCode).toBe(0);

    const recreate = firstRun.output
      .split('following command:')[1]
      ?.replaceAll('\\\r\n', ' ')
      .replaceAll('\\\n', ' ')
      .trim()
      .split(/\s+/);
    expect(recreate?.slice(0, 2)).toEqual(['npx', 'create-faster']);

    const secondDir = await createTempDir();
    try {
      const secondRun = await runCliOnTerminal((recreate as string[]).slice(2), secondDir, []);

      expect(secondRun.exitCode).toBe(0);
      expect(await listFiles(join(secondDir, 'demo'))).toEqual(await listFiles(join(tempDir, 'demo')));
    } finally {
      await cleanupTempDir(secondDir);
    }
  }, 120_000);
});

async function listFiles(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).sort();
}
