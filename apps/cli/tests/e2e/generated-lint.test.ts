import { afterAll, beforeAll, describe, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 1_200_000;
const OUTPUT_TAIL_LINES = 60;

// `prettier` is left out: it only formats and defines no lint script.
const LINTERS = ['biome', 'oxc', 'eslint', 'eslint-prettier'];

// Only Biome is held to zero warnings. The `lint` script of an ESLint turborepo is `turbo lint`, which does not
// forward a flag to eslint, and oxlint still warns on files unrelated to this check.
const FAIL_ON_WARNINGS_FLAGS: Record<string, string[]> = {
  biome: ['--error-on-warnings'],
};

const BLUEPRINTS = [
  'dapp-privy-nextjs',
  'dapp-rainbowkit-nextjs',
  'lambda-sst-hono',
  'lambda-terraform-aws-hono',
  'org-dashboard-nextjs',
  'org-dashboard-tanstack-start',
  'multitenant-saas-nextjs',
  'cloudflare-static-site-nextjs',
  'cloudflare-fullstack-nextjs',
  'showcase-nextjs',
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

// Steps a developer runs by hand before the first build: the .env files, Wrangler binding types and the Prisma client.
async function prepareBuild(projectDir: string): Promise<void> {
  for (const dir of workspaceDirs(projectDir)) {
    if (existsSync(join(dir, '.env.example'))) await copyFile(join(dir, '.env.example'), join(dir, '.env'));
  }

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

// A Cloudflare Next.js app is built for Workers by `build:cf` (OpenNext), which writes `.open-next` and `.wrangler`.
async function buildProject(projectDir: string): Promise<string[]> {
  const dirs = workspaceDirs(projectDir);
  const manifests = await Promise.all(dirs.map(readManifest));
  const workersBuilds = dirs.filter((_, index) => manifests[index]?.scripts?.['build:cf']);
  const builds = workersBuilds.map((dir) => ({ script: 'build:cf', dir }));
  if (manifests[0]?.scripts?.build && !workersBuilds.includes(projectDir)) {
    builds.unshift({ script: 'build', dir: projectDir });
  }

  const outcomes: string[] = [];
  for (const { script, dir } of builds) {
    const { exitCode } = await runCommand(['bun', 'run', script], dir);
    outcomes.push(`${script} exit ${exitCode}`);
  }
  return outcomes;
}

async function expectLintPasses(projectDir: string, linter: string, moment: string): Promise<void> {
  const command = ['bun', 'run', 'lint', ...(FAIL_ON_WARNINGS_FLAGS[linter] ?? [])];
  const result = await runCommand(command, projectDir);
  if (result.exitCode === 0) return;
  const tail = `${result.stdout}\n${result.stderr}`.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
  throw new Error(`\`${command.join(' ')}\` exited ${result.exitCode} ${moment}:\n${tail}`);
}

// The build outcome is logged, not asserted: the other e2e files own it. What matters here is that
// whatever the build writes (or leaves half written) is never linted.
describe('generated projects pass their own lint script (Biome also without warnings)', () => {
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

          try {
            await prepareBuild(projectDir);
            await expectLintPasses(projectDir, linter, 'before the build');
            const builds = await buildProject(projectDir);
            if (builds.length > 0) await expectLintPasses(projectDir, linter, 'after the build');
            console.log(`${linter}: ${name}: ${builds.join(', ') || 'no build script'}`);
          } finally {
            await cleanupTempDir(projectDir);
          }
        },
        TIMEOUT_PROJECT,
      );
    }
  }
});
