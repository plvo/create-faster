import { afterAll, beforeAll, describe, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 1_200_000;
const OUTPUT_TAIL_LINES = 60;

// `prettier` is left out: it only formats and defines no lint script.
const LINTERS = ['biome', 'oxc', 'eslint', 'eslint-prettier'];

const BLUEPRINTS = [
  'dapp-privy',
  'dapp-rainbowkit',
  'lambda-sst',
  'lambda-terraform-aws',
  'org-dashboard',
  'multitenant-saas',
  'cloudflare-static-site',
  'cloudflare-fullstack',
  'showcase',
];

const PROJECTS: { name: string; args: string[] }[] = [
  {
    name: 'next-loaded',
    args: [
      '--app',
      'next-loaded:nextjs:shadcn,next-themes,mdx,pwa,tanstack-query,tanstack-devtools,react-hook-form,tanstack-form,better-auth,trpc,posthog,evlog,vitest,playwright',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ],
  },
  {
    name: 'next-prisma',
    args: ['--app', 'next-prisma:nextjs:shadcn,trpc,better-auth', '--database', 'postgres', '--orm', 'prisma'],
  },
  {
    name: 'start-loaded',
    args: [
      '--app',
      'start-loaded:tanstack-start:shadcn,next-themes,tanstack-query,tanstack-devtools,react-hook-form,tanstack-form,better-auth,trpc,posthog,evlog,vitest,playwright',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ],
  },
  { name: 'hono-single', args: ['--app', 'hono-single:hono:vitest-node'] },
  { name: 'node-single', args: ['--app', 'node-single:node:vitest-node'] },
  { name: 'expo-single', args: ['--app', 'expo-single:expo:nativewind,jest-expo'] },
  { name: 'next-cloudflare', args: ['--app', 'next-cloudflare:nextjs:shadcn', '--deployment', 'cloudflare'] },
  { name: 'start-cloudflare', args: ['--app', 'start-cloudflare:tanstack-start:shadcn', '--deployment', 'cloudflare'] },
  { name: 'hono-cloudflare', args: ['--app', 'hono-cloudflare:hono', '--deployment', 'cloudflare'] },
  {
    name: 'turbo-all-stacks',
    args: [
      '--app',
      'web:nextjs:shadcn,tanstack-query,better-auth,trpc,evlog,vitest',
      '--app',
      'admin:tanstack-start:shadcn,tanstack-query,evlog',
      '--app',
      'api:hono:vitest-node',
      '--app',
      'mobile:expo:nativewind,jest-expo',
      '--app',
      'worker:node',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ],
  },
  {
    name: 'turbo-prisma',
    args: [
      '--app',
      'web:nextjs:shadcn,better-auth,trpc',
      '--app',
      'api:hono',
      '--database',
      'mysql',
      '--orm',
      'prisma',
    ],
  },
  {
    name: 'turbo-cloudflare',
    args: [
      '--app',
      'web:nextjs:shadcn',
      '--app',
      'admin:tanstack-start:shadcn',
      '--app',
      'api:hono',
      '--deployment',
      'cloudflare',
    ],
  },
  ...BLUEPRINTS.map((blueprint) => ({ name: blueprint, args: ['--blueprint', blueprint] })),
];

interface PackageManifest {
  scripts?: Record<string, string>;
}

async function readManifest(dir: string): Promise<PackageManifest | undefined> {
  const path = join(dir, 'package.json');
  return existsSync(path) ? (JSON.parse(await readFile(path, 'utf8')) as PackageManifest) : undefined;
}

function workspaceDirs(projectDir: string): string[] {
  const nested = ['apps', 'packages'].flatMap((group) => {
    const groupDir = join(projectDir, group);
    return existsSync(groupDir) ? readdirSync(groupDir).map((name) => join(groupDir, name)) : [];
  });
  return [projectDir, ...nested];
}

// Steps a developer runs by hand before the first build: Wrangler binding types and the Prisma client.
async function prepareBuild(projectDir: string): Promise<void> {
  for (const dir of workspaceDirs(projectDir)) {
    const scripts = (await readManifest(dir))?.scripts ?? {};
    const steps = ['cf-typegen', 'cf:typegen'].filter((name) => scripts[name]);
    if (scripts['db:generate']?.startsWith('prisma generate')) steps.push('db:generate');
    for (const step of steps) {
      const result = await runCommand(['bun', 'run', step], dir);
      if (result.exitCode !== 0) throw new Error(`${step} failed in ${dir}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

async function expectLintPasses(projectDir: string, moment: string): Promise<void> {
  const result = await runCommand(['bun', 'run', 'lint'], projectDir);
  if (result.exitCode === 0) return;
  const tail = `${result.stdout}\n${result.stderr}`.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
  throw new Error(`\`bun run lint\` exited ${result.exitCode} ${moment}:\n${tail}`);
}

// The build outcome is not asserted: the other e2e files own it. What matters here is that
// whatever the build writes (or leaves half written) is never linted.
describe('generated projects pass their own lint script', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const linter of LINTERS) {
    for (const { name, args } of PROJECTS) {
      test(
        `${linter}: ${name}`,
        async () => {
          const generated = await runCli(
            [name, ...args, '--linter', linter, '--no-git', '--no-install', '--pm', 'bun'],
            tempDir,
          );
          if (generated.exitCode !== 0) throw new Error(`generation failed:\n${generated.stdout}\n${generated.stderr}`);

          const projectDir = join(tempDir, name);
          const install = await runCommand(['bun', 'install'], projectDir);
          if (install.exitCode !== 0) throw new Error(`install failed:\n${install.stderr}`);
          await prepareBuild(projectDir);

          try {
            await expectLintPasses(projectDir, 'before the build');
            if ((await readManifest(projectDir))?.scripts?.build) {
              await runCommand(['bun', 'run', 'build'], projectDir);
              await expectLintPasses(projectDir, 'after the build');
            }
          } finally {
            await cleanupTempDir(projectDir);
          }
        },
        TIMEOUT_PROJECT,
      );
    }
  }
});
