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

  function printedOutput(ctx: TemplateContext): string {
    const written: string[] = [];
    const writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    displayOutroCliCommand(ctx, '/tmp/demo');
    writeSpy.mockRestore();
    return written.join('');
  }

  function recreateCommand(ctx: TemplateContext): string {
    return printedOutput(ctx).replaceAll('\\\n  ', '');
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

  test.each([
    ['a--b/my--app', 'a--b/my--app'],
    ['../my dir--x/my--app', "'../my dir--x/my--app'"],
  ])('a long command wraps only before flags, keeping the directory %s whole', (projectDir, printedDir) => {
    const ctx = { ...answered, projectName: 'my--app', projectDir };
    const lines = printedOutput(ctx).split('following command:')[1]?.trim().split('\n') ?? [];

    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0]).toContain(`create-faster ${printedDir} \\`);
    for (const line of lines.slice(1)) {
      expect(line).toStartWith('  --');
    }
    expect(recreateCommand(ctx)).toContain(`create-faster ${printedDir} --app demo:nextjs --database postgres`);
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

  test('commits before it pushes, on a branch named main', () => {
    displaySummaryNote(ctx, undefined, []);
    const output = written.join('');
    const gitBlock = output.slice(output.indexOf('# Git:'));
    const steps = ['git add .', 'git commit -m', 'git branch -M main', 'git remote add origin', 'git push -u origin main'];
    const positions = steps.map((step) => gitBlock.indexOf(step));

    expect(output).toContain('# Git:');
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('titles the sections without a literal #', () => {
    displaySummaryNote(ctx, undefined, []);
    const output = written.join('');

    expect(output).toContain('🏠 Structure:');
    expect(output).toContain('💡 Next steps:');
    expect(output).not.toContain('#🏠');
    expect(output).not.toContain('#💡');
  });

  test('counts one library in the singular and several in the plural', () => {
    const withLibraries = (libraries: string[]) => ({ ...ctx, apps: [{ appName: 'demo', stackName: 'nextjs' as const, libraries }] });

    displaySummaryNote(withLibraries(['shadcn']), undefined, []);
    expect(written.join('')).toContain('+1 library');
    written.length = 0;

    displaySummaryNote(withLibraries(['shadcn', 'mdx']), undefined, []);
    expect(written.join('')).toContain('+2 libraries');
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

  function manualGitInitIndex(output: string): number {
    const index = output.search(/│\s+git init\s+│/);
    expect(index).toBeGreaterThan(-1);
    return index;
  }

  test('puts the manual git init before the install when the install is still to run', () => {
    displaySummaryNote({ ...ctx, skipInstall: true }, { output: 'fatal: git failed' }, []);
    const output = written.join('');

    expect(output.match(/bun install/g)).toHaveLength(1);
    expect(output.indexOf('bun install')).toBeGreaterThan(manualGitInitIndex(output));
  });

  test('lists the install again after the manual git init when the install already ran', () => {
    displaySummaryNote(ctx, { output: 'fatal: git failed' }, []);
    const output = written.join('');

    expect(output).toContain('so install scripts find the repository');
    expect(output.indexOf('bun install')).toBeGreaterThan(manualGitInitIndex(output));
    expect(output.indexOf('# Development:')).toBeGreaterThan(output.indexOf('bun install'));
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

  describe('production steps', () => {
    const oneApp = (stackName: 'hono' | 'nextjs', deployment?: string): TemplateContext => ({
      ...ctx,
      apps: [{ appName: 'demo', stackName, libraries: [] }],
      project: { deployment, tooling: [] },
    });

    test('a Hono app has no build script, so the summary does not run one', () => {
      displaySummaryNote(oneApp('hono'), undefined, []);
      const output = written.join('');

      expect(output).not.toContain('bun run build');
      expect(output).toContain('bun run start');
    });

    test('an Expo app has no dev script, so the summary has no development step', () => {
      displaySummaryNote({ ...ctx, apps: [{ appName: 'demo', stackName: 'expo', libraries: [] }] }, undefined, []);
      const output = written.join('');

      expect(output).not.toContain('# Development:');
      expect(output).not.toContain('run dev');
    });

    test('a turborepo shows the app-only scripts of its deployment from the app directory', () => {
      const apps = [
        { appName: 'web', stackName: 'nextjs' as const, libraries: [] },
        { appName: 'docs', stackName: 'nextjs' as const, libraries: [] },
      ];
      displaySummaryNote(
        { ...ctx, repo: 'turborepo', apps, project: { deployment: 'cloudflare', tooling: [] } },
        undefined,
        [],
      );

      const output = written.join('');

      expect(output).toContain('(cd apps/web && bun run deploy)');
      expect(output).toContain('(cd apps/docs && bun run deploy)');
      expect(output).not.toContain('<app>');
    });

    test('a Next.js app on Cloudflare lists the Worker build, the preview and the deploy, and no start', () => {
      displaySummaryNote(oneApp('nextjs', 'cloudflare'), undefined, []);
      const output = written.join('');
      const steps = ['bun run build ', 'bun run build:cf', 'bun run preview', 'bun run deploy'];
      const positions = steps.map((step) => output.indexOf(step));

      expect(positions).not.toContain(-1);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(output).not.toContain('bun run start');
    });
  });
});
