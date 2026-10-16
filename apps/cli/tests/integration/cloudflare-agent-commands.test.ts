import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const PER_APP_SCRIPT = /(cd apps\/<app> && )?bun run (build:cf|preview|deploy)\b/g;

describe('Cloudflare agent notes name the commands as a user runs them', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function rootAgentNotes(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return readTextFile(join(tempDir, name, 'AGENTS.md'));
  }

  test('turborepo: build:cf, preview and deploy are per-app, so every one is run from the app directory', async () => {
    const notes = await rootAgentNotes('mono', [
      '--app',
      'web:nextjs',
      '--app',
      'docs:tanstack-start',
      '--app',
      'api:hono',
    ]);

    const invocations = [...notes.matchAll(PER_APP_SCRIPT)];
    expect(invocations.length).toBeGreaterThan(0);
    expect(invocations.filter(([, fromAppDirectory]) => !fromAppDirectory).map(([call]) => call)).toEqual([]);
    for (const script of ['build:cf', 'preview', 'deploy']) {
      expect(notes).toContain(`cd apps/<app> && bun run ${script}`);
    }
  });

  test('turborepo: each stack section names the apps it applies to', async () => {
    const notes = await rootAgentNotes('named', [
      '--app',
      'web:nextjs',
      '--app',
      'docs:nextjs',
      '--app',
      'site:tanstack-start',
      '--app',
      'api:hono',
    ]);

    expect(notes).toContain('Next.js apps: `web`, `docs`');
    expect(notes).toContain('TanStack Start apps: `site`');
    expect(notes).toContain('Hono apps: `api`');
  });

  test('turborepo: dev, build and cf-typegen stay root commands, the root runs them in every app', async () => {
    const notes = await rootAgentNotes('rootscripts', ['--app', 'docs:tanstack-start', '--app', 'api:hono']);

    expect(notes).toContain('`bun run build` — `vite build`');
    expect(notes).toContain('`bun run cf-typegen`');
    expect(notes).not.toContain('cd apps/<app> && bun run build`');
    expect(notes).not.toContain('cd apps/<app> && bun run cf-typegen');
  });

  test.each(['nextjs', 'tanstack-start', 'hono'])('single repo %s: the scripts run from the root, with no directory change', async (stack) => {
    const notes = await rootAgentNotes(`single-${stack}`, ['--app', `site:${stack}`]);

    expect(notes).toContain('`bun run deploy`');
    expect(notes).not.toContain('cd apps/');
  });
});
