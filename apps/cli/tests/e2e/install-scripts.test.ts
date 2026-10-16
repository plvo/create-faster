import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

/**
 * Fails when a dependency with an install script is brought by a choice without a ruling in META (`installScripts`).
 * pnpm 11 and later fails the install on the first unreviewed script and names every one: a pnpm older than that
 * is replaced by `pnpm@12` through npx. A script blocked only on another OS (`fsevents` on macOS) is not seen here.
 */
const STRICT_PNPM_MAJOR = 11;
const FALLBACK_PNPM = ['npx', '--yes', 'pnpm@12'];
const TIMEOUT_INSTALL = 600_000;

const REPRESENTATIVE_PROJECTS = [
  {
    name: 'cloudflare-nextjs',
    args: [
      '--app',
      'web:nextjs:shadcn,posthog,pwa,better-auth,trpc,vitest,playwright',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
      '--linter',
      'biome',
    ],
  },
  {
    name: 'prisma-sst',
    args: ['--app', 'web:nextjs:trpc,tanstack-query', '--database', 'mysql', '--orm', 'prisma', '--deployment', 'sst', '--linter', 'oxc'],
  },
  {
    name: 'all-stacks-turborepo',
    args: [
      '--app',
      'web:nextjs:shadcn,vitest',
      '--app',
      'api:hono:vitest-node',
      '--app',
      'mobile:expo:nativewind,jest-expo',
      '--app',
      'site:tanstack-start:vitest',
      '--database',
      'postgres',
      '--orm',
      'prisma',
      '--deployment',
      'cloudflare',
      '--linter',
      'eslint-prettier',
      '--tooling',
      'portless',
    ],
  },
  {
    name: 'tanstack-start-sqlite',
    args: ['--app', 'web:tanstack-start:vitest,playwright', '--database', 'sqlite', '--orm', 'drizzle', '--linter', 'prettier'],
  },
  {
    name: 'hono-lambda',
    args: ['--app', 'api:hono:aws-lambda,vitest-node', '--app', 'worker:node', '--deployment', 'terraform-aws'],
  },
];

const BLUEPRINT_PROJECTS = Object.keys(META.blueprints).map((blueprint) => ({
  name: blueprint,
  args: ['--blueprint', blueprint],
}));

function strictPnpmCommand(): string[] {
  const version = Bun.spawnSync(['pnpm', '--version']).stdout.toString().trim();
  return Number.parseInt(version, 10) >= STRICT_PNPM_MAJOR ? ['pnpm'] : FALLBACK_PNPM;
}

function ignoredBuilds(output: string): string[] {
  const listed = output.match(/Ignored build scripts: ([^\n]+)/)?.[1] ?? '';
  return listed
    .replace(/\.$/, '')
    .split(', ')
    .filter((name) => name !== '');
}

describe.each([...REPRESENTATIVE_PROJECTS, ...BLUEPRINT_PROJECTS])('$name', ({ name, args }) => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'pnpm'], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test(
    'every dependency with an install script has a ruling',
    async () => {
      const install = await runCommand([...strictPnpmCommand(), 'install'], join(tempDir, name));
      expect(ignoredBuilds(`${install.stdout}\n${install.stderr}`)).toEqual([]);
      expect(install.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );
});
