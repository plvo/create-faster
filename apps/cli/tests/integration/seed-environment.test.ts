import './timeout';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const LOADS_DOTENV = /^\s*import\s+['"]dotenv\/config['"]/m;
const ENV_FILE_FLAG = /--env-file(?:-if-exists)?=/;
const READS_ENVIRONMENT = /process\.env|import\.meta\.env/;
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s+['"]([^'"]+)['"]/g;
const PRISMA_SEED_COMMAND = /^prisma db seed$/;
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '/index.ts'];

const SECOND_APP = ['--app', 'api:hono'];
const DRIZZLE_DATABASES: [string, string[]][] = [
  ['postgres', []],
  ['mysql', []],
  ['sqlite', []],
  ['d1', ['--deployment', 'cloudflare']],
];
const PRISMA_DATABASES = ['postgres', 'mysql'];

function seedProjects(orm: string, database: string, extra: string[]): { name: string; args: string[] }[] {
  const project = ['--app', 'web:nextjs'];
  const choices = ['--database', database, '--orm', orm, ...extra];
  return [
    { name: `single-${orm}-${database}`, args: [...project, ...choices] },
    { name: `mono-${orm}-${database}`, args: [...project, ...SECOND_APP, ...choices] },
  ];
}

const GENERIC_SEEDS = [
  ...DRIZZLE_DATABASES.flatMap(([database, extra]) => seedProjects('drizzle', database, extra)),
  ...PRISMA_DATABASES.flatMap((database) => seedProjects('prisma', database, [])),
];

interface Manifest {
  scripts?: Record<string, string>;
}

interface Seed {
  manifest: string;
  script: string;
  file: string;
  /** Files that can load the environment before the seed code runs. */
  loaders: string[];
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) return [path];
      return entry.name === 'node_modules' ? [] : listFiles(path);
    }),
  );
  return nested.flat();
}

async function manifestsOf(project: string): Promise<string[]> {
  const workspaceDirs = await Promise.all(
    ['apps', 'packages'].map(async (group) =>
      (await readdir(join(project, group)).catch(() => [])).map((name) => join(project, group, name)),
    ),
  );
  const candidates = [project, ...workspaceDirs.flat()].map((dir) => join(dir, 'package.json'));
  const existing = await Promise.all(candidates.map(fileExists));
  return candidates.filter((_, index) => existing[index]);
}

/** The seed scripts a project runs itself: a script that runs no TypeScript file only forwards to another one (`turbo db:seed`). */
async function findSeeds(project: string): Promise<Seed[]> {
  const seeds: Seed[] = [];
  for (const manifest of await manifestsOf(project)) {
    const script = (await readJsonFile<Manifest>(manifest)).scripts?.['db:seed'];
    if (!script) continue;
    const packageDir = dirname(manifest);
    if (PRISMA_SEED_COMMAND.test(script)) {
      const config = join(packageDir, 'prisma.config.ts');
      const command = (await readTextFile(config)).match(/seed:\s*'([^']+)'/)?.[1] ?? '';
      const file = join(packageDir, command.match(/\S+\.ts\b/)?.[0] ?? '');
      seeds.push({ manifest, script: command, file, loaders: [config] });
      continue;
    }
    const runsFile = script.match(/\S+\.ts\b/)?.[0];
    if (!runsFile) continue;
    const file = join(packageDir, runsFile);
    seeds.push({ manifest, script, file, loaders: [file] });
  }
  return seeds;
}

async function sourcesImportedBy(file: string, project: string): Promise<string[]> {
  const source = await readTextFile(file);
  const resolved = await Promise.all(
    [...source.matchAll(IMPORT_SPECIFIER)].map(async ([, specifier = '']) => {
      if (specifier.startsWith('@repo/')) {
        return listFiles(join(project, 'packages', specifier.split('/')[1] ?? '', 'src'));
      }
      const base = specifier.startsWith('@/')
        ? join(project, 'src', specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(dirname(file), specifier)
          : undefined;
      if (!base) return [];
      for (const extension of SOURCE_EXTENSIONS) {
        const candidate = `${base}${extension}`;
        if (candidate.match(/\.[a-z]+$/) && (await fileExists(candidate))) return [candidate];
      }
      return [];
    }),
  );
  return resolved.flat();
}

/** Every source the seed pulls in, itself included: a database client it imports reads DATABASE_URL. */
async function reachableFrom(seed: string, project: string): Promise<string[]> {
  const visited = new Set<string>();
  const queue = [seed];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (visited.has(file)) continue;
    visited.add(file);
    queue.push(...(await sourcesImportedBy(file, project)));
  }
  return [...visited];
}

async function expectSeedsLoadTheirEnvironment(project: string): Promise<number> {
  const seeds = await findSeeds(project);
  for (const seed of seeds) {
    expect(await fileExists(seed.file), `${seed.manifest}: ${seed.script} runs a file that does not exist`).toBe(true);
    const reachable = await reachableFrom(seed.file, project);
    const readsEnvironment = (await Promise.all(reachable.map(readTextFile))).some((source) =>
      READS_ENVIRONMENT.test(source),
    );
    if (!readsEnvironment) continue;

    const loaders = await Promise.all(seed.loaders.map(readTextFile));
    const loadsEnvironment = ENV_FILE_FLAG.test(seed.script) || loaders.some((source) => LOADS_DOTENV.test(source));
    expect(
      loadsEnvironment,
      `${seed.manifest}: \`${seed.script}\` reads process.env and loads no .env (no \`import 'dotenv/config'\` in ${seed.loaders.join(', ')}, no --env-file)`,
    ).toBe(true);
  }
  return seeds.length;
}

describe('seeds load their environment under Node', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'npm'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    return join(tempDir, name);
  }

  const checkedSeeds: number[] = [];

  test.each(Object.keys(META.blueprints))('blueprint %s', async (blueprint) => {
    const project = await generate(`seed-${blueprint}`, ['--blueprint', blueprint]);

    checkedSeeds.push(await expectSeedsLoadTheirEnvironment(project));
  });

  test.each(GENERIC_SEEDS)('generic seed $name', async ({ name, args }) => {
    const project = await generate(`seed-${name}`, args);

    expect(await expectSeedsLoadTheirEnvironment(project)).toBeGreaterThan(0);
  });

  test('the blueprints ship seeds that were checked', () => {
    expect(checkedSeeds.filter((count) => count > 0).length).toBeGreaterThan(3);
  });
});
