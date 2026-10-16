import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

interface Generated {
  readme: string;
  stdout: string;
}

async function generate(tempDir: string, name: string, args: string[]): Promise<Generated> {
  const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode).toBe(0);
  return { readme: await readTextFile(join(tempDir, name, 'README.md')), stdout: result.stdout };
}

function expectInOrder(text: string, commands: string[]): void {
  const positions = commands.map((command) => text.indexOf(command));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe('first-run steps shared by the README and the CLI summary', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('Drizzle on Postgres prints the same commands, in the same order, in both', async () => {
    const { readme, stdout } = await generate(tempDir, 'drizzle-app', [
      '--app',
      'web:nextjs',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    const commands = [
      'cp .env.example .env',
      'docker compose up -d --wait',
      'bun run db:generate',
      'bun run db:migrate',
      'bun run dev',
    ];

    expectInOrder(readme, commands);
    expectInOrder(stdout, commands);
  });

  test('a database without an ORM still starts the database first', async () => {
    const { readme, stdout } = await generate(tempDir, 'postgres-only', [
      '--app',
      'web:nextjs',
      '--database',
      'postgres',
    ]);

    expectInOrder(readme, ['docker compose up -d --wait', 'bun run dev']);
    expectInOrder(stdout, ['docker compose up -d --wait', 'bun run dev']);
    expect(readme).not.toContain('db:generate');
  });

  test('a blueprint with a setup script prints it instead of the ORM commands', async () => {
    const { readme, stdout } = await generate(tempDir, 'cf-blueprint', ['--blueprint', 'cloudflare-fullstack-nextjs']);

    expectInOrder(readme, ['cp apps/web/.env.example apps/web/.env', 'bun run local-setup', 'bun run dev']);
    expectInOrder(stdout, ['cp apps/web/.env.example apps/web/.env', 'bun run local-setup', 'bun run dev']);
    expect(readme).not.toContain('bun run db:generate\n');
  });
});
