import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand, startServer } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_DB = 120_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_START = 60_000;

interface Topology {
  name: string;
  args: string[];
  appDir: string;
  dbPackageDir: string;
  dbImport: string;
}

const TOPOLOGIES: Topology[] = [
  {
    name: 'tanstack-start-sqlite-single',
    args: ['--app', 'tanstack-start-sqlite-single:tanstack-start'],
    appDir: '.',
    dbPackageDir: '.',
    dbImport: '@/lib/db',
  },
  {
    name: 'tanstack-start-sqlite-turbo',
    args: ['--app', 'web:tanstack-start', '--app', 'admin:tanstack-start'],
    appDir: 'apps/web',
    dbPackageDir: 'packages/db',
    dbImport: '@repo/db',
  },
];

function dbProbeRoute(dbImport: string): string {
  return `import { createFileRoute } from '@tanstack/react-router'
import { db, userTable } from '${dbImport}'

export const Route = createFileRoute('/api/db-probe')({
  server: {
    handlers: {
      GET: async () => {
        await db.insert(userTable).values({ username: 'probe', email: 'probe@example.com' })
        const users = await db.select().from(userTable)
        return Response.json({ users: users.map((user) => user.username) })
      },
    },
  },
})
`;
}

describe.each(TOPOLOGIES)('$name', ({ name, args, appDir, dbPackageDir, dbImport }) => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, ...args, '--database', 'sqlite', '--orm', 'drizzle', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    await writeFile(join(projectDir, appDir, 'src/routes/api.db-probe.ts'), dbProbeRoute(dbImport));
    installResult = await runCommand(['bun', 'install'], projectDir);
    await copyFile(join(projectDir, dbPackageDir, '.env.example'), join(projectDir, dbPackageDir, '.env'));
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'db:push creates the local database file',
    async () => {
      const result = await runCommand(['bun', 'run', 'db:push', '--force'], join(projectDir, dbPackageDir));
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_DB,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'the built Nitro server loads the native sqlite binding and answers a route that queries the database',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], join(projectDir, appDir), {
        env: { DATABASE_URL: 'file:./db.sqlite' },
      });
      try {
        const response = await fetch(new URL('/api/db-probe', server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ users: ['probe'] });
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );
});
