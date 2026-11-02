import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const E2E_DIR = join(import.meta.dir, '../e2e');

// A top-level `describe` block of an e2e file, up to the next one.
function topLevelBlocks(source: string): string[] {
  return source.split(/^(?=describe(?:WithDocker)?\b)/m).filter((block) => /^describe/.test(block));
}

const usesDocker = (block: string): boolean => block.startsWith('describeWithDocker') || /'compose'/.test(block);

function dockerBlocksWithoutIsolation(): string[] {
  return readdirSync(E2E_DIR)
    .filter((file) => file.endsWith('.test.ts'))
    .flatMap((file) =>
      topLevelBlocks(readFileSync(join(E2E_DIR, file), 'utf8'))
        .filter((block) => usesDocker(block) && block.includes('generateInstalledProject('))
        .map((block) => `${file}: ${block.split('\n')[0]}`),
    );
}

describe('e2e files that start Docker', () => {
  test('generate their project with generateDockerProject, never a project name two runs share', () => {
    expect(dockerBlocksWithoutIsolation()).toEqual([]);
  });

  test('the scan sees the Docker blocks it is meant to guard', () => {
    const blocks = readdirSync(E2E_DIR)
      .filter((file) => file.endsWith('.test.ts'))
      .flatMap((file) => topLevelBlocks(readFileSync(join(E2E_DIR, file), 'utf8')))
      .filter(usesDocker);

    expect(blocks.filter((block) => block.includes('generateDockerProject(')).length).toBeGreaterThanOrEqual(6);
  });
});
