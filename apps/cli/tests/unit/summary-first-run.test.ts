import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { META } from '@/__meta__';
import { displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';

describe('summary first-run steps', () => {
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

  function summarize(ctx: TemplateContext): string {
    displaySummaryNote(ctx, undefined);
    return written.join('');
  }

  function expectInOrder(output: string, commands: string[]): void {
    const positions = commands.map((command) => output.indexOf(command));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  }

  const nextjsApp = { appName: 'demo', stackName: 'nextjs' as const, libraries: [] };

  test('a Next.js app without a database goes straight to dev', () => {
    const output = summarize({
      projectName: 'demo',
      repo: 'single',
      apps: [nextjsApp],
      project: { tooling: [] },
      git: false,
      pm: 'npm',
    });

    expect(output).not.toContain('docker compose');
    expect(output).not.toContain('db:');
    expect(output).not.toContain('cp ');
    expectInOrder(output, ['cd demo', 'npm run dev']);
  });

  test('Postgres with Drizzle copies the env file, starts the database and migrates before dev', () => {
    const output = summarize({
      projectName: 'demo',
      repo: 'single',
      apps: [nextjsApp],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: false,
      pm: 'pnpm',
    });

    expectInOrder(output, [
      'cp .env.example .env',
      'docker compose up -d --wait',
      'pnpm run db:generate',
      'pnpm run db:migrate',
      'pnpm run dev',
    ]);
    expect(output).not.toContain('pnpm run db:push');
  });

  test('Prisma pushes the schema and never runs the interactive migrate', () => {
    const output = summarize({
      projectName: 'demo',
      repo: 'single',
      apps: [nextjsApp],
      project: { database: 'postgres', orm: 'prisma', tooling: [] },
      git: false,
      pm: 'bun',
    });

    expectInOrder(output, ['docker compose up -d --wait', 'bun run db:push', 'bun run dev']);
    expect(output).not.toContain('db:migrate');
  });

  test('D1 on Cloudflare has no Docker step and generates then applies the migrations', () => {
    const output = summarize({
      projectName: 'demo',
      repo: 'single',
      apps: [nextjsApp],
      project: { database: 'd1', orm: 'drizzle', deployment: 'cloudflare', tooling: [] },
      git: false,
      pm: 'npm',
    });

    expect(output).not.toContain('docker compose');
    expectInOrder(output, ['npm run db:generate', 'npm run db:migrate', 'npm run dev']);
  });

  test('a turborepo copies the env file of every app, then runs the root db scripts', () => {
    const output = summarize({
      projectName: 'demo',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: [] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
      git: false,
      pm: 'npm',
    });

    expectInOrder(output, [
      'cp apps/web/.env.example apps/web/.env',
      'docker compose up -d --wait',
      'npm run db:generate',
      'npm run db:migrate',
      'npm run dev',
    ]);
    expect(output).toContain('cp apps/api/.env.example apps/api/.env');
  });

  test('a blueprint with its own orchestrator replaces the database steps with it', () => {
    const blueprint = META.blueprints['cloudflare-fullstack'];
    const output = summarize({
      projectName: 'demo',
      repo: 'turborepo',
      apps: blueprint.context.apps,
      project: { ...blueprint.context.project, tooling: [] },
      blueprint: 'cloudflare-fullstack',
      git: false,
      pm: 'bun',
    });

    expectInOrder(output, ['cp apps/web/.env.example apps/web/.env', 'bun run local-setup', 'bun run dev']);
    expect(output).not.toContain('db:generate');
  });
});
