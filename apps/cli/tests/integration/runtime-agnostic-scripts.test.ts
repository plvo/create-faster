import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm'] as const;
const BUN_API = /\bBun\.|bun:|#!\/usr\/bin\/env bun/;
// tsx runs a file of a package without "type": "module" as CommonJS, which has no top-level await.
const TOP_LEVEL_AWAIT = /^await /m;

interface Manifest {
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function runnerOf(pm: (typeof PACKAGE_MANAGERS)[number]): string {
  return pm === 'bun' ? 'bun' : 'tsx';
}

function forwarded(pm: (typeof PACKAGE_MANAGERS)[number], script: string, args: string): string {
  return `${pm} run ${script} ${pm === 'npm' ? '-- ' : ''}${args}`;
}

async function generate(name: string, args: string[], pm: string): Promise<{ dir: string; project: string }> {
  const dir = await createTempDir();
  const result = await runCli([name, ...args, '--no-install', '--no-git', '--pm', pm], dir);
  expect(result.exitCode).toBe(0);
  return { dir, project: join(dir, name) };
}

describe.each(['org-dashboard-nextjs', 'multitenant-saas-nextjs'])('%s scripts under every package manager', (blueprint) => {
  describe.each([...PACKAGE_MANAGERS])('with %s', (pm) => {
    let dir: string;
    let project: string;

    beforeAll(async () => {
      ({ dir, project } = await generate(`${blueprint}-${pm}`, ['--blueprint', blueprint], pm));
    });

    afterAll(async () => {
      await cleanupTempDir(dir);
    });

    test('local-setup and seed use no Bun API and no shebang', async () => {
      for (const file of ['scripts/local-setup.ts', 'scripts/seed.ts']) {
        const source = await readTextFile(join(project, file));
        expect(source.match(BUN_API)).toBeNull();
        expect(source).not.toMatch(TOP_LEVEL_AWAIT);
        if (pm !== 'bun') expect(source.match(/\bbun\b/)).toBeNull();
      }
    });

    test('local-setup runs the schema push and the seed through the package manager', async () => {
      const source = await readTextFile(join(project, 'scripts/local-setup.ts'));

      expect(source).toContain(forwarded(pm, 'db:push', '--force'));
      expect(source).toContain(forwarded(pm, 'db:seed', '--fixtures'));
      expect(source).toContain(`then run \`${pm} run dev\``);
    });

    test('the seed usage names the package manager', async () => {
      const source = await readTextFile(join(project, 'scripts/seed.ts'));

      expect(source).toContain(`Usage: ${pm} run db:seed [options]`);
    });

    test('the root scripts run the TypeScript files with the runner of the package manager', async () => {
      const { scripts, devDependencies } = await readJsonFile<Manifest>(join(project, 'package.json'));

      expect(scripts['local-setup']).toBe(`${runnerOf(pm)} scripts/local-setup.ts`);
      expect(scripts['db:seed']).toContain(`${runnerOf(pm)} --env-file=`);
      expect(scripts['db:seed']).toContain('scripts/seed.ts');
      expect(Boolean(devDependencies?.tsx)).toBe(pm !== 'bun');
    });

    test('the db package seed script goes back to the root through the package manager', async () => {
      const { scripts } = await readJsonFile<Manifest>(join(project, 'packages/db/package.json'));

      expect(scripts['db:seed']).toBe(`cd ../.. && ${pm} run db:seed`);
    });
  });
});

describe.each([...PACKAGE_MANAGERS])('generic seed with %s', (pm) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    ({ dir, project } = await generate(
      `seed-${pm}`,
      ['--app', 'web:nextjs', '--database', 'postgres', '--orm', 'drizzle'],
      pm,
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('db:seed runs the seed with the runner of the package manager', async () => {
    const { scripts, devDependencies } = await readJsonFile<Manifest>(join(project, 'package.json'));

    expect(scripts['db:seed']).toBe(`${runnerOf(pm)} scripts/seed.ts`);
    expect(Boolean(devDependencies?.tsx)).toBe(pm !== 'bun');
  });

  test('the seed loads .env before the database client reads DATABASE_URL', async () => {
    const source = await readTextFile(join(project, 'scripts/seed.ts'));

    expect(source.indexOf("import 'dotenv/config'")).toBe(0);
    expect(source.match(BUN_API)).toBeNull();
  });
});

describe.each([...PACKAGE_MANAGERS])('prisma seed with %s', (pm) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    ({ dir, project } = await generate(
      `prisma-${pm}`,
      ['--app', 'web:nextjs', '--database', 'postgres', '--orm', 'prisma'],
      pm,
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('prisma db seed runs the seed with the runner of the package manager', async () => {
    const config = await readTextFile(join(project, 'prisma.config.ts'));
    const { devDependencies } = await readJsonFile<Manifest>(join(project, 'package.json'));

    expect(config).toContain(`seed: '${runnerOf(pm)} scripts/seed.ts'`);
    expect(Boolean(devDependencies?.tsx)).toBe(pm !== 'bun');
    expect(await fileExists(join(project, 'scripts/seed.ts'))).toBe(true);
  });
});

describe.each([...PACKAGE_MANAGERS])('cloudflare-fullstack-nextjs scripts with %s', (pm) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    ({ dir, project } = await generate(`fullstack-${pm}`, ['--blueprint', 'cloudflare-fullstack-nextjs'], pm));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('local-setup and seed use no Bun API', async () => {
    for (const file of ['scripts/local-setup.ts', 'scripts/seed.ts']) {
      const source = await readTextFile(join(project, file));
      expect(source.match(BUN_API)).toBeNull();
      expect(source).not.toMatch(TOP_LEVEL_AWAIT);
      if (pm !== 'bun') expect(source.match(/\bbun\b/)).toBeNull();
    }
  });

  test('local-setup runs every script through the package manager', async () => {
    const source = await readTextFile(join(project, 'scripts/local-setup.ts'));

    for (const script of ['db:generate', 'db:migrate', 'cf-typegen', 'dev']) {
      expect(source).toContain(`${pm} run ${script}`);
    }
    expect(source).toContain(forwarded(pm, 'db:seed', '--fixtures'));
  });

  test('the seed opens the local D1 file with libsql and names the package manager', async () => {
    const source = await readTextFile(join(project, 'scripts/seed.ts'));
    const { devDependencies } = await readJsonFile<Manifest>(join(project, 'package.json'));

    expect(source).toContain("from '@libsql/client'");
    expect(source).toContain(`Usage: ${pm} run db:seed [options]`);
    expect(devDependencies?.['@libsql/client']).toBeDefined();
  });

  test('the root scripts run the TypeScript files with the runner of the package manager', async () => {
    const { scripts } = await readJsonFile<Manifest>(join(project, 'package.json'));

    expect(scripts['local-setup']).toBe(`${runnerOf(pm)} scripts/local-setup.ts`);
    expect(scripts['db:seed']).toBe(
      `BETTER_AUTH_URL=http://localhost:3000 ${runnerOf(pm)} --env-file=apps/web/.env scripts/seed.ts`,
    );
  });
});

describe.each([...PACKAGE_MANAGERS])('d1 with %s', (pm) => {
  let dir: string;
  let project: string;

  beforeAll(async () => {
    ({ dir, project } = await generate(
      `d1-${pm}`,
      ['--app', 'api:hono', '--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'],
      pm,
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('the seed opens the local D1 file with libsql, with no Bun API or Bun types', async () => {
    const seed = await readTextFile(join(project, 'packages/db/scripts/seed.ts'));
    const { devDependencies } = await readJsonFile<Manifest>(join(project, 'packages/db/package.json'));
    const tsconfig = await readTextFile(join(project, 'packages/db/tsconfig.json'));

    expect(seed).toContain("from '@libsql/client'");
    expect(seed).toContain(`Run \`${pm} run db:migrate:local\` first.`);
    expect(seed.match(BUN_API)).toBeNull();
    expect(devDependencies?.['@types/bun']).toBeUndefined();
    expect(tsconfig).not.toContain('"bun"');
  });

  test('the local-setup script of the db package re-enters its scripts through the package manager', async () => {
    const { scripts } = await readJsonFile<Manifest>(join(project, 'packages/db/package.json'));

    expect(scripts['local-setup']).toStartWith(`${pm} run db:generate && wrangler`);
    expect(scripts['local-setup']).toEndWith(`&& ${pm} run db:seed`);
    expect(scripts['db:seed']).toBe(`${runnerOf(pm)} scripts/seed.ts`);
  });
});
