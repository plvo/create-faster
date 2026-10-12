import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';

describe('recreate command', () => {
  test('summary.ts appends --no-agent-context when disabled', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/tui/summary.ts'), 'utf-8');
    expect(src).toContain('--no-agent-context');
  });
});

describe('summary note', () => {
  const ctx: TemplateContext = {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [] },
    git: true,
    pm: 'bun',
  };

  let written: string[];
  let writeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    written = [];
    writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  test('lists Git and the remote steps when git init succeeded', () => {
    displaySummaryNote(ctx, false);
    const output = written.join('');

    expect(output).toMatch(/⚙️\s+Git/);
    expect(output).toContain('git remote add origin');
    expect(output).toContain('git push -u origin main');
  });

  test('drops the Git line and the remote steps and hints at git init when it failed', () => {
    displaySummaryNote(ctx, true);
    const output = written.join('');

    expect(output).not.toMatch(/⚙️\s+Git/);
    expect(output).not.toContain('git remote add origin');
    expect(output).not.toContain('git push');
    expect(output).toContain('# git init failed');
  });
});
