import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

describe('TanStack Start + cloudflare', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('single repo, no database', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, 'start-cf');
      const result = await runCli(
        ['start-cf', '--app', 'start-cf:tanstack-start', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('vite config uses the cloudflare plugin instead of nitro', async () => {
      const config = await readTextFile(join(projectPath, 'vite.config.ts'));
      expect(config).toContain("from '@cloudflare/vite-plugin'");
      expect(config).toContain("cloudflare({ viteEnvironment: { name: 'ssr' }");
      expect(config).not.toContain('nitro');
    });

    test('wrangler.jsonc points at the Start server entry with nodejs_compat', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"name": "start-cf"');
      expect(wrangler).toContain('"main": "@tanstack/react-start/server-entry"');
      expect(wrangler).toContain('"nodejs_compat"');
      expect(wrangler).not.toContain('d1_databases');
      expect(wrangler).not.toContain('hyperdrive');
    });

    test('does not generate the nitro-only .env.start nor a server.ts', async () => {
      expect(await fileExists(join(projectPath, '.env.start'))).toBe(false);
      expect(await fileExists(join(projectPath, 'src/lib/server.ts'))).toBe(false);
    });

    test('tsconfig includes the generated worker types', async () => {
      const tsconfig = await readTextFile(join(projectPath, 'tsconfig.json'));
      expect(tsconfig).toContain('cloudflare-env.d.ts');
    });

    test('agent docs describe the Start variant, not the Hono one', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('@cloudflare/vite-plugin');
      expect(agents).toContain('cloudflare:workers');
      expect(agents).not.toContain('c.env');
    });
  });

  describe('single repo, D1 + drizzle', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, 'start-d1');
      const result = await runCli(
        ['start-d1', '--app', 'start-d1:tanstack-start', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('wrangler.jsonc declares the DB binding and its migrations', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"binding": "DB"');
      expect(wrangler).toContain('"migrations_dir": "drizzle"');
    });

    test('server.ts builds db once at module scope from the cloudflare:workers env', async () => {
      const server = await readTextFile(join(projectPath, 'src/lib/server.ts'));
      expect(server).toContain("import { env } from 'cloudflare:workers'");
      expect(server).toContain("import { createDb } from '@/lib/db'");
      expect(server).toContain('export const db = createDb(env.DB)');
      expect(server).not.toContain('async');
    });

    test('db package factory is untouched: createDb(d1) stays a plain factory', async () => {
      const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
      expect(index).toContain('export function createDb(d1: D1Database)');
      expect(index).not.toContain('cloudflare:workers');
    });

    test('vite config persists local state where the d1 migration scripts write', async () => {
      const config = await readTextFile(join(projectPath, 'vite.config.ts'));
      expect(config).toContain("persistState: { path: '.wrangler' }");
    });
  });

  describe('single repo, postgres + drizzle (Hyperdrive)', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, 'start-pg');
      const result = await runCli(
        ['start-pg', '--app', 'start-pg:tanstack-start', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('wrangler.jsonc declares the Hyperdrive binding', async () => {
      const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
      expect(wrangler).toContain('"binding": "HYPERDRIVE"');
      expect(wrangler).toContain('localConnectionString');
      expect(wrangler).not.toContain('d1_databases');
    });

    test('generates no module-level db: consumers build a client per request', async () => {
      expect(await fileExists(join(projectPath, 'src/lib/server.ts'))).toBe(false);
      const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
      expect(index).toContain('export async function createDb(hyperdrive: Hyperdrive)');
    });
  });

  describe('turborepo, D1 + drizzle', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = join(tempDir, 'start-turbo');
      const result = await runCli(
        ['start-turbo', '--app', 'web:tanstack-start', '--app', 'api:hono', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    });

    test('web app gets its own wrangler.jsonc with the monorepo migrations dir', async () => {
      const wrangler = await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'));
      expect(wrangler).toContain('"name": "web"');
      expect(wrangler).toContain('"main": "@tanstack/react-start/server-entry"');
      expect(wrangler).toContain('"migrations_dir": "../../packages/db/drizzle"');
    });

    test('server.ts imports the shared db package factory', async () => {
      const server = await readTextFile(join(projectPath, 'apps/web/src/lib/server.ts'));
      expect(server).toContain("import { createDb } from '@repo/db'");
      expect(server).toContain('export const db = createDb(env.DB)');
    });

    test('vite config persists state at the monorepo root .wrangler', async () => {
      const config = await readTextFile(join(projectPath, 'apps/web/vite.config.ts'));
      expect(config).toContain("persistState: { path: '../../.wrangler' }");
    });

    test('root agent docs cover both the Start and the Hono deploy flows', async () => {
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));
      expect(agents).toContain('Cloudflare Workers deploy (TanStack Start, Vite plugin)');
      expect(agents).toContain('Cloudflare Workers deploy (Wrangler)');
    });

    test('shared db package never imports cloudflare:workers', async () => {
      const index = await readTextFile(join(projectPath, 'packages/db/src/index.ts'));
      expect(index).not.toContain('cloudflare:workers');
    });
  });
});
