import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Glob } from 'bun';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['org-dashboard-nextjs', 'org-dashboard-tanstack-start', 'cloudflare-fullstack-nextjs'];

/** The text of the call whose opening parenthesis is at `open`. */
function callAt(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '(') depth++;
    if (source[index] === ')' && --depth === 0) return source.slice(open, index + 1);
  }
  return source.slice(open);
}

async function componentsOf(projectPath: string): Promise<{ file: string; source: string }[]> {
  const root = join(projectPath, 'apps/web/src');
  const components: { file: string; source: string }[] = [];
  for await (const file of new Glob('**/*.tsx').scan(root)) {
    components.push({ file, source: await readTextFile(join(root, file)) });
  }
  return components;
}

describe.each(BLUEPRINTS)('%s mutations', (blueprint) => {
  let tempDir: string;
  let components: { file: string; source: string }[];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    components = await componentsOf(join(tempDir, blueprint));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('every tRPC mutation tells the user why it failed', () => {
    const silent: string[] = [];
    let mutations = 0;
    for (const { file, source } of components) {
      for (const match of source.matchAll(/\.mutationOptions\(/g)) {
        mutations++;
        const call = callAt(source, (match.index ?? 0) + match[0].length - 1);
        if (!/onError:\s*\(\w+\)\s*=>/.test(call)) silent.push(`${file}: ${source.slice(match.index, (match.index ?? 0) + 60)}`);
      }
    }
    expect(mutations).toBeGreaterThan(0);
    expect(silent).toEqual([]);
  });

  test('a form never awaits a mutation it cannot catch', () => {
    const rejecting = components.filter(({ source }) => source.includes('.mutateAsync(')).map(({ file }) => file);
    expect(rejecting).toEqual([]);
  });
});
