import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

interface TurboTask {
  dependsOn?: string[];
  cache?: boolean;
  outputs?: string[];
}

interface PackageManifest {
  scripts: Record<string, string>;
}

async function generate(name: string, args: string[]): Promise<{ tempDir: string; projectPath: string }> {
  const tempDir = await createTempDir();
  const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode).toBe(0);
  return { tempDir, projectPath: join(tempDir, name) };
}

const readTurboTasks = async (projectPath: string) =>
  (await readJsonFile<{ tasks: Record<string, TurboTask> }>(join(projectPath, 'turbo.json'))).tasks;

describe('Prisma turborepo: first run from a fresh clone', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    ({ tempDir, projectPath } = await generate('prisma-turbo', [
      '--app',
      'web:nextjs:better-auth,trpc',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'prisma',
    ]));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('dev and build generate the client first, and a cached generate restores it', async () => {
    const tasks = await readTurboTasks(projectPath);
    expect(tasks.dev?.dependsOn).toContain('^db:generate');
    expect(tasks.build?.dependsOn).toEqual(['^build', '^db:generate']);
    expect(tasks['db:generate']?.outputs).toEqual(['generated/**']);
  });

  test('db:migrate runs in the db package because turbo stream mode never forwards stdin', async () => {
    const root = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(root.scripts['db:migrate']).toBe('cd packages/db && bun run db:migrate');
    expect(root.scripts['db:push']).toBe('turbo db:push');
    expect(root.scripts['db:generate']).toBe('turbo db:generate');
  });

  test('README starts the database then pushes the schema, without the interactive migrate', async () => {
    const readme = await readTextFile(join(projectPath, 'README.md'));
    const docker = readme.indexOf('docker compose up -d --wait');
    const push = readme.indexOf('bun run db:push');
    expect(docker).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(docker);
    expect(readme).not.toContain('bun run db:migrate');
  });

  test('the Prisma note says the client is generated before dev and build', async () => {
    const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agents).toContain('`bun run db:generate`');
    expect(agents).toContain('before `dev` and `build`');
  });
});

describe('Drizzle turborepo: first run from a fresh clone', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    ({ tempDir, projectPath } = await generate('drizzle-turbo', [
      '--app',
      'web:nextjs:better-auth,trpc',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('build and dev do not run drizzle-kit generate', async () => {
    const tasks = await readTurboTasks(projectPath);
    expect(tasks.build?.dependsOn).toEqual(['^build']);
    expect(tasks.dev?.dependsOn).toBeUndefined();
  });

  test('db:generate writes migration files into the source tree, so a cache hit must not skip it', async () => {
    const tasks = await readTurboTasks(projectPath);
    expect(tasks['db:generate']?.cache).toBe(false);
  });

  test('db:push runs in the db package, drizzle-kit asks for confirmation; generate and migrate never prompt', async () => {
    const root = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(root.scripts['db:push']).toBe('cd packages/db && bun run db:push');
    expect(root.scripts['db:generate']).toBe('turbo db:generate');
    expect(root.scripts['db:migrate']).toBe('turbo db:migrate');
  });

  test('README starts the database, generates the migrations, then applies them', async () => {
    const readme = await readTextFile(join(projectPath, 'README.md'));
    const docker = readme.indexOf('docker compose up -d --wait');
    const generateStep = readme.indexOf('bun run db:generate');
    expect(generateStep).toBeGreaterThan(docker);
    expect(readme.indexOf('bun run db:migrate')).toBeGreaterThan(generateStep);
    expect(readme).not.toContain('bun run db:push');
  });
});

describe('Prisma single repo: first run from a fresh clone', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    ({ tempDir, projectPath } = await generate('prisma-single', [
      '--app',
      'prisma-single:nextjs',
      '--database',
      'mysql',
      '--orm',
      'prisma',
    ]));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('predev and prebuild generate the client', async () => {
    const pkg = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(pkg.scripts.predev).toBe('prisma generate');
    expect(pkg.scripts.prebuild).toBe('prisma generate');
  });

  test('db:migrate is the Prisma command itself, with stdin attached', async () => {
    const pkg = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(pkg.scripts['db:migrate']).toBe('prisma migrate dev');
  });

  test('README starts the database then pushes the schema', async () => {
    const readme = await readTextFile(join(projectPath, 'README.md'));
    expect(readme.indexOf('bun run db:push')).toBeGreaterThan(readme.indexOf('docker compose up -d --wait'));
    expect(readme).not.toContain('bun run db:migrate');
  });
});

describe('Drizzle single repo with SQLite: first run from a fresh clone', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    ({ tempDir, projectPath } = await generate('drizzle-sqlite', [
      '--app',
      'drizzle-sqlite:nextjs',
      '--database',
      'sqlite',
      '--orm',
      'drizzle',
    ]));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('no client generation hook', async () => {
    const pkg = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(pkg.scripts.predev).toBeUndefined();
    expect(pkg.scripts.prebuild).toBeUndefined();
  });

  test('README generates the migrations then applies them, with no container step', async () => {
    const readme = await readTextFile(join(projectPath, 'README.md'));
    expect(readme.indexOf('bun run db:migrate')).toBeGreaterThan(readme.indexOf('bun run db:generate'));
    expect(readme).not.toContain('docker compose');
    expect(readme).not.toContain('bun run db:push');
  });
});

describe('Drizzle on D1: first run from a fresh clone', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    ({ tempDir, projectPath } = await generate('drizzle-d1', [
      '--app',
      'drizzle-d1:nextjs',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('README generates the migrations before applying them, with no container and no remote push', async () => {
    const readme = await readTextFile(join(projectPath, 'README.md'));
    const generateStep = readme.indexOf('bun run db:generate');
    expect(generateStep).toBeGreaterThan(-1);
    expect(readme.indexOf('bun run db:migrate')).toBeGreaterThan(generateStep);
    expect(readme).not.toContain('docker compose');
    expect(readme).not.toContain('bun run db:push');
  });

  test('local-setup generates the migrations it applies', async () => {
    const pkg = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(pkg.scripts['local-setup']).toStartWith('bun run db:generate && wrangler d1 migrations apply');
  });
});

describe('Blueprint: the root db scripts come from the ORM, not from a blueprint copy', () => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    ({ tempDir, projectPath } = await generate('blueprint-db', ['--blueprint', 'org-dashboard']));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db:push keeps stdin, the other db scripts go through turbo', async () => {
    const root = await readJsonFile<PackageManifest>(join(projectPath, 'package.json'));
    expect(root.scripts['db:push']).toBe('cd packages/db && bun run db:push');
    expect(root.scripts['db:migrate']).toBe('turbo db:migrate');
    expect(root.scripts['db:studio']).toBe('turbo db:studio');
  });
});
