import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_DEPLOY_DRY_RUN = 120_000;

const NAME = 'nextjs-cloudflare';

describe(NAME, () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [NAME, '--app', `${NAME}:nextjs`, '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, NAME);
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
    'build:cf builds the OpenNext worker',
    async () => {
      const result = await runCommand(['bun', 'run', 'build:cf'], projectDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.match(/▲ Next\.js/g)).toHaveLength(1);
    },
    TIMEOUT_BUILD,
  );

  // The build only inlines the literal process.env.NODE_ENV, so the Worker takes NODE_ENV from its vars: without
  // it, runtime reads by tRPC, better-auth and other dependencies see "development". A request-time check through `preview` is blocked by
  // opennextjs-cloudflare#1355 (Next.js 16.4 answers 500 on every route), so the deployed config is asserted.
  test(
    'wrangler deploy --dry-run ships the NODE_ENV=production Worker variable',
    async () => {
      const result = await runCommand(['bunx', 'wrangler', 'deploy', '--dry-run'], projectDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('env.NODE_ENV ("production")');
    },
    TIMEOUT_DEPLOY_DRY_RUN,
  );
});
