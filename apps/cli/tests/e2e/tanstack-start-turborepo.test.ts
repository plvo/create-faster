import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 240_000;
const TIMEOUT_START = 90_000;

describe('tanstack-start-turborepo', () => {
  let projectDir: string;
  let installResult: CommandResult;
  const servers: RunningServer[] = [];

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'tanstack-start-turborepo',
        '--app',
        'web:tanstack-start',
        '--app',
        'admin:tanstack-start',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start-turborepo');
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
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'every app serves its build on its own port at the same time',
    async () => {
      servers.push(await startServer(['bun', 'run', 'start'], join(projectDir, 'apps/web'), { port: 3000 }));
      servers.push(await startServer(['bun', 'run', 'start'], join(projectDir, 'apps/admin'), { port: 3001 }));

      for (const server of servers) await expectServesPageWithClientScript(server.url);
    },
    TIMEOUT_START,
  );
});
