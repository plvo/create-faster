import './timeout';
import { readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const DOTENV_IMPORT = /^\s*import\s+['"]dotenv\/config['"]/;
const FIRST_IMPORT = /^\s*import\b.*$/m;
const NODE_RUNNERS = ['tsx', 'node'];
const SEED_FILE = /\.[cm]?[jt]s$/;
const ENV_FILE_FLAG = /^--env-file(?:-if-exists)?(?:=(.*))?$/;
const PRISMA_SEED_COMMAND = 'prisma db seed';

const KNOWN_SEEDING_BLUEPRINTS = [
  'cloudflare-fullstack-nextjs',
  'dapp-privy-nextjs',
  'dapp-rainbowkit-nextjs',
  'multitenant-saas-nextjs',
  'org-dashboard-nextjs',
  'org-dashboard-tanstack-start',
];

const DRIZZLE_DATABASES: [string, string[]][] = [
  ['postgres', []],
  ['mysql', []],
  ['sqlite', []],
  ['d1', ['--deployment', 'cloudflare']],
];
const PRISMA_DATABASES = ['postgres', 'mysql'];

function seedProjects(orm: string, database: string, extra: string[]): { name: string; args: string[] }[] {
  const web = ['--app', 'web:nextjs'];
  const choices = ['--database', database, '--orm', orm, ...extra];
  return [
    { name: `single-${orm}-${database}`, args: [...web, ...choices] },
    { name: `mono-${orm}-${database}`, args: [...web, '--app', 'api:hono', ...choices] },
  ];
}

const GENERIC_SEEDS = [
  ...DRIZZLE_DATABASES.flatMap(([database, extra]) => seedProjects('drizzle', database, extra)),
  ...PRISMA_DATABASES.flatMap((database) => seedProjects('prisma', database, [])),
];

interface Manifest {
  scripts?: Record<string, string>;
}

interface SeedCheck {
  /** The seed files that run under Node, relative to the project. */
  checked: string[];
  problems: string[];
}

interface NodeCommand {
  file: string;
  envFiles: string[];
}

/** The file a script runs through `tsx` or `node`, and the `.env` files the runner is given. */
function parseNodeCommand(script: string): NodeCommand | undefined {
  const tokens = script.split(/\s+/);
  const runner = tokens.findIndex((token) => NODE_RUNNERS.includes(token));
  if (runner < 0) return undefined;
  const envFiles: string[] = [];
  for (let index = runner + 1; index < tokens.length; index++) {
    const token = tokens[index] ?? '';
    const flag = token.match(ENV_FILE_FLAG);
    if (flag) {
      envFiles.push(flag[1] ?? tokens[++index] ?? '');
    } else if (!token.startsWith('-')) {
      return SEED_FILE.test(token) ? { file: token, envFiles } : undefined;
    }
  }
  return undefined;
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

async function loadsDotenvFirst(file: string): Promise<boolean> {
  const firstImport = (await readTextFile(file)).match(FIRST_IMPORT)?.[0];
  return firstImport !== undefined && DOTENV_IMPORT.test(firstImport);
}

/** Every `db:seed` of a project, followed through the scripts that forward to another one until a seed runs under Node. */
async function checkSeeds(project: string): Promise<SeedCheck> {
  const manifests = await manifestsOf(project);
  const scriptsOf = new Map(
    await Promise.all(
      manifests.map(async (manifest) => [manifest, (await readJsonFile<Manifest>(manifest)).scripts?.['db:seed']] as const),
    ),
  );
  const visited = new Set<string>();
  const result: SeedCheck = { checked: [], problems: [] };
  const where = (manifest: string) => relative(project, manifest);

  async function checkNodeSeed(manifest: string, script: string, command: NodeCommand): Promise<void> {
    const packageDir = dirname(manifest);
    const file = join(packageDir, command.file);
    if (!(await fileExists(file))) {
      result.problems.push(`${where(manifest)}: \`${script}\` runs ${command.file}, which does not exist`);
      return;
    }
    result.checked.push(where(file));
    for (const envFile of command.envFiles) {
      if (!(await fileExists(resolve(packageDir, `${envFile}.example`)))) {
        result.problems.push(`${where(manifest)}: \`${script}\` loads ${envFile}, which has no ${envFile}.example`);
      }
    }
    if (command.envFiles.length === 0 && !(await loadsDotenvFirst(file))) {
      result.problems.push(
        `${where(manifest)}: \`${script}\` loads no .env: no --env-file flag, and \`import 'dotenv/config'\` is not the first import of ${command.file}`,
      );
    }
  }

  async function checkPrismaSeed(manifest: string): Promise<void> {
    const config = join(dirname(manifest), 'prisma.config.ts');
    const seedCommand = (await readTextFile(config)).match(/seed:\s*'([^']+)'/)?.[1] ?? '';
    const command = parseNodeCommand(seedCommand);
    if (!command || !(await fileExists(join(dirname(manifest), command.file)))) {
      result.problems.push(`${where(config)}: the seed command \`${seedCommand}\` runs no existing file`);
      return;
    }
    result.checked.push(where(join(dirname(manifest), command.file)));
    if (!(await loadsDotenvFirst(config))) {
      result.problems.push(`${where(config)}: \`prisma db seed\` loads no .env, \`import 'dotenv/config'\` is not the first import`);
    }
  }

  function forwardTargets(manifest: string, script: string): string[] {
    const directory = script.match(/\bcd\s+(\S+)/)?.[1];
    if (directory) return [join(resolve(dirname(manifest), directory), 'package.json')];
    return manifests.filter((other) => other !== manifest && scriptsOf.get(other));
  }

  async function inspect(manifest: string): Promise<void> {
    if (visited.has(manifest)) return;
    visited.add(manifest);
    const script = scriptsOf.get(manifest);
    if (!script) {
      result.problems.push(`${where(manifest)}: a db:seed script forwards here, but it defines none`);
      return;
    }
    const command = parseNodeCommand(script);
    if (command) return checkNodeSeed(manifest, script, command);
    if (script === PRISMA_SEED_COMMAND) return checkPrismaSeed(manifest);
    if (!/\bturbo db:seed\b|\brun db:seed\b/.test(script)) {
      result.problems.push(`${where(manifest)}: \`${script}\` is neither a seed run by tsx or node nor a forward to one`);
      return;
    }
    const targets = forwardTargets(manifest, script);
    if (targets.length === 0) result.problems.push(`${where(manifest)}: \`${script}\` reaches no seed`);
    for (const target of targets) await inspect(target);
  }

  for (const manifest of manifests) {
    if (scriptsOf.get(manifest)) await inspect(manifest);
  }
  return result;
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

  const checkedByBlueprint = new Map<string, string[]>();

  test.each(Object.keys(META.blueprints))('blueprint %s', async (blueprint) => {
    const { checked, problems } = await checkSeeds(await generate(`seed-${blueprint}`, ['--blueprint', blueprint]));

    expect(problems).toEqual([]);
    checkedByBlueprint.set(blueprint, checked);
  });

  test.each(GENERIC_SEEDS)('generic seed $name', async ({ name, args }) => {
    const { checked, problems } = await checkSeeds(await generate(`seed-${name}`, args));

    expect(problems).toEqual([]);
    expect(checked.length).toBeGreaterThan(0);
  });

  test('every blueprint that seeds was checked', () => {
    const seeding = [...checkedByBlueprint].filter(([, checked]) => checked.length > 0).map(([name]) => name);

    expect(seeding.sort()).toEqual(KNOWN_SEEDING_BLUEPRINTS);
  });

  describe('the check fails when', () => {
    async function seedProblems(
      blueprint: string,
      mutate: (project: string) => Promise<void>,
    ): Promise<string[]> {
      const project = await generate(`mutated-${blueprint}-${Math.random().toString(36).slice(2, 8)}`, [
        '--blueprint',
        blueprint,
      ]);
      await mutate(project);
      return (await checkSeeds(project)).problems;
    }

    async function setScript(manifest: string, script: string): Promise<void> {
      const content = await readJsonFile<Manifest>(manifest);
      await writeFile(manifest, JSON.stringify({ ...content, scripts: { ...content.scripts, 'db:seed': script } }));
    }

    const loaderless = [
      "import { db } from '../src/lib/db';\nawait db.query();\n",
      "const { db } = await import('../src/lib/db');\nawait db.query();\n",
    ];

    test.each(['.ts', '.mts', '.cts', '.js', '.mjs'])('a %s seed has no loader', async (extension) => {
      for (const body of loaderless) {
        const problems = await seedProblems('dapp-privy-nextjs', async (project) => {
          await rename(join(project, 'scripts/seed.ts'), join(project, `scripts/seed${extension}`));
          await writeFile(join(project, `scripts/seed${extension}`), body);
          await setScript(join(project, 'package.json'), `tsx scripts/seed${extension}`);
        });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('loads no .env');
      }
    });

    test('a .mts seed imports dotenv first', async () => {
      const problems = await seedProblems('dapp-privy-nextjs', async (project) => {
        await rename(join(project, 'scripts/seed.ts'), join(project, 'scripts/seed.mts'));
        await setScript(join(project, 'package.json'), 'tsx scripts/seed.mts');
      });

      expect(problems).toEqual([]);
    });

    test('dotenv is imported after another import', async () => {
      const problems = await seedProblems('dapp-privy-nextjs', async (project) => {
        const seed = join(project, 'scripts/seed.ts');
        await writeFile(seed, `import { db } from '../src/lib/db';\n${await readTextFile(seed)}`);
      });

      expect(problems).toHaveLength(1);
    });

    test('--env-file points at a file that has no .example', async () => {
      const problems = await seedProblems('org-dashboard-nextjs', async (project) => {
        await setScript(join(project, 'package.json'), 'tsx --env-file=apps/wbe/.env scripts/seed.ts');
      });

      expect(problems).toEqual([expect.stringContaining('apps/wbe/.env, which has no apps/wbe/.env.example')]);
    });

    test('a script that forwards reaches a seed that is not run by tsx or node', async () => {
      const problems = await seedProblems('org-dashboard-nextjs', async (project) => {
        await setScript(join(project, 'package.json'), 'echo seeded');
      });

      expect(problems.some((problem) => problem.includes('neither a seed run by tsx or node'))).toBe(true);
    });

    test('a script that forwards to another package finds no db:seed there', async () => {
      const problems = await seedProblems('org-dashboard-nextjs', async (project) => {
        await setScript(join(project, 'packages/db/package.json'), 'cd ../../apps/web && npm run db:seed');
      });

      expect(problems).toEqual([expect.stringContaining('forwards here, but it defines none')]);
    });
  });
});
