import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const REPO_NODE_MODULES = resolve(import.meta.dir, '../../../../node_modules');
const PROJECT = 'payload-logic';

// The revalidation tags are what the hooks and the cached reads agree on: the tests run the generated hooks over a recorder
// in place of Next.js, because revalidateTag only works inside a request.
const revalidated: [string, unknown][] = [];
let revalidateError: Error | undefined;

mock.module('next/cache', () => ({
  revalidateTag: (tag: string, profile: unknown) => {
    if (revalidateError) throw revalidateError;
    revalidated.push([tag, profile]);
  },
  unstable_cache: (read: () => unknown) => read,
}));

interface Hooks {
  revalidatePage: (args: unknown) => unknown;
  revalidateDeletedPage: (args: unknown) => unknown;
  revalidatePost: (args: unknown) => unknown;
  revalidateDeletedPost: (args: unknown) => unknown;
  revalidateSiteSettings: (args: unknown) => unknown;
}

interface RemoteConfig {
  remoteBindingsConfig: (config: unknown, bindings: string[]) => Record<string, unknown>;
  bindingsWithoutDatabaseId: (config: unknown) => string[];
}

interface Backup {
  runBackup: (env: unknown, now?: Date) => Promise<{ prefix: string; tables: { name: string; objects: string[]; rows: number }[] }>;
}

describe('cloudflare-payload-nextjs generated logic', () => {
  let tempDir: string;
  let projectPath: string;
  const web = (path: string) => join(projectPath, 'apps/web', path);
  const cron = (path: string) => join(projectPath, 'apps/cron', path);

  // The backup and the HTTP logger write to the console: the tests keep it to check it.
  const originalLog = console.log;
  let logged: string[] = [];

  beforeAll(async () => {
    console.log = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    tempDir = await createTempDir();
    projectPath = join(tempDir, PROJECT);
    const result = await runCli([PROJECT, '--blueprint', 'cloudflare-payload-nextjs', '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    await symlink(REPO_NODE_MODULES, join(projectPath, 'node_modules'));
  });

  afterAll(async () => {
    console.log = originalLog;
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    logged = [];
    revalidated.length = 0;
    revalidateError = undefined;
  });

  describe('the hooks that expire the cache', () => {
    let hooks: Hooks;

    beforeAll(async () => {
      hooks = await import(web('src/hooks/revalidate.ts'));
    });

    const page = (slug: string, status: 'draft' | 'published') => ({ slug, _status: status });
    const changed = (doc: unknown, previousDoc?: unknown, context: Record<string, unknown> = {}) => ({
      doc,
      previousDoc,
      req: { context },
    });
    const tagsOf = () => revalidated.map(([tag]) => tag).sort();

    test('publishing a page expires the pages list and the page, at once', () => {
      hooks.revalidatePage(changed(page('about', 'published'), undefined));

      expect(tagsOf()).toEqual(['page:about', 'pages']);
      expect(revalidated.every(([, profile]) => JSON.stringify(profile) === JSON.stringify({ expire: 0 }))).toBe(true);
    });

    test('renaming a published page expires the old slug too, so its page is gone', () => {
      hooks.revalidatePage(changed(page('about-us', 'published'), page('about', 'published')));

      expect(tagsOf()).toEqual(['page:about', 'page:about-us', 'pages']);
    });

    test('unpublishing expires the page; saving a draft over a draft expires nothing', () => {
      hooks.revalidatePage(changed(page('about', 'draft'), page('about', 'published')));
      expect(tagsOf()).toEqual(['page:about', 'pages']);

      revalidated.length = 0;
      hooks.revalidatePage(changed(page('about', 'draft'), page('about', 'draft')));
      expect(revalidated).toEqual([]);
    });

    test('deleting a page or a post expires its tags and its list', () => {
      hooks.revalidateDeletedPage({ doc: page('about', 'published'), req: { context: {} } });
      expect(tagsOf()).toEqual(['page:about', 'pages']);

      revalidated.length = 0;
      hooks.revalidateDeletedPost({ doc: page('hello', 'published'), req: { context: {} } });
      expect(tagsOf()).toEqual(['post:hello', 'posts']);
    });

    test('publishing a post expires the posts list and the post', () => {
      hooks.revalidatePost(changed(page('hello', 'published')));

      expect(tagsOf()).toEqual(['post:hello', 'posts']);
    });

    test('the site settings expire their own tag', () => {
      hooks.revalidateSiteSettings({ doc: {}, req: { context: {} } });

      expect(tagsOf()).toEqual(['site-settings']);
    });

    test('a write that asks for it expires nothing', () => {
      hooks.revalidatePage(changed(page('about', 'published'), undefined, { disableRevalidate: true }));
      hooks.revalidateSiteSettings({ doc: {}, req: { context: { disableRevalidate: true } } });

      expect(revalidated).toEqual([]);
    });

    test('a write outside a request (a migration, the seed) is not an error', () => {
      revalidateError = new Error('Invariant: static generation store missing in revalidateTag("pages")');

      expect(() => hooks.revalidatePage(changed(page('about', 'published')))).not.toThrow();
    });

    test('any other error of the cache is not hidden', () => {
      revalidateError = new Error('the tag cache is down');

      expect(() => hooks.revalidatePage(changed(page('about', 'published')))).toThrow('the tag cache is down');
    });
  });

  describe('the remote bindings runner', () => {
    let remote: RemoteConfig;

    beforeAll(async () => {
      remote = await import(web('scripts/remote-config.ts'));
    });

    const config = {
      name: 'site-web',
      main: '.open-next/worker.js',
      compatibility_date: '2026-06-12',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: [
        { binding: 'DB', database_name: 'site-db', database_id: 'abc' },
        { binding: 'NEXT_TAG_CACHE_D1', database_name: 'site-db', database_id: 'abc' },
      ],
      r2_buckets: [
        { binding: 'STORAGE', bucket_name: 'site-storage' },
        { binding: 'NEXT_INC_CACHE_R2_BUCKET', bucket_name: 'site-storage' },
      ],
    };

    test('makes the named bindings remote and carries nothing else to the account', () => {
      expect(remote.remoteBindingsConfig(config, ['DB', 'STORAGE'])).toEqual({
        name: 'site-web',
        compatibility_date: '2026-06-12',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [{ binding: 'DB', database_name: 'site-db', database_id: 'abc', remote: true }],
        r2_buckets: [{ binding: 'STORAGE', bucket_name: 'site-storage', remote: true }],
      });
    });

    test('names the D1 bindings that still hold the placeholder id', () => {
      const placeholder = { ...config, d1_databases: config.d1_databases.map((d1) => ({ ...d1, database_id: 'REPLACE_WITH_D1_DATABASE_ID' })) };

      expect(remote.bindingsWithoutDatabaseId(placeholder)).toEqual(['DB', 'NEXT_TAG_CACHE_D1']);
      expect(remote.bindingsWithoutDatabaseId(config)).toEqual([]);
    });
  });

  describe('the backup of the cron Worker', () => {
    interface StoredObject {
      body: string;
    }

    // SQLite stands in for D1, and refuses the tables D1 refuses.
    function d1Over(database: Database) {
      return {
        prepare(sql: string) {
          if (/_cf_/.test(sql)) throw new Error('D1_ERROR: access to _cf_KV is prohibited');
          const statement = database.query(sql);
          let values: unknown[] = [];
          const prepared = {
            bind(...bound: unknown[]) {
              values = bound;
              return prepared;
            },
            async all() {
              return { results: statement.all(...(values as never[])) };
            },
          };
          return prepared;
        },
      };
    }

    function r2Over(objects: Map<string, StoredObject>) {
      return {
        async put(key: string, body: string) {
          objects.set(key, { body });
        },
        async delete(keys: string | string[]) {
          for (const key of [keys].flat()) objects.delete(key);
        },
        async list({ prefix = '', delimiter }: { prefix?: string; delimiter?: string }) {
          const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
          if (!delimiter) return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [], truncated: false };
          const prefixes = new Set(keys.map((key) => key.slice(0, prefix.length + key.slice(prefix.length).indexOf(delimiter) + 1)));
          return { objects: [], delimitedPrefixes: [...prefixes], truncated: false };
        },
      };
    }

    let database: Database;
    let objects: Map<string, StoredObject>;
    let backup: Backup;

    beforeAll(async () => {
      backup = await import(cron('src/backup.ts'));
    });

    beforeEach(() => {
      database = new Database(':memory:');
      database.run('CREATE TABLE users (id integer PRIMARY KEY, email text)');
      database.run('CREATE TABLE "weird ""name""" (id integer PRIMARY KEY, value text)');
      database.run('CREATE TABLE _cf_KV (key text PRIMARY KEY, value blob)');
      database.run('CREATE TABLE empty_table (id integer PRIMARY KEY)');
      database.run('CREATE TABLE seen (id integer PRIMARY KEY AUTOINCREMENT)');
      database.run("INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com')");
      database.run('INSERT INTO "weird ""name""" (value) VALUES (\'x\')');
      objects = new Map();
    });

    const env = (extra: Record<string, string> = {}) => ({ DB: d1Over(database), STORAGE: r2Over(objects), ...extra });
    const lines = (key: string) =>
      (objects.get(key)?.body ?? '')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

    test('writes one NDJSON object per table with rows, a manifest, and nothing of the tables D1 owns', async () => {
      const manifest = await backup.runBackup(env(), new Date('2026-10-21T03:00:00.000Z'));

      expect(manifest.prefix).toBe('backups/2026-10-21/2026-10-21T03-00-00Z/');
      expect(manifest.tables.map((table) => [table.name, table.rows]).sort()).toEqual([
        ['empty_table', 0],
        ['seen', 0],
        ['users', 2],
        ['weird "name"', 1],
      ]);
      expect(lines(`${manifest.prefix}users/0001.ndjson`)).toEqual([
        { id: 1, email: 'a@example.com' },
        { id: 2, email: 'b@example.com' },
      ]);
      expect([...objects.keys()].some((key) => key.includes('_cf_KV') || key.includes('sqlite_'))).toBe(false);
      expect(JSON.parse(objects.get(`${manifest.prefix}manifest.json`)?.body ?? '{}').tables).toHaveLength(4);
      expect(logged).toContain(`[cron] backed up 4 table(s) to ${manifest.prefix}, pruned 0 old day(s)`);
    });

    test('reads a table of more rows than one query returns', async () => {
      database.run('WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200) INSERT INTO "weird ""name""" (value) SELECT i FROM n');

      const manifest = await backup.runBackup(env());

      const table = manifest.tables.find((entry) => entry.name === 'weird "name"');
      expect(table?.rows).toBe(1201);
      expect(table?.objects.map((key) => lines(key).length).reduce((sum, count) => sum + count, 0)).toBe(1201);
    });

    test('deletes the backups older than the retention and keeps the others', async () => {
      for (const day of ['2026-09-01', '2026-09-25', '2026-10-20']) {
        objects.set(`backups/${day}/${day}T03-00-00Z/manifest.json`, { body: '{}' });
        objects.set(`backups/${day}/${day}T03-00-00Z/users/0001.ndjson`, { body: '' });
      }
      objects.set('media.png', { body: 'image' });
      objects.set('incremental-cache/page', { body: 'page' });

      await backup.runBackup(env({ BACKUP_RETENTION_DAYS: '30' }), new Date('2026-10-21T03:00:00.000Z'));

      const keys = [...objects.keys()];
      expect(keys.some((key) => key.startsWith('backups/2026-09-01/'))).toBe(false);
      expect(keys.some((key) => key.startsWith('backups/2026-09-25/'))).toBe(true);
      expect(keys.some((key) => key.startsWith('backups/2026-10-20/'))).toBe(true);
      expect(keys.some((key) => key.startsWith('backups/2026-10-21/'))).toBe(true);
      expect(keys).toContain('media.png');
      expect(keys).toContain('incremental-cache/page');
    });
  });

  describe('POST /backup/run', () => {
    type Fetch = (request: Request, env: Record<string, unknown>) => Promise<Response>;
    let fetchApp: Fetch;

    beforeAll(async () => {
      const app = (await import(cron('src/app.ts'))).default as { fetch: Fetch };
      fetchApp = (request, env) => app.fetch(request, env);
    });

    const database = new Database(':memory:');
    database.run('CREATE TABLE users (id integer PRIMARY KEY)');
    const stored = new Map<string, StoredObjectLike>();
    interface StoredObjectLike {
      body: string;
    }
    const bindings = (token?: string) => ({
      BACKUP_TRIGGER_TOKEN: token,
      DB: { prepare: (sql: string) => ({ bind: () => ({ all: async () => ({ results: database.query(sql).all() }) }), all: async () => ({ results: database.query(sql).all() }) }) },
      STORAGE: {
        put: async (key: string, body: string) => void stored.set(key, { body }),
        list: async () => ({ objects: [], delimitedPrefixes: [], truncated: false }),
        delete: async () => undefined,
      },
    });
    const call = (authorization: string | undefined, token: string | undefined) =>
      fetchApp(new Request('http://cron.test/backup/run', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }), bindings(token));

    test('fails closed when no token is set, even for a request that sends an empty one', async () => {
      expect((await call(undefined, undefined)).status).toBe(503);
      expect((await call('Bearer ', undefined)).status).toBe(503);
      expect(stored.size).toBe(0);
    });

    test('refuses a missing or wrong token', async () => {
      expect((await call(undefined, 'secret')).status).toBe(401);
      expect((await call('Bearer nope', 'secret')).status).toBe(401);
      expect((await call('Bearer secret-and-more', 'secret')).status).toBe(401);
      expect(stored.size).toBe(0);
    });

    test('runs a backup for the right token', async () => {
      const response = await call('Bearer secret', 'secret');

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, tables: 1 });
      expect([...stored.keys()].some((key) => key.endsWith('manifest.json'))).toBe(true);
    });
  });
});
