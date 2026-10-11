import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

interface DbClientCase {
  name: string;
  stack: 'nextjs' | 'tanstack-start';
  orm: 'drizzle' | 'prisma';
  turborepo: boolean;
}

const CASES: DbClientCase[] = [
  { name: 'nextjs single drizzle', stack: 'nextjs', orm: 'drizzle', turborepo: false },
  { name: 'nextjs single prisma', stack: 'nextjs', orm: 'prisma', turborepo: false },
  { name: 'nextjs turborepo drizzle', stack: 'nextjs', orm: 'drizzle', turborepo: true },
  { name: 'nextjs turborepo prisma', stack: 'nextjs', orm: 'prisma', turborepo: true },
  { name: 'tanstack-start single drizzle', stack: 'tanstack-start', orm: 'drizzle', turborepo: false },
  { name: 'tanstack-start single prisma', stack: 'tanstack-start', orm: 'prisma', turborepo: false },
  { name: 'tanstack-start turborepo prisma', stack: 'tanstack-start', orm: 'prisma', turborepo: true },
];

const DB_IMPORT = /^import \{ (\w+)(?: as (\w+))? \} from '(?:@repo\/db|@\/lib\/db)';$/m;

describe('tRPC context imports the client its ORM package exports', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const [index, testCase] of CASES.entries()) {
    test(testCase.name, async () => {
      const projectName = `trpc-db-${index}`;
      const result = await runCli(
        [
          projectName,
          '--app',
          `web:${testCase.stack}:trpc,better-auth`,
          ...(testCase.turborepo ? ['--app', 'api:hono'] : []),
          '--database',
          'postgres',
          '--orm',
          testCase.orm,
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      const root = join(tempDir, projectName);
      const init = await readTextFile(join(root, testCase.turborepo ? 'packages/api/src/trpc.ts' : 'src/trpc/init.ts'));
      const dbIndex = await readTextFile(
        join(root, testCase.turborepo ? 'packages/db/src/index.ts' : 'src/lib/db/index.ts'),
      );

      const [, importedName, localName] = init.match(DB_IMPORT) ?? [];
      expect(importedName).toBeDefined();
      expect(dbIndex).toMatch(new RegExp(`export (?:const|function) ${importedName}\\b`));
      expect(localName ?? importedName).toBe('db');
    });
  }
});
