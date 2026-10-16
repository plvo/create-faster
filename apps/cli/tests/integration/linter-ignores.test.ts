import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const ROUTE_TREE = 'routeTree.gen.ts';

describe('linter ignore lists', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, linter: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--linter', linter, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  describe('oxc', () => {
    test('oxfmt skips the generated route tree of a TanStack Start app', async () => {
      const dir = await generate('oxc-start', 'oxc', ['--app', 'oxc-start:tanstack-start']);
      expect(await readTextFile(join(dir, 'oxfmt.config.mts'))).toContain(`'**/${ROUTE_TREE}'`);
    });

    test('oxfmt carries no route tree entry without a TanStack Start app', async () => {
      const dir = await generate('oxc-next', 'oxc', ['--app', 'oxc-next:nextjs']);
      expect(await readTextFile(join(dir, 'oxfmt.config.mts'))).not.toContain(ROUTE_TREE);
    });
  });

  describe('prettier', () => {
    test('skips the generated route tree of a TanStack Start app', async () => {
      const dir = await generate('prettier-start', 'prettier', ['--app', 'prettier-start:tanstack-start']);
      expect(await readTextFile(join(dir, '.prettierignore'))).toContain(ROUTE_TREE);
    });

    test('carries no route tree entry without a TanStack Start app', async () => {
      const dir = await generate('prettier-next', 'prettier', ['--app', 'prettier-next:nextjs']);
      expect(await readTextFile(join(dir, '.prettierignore'))).not.toContain(ROUTE_TREE);
    });
  });

  describe('eslint', () => {
    test('a TanStack Start app ignores the router temp directory, the Nitro output and the route tree', async () => {
      const dir = await generate('eslint-start', 'eslint', ['--app', 'eslint-start:tanstack-start']);
      const config = await readTextFile(join(dir, 'eslint.config.mjs'));
      expect(config).toContain('".tanstack/**"');
      expect(config).toContain('".output/**"');
      expect(config).toContain(`"src/${ROUTE_TREE}"`);
      expect(config).not.toContain('.wrangler');
    });

    test('the Cloudflare deployment adds the Wrangler state and the generated binding types', async () => {
      const dir = await generate('eslint-start-cf', 'eslint', [
        '--app',
        'eslint-start-cf:tanstack-start',
        '--deployment',
        'cloudflare',
      ]);
      const config = await readTextFile(join(dir, 'eslint.config.mjs'));
      expect(config).toContain('".wrangler/**", "cloudflare-env.d.ts"]');
    });

    test('a Next.js app on Cloudflare also ignores the OpenNext output', async () => {
      const dir = await generate('eslint-next-cf', 'eslint', [
        '--app',
        'eslint-next-cf:nextjs',
        '--deployment',
        'cloudflare',
      ]);
      const config = await readTextFile(join(dir, 'eslint.config.mjs'));
      expect(config).toContain('".open-next/**", ".wrangler/**", "cloudflare-env.d.ts"]');
    });

    test('a Hono app on Cloudflare ignores the Wrangler state and the generated binding types', async () => {
      const dir = await generate('eslint-hono-cf', 'eslint', [
        '--app',
        'eslint-hono-cf:hono',
        '--deployment',
        'cloudflare',
      ]);
      expect(await readTextFile(join(dir, 'eslint.config.mjs'))).toContain('".wrangler/**", "cloudflare-env.d.ts"]');
    });

    test('a turborepo shares the ignores between its apps through the config package', async () => {
      const dir = await generate('eslint-turbo', 'eslint', [
        '--app',
        'web:nextjs',
        '--app',
        'admin:tanstack-start',
        '--app',
        'api:hono',
        '--deployment',
        'cloudflare',
      ]);
      const pkg = join(dir, 'packages/eslint-config');
      expect(await readTextFile(join(pkg, 'base.js'))).toContain('".wrangler/**", "cloudflare-env.d.ts"]');
      expect(await readTextFile(join(pkg, 'react.js'))).toContain(`".tanstack/**"`);
      expect(await readTextFile(join(pkg, 'react.js'))).toContain(`"src/${ROUTE_TREE}"`);
      expect(await readTextFile(join(pkg, 'next.js'))).toContain('"next.config.*"');
      expect(await readTextFile(join(pkg, 'next.js'))).toContain('".open-next/**"');
    });
  });
});
