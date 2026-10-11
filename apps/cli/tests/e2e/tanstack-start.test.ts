import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectOnlyMissingEnvNoticeOnStderr,
  expectServesPageWithClientScript,
  runCli,
  runCommand,
  startServer,
} from './helpers';
import { expectServerFnsRejectCrossSiteRequests, writeCsrfProbeRoute } from './csrf-probe';
import { expectServerNodeEnv, writeNodeEnvProbeRoute } from './node-env-probe';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 180_000;
const TIMEOUT_START = 60_000;

describe('tanstack-start', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['tanstack-start', '--app', 'tanstack-start:tanstack-start', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start');
    await writeNodeEnvProbeRoute(projectDir);
    await writeCsrfProbeRoute(projectDir);
    installResult = await runCommand(['bun', 'install'], projectDir);
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
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'start serves the built app and its client assets, and only reports the missing .env on stderr',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      let stderr = '';
      try {
        await expectServesPageWithClientScript(server.url);
      } finally {
        ({ stderr } = await server.stop());
      }
      await expectOnlyMissingEnvNoticeOnStderr(stderr, projectDir);
    },
    TIMEOUT_START,
  );

  test(
    'start runs the server with NODE_ENV=production, which Node does not set on its own',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        await expectServerNodeEnv(server.url, 'production');
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );

  test(
    'start rejects a cross-site server function call and serves a same-origin one, with Start default protection',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        await expectServerFnsRejectCrossSiteRequests(server.url);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );
});
