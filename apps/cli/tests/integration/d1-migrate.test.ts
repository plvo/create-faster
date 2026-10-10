import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('Turborepo: d1 migrate workflow points at the deploy app config and a shared state dir', () => {
  const projectName = 'd1-migrate-turbo';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'api:hono',
        '--app',
        'web:nextjs:trpc,tanstack-query,better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('db package migrate scripts target the consuming app wrangler config and persist to the workspace root', async () => {
    const pkg = JSON.parse(await readTextFile(join(projectPath, 'packages/db/package.json')));
    const expected = 'wrangler --config ../../apps/web/wrangler.jsonc d1 migrations apply DB --local --persist-to ../../.wrangler';
    expect(pkg.scripts['db:migrate']).toBe(expected);
    expect(pkg.scripts['db:migrate:local']).toBe(expected);
    expect(pkg.scripts['db:migrate:remote']).toBe(
      'wrangler --config ../../apps/web/wrangler.jsonc d1 migrations apply DB --remote',
    );
  });

  test('the deploy app wrangler config reads migrations from the db package output dir', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    expect(wrangler).toContain('"migrations_dir": "../../packages/db/drizzle"');
  });

  test('the deploy app preview shares the workspace-root local state', async () => {
    const pkg = JSON.parse(await readTextFile(join(projectPath, 'apps/web/package.json')));
    expect(pkg.scripts.preview).toBe('opennextjs-cloudflare preview -- --persist-to ../../.wrangler');
  });

  test('drizzle config resolves the local D1 file from the persisted state dir', async () => {
    const config = await readTextFile(join(projectPath, 'packages/db/drizzle.config.ts'));
    expect(config).toContain('../../.wrangler/v3/d1/miniflare-D1DatabaseObject');
    expect(config).not.toContain('state/v3');
  });

  test('seed lives in the db package and reads the state dir that migrate persists to', async () => {
    expect(await fileExists(join(projectPath, 'scripts/seed.ts'))).toBe(false);
    const seed = await readTextFile(join(projectPath, 'packages/db/scripts/seed.ts'));
    expect(seed).toContain("path.resolve(process.cwd(), '../../.wrangler/v3/d1/miniflare-D1DatabaseObject')");
    expect(seed).toContain("from '../src/schema'");
    expect(seed).toContain("from '../src/index'");
    expect(seed).not.toContain('state/v3');
  });

  test('root db:seed delegates to the db package like the other db scripts', async () => {
    const root = JSON.parse(await readTextFile(join(projectPath, 'package.json')));
    expect(root.scripts['db:seed']).toBe('turbo db:seed');
    expect(root.dependencies?.['drizzle-orm']).toBeUndefined();
    expect(root.devDependencies?.['drizzle-orm']).toBeUndefined();
  });

  test('local-setup seeds from the db package that owns the seed script', async () => {
    const pkg = JSON.parse(await readTextFile(join(projectPath, 'packages/db/package.json')));
    expect(pkg.scripts['local-setup']).toBe(
      'wrangler --config ../../apps/web/wrangler.jsonc d1 migrations apply DB --local --persist-to ../../.wrangler && bun run db:seed',
    );
  });
});

describe('Single repo: d1 migrate workflow stays self-consistent on one local state dir', () => {
  const projectName = 'd1-migrate-single';
  let projectPath: string;
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [
        projectName,
        '--app',
        'web:nextjs:better-auth',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });
  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('migrate, preview and drizzle config all agree on the root .wrangler/v3 state', async () => {
    const pkg = JSON.parse(await readTextFile(join(projectPath, 'package.json')));
    expect(pkg.scripts['db:migrate']).toBe('wrangler d1 migrations apply DB --local --persist-to ./.wrangler');
    expect(pkg.scripts.preview).toBe('opennextjs-cloudflare preview -- --persist-to ./.wrangler');

    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"migrations_dir": "drizzle"');

    const config = await readTextFile(join(projectPath, 'drizzle.config.ts'));
    expect(config).toContain('.wrangler/v3/d1/miniflare-D1DatabaseObject');
    expect(config).not.toContain('state/v3');
  });

  test('seed reads the root state dir that migrate persists to', async () => {
    const seed = await readTextFile(join(projectPath, 'scripts/seed.ts'));
    expect(seed).toContain("path.resolve(process.cwd(), '.wrangler/v3/d1/miniflare-D1DatabaseObject')");
    expect(seed).not.toContain('state/v3');
  });
});
