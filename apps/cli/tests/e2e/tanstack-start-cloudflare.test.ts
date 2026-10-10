import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;
const TIMEOUT_PREVIEW = 90_000;

interface Scenario {
  name: string;
  args: string[];
  startAppDirs: string[];
  workerDirs: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: 'tanstack-start-cloudflare',
    args: ['--app', 'tanstack-start-cloudflare:tanstack-start'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-d1',
    args: ['--app', 'tanstack-start-cloudflare-d1:tanstack-start', '--database', 'd1', '--orm', 'drizzle'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-postgres',
    args: ['--app', 'tanstack-start-cloudflare-postgres:tanstack-start', '--database', 'postgres', '--orm', 'drizzle'],
    startAppDirs: ['.'],
    workerDirs: ['.'],
  },
  {
    name: 'tanstack-start-cloudflare-turborepo',
    args: ['--app', 'web:tanstack-start', '--app', 'admin:tanstack-start'],
    startAppDirs: ['apps/web', 'apps/admin'],
    workerDirs: ['apps/web', 'apps/admin'],
  },
  {
    name: 'tanstack-start-cloudflare-turborepo-d1',
    args: ['--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle'],
    startAppDirs: ['apps/web'],
    workerDirs: ['apps/web', 'apps/api'],
  },
];

describe.each(SCENARIOS)('$name', ({ name, args, startAppDirs, workerDirs }) => {
  let projectDir: string;
  let installResult: CommandResult;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [name, ...args, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
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
    'generates the worker types',
    async () => {
      for (const dir of startAppDirs) {
        const result = await runCommand(['bun', 'run', 'cf-typegen'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_TYPECHECK,
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
    'wrangler deploy --dry-run succeeds',
    async () => {
      for (const dir of workerDirs) {
        const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );

  test(
    'vite preview serves the built app in workerd',
    async () => {
      for (const dir of startAppDirs) {
        const port = await getFreePort();
        const server = await startServer(['bunx', 'vite', 'preview', '--port', String(port)], join(projectDir, dir), {
          port,
        });
        servers.push(server);
        await expectServesPageWithClientScript(server.url);
      }
    },
    TIMEOUT_PREVIEW,
  );

  test(
    'type-checks',
    async () => {
      for (const dir of startAppDirs) {
        const result = await runCommand(['bunx', 'tsc', '--noEmit'], join(projectDir, dir));
        expect(result.exitCode).toBe(0);
      }
    },
    TIMEOUT_TYPECHECK,
  );
});
