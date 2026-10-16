import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import ts from 'typescript';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

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

const UNRESOLVED_NAME = [2304, 2552];
const UNUSED_IMPORT = [6133, 6192];

/**
 * Compiles the file alone, without resolving its modules: a name the file uses and never imports is an
 * unresolved name, and an import it never reads is an unused local. Everything else (missing packages, node
 * globals) is out of scope here.
 */
function importProblems(file: string): string[] {
  const program = ts.createProgram([file], {
    noResolve: true,
    noEmit: true,
    noUnusedLocals: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(file))
    .filter((diagnostic) => [...UNRESOLVED_NAME, ...UNUSED_IMPORT].includes(diagnostic.code))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('the tRPC init file imports exactly what it uses', () => {
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

          const initPath = join(tempDir, projectName, repo.initPath);
          expect(await readTextFile(initPath)).toContain('initTRPC');
          expect(importProblems(initPath)).toEqual([]);
        });
      }
    }
  }
});
