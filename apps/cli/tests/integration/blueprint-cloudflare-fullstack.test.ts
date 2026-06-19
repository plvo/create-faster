import { join } from 'node:path';
import { $ } from 'bun';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('Blueprint generation - cloudflare-fullstack', () => {
  const projectName = 'cf-fullstack';
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--blueprint', 'cloudflare-fullstack', '--no-install', '--no-git'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates a turborepo with web + cron apps', async () => {
    expect(await fileExists(join(projectPath, 'turbo.json'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/web'))).toBe(true);
    expect(await fileExists(join(projectPath, 'apps/cron'))).toBe(true);
  });

  test('web wrangler binds both D1 and R2', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"binding": "STORAGE"');
  });

  test('cron wrangler ships a schedule + the R2 binding', async () => {
    const wrangler = await readTextFile(join(projectPath, 'apps/cron/wrangler.jsonc'));
    expect(wrangler).toContain('"crons"');
    expect(wrangler).toContain('"binding": "STORAGE"');
  });

  test('cron worker exposes a scheduled handler', async () => {
    const index = await readTextFile(join(projectPath, 'apps/cron/src/index.ts'));
    expect(index).toContain('async scheduled(');
    expect(index).toContain('createDb(env.DB)');
  });

  test('db package ships the documents table + admin role column', async () => {
    const schema = await readTextFile(join(projectPath, 'packages/db/src/schema.ts'));
    expect(schema).toContain("sqliteTable('documents'");
    expect(schema).toContain("role: text('role')");
  });

  test('auth package ships createAuth + admin plugin', async () => {
    const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(auth).toContain('createAuth');
    expect(auth).toContain('admin(');
  });

  test('api package registers the documents router', async () => {
    const root = await readTextFile(join(projectPath, 'packages/api/src/root.ts'));
    expect(root).toContain('documents: documentsRouter');
  });

  test('web ships the R2 upload route', async () => {
    expect(await fileExists(join(projectPath, 'apps/web/src/app/api/documents/upload/route.ts'))).toBe(true);
  });

  test('root layout mounts AppProviders + Toaster', async () => {
    const layout = await readTextFile(join(projectPath, 'apps/web/src/app/layout.tsx'));
    expect(layout).toContain('<AppProviders>');
    expect(layout).toContain('<Toaster richColors />');
  });

  test('ships the four agent docs', async () => {
    for (const f of ['auth-rbac.md', 'data-layer.md', 'storage.md', 'cloudflare-deploy.md']) {
      expect(await fileExists(join(projectPath, 'docs/agents', f))).toBe(true);
    }
  });

  test('uses D1 bindings everywhere — no DATABASE_URL leaks', async () => {
    const matches = await $`grep -rl DATABASE_URL ${projectPath}`.quiet().nothrow();
    expect(matches.stdout.toString().trim()).toBe('');
  });
});
