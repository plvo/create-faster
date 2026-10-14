import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const COMMON = ['--no-git', '--no-install', '--pm', 'bun'];
const D1 = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];

interface WranglerConfig {
  secrets?: { required: string[] };
  d1_databases?: unknown[];
  vars?: Record<string, string>;
}

async function readWrangler(path: string): Promise<WranglerConfig> {
  return Bun.JSONC.parse(await readTextFile(path)) as WranglerConfig;
}

describe('wrangler.jsonc declares the runtime secrets of each Worker', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, ...COMMON], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  test.each(['nextjs', 'tanstack-start'])('%s with better-auth requires BETTER_AUTH_SECRET only', async (stack) => {
    const root = await generate(`auth-${stack}`, ['--app', `web:${stack}:better-auth`, ...D1]);
    const config = await readWrangler(join(root, 'wrangler.jsonc'));

    expect(config.secrets).toEqual({ required: ['BETTER_AUTH_SECRET'] });
    expect(config.d1_databases).toHaveLength(1);
  });

  test.each(['nextjs', 'tanstack-start', 'hono'])('%s without a secret has no secrets field', async (stack) => {
    const root = await generate(`plain-${stack}`, ['--app', `web:${stack}`, ...D1]);
    const config = await readWrangler(join(root, 'wrangler.jsonc'));

    expect(config.secrets).toBeUndefined();
    expect(config.d1_databases).toHaveLength(1);
  });

  test('a Next.js Worker keeps its NODE_ENV var next to the secrets', async () => {
    const root = await generate('auth-vars', ['--app', 'web:nextjs:better-auth', ...D1]);
    const config = await readWrangler(join(root, 'wrangler.jsonc'));

    expect(config.vars).toEqual({ NODE_ENV: 'production' });
    expect(config.secrets?.required).toEqual(['BETTER_AUTH_SECRET']);
  });

  test('a turborepo lists secrets only in the Worker that has the library', async () => {
    const root = await generate('secrets-mono', [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'docs:tanstack-start',
      '--app',
      'api:hono',
      ...D1,
    ]);

    expect((await readWrangler(join(root, 'apps/web/wrangler.jsonc'))).secrets).toEqual({
      required: ['BETTER_AUTH_SECRET'],
    });
    expect((await readWrangler(join(root, 'apps/docs/wrangler.jsonc'))).secrets).toBeUndefined();
    expect((await readWrangler(join(root, 'apps/api/wrangler.jsonc'))).secrets).toBeUndefined();
  });

  test('a turborepo with better-auth on two stacks lists it in both Workers', async () => {
    const root = await generate('secrets-mono-two', [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'docs:tanstack-start:better-auth',
      ...D1,
    ]);

    for (const app of ['web', 'docs']) {
      expect((await readWrangler(join(root, `apps/${app}/wrangler.jsonc`))).secrets, app).toEqual({
        required: ['BETTER_AUTH_SECRET'],
      });
    }
  });

  test('cloudflare-fullstack requires the secret in the web Worker and not in the cron Worker', async () => {
    const root = await generate('secrets-fullstack', ['--blueprint', 'cloudflare-fullstack']);

    expect((await readWrangler(join(root, 'apps/web/wrangler.jsonc'))).secrets).toEqual({
      required: ['BETTER_AUTH_SECRET'],
    });
    const cron = await readWrangler(join(root, 'apps/cron/wrangler.jsonc'));
    expect(cron.secrets).toBeUndefined();
    expect(cron.d1_databases).toHaveLength(1);
  });
});
