import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, matchesAny, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';
import { COMBINATIONS } from './workspace-combinations';

setIntegrationTimeout();

const PACKAGE_SOURCE = 'packages/api/src/index.ts';

async function excludedPatterns(linter: string, projectPath: string): Promise<string[]> {
  if (linter === 'biome') {
    const { files } = JSON.parse(await readTextFile(join(projectPath, 'biome.json')));
    return (files.includes as string[]).filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  }
  const config = await readTextFile(join(projectPath, 'oxlint.config.mts'));
  const list = /ignorePatterns: \[(.*)\]/.exec(config)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

describe.each(['biome', 'oxc'])('root %s config covers the workspace packages', (linter) => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(COMBINATIONS)('$name', async ({ args }) => {
    const result = await runCli(
      ['lint-root', ...args, '--linter', linter, '--no-install', '--no-git', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const projectPath = join(tempDir, 'lint-root');

    expect(matchesAny(await excludedPatterns(linter, projectPath), PACKAGE_SOURCE)).toBe(false);
    await cleanupTempDir(projectPath);
  });
});
