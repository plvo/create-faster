import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const STACKS = ['nextjs', 'tanstack-start'];

const POSTGRES_DRIZZLE = ['--database', 'postgres', '--orm', 'drizzle'];
const POSTGRES_PRISMA = ['--database', 'postgres', '--orm', 'prisma'];
const D1_CLOUDFLARE = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];

const SCENARIOS: { name: string; libraries: string; flags: string[] }[] = [
  { name: 'no database, no auth', libraries: 'trpc', flags: [] },
  { name: 'postgres drizzle, no auth', libraries: 'trpc', flags: POSTGRES_DRIZZLE },
  { name: 'd1, no auth', libraries: 'trpc', flags: D1_CLOUDFLARE },
  { name: 'postgres drizzle, better-auth', libraries: 'trpc,better-auth', flags: POSTGRES_DRIZZLE },
  { name: 'postgres prisma, better-auth', libraries: 'trpc,better-auth', flags: POSTGRES_PRISMA },
  { name: 'd1, better-auth', libraries: 'trpc,better-auth', flags: D1_CLOUDFLARE },
];

const REPOS = [
  { name: 'single repo', extraApps: [] as string[], initPath: 'src/trpc/init.ts' },
  { name: 'turborepo', extraApps: ['--app', 'api:hono'], initPath: 'packages/api/src/trpc.ts' },
];

/** The local names an `import` statement brings in, with the statement text removed from the source. */
function splitImports(source: string): { imported: string[]; body: string } {
  const imported: string[] = [];
  const body = source.replace(/^import\s+([^;]*?)\s+from\s+'[^']*';\n/gm, (_, clause: string) => {
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    for (const specifier of named.split(',')) {
      const local = specifier
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop();
      if (local) imported.push(local);
    }
    const defaultImport = clause.replace(/\{[^}]*\}/, '').replace(/,/, '').trim();
    if (defaultImport) imported.push(defaultImport);
    return '';
  });
  return { imported, body };
}

describe('the tRPC init file imports only what it uses', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const stack of STACKS) {
    for (const repo of REPOS) {
      for (const scenario of SCENARIOS) {
        test(`${stack}, ${repo.name}, ${scenario.name}`, async () => {
          const projectName = `trpc-imports-${stack}-${repo.name.replace(' ', '-')}-${scenario.name.replace(/\W+/g, '-')}`;
          const result = await runCli(
            [
              projectName,
              '--app',
              `web:${stack}:${scenario.libraries}`,
              ...repo.extraApps,
              ...scenario.flags,
              '--no-git',
              '--no-install',
              '--pm',
              'bun',
            ],
            tempDir,
          );
          expect(result.exitCode).toBe(0);

          const init = await readTextFile(join(tempDir, projectName, repo.initPath));
          const { imported, body } = splitImports(init);

          expect(imported).toContain('initTRPC');
          for (const name of imported) {
            expect({ name, used: new RegExp(`\\b${name}\\b`).test(body) }).toEqual({ name, used: true });
          }
        });
      }
    }
  }
});
