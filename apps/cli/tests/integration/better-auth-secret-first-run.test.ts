import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

const GENERATE_SECRET = 'openssl rand -base64 32';

interface Generated {
  projectDir: string;
  readme: string;
  stdout: string;
}

const blueprintsWithBetterAuth = Object.entries(META.blueprints).flatMap(([name, blueprint]) => {
  const app = blueprint.context.apps.find((candidate) => candidate.libraries.includes('better-auth'));
  const ownFirstRun = 'firstRun' in blueprint && blueprint.firstRun !== undefined;
  return app ? [{ name, appName: app.appName, nextStep: ownFirstRun ? 'run local-setup' : 'docker compose up' }] : [];
});

function expectInOrder(text: string, parts: string[]): void {
  let from = 0;
  for (const part of parts) {
    const position = text.indexOf(part, from);
    expect(position, `"${part}" after offset ${from}`).toBeGreaterThanOrEqual(0);
    from = position + part.length;
  }
}

async function envFileOf(projectDir: string, appName: string): Promise<string> {
  return (await fileExists(join(projectDir, 'apps', appName, '.env.example'))) ? `apps/${appName}/.env` : '.env';
}

describe('BETTER_AUTH_SECRET first-run step', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<Generated> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    const projectDir = join(tempDir, name);
    return { projectDir, readme: await readTextFile(join(projectDir, 'README.md')), stdout: result.stdout };
  }

  test('a single repo with Better Auth generates the secret after copying the env file and before dev', async () => {
    const { projectDir, readme, stdout } = await generate('single-auth', [
      '--app',
      'web:nextjs:better-auth',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    const steps = ['cp .env.example .env', GENERATE_SECRET, 'bun run dev'];

    expectInOrder(readme, steps);
    expectInOrder(stdout, steps);
    expect(readme).toContain('Generate BETTER_AUTH_SECRET and set it in .env');
    expect(stdout).toContain('Generate BETTER_AUTH_SECRET and set it in .env');

    const example = await readTextFile(join(projectDir, '.env.example'));
    expect(example).toMatch(/^BETTER_AUTH_SECRET=\s*(#.*)?$/m);
  });

  test('a turborepo names the env file of the app that reads the secret', async () => {
    const { readme, stdout } = await generate('turbo-auth', [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'batch:node',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    const steps = ['cp apps/web/.env.example apps/web/.env', GENERATE_SECRET, 'bun run dev'];

    expectInOrder(readme, steps);
    expectInOrder(stdout, steps);
    expect(readme).toContain('Generate BETTER_AUTH_SECRET and set it in apps/web/.env');
    expect(stdout).toContain('Generate BETTER_AUTH_SECRET and set it in apps/web/.env');
  });

  test('a project without Better Auth is not asked for a secret', async () => {
    const { readme, stdout } = await generate('no-auth', ['--app', 'web:nextjs', '--database', 'postgres']);

    expect(readme).not.toContain(GENERATE_SECRET);
    expect(stdout).not.toContain(GENERATE_SECRET);
  });

  test('every blueprint with Better Auth is covered by the META scan', () => {
    expect(blueprintsWithBetterAuth.map(({ name }) => name)).toContain('org-dashboard-nextjs');
    expect(blueprintsWithBetterAuth.map(({ name }) => name)).toContain('dapp-rainbowkit-nextjs');
  });

  for (const { name, appName, nextStep } of blueprintsWithBetterAuth) {
    test(`${name} generates the secret before its own first-run steps`, async () => {
      const { projectDir, readme, stdout } = await generate(`bp-${name}`, ['--blueprint', name]);
      const envFile = await envFileOf(projectDir, appName);
      const description = `Generate BETTER_AUTH_SECRET and set it in ${envFile}`;
      const steps = [description, GENERATE_SECRET, nextStep, 'run dev'];

      expectInOrder(readme, steps);
      expectInOrder(stdout, steps);
    });
  }
});
