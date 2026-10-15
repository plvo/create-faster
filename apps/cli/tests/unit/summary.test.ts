import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { displayOutroCliCommand, displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';

describe('recreate command', () => {
  test('summary.ts appends --no-agent-context when disabled', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/tui/summary.ts'), 'utf-8');
    expect(src).toContain('--no-agent-context');
  });
});

describe('recreate command answers every prompt', () => {
  const answered: TemplateContext = {
    projectName: 'demo',
    repo: 'single',
    apps: [{ appName: 'demo', stackName: 'nextjs', libraries: [] }],
    project: { database: 'postgres', orm: 'drizzle', deployment: 'sst', linter: 'biome', tooling: ['husky'] },
    git: true,
    pm: 'bun',
  };

  function recreateCommand(ctx: TemplateContext): string {
    const written: string[] = [];
    const writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    displayOutroCliCommand(ctx, '/tmp/demo');
    writeSpy.mockRestore();
    return written.join('');
  }

  test('adds nothing when every category, git and the package manager are given', () => {
    const output = recreateCommand(answered);

    expect(output).toContain('--database postgres --orm drizzle --deployment sst --linter biome --tooling husky');
    expect(output).not.toContain('--yes');
  });

  test('adds --yes when a category is left empty, without printing it as undefined', () => {
    const output = recreateCommand({ ...answered, project: { ...answered.project, linter: undefined } });

    expect(output).toContain('--yes');
    expect(output).not.toContain('--linter');
    expect(output).not.toContain('undefined');
  });

  test('adds --yes when git is off or no package manager is chosen', () => {
    expect(recreateCommand({ ...answered, git: false })).toContain('--yes');
    expect(recreateCommand({ ...answered, pm: undefined })).toContain('--yes');
  });

  test('keeps --no-install next to the package manager when installation was skipped', () => {
    expect(recreateCommand({ ...answered, skipInstall: true })).toContain('--pm bun --no-install');
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
    displaySummaryNote(ctx, undefined, []);
    const output = written.join('');

    expect(output).toContain('Git, AGENTS.md');
    expect(output).toContain('git remote add origin');
    expect(output).toContain('git push -u origin main');
  });

  test('drops the Git line and the remote steps and hints at git init when it failed', () => {
    displaySummaryNote(ctx, { output: 'fatal: git failed' }, []);
    const output = written.join('');

    expect(output).not.toContain('Git');
    expect(output).toContain('AGENTS.md');
    expect(output).not.toContain('git remote add origin');
    expect(output).not.toContain('git push');
    expect(output).toContain('# git init failed');
  });

  test('lists a step that did not run among the next steps, after the install', () => {
    displaySummaryNote({ ...ctx, skipInstall: true }, undefined, [
      { description: 'Format the generated files', command: 'bun run format' },
    ]);
    const output = written.join('');

    expect(output.indexOf('bun install')).toBeGreaterThan(-1);
    expect(output.indexOf('# Format the generated files:')).toBeGreaterThan(output.indexOf('bun install'));
    expect(output.indexOf('bun run format')).toBeGreaterThan(output.indexOf('# Format the generated files:'));
    expect(output.indexOf('# Development:')).toBeGreaterThan(output.indexOf('bun run format'));
  });
});
