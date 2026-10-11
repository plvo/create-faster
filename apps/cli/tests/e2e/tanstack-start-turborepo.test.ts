import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectOnlyMissingEnvNoticeOnStderr,
  expectServesPageWithClientScript,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';
import { expectServerNodeEnv, writeNodeEnvProbeRoute } from './node-env-probe';

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
    await writeNodeEnvProbeRoute(join(projectDir, 'apps/web'));
    await writeNodeEnvProbeRoute(join(projectDir, 'apps/admin'));
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
    'every app serves its build on its own port at the same time, and only reports the missing .env on stderr',
    async () => {
      const webDir = join(projectDir, 'apps/web');
      const adminDir = join(projectDir, 'apps/admin');
      const web = await startServer(['bun', 'run', 'start'], webDir, { port: 3000 });
      servers.push(web);
      const admin = await startServer(['bun', 'run', 'start'], adminDir, { port: 3001 });
      servers.push(admin);

      for (const server of servers) {
        await expectServesPageWithClientScript(server.url);
        await expectServerNodeEnv(server.url, 'production');
      }

      await expectOnlyMissingEnvNoticeOnStderr((await web.stop()).stderr, webDir);
      await expectOnlyMissingEnvNoticeOnStderr((await admin.stop()).stderr, adminDir);
    },
    TIMEOUT_START,
  );
});
