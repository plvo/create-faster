import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const COMMON = ['--no-git', '--no-install', '--pm', 'bun'];

type PackageScripts = { scripts: Record<string, string> };

const databaseNameOf = (wrangler: string) => wrangler.match(/"database_name": "([^"]+)"/)?.[1];
const databaseIdOf = (wrangler: string) => wrangler.match(/"database_id": "([^"]+)"/)?.[1];

describe('D1 turborepo: every Worker shares one database and one local state', () => {
  const projectName = 'd1-shared-turbo';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:tanstack-start:better-auth,trpc',
        '--app',
        'worker:hono',
        '--app',
        'site:nextjs',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        ...COMMON,
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('all Workers bind the same D1 database name and id', async () => {
    const configs = await Promise.all(
      ['web', 'worker', 'site'].map((app) => readTextFile(join(projectPath, `apps/${app}/wrangler.jsonc`))),
    );
    expect(new Set(configs.map(databaseNameOf))).toEqual(new Set([`${projectName}-db`]));
    expect(new Set(configs.map(databaseIdOf)).size).toBe(1);
  });

  test('every Worker local preview persists to the workspace-root state the migrate script writes', async () => {
    const previews = await Promise.all(
      ['site', 'worker'].map(async (app) => {
        const pkg = await readJsonFile<PackageScripts>(join(projectPath, `apps/${app}/package.json`));
        return pkg.scripts.preview;
      }),
    );
    expect(previews).toEqual([
      'opennextjs-cloudflare preview -- --persist-to ../../.wrangler',
      'wrangler dev --persist-to ../../.wrangler',
    ]);
  });

  test('agent context tells where to paste the single database id', async () => {
    const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agents).toContain(`(cd packages/db && bunx wrangler d1 create ${projectName}-db --no-update-config)`);
    expect(agents).toContain('into the `d1_databases` entry of every `apps/*/wrangler.jsonc`');
  });
});

describe('D1 single repo: the Hono Worker previews on the state db:migrate writes', () => {
  const projectName = 'd1-shared-single';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', ...COMMON],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('preview and db:migrate share the root .wrangler directory', async () => {
    const pkg = await readJsonFile<PackageScripts>(join(projectPath, 'package.json'));
    expect(pkg.scripts.preview).toBe('wrangler dev --persist-to ./.wrangler');
    expect(pkg.scripts['db:migrate']).toContain('--persist-to ./.wrangler');
  });

  test('wrangler config binds the project D1 database', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(databaseNameOf(wrangler)).toBe(`${projectName}-db`);
  });
});

describe('cloudflare-fullstack-nextjs: the cron Worker previews on the shared local state', () => {
  const projectName = 'd1-shared-fullstack';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli([projectName, '--blueprint', 'cloudflare-fullstack-nextjs', ...COMMON], tempDir);
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('cron preview persists to the workspace-root state', async () => {
    const pkg = await readJsonFile<PackageScripts>(join(projectPath, 'apps/cron/package.json'));
    expect(pkg.scripts.preview).toBe('wrangler dev --persist-to ../../.wrangler');
  });

  test('web and cron bind the same D1 database', async () => {
    const web = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    const cron = await readTextFile(join(projectPath, 'apps/cron/wrangler.jsonc'));
    expect(databaseNameOf(web)).toBe(`${projectName}-db`);
    expect(databaseNameOf(cron)).toBe(databaseNameOf(web));
    expect(databaseIdOf(cron)).toBe(databaseIdOf(web));
  });
});
