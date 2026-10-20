import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import type { StackName } from '@/types/stack-name';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

describe('--help output', () => {
  let dir: string;
  let help: string;

  beforeAll(async () => {
    dir = await createTempDir();
    help = (await runCli(['--help'], dir)).stdout;
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('every blueprint used in an example exists in META', () => {
    const examples = [...help.matchAll(/--blueprint (\S+)/g)]
      .map(([, name = '']) => name)
      .filter((name) => !name.startsWith('<'));

    expect(examples.length).toBeGreaterThan(0);
    for (const name of examples) {
      expect(META.blueprints).toHaveProperty(name);
    }
  });

  test('prints no empty-array default for a repeatable option', () => {
    expect(help).toContain('--app <name:stack:libraries>');
    expect(help).toContain('--tooling <name>');
    expect(help).not.toContain('(default: [])');
  });

  test('shows the project directory as optional and says it can be a path', () => {
    const usage = help.split('\n').find((line) => line.startsWith('Usage:')) ?? '';

    expect(usage).toContain('[project-dir]');
    expect(usage).not.toContain('<project-dir>');
    expect(usage).not.toContain('<project-name>');
    expect(help).toMatch(/project-dir\s+.*path/);
  });

  test('lists the stacks each library supports, as META declares them', () => {
    for (const [name, library] of Object.entries(META.libraries)) {
      const supported = Object.keys(META.stacks).filter((stack) => isLibraryCompatible(library, stack as StackName));
      const line = help.split('\n').find((candidate) => candidate.trim().startsWith(`${name} `));

      expect(line, `${name} should have a line`).toBeDefined();
      expect(line?.trim().slice(name.length).trim().split(', ')).toEqual(supported);
    }
  });

  test('wraps the prompts paragraph at the width the options wrap at', () => {
    const lines = help.split('\n');
    const promptsAt = lines.findIndex((line) => line.startsWith('Prompts:'));
    const paragraph = lines.slice(promptsAt + 1, lines.indexOf('', promptsAt));

    const widestOption = Math.max(...lines.slice(0, promptsAt).filter((l) => l.startsWith('  -')).map((l) => l.length));
    expect(paragraph.length).toBeGreaterThan(1);
    expect(Math.max(...paragraph.map((line) => line.length))).toBeLessThanOrEqual(widestOption);
  });
});
