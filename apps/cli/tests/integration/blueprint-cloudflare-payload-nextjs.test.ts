import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  evaluateGeneratedModule,
  expectInOrder,
  fileExists,
  filesUnder,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINT = 'cloudflare-payload-nextjs';
const PROJECT = 'payload-site';

interface PackageJsonShape {
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface WranglerShape {
  name?: string;
  d1_databases?: { binding: string; migrations_dir?: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
}

// Columns of the `revalidations` table that `@opennextjs/cloudflare@1.20.12` reads and writes
// (`dist/api/overrides/tag-cache/d1-next-tag-cache.js`: INSERT and SELECT) and creates itself at `preview` and
// `deploy` (`dist/cli/commands/populate-cache.js`). tests/e2e/blueprint-cloudflare-payload-nextjs.test.ts compares
// them with the installed package.
const REVALIDATIONS_COLUMNS = ['tag', 'revalidatedAt', 'stale', 'expire'];

describe(`Blueprint generation - ${BLUEPRINT}`, () => {
  let tempDir: string;
  let projectPath: string;

  const web = (path: string) => join(projectPath, 'apps/web', path);
  const cron = (path: string) => join(projectPath, 'apps/cron', path);

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, PROJECT);
    const result = await runCli([PROJECT, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('files', () => {
    test('generates the Payload admin group, the public site and the migrations', async () => {
      const expected = [
        'src/payload.config.ts',
        'src/payload-types.ts',
        'src/app/(payload)/layout.tsx',
        'src/app/(payload)/admin/[[...segments]]/page.tsx',
        'src/app/(payload)/admin/[[...segments]]/not-found.tsx',
        'src/app/(payload)/admin/importMap.js',
        'src/app/(payload)/api/[...slug]/route.ts',
        'src/app/(frontend)/layout.tsx',
        'src/app/(frontend)/[[...slug]]/page.tsx',
        'src/app/(frontend)/posts/page.tsx',
        'src/app/(frontend)/posts/[slug]/page.tsx',
        'src/app/(frontend)/not-found.tsx',
        'src/app/sitemap.ts',
        'src/app/robots.ts',
        'src/app/(frontend)/next/preview/route.ts',
        'src/migrations/index.ts',
        'scripts/ensure-admin.ts',
        'scripts/admin-credentials.ts',
        'scripts/remote.ts',
        'scripts/seed.ts',
        'open-next.config.ts',
        'next.config.ts',
        'wrangler.jsonc',
      ];
      for (const path of expected) expect(await fileExists(web(path)), path).toBe(true);
      expect(await fileExists(cron('src/index.ts'))).toBe(true);
      expect(await fileExists(cron('wrangler.jsonc'))).toBe(true);
    });

    test('has no ORM package and no Drizzle file: Payload owns the schema', async () => {
      expect(await fileExists(join(projectPath, 'packages/db'))).toBe(false);
      const files = await filesUnder(projectPath, ['node_modules']);
      expect(files.filter((file) => /drizzle/i.test(file))).toEqual([]);
    });

    test('replaces the stack root layout, pages and proxy: Payload has two route groups with their own <html>', async () => {
      for (const path of [
        'src/app/layout.tsx',
        'src/app/page.tsx',
        'src/app/not-found.tsx',
        'src/app/error.tsx',
        'src/middleware.ts',
        'src/proxy.ts',
      ]) {
        expect(await fileExists(web(path)), path).toBe(false);
      }
    });
  });

  describe('package.json of web', () => {
    let pkg: PackageJsonShape;

    beforeAll(async () => {
      pkg = await readJsonFile<PackageJsonShape>(web('package.json'));
    });

    test('is an ES module: payload.config.ts awaits the Cloudflare context at the top level', () => {
      expect(pkg.type).toBe('module');
    });

    test('pins payload and every @payloadcms package to one exact version', () => {
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      const payloadPackages = Object.entries(dependencies).filter(
        ([name]) => name === 'payload' || name.startsWith('@payloadcms/'),
      );
      expect(payloadPackages.map(([name]) => name).sort()).toEqual([
        '@payloadcms/db-d1-sqlite',
        '@payloadcms/live-preview-react',
        '@payloadcms/next',
        '@payloadcms/plugin-seo',
        '@payloadcms/richtext-lexical',
        '@payloadcms/storage-r2',
        '@payloadcms/ui',
        'payload',
      ]);
      const versions = new Set(payloadPackages.map(([, version]) => version));
      expect(versions.size).toBe(1);
      expect([...versions][0]).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('installs no sharp: no image library runs on workerd', () => {
      expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('sharp');
    });

    test('builds with webpack, which Payload requires', () => {
      expect(pkg.scripts?.build).toContain('next build --webpack');
    });

    test('defines the Payload, migration, first-admin and seed scripts', () => {
      for (const script of [
        'payload',
        'generate:types',
        'generate:importmap',
        'migrate',
        'migrate:create',
        'ensure-admin',
        'db:seed',
        'db:migrate:remote',
        'ensure-admin:remote',
      ]) {
        expect(pkg.scripts, script).toHaveProperty([script]);
      }
    });
  });

  describe('wrangler.jsonc', () => {
    test('web binds the D1 database, the R2 bucket and the OpenNext caches, and no migrations directory', async () => {
      const config = Bun.JSONC.parse(await readTextFile(web('wrangler.jsonc'))) as WranglerShape;
      expect(config.name).toBe(`${PROJECT}-web`);
      expect(config.d1_databases?.map((d1) => d1.binding).sort()).toEqual(['DB', 'NEXT_TAG_CACHE_D1']);
      for (const d1 of config.d1_databases ?? []) expect(d1.migrations_dir).toBeUndefined();
      const buckets = Object.fromEntries((config.r2_buckets ?? []).map((r2) => [r2.binding, r2.bucket_name]));
      expect(buckets).toEqual({
        STORAGE: `${PROJECT}-storage`,
        NEXT_INC_CACHE_R2_BUCKET: `${PROJECT}-storage`,
      });
      expect(config.vars?.NODE_ENV).toBe('production');
    });

    test('no binding of a committed file is remote: next build resolves the bindings at module scope', async () => {
      for (const file of [web('wrangler.jsonc'), cron('wrangler.jsonc')]) {
        expect(await readTextFile(file), file).not.toMatch(/"remote"\s*:\s*true/);
      }
    });

    test('cron binds the same D1 and its own backups bucket, and runs a daily schedule', async () => {
      const config = Bun.JSONC.parse(await readTextFile(cron('wrangler.jsonc'))) as WranglerShape;
      expect(config.d1_databases?.map((d1) => d1.binding)).toEqual(['DB']);
      // The backups have a bucket of their own, which the Worker that serves the media does not bind.
      expect(config.r2_buckets?.map((r2) => [r2.binding, r2.bucket_name])).toEqual([['BACKUPS', `${PROJECT}-backups`]]);
      expect(config.triggers?.crons).toHaveLength(1);
      expect(config.vars).toHaveProperty('BACKUP_RETENTION_DAYS');
    });
  });

  describe('payload.config.ts', () => {
    let source: string;

    beforeAll(async () => {
      source = await readTextFile(web('src/payload.config.ts'));
    });

    test('registers the R2 storage under plugins, as Payload 3.x takes it', () => {
      expect(source).toMatch(/plugins:\s*\[[^\]]*r2Storage\(/s);
      expect(source).not.toMatch(/\bstorage:\s*\[/);
    });

    test('never pushes the schema: it only changes through committed migrations', () => {
      expect(source).toMatch(/sqliteD1Adapter\(\{[^}]*push:\s*false/s);
    });

    test('reaches the remote bindings only on an explicit variable, never from NODE_ENV', () => {
      expect(source).toContain('WRANGLER_REMOTE_BINDINGS');
      expect(source).toMatch(/remoteBindings:\s*process\.env\.WRANGLER_REMOTE_BINDINGS === 'true'/);
      expect(source).not.toMatch(/remoteBindings:\s*isProduction/);
    });

    test('limits uploads with a documented size', () => {
      expect(source).toContain('abortOnLimit: true');
      expect(source).toContain('requestSizeLimit');
      expect(source).toContain('MAX_UPLOAD_BYTES');
    });

    test('imports the config through the @/ alias only', async () => {
      const files = (await filesUnder(web('src'))).filter((file) => /\.(ts|tsx|js)$/.test(file));
      for (const file of files) expect(await readTextFile(file), file).not.toContain('@payload-config');
    });
  });

  describe('next.config.ts', () => {
    let source: string;

    beforeAll(async () => {
      source = await readTextFile(web('next.config.ts'));
    });

    test('wraps the config with withPayload and keeps the Worker-only packages external', () => {
      expect(source).toContain("withPayload(nextConfig, { devBundleServerPackages: false })");
      expect(source).toContain("serverExternalPackages: ['jose', 'pg-cloudflare']");
    });

    test('serves media as they are: the OpenNext optimizer cannot read them from R2', () => {
      expect(source).toMatch(/images:\s*\{\s*unoptimized:\s*true/);
    });

    test('builds one page at a time: parallel workers drop the platform proxy connection', () => {
      expect(source).toMatch(/cpus:\s*1/);
      expect(source).toMatch(/staticGenerationMaxConcurrency:\s*1/);
    });

    test('keeps the dev-only OpenNext initialisation on the shared persist path', () => {
      expect(source).toMatch(/NODE_ENV === 'development'/);
      expect(source).toContain("persist: { path: '../../.wrangler/v3' }");
    });
  });

  describe('migrations', () => {
    test('create the revalidations table of the OpenNext D1 tag cache with the columns it reads', async () => {
      const migrations = (await filesUnder(web('src/migrations'))).filter((file) => file.endsWith('.ts') && !file.endsWith('index.ts'));
      const sources = await Promise.all(migrations.map((file) => readTextFile(file)));
      const revalidations = sources.find((source) => source.includes('revalidations'));
      expect(revalidations, 'a migration that creates revalidations').toBeDefined();
      const table = (revalidations as string).match(/CREATE TABLE(?: IF NOT EXISTS)? `?revalidations`?\s*\(([^;]*?)\)\s*;?\s*`/s);
      expect(table, 'CREATE TABLE revalidations').not.toBeNull();
      const columns = (table?.[1] ?? '').split(',').map((column) => column.trim().split(/\s+/)[0]?.replace(/`/g, ''));
      for (const column of REVALIDATIONS_COLUMNS) expect(columns).toContain(column);
      expect(table?.[1]).toMatch(/UNIQUE\(\s*`?tag`?\s*\)\s*ON CONFLICT REPLACE/);
    });

    test('are committed with their snapshots, so migrate:create writes a delta', async () => {
      const files = (await filesUnder(web('src/migrations'))).map((file) => file.slice(web('src/migrations').length + 1));
      const migrations = files.filter((file) => file.endsWith('.ts') && file !== 'index.ts');
      expect(migrations.length).toBeGreaterThanOrEqual(2);
      for (const migration of migrations) expect(files, migration).toContain(migration.replace(/\.ts$/, '.json'));
    });
  });

  describe('the README', () => {
    test('orders the provisioning, then the production URL, the first deploy and the first admin: no deploy before the secrets', async () => {
      const readme = await readTextFile(join(projectPath, 'README.md'));
      expectInOrder(readme, [
        `wrangler d1 create ${PROJECT}-db`,
        'REPLACE_WITH_D1_DATABASE_ID',
        `wrangler r2 bucket create ${PROJECT}-storage`,
        `wrangler r2 bucket create ${PROJECT}-backups`,
        'bun run db:migrate:remote',
        'bun run ensure-admin:remote',
        '7. Learn the production URL and deploy',
        '### Production URL',
        '### First deploy',
        'export NEXT_PUBLIC_APP_URL=',
        'export PAYLOAD_SECRET=$(openssl rand -base64 32)',
        'bun run deploy --secrets-file .prod.env',
        '### First admin',
      ]);
      // The generic deploy step would send the reader to the build commands before the URL and the secrets.
      expect(readme).not.toContain('Then run the build and deploy commands listed under');
      expect(readme).not.toContain('Set the runtime secrets: every name under');
    });

    test('does not let the first deploy lose the token of the backups: it is generated into a variable to keep', async () => {
      const readme = await readTextFile(join(projectPath, 'README.md'));
      expect(readme).toContain('export BACKUP_TRIGGER_TOKEN=$(openssl rand -base64 32)');
      expect(readme).toContain('"$BACKUP_TRIGGER_TOKEN" > apps/cron/.prod.env');
      expect(readme).toContain('and keep each value');
    });

    test('carries the first deploy itself, so it does not depend on the agent notes', async () => {
      const dir = await createTempDir();
      try {
        const result = await runCli(['no-notes', '--blueprint', BLUEPRINT, '--no-agent-context', '--no-git', '--no-install', '--pm', 'bun'], dir);
        expect(result.exitCode, result.stderr).toBe(0);
        const readme = await readTextFile(join(dir, 'no-notes/README.md'));
        expect(readme).toContain('--secrets-file .prod.env');
        expect(readme).not.toContain('docs/agents');
        expect(await fileExists(join(dir, 'no-notes/docs/agents'))).toBe(false);
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });

  describe('fonts', () => {
    test('the paths of the site layout reach the font files of the stack', async () => {
      const layout = await readTextFile(web('src/app/(frontend)/layout.tsx'));
      const sources = [...layout.matchAll(/src: '([^']+\.woff)'/g)].map((match) => match[1] ?? '');
      expect(sources).toHaveLength(2);
      for (const source of sources) {
        expect(await fileExists(join(web('src/app/(frontend)'), source)), source).toBe(true);
      }
    });
  });

  describe('robots.txt', () => {
    interface Robots {
      rules: { userAgent: string; allow?: string; disallow?: string | string[] };
      sitemap?: string;
    }
    type RobotsRoute = () => Promise<Robots>;

    // The route reads the origin from get-app-url and the host of the request from next/headers.
    async function loadRobots(): Promise<RobotsRoute> {
      const directory = join(tempDir, 'robots');
      const getAppUrl = join(directory, 'get-app-url.mjs');
      const headers = join(directory, 'next-headers.mjs');
      await evaluateGeneratedModule(await readTextFile(web('src/lib/get-app-url.ts')), getAppUrl);
      await Bun.write(headers, 'export const headers = async () => ({ get: () => globalThis.__requestHost });');
      const { default: robots } = await evaluateGeneratedModule<{ default: RobotsRoute }>(
        await readTextFile(web('src/app/robots.ts')),
        join(directory, 'robots.mjs'),
        { '@/lib/get-app-url': getAppUrl, 'next/headers': headers },
      );
      return robots;
    }

    async function robotsFor(appUrl: string, requestHost: string): Promise<Robots> {
      process.env.NEXT_PUBLIC_APP_URL = appUrl;
      (globalThis as { __requestHost?: string }).__requestHost = requestHost;
      return (await loadRobots())();
    }

    afterAll(() => {
      Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_APP_URL');
    });

    test('allows the public site, keeps /admin/ and /api/ out and names the sitemap on the production origin', async () => {
      const robots = await robotsFor('https://example.com', 'example.com');
      expect(robots.rules).toEqual({ userAgent: '*', allow: '/', disallow: ['/admin/', '/api/'] });
      expect(robots.sitemap).toBe('https://example.com/sitemap.xml');
    });

    test.each([
      ['a local run', 'http://localhost:3000', 'localhost:3000'],
      ['a workers.dev address configured as the origin', 'https://site-web.account.workers.dev', 'site-web.account.workers.dev'],
      ['the workers.dev address of a Worker that has a custom domain', 'https://example.com', 'site-web.account.workers.dev'],
      ['a preview URL', 'https://example.com', 'abc123-site-web.account.workers.dev'],
    ])('disallows everything on %s', async (_title, appUrl, requestHost) => {
      const robots = await robotsFor(appUrl, requestHost);
      expect(robots.rules).toEqual({ userAgent: '*', disallow: '/' });
      expect(robots.sitemap).toBeUndefined();
    });
  });
});
