import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const COMMON = ['--no-git', '--no-install', '--pm', 'bun'];

interface WranglerConfig {
  keep_names?: boolean;
  workers_dev?: boolean;
  preview_urls?: boolean;
}

async function readWrangler(path: string): Promise<WranglerConfig> {
  return Bun.JSONC.parse(await readTextFile(path)) as WranglerConfig;
}

describe('wrangler.jsonc of a Worker', () => {
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

  // Wrangler bundles the OpenNext worker with esbuild's keep-names, which wraps every named function in `__name(...)`. next-themes
  // serializes a function with `toString()` into an inline <script> that runs in the browser, where `__name` does not exist.
  describe('a Next.js Worker keeps no function names', () => {
    test('with next-themes on the cloudflare deployment', async () => {
      const root = await generate('themes', ['--app', 'web:nextjs:shadcn,next-themes', '--deployment', 'cloudflare']);

      expect((await readWrangler(join(root, 'wrangler.jsonc'))).keep_names).toBe(false);
    });

    test('in every Next.js app of a turborepo', async () => {
      const root = await generate('themes-mono', [
        '--app',
        'web:nextjs:shadcn,next-themes',
        '--app',
        'admin:nextjs',
        '--deployment',
        'cloudflare',
      ]);

      expect((await readWrangler(join(root, 'apps/web/wrangler.jsonc'))).keep_names).toBe(false);
      expect((await readWrangler(join(root, 'apps/admin/wrangler.jsonc'))).keep_names).toBe(false);
    });

    test('in the Next.js Worker of cloudflare-fullstack-nextjs', async () => {
      const root = await generate('fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs']);

      expect((await readWrangler(join(root, 'apps/web/wrangler.jsonc'))).keep_names).toBe(false);
    });
  });

  // Wrangler warns on every deploy that `workers_dev` and `preview_urls` default to enabled when the file sets neither.
  describe('names whether it is served from workers.dev and has preview URLs', () => {
    test.each([
      ['nextjs', 'cloudflare'],
      ['tanstack-start', 'cloudflare'],
      ['hono', 'cloudflare'],
      ['nextjs', 'cloudflare-static'],
      ['tanstack-start', 'cloudflare-static'],
    ])('%s on %s', async (stack, deployment) => {
      const root = await generate(`urls-${stack}-${deployment}`, ['--app', `web:${stack}`, '--deployment', deployment]);
      const config = await readWrangler(join(root, 'wrangler.jsonc'));

      expect(config.workers_dev).toBe(true);
      expect(config.preview_urls).toBe(false);
    });

    test('in both Workers of cloudflare-fullstack-nextjs', async () => {
      const root = await generate('urls-fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs']);

      for (const app of ['web', 'cron']) {
        const config = await readWrangler(join(root, `apps/${app}/wrangler.jsonc`));
        expect(config.workers_dev).toBe(true);
        expect(config.preview_urls).toBe(false);
      }
    });
  });
});
