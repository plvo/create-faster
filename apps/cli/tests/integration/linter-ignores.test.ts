import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join, posix } from 'node:path';
import { META } from '@/__meta__';
import type { MetaBlueprint } from '@/types/meta';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

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

  describe('Drizzle migrations', () => {
    const MIGRATED_FILE = 'meta/_journal.json';
    const SQLITE = ['--database', 'sqlite', '--orm', 'drizzle'];
    const D1 = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];
    const TWO_APPS = ['--app', 'web:nextjs', '--app', 'api:hono'];
    const LAYOUTS = [
      { layout: 'sqlite single repo', args: ['--app', 'web:nextjs', ...SQLITE] },
      { layout: 'sqlite turborepo', args: [...TWO_APPS, ...SQLITE] },
      { layout: 'd1 single repo', args: ['--app', 'web:nextjs', ...D1] },
      { layout: 'd1 turborepo', args: [...TWO_APPS, ...D1] },
      { layout: 'multitenant-saas-nextjs blueprint', args: ['--blueprint', 'multitenant-saas-nextjs'] },
    ];

    type IgnoredBy = (dir: string, file: string) => Promise<boolean>;

    const biomeIgnores: IgnoredBy = async (dir, file) => {
      const { files } = JSON.parse(await readTextFile(join(dir, 'biome.json')));
      const excluded = (files.includes as string[]).filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
      return excluded.some((glob) => new Bun.Glob(glob).match(file));
    };

    const oxfmtIgnores: IgnoredBy = async (dir, file) => {
      const config = await readTextFile(join(dir, 'oxfmt.config.mts'));
      const list = /ignorePatterns: \[(.*)\]/.exec(config)?.[1] ?? '';
      return [...list.matchAll(/'([^']+)'/g)].some((match) => new Bun.Glob(match[1] as string).match(file));
    };

    // gitignore semantics for the entries Prettier reads: a slash-free entry names a directory at any depth,
    // an entry with a leading slash is anchored to the project root.
    const prettierIgnores: IgnoredBy = async (dir, file) => {
      const entries = (await readTextFile(join(dir, '.prettierignore'))).split('\n').filter(Boolean);
      return entries.some((entry) => {
        const name = entry.replace(/^\//, '').replace(/\/$/, '');
        if (entry.startsWith('/') || name.includes('/')) return file.startsWith(`${name}/`);
        return file.split('/').slice(0, -1).includes(name);
      });
    };

    const FORMATTERS: { linter: string; ignores: IgnoredBy }[] = [
      { linter: 'biome', ignores: biomeIgnores },
      { linter: 'oxc', ignores: oxfmtIgnores },
      { linter: 'prettier', ignores: prettierIgnores },
      { linter: 'eslint-prettier', ignores: prettierIgnores },
    ];

    // drizzle-kit writes `out` of the Drizzle package, which is the project root or packages/db.
    async function migrationFile(dir: string): Promise<string> {
      const packageDir = (await fileExists(join(dir, 'drizzle.config.ts'))) ? '.' : 'packages/db';
      const config = await readTextFile(join(dir, packageDir, 'drizzle.config.ts'));
      const out = /out: '([^']+)'/.exec(config)?.[1];
      if (!out) throw new Error(`no out in ${packageDir}/drizzle.config.ts`);
      return posix.join(packageDir, out, MIGRATED_FILE);
    }

    for (const { linter, ignores } of FORMATTERS) {
      for (const { layout, args } of LAYOUTS) {
        test(`${linter} ignores the migrations drizzle-kit writes: ${layout}`, async () => {
          const dir = await generate(`${linter}-${layout.replaceAll(' ', '-')}`, linter, args);
          expect(await ignores(dir, await migrationFile(dir))).toBe(true);
        });
      }

      test(`${linter} ignores nothing named drizzle under Prisma`, async () => {
        const dir = await generate(`${linter}-prisma`, linter, [
          '--app',
          'web:nextjs',
          '--database',
          'postgres',
          '--orm',
          'prisma',
        ]);
        expect(await ignores(dir, `drizzle/${MIGRATED_FILE}`)).toBe(false);
      });
    }
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
  // The files a tool of the blueprint writes and the repository commits (Payload's types, import map and migrations) must stay
  // byte-identical to its output, so no linter or formatter rewrites them or reports on them.
  describe('files a blueprint generates', () => {
    const BLUEPRINT = 'cloudflare-payload-nextjs';
    const GENERATED = [
      'apps/web/src/payload-types.ts',
      'apps/web/src/app/(payload)/admin/importMap.js',
      'apps/web/src/migrations/20261021_133016_initial.ts',
    ];
    const patterns = ((META.blueprints[BLUEPRINT] as MetaBlueprint).generatedFiles ?? []).filter(
      (file): file is string => typeof file === 'string',
    );

    // [linter, file that lists the ignores in a turborepo]
    const IGNORE_FILES: [string, string][] = [
      ['biome', 'biome.json'],
      ['oxc', 'oxlint.config.mts'],
      ['oxc', 'oxfmt.config.mts'],
      ['prettier', '.prettierignore'],
      ['eslint-prettier', '.prettierignore'],
      ['eslint', 'packages/eslint-config/next.js'],
    ];

    test('the blueprint names the files Payload writes, and each is matched by a pattern', () => {
      expect(patterns.length).toBeGreaterThan(0);
      for (const file of GENERATED) {
        expect(
          patterns.some((pattern) => new Bun.Glob(pattern).match(file)),
          file,
        ).toBe(true);
      }
      expect(patterns.some((pattern) => new Bun.Glob(pattern).match('apps/web/src/payload.config.ts'))).toBe(false);
    });

    test.each(IGNORE_FILES)('%s lists them in %s', async (linter, file) => {
      const dir = await generate(`${linter}-${file.replaceAll(/\W/g, '-')}-payload`, linter, ['--blueprint', BLUEPRINT]);
      const content = await readTextFile(join(dir, file));
      for (const pattern of patterns) expect(content, pattern).toContain(pattern);
    });

    test('a project without the blueprint lists none of them', async () => {
      const dir = await generate('biome-no-payload', 'biome', ['--app', 'web:nextjs']);
      expect(await readTextFile(join(dir, 'biome.json'))).not.toContain('payload-types');
    });
  });
});
