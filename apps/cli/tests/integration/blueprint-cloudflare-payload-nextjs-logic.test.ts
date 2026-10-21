import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const REPO_NODE_MODULES = resolve(import.meta.dir, '../../../../node_modules');
const PROJECT = 'payload-logic';

// The recorder the stand-ins of Next.js and React write to, and the Payload client of the stand-in for the Local API.
interface Recorder {
  calls: { keys: string[]; tags: string[] | undefined }[];
  error?: Error;
  headers: Record<string, string>;
  revalidated: [string, unknown][];
  store: Map<string, unknown>;
}

interface FakePayload {
  auth: (args: { headers: Headers }) => Promise<{ user: { id: number } | null }>;
  count: (args: unknown) => Promise<{ totalDocs: number }>;
  find: (args: Record<string, unknown>) => Promise<{ docs: Record<string, unknown>[] }>;
  findGlobal: (args: unknown) => Promise<Record<string, unknown>>;
}

declare global {
  // biome-ignore lint/style/noVar: globalThis properties are declared with var
  var __recorder: Recorder;
  // biome-ignore lint/style/noVar: globalThis properties are declared with var
  var __payload: FakePayload;
}

const STUBS: Record<string, string> = {
  'next-cache': `
export const revalidateTag = (tag, profile) => {
  if (globalThis.__recorder.error) throw globalThis.__recorder.error;
  globalThis.__recorder.revalidated.push([tag, profile]);
};
// Like unstable_cache: the result of a call is kept under its keys, and a call that throws keeps nothing.
export const unstable_cache = (read, keys, options) => async () => {
  const { calls, store } = globalThis.__recorder;
  const key = JSON.stringify(keys);
  calls.push({ keys, tags: options?.tags });
  if (store.has(key)) return store.get(key);
  const value = await read();
  store.set(key, value);
  return value;
};`,
  'next-headers': 'export const headers = async () => new Headers(globalThis.__recorder.headers);',
  // Like React's cache(): the same arguments in one render run the function once.
  react: `
export const cache = (fn) => {
  const results = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!results.has(key)) results.set(key, fn(...args));
    return results.get(key);
  };
};`,
  'payload-client': 'export const getPayloadClient = async () => globalThis.__payload;',
  payload: `
export class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}`,
  'opennext-config': 'export const defineCloudflareConfig = (config) => config;',
  'opennext-with-payload': 'export const withPayload = (config) => config;',
  'opennext-dev': 'export const initOpenNextCloudflareForDev = () => {};',
  'opennext-r2-cache': `
const writes = [];
export default {
  name: 'cf-r2-incremental-cache',
  writes,
  get: async (key) => ({ key }),
  set: async (key, value, cacheType) => { writes.push([key, value, cacheType]); },
  delete: async () => {},
};`,
  'opennext-tag-cache': "export default { name: 'tag-cache' };",
};

describe('cloudflare-payload-nextjs generated logic', () => {
  let tempDir: string;
  let projectPath: string;
  let loads = 0;
  const web = (path: string) => join(projectPath, 'apps/web', path);
  const cron = (path: string) => join(projectPath, 'apps/cron', path);

  // The backup and the HTTP logger write to the console: the tests keep it to check it.
  const originalLog = console.log;
  let logged: string[] = [];

  /** A stand-in module, written once. */
  async function stub(name: string): Promise<string> {
    const path = join(tempDir, 'stubs', `${name}.mjs`);
    if (!(await Bun.file(path).exists())) await Bun.write(path, STUBS[name] as string);
    return path;
  }

  /**
   * The generated module, written to a directory of its own so that every load is fresh (React's cache() and the state of
   * a module do not leak from a test to the next). `imports` maps the specifiers it imports to stand-ins or to other
   * evaluated modules.
   */
  async function load<T>(source: string, imports: Record<string, string>): Promise<T> {
    loads += 1;
    const directory = join(tempDir, `load-${loads}`);
    await mkdir(directory, { recursive: true });
    return evaluateGeneratedModule<T>(await readTextFile(web(source)), join(directory, 'module.mjs'), imports);
  }

  /** The path of a generated module that the next one imports, evaluated as it is. */
  async function path(source: string, imports: Record<string, string> = {}): Promise<string> {
    loads += 1;
    const directory = join(tempDir, `load-${loads}`);
    await mkdir(directory, { recursive: true });
    const target = join(directory, 'module.mjs');
    await evaluateGeneratedModule(await readTextFile(web(source)), target, imports);
    return target;
  }

  beforeAll(async () => {
    console.log = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    tempDir = await createTempDir();
    projectPath = join(tempDir, PROJECT);
    const result = await runCli(
      [PROJECT, '--blueprint', 'cloudflare-payload-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    await symlink(REPO_NODE_MODULES, join(projectPath, 'node_modules'));
  });

  afterAll(async () => {
    console.log = originalLog;
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    logged = [];
    globalThis.__recorder = { calls: [], headers: {}, revalidated: [], store: new Map() };
  });

  interface Tags {
    CACHE_TAGS: {
      pages: string;
      posts: string;
      siteSettings: string;
      media: string;
      page: (slug: string) => string;
      post: (slug: string) => string;
    };
  }
  const tagsModule = async () => path('src/lib/cache-tags.ts');

  describe('the hooks that expire the cache', () => {
    interface Hooks {
      revalidatePage: (args: unknown) => unknown;
      revalidateDeletedPage: (args: unknown) => unknown;
      revalidatePost: (args: unknown) => unknown;
      revalidateDeletedPost: (args: unknown) => unknown;
      revalidateSiteSettings: (args: unknown) => unknown;
      revalidateMedia: (args: unknown) => unknown;
      revalidateDeletedMedia: (args: unknown) => unknown;
    }
    let hooks: Hooks;
    let tags: Tags['CACHE_TAGS'];

    beforeEach(async () => {
      const cacheTags = await tagsModule();
      const revalidate = await path('src/lib/revalidate.ts', { 'next/cache': await stub('next-cache') });
      hooks = await load<Hooks>('src/hooks/revalidate.ts', {
        '@/lib/cache-tags': cacheTags,
        '@/lib/revalidate': revalidate,
      });
      tags = (await import(cacheTags) as Tags).CACHE_TAGS;
    });

    const doc = (slug: string, status: 'draft' | 'published') => ({ slug, _status: status });
    const changed = (current: unknown, previousDoc?: unknown, context: Record<string, unknown> = {}) => ({
      doc: current,
      previousDoc,
      req: { context },
    });
    const revalidated = () => globalThis.__recorder.revalidated.map(([tag]) => tag).sort();

    test('publishing a page expires the pages list and the page, at once', () => {
      hooks.revalidatePage(changed(doc('about', 'published')));

      expect(revalidated()).toEqual([tags.page('about'), tags.pages].sort());
      expect(
        globalThis.__recorder.revalidated.every(([, profile]) => JSON.stringify(profile) === JSON.stringify({ expire: 0 })),
      ).toBe(true);
    });

    test('renaming a published page expires the old slug too, so its page is gone', () => {
      hooks.revalidatePage(changed(doc('about-us', 'published'), doc('about', 'published')));

      expect(revalidated()).toEqual([tags.page('about'), tags.page('about-us'), tags.pages].sort());
    });

    test('unpublishing expires the page; saving a draft over a draft expires nothing', () => {
      hooks.revalidatePage(changed(doc('about', 'draft'), doc('about', 'published')));
      expect(revalidated()).toEqual([tags.page('about'), tags.pages].sort());

      globalThis.__recorder.revalidated.length = 0;
      hooks.revalidatePage(changed(doc('about', 'draft'), doc('about', 'draft')));
      expect(globalThis.__recorder.revalidated).toEqual([]);
    });

    test('deleting a page or a post expires its tags and its list', () => {
      hooks.revalidateDeletedPage({ doc: doc('about', 'published'), req: { context: {} } });
      expect(revalidated()).toEqual([tags.page('about'), tags.pages].sort());

      globalThis.__recorder.revalidated.length = 0;
      hooks.revalidateDeletedPost({ doc: doc('hello', 'published'), req: { context: {} } });
      expect(revalidated()).toEqual([tags.post('hello'), tags.posts].sort());
    });

    test('publishing a post expires the posts list and the post', () => {
      hooks.revalidatePost(changed(doc('hello', 'published')));

      expect(revalidated()).toEqual([tags.post('hello'), tags.posts].sort());
    });

    test('the site settings expire their own tag', () => {
      hooks.revalidateSiteSettings({ doc: {}, req: { context: {} } });

      expect(revalidated()).toEqual([tags.siteSettings]);
    });

    test('editing or deleting a media expires the reads that embed it, and uploading one expires nothing', () => {
      hooks.revalidateMedia({ doc: { id: 1 }, operation: 'update', req: { context: {} } });
      expect(revalidated()).toEqual([tags.media]);

      globalThis.__recorder.revalidated.length = 0;
      hooks.revalidateDeletedMedia({ doc: { id: 1 }, req: { context: {} } });
      expect(revalidated()).toEqual([tags.media]);

      globalThis.__recorder.revalidated.length = 0;
      hooks.revalidateMedia({ doc: { id: 2 }, operation: 'create', req: { context: {} } });
      expect(globalThis.__recorder.revalidated).toEqual([]);
    });

    test('a write that asks for it expires nothing', () => {
      hooks.revalidatePage(changed(doc('about', 'published'), undefined, { disableRevalidate: true }));
      hooks.revalidateSiteSettings({ doc: {}, req: { context: { disableRevalidate: true } } });
      hooks.revalidateMedia({ doc: {}, operation: 'update', req: { context: { disableRevalidate: true } } });
      hooks.revalidateDeletedMedia({ doc: {}, req: { context: { disableRevalidate: true } } });

      expect(globalThis.__recorder.revalidated).toEqual([]);
    });

    test('a write outside a request (a migration, the seed) is not an error', () => {
      globalThis.__recorder.error = new Error('Invariant: static generation store missing in revalidateTag("pages")');

      expect(() => hooks.revalidatePage(changed(doc('about', 'published')))).not.toThrow();
    });

    test('any other error of the cache is not hidden', () => {
      globalThis.__recorder.error = new Error('the tag cache is down');

      expect(() => hooks.revalidatePage(changed(doc('about', 'published')))).toThrow('the tag cache is down');
    });
  });

  describe('the reads of the public site', () => {
    interface Queries {
      getPage: (slug: string, draft: boolean) => Promise<unknown>;
      getPost: (slug: string, draft: boolean) => Promise<unknown>;
      getPublishedPosts: () => Promise<unknown>;
      getSiteSettings: () => Promise<unknown>;
      getSitemapEntries: () => Promise<unknown>;
    }
    interface FindCall {
      collection: string;
      draft?: boolean;
      overrideAccess?: boolean;
      populate?: Record<string, Record<string, boolean>>;
      select?: Record<string, boolean>;
      user?: unknown;
      where?: { slug: { equals: string } };
    }
    let queries: Queries;
    let finds: FindCall[];
    let authCalls: number;
    let signedIn: { id: number } | null;
    let tags: Tags['CACHE_TAGS'];
    let hookTags: (event: 'page' | 'post' | 'settings' | 'media', slug: string) => string[];

    const PUBLISHED = { 'about': { slug: 'about', title: 'About', _status: 'published' } } as Record<string, Record<string, unknown>>;

    beforeEach(async () => {
      finds = [];
      authCalls = 0;
      signedIn = null;
      globalThis.__payload = {
        async auth() {
          authCalls += 1;
          return { user: signedIn };
        },
        async count() {
          return { totalDocs: 0 };
        },
        async find(args) {
          finds.push(args as unknown as FindCall);
          const slug = (args as unknown as FindCall).where?.slug.equals ?? '';
          const found = PUBLISHED[slug];
          return { docs: found ? [found] : [{ id: 1, slug: 'x', updatedAt: 'now' }] };
        },
        async findGlobal() {
          return { siteName: 'Site' };
        },
      };
      const cacheTags = await tagsModule();
      tags = (await import(cacheTags) as Tags).CACHE_TAGS;
      queries = await load<Queries>('src/lib/queries.ts', {
        '@/lib/cache-tags': cacheTags,
        '@/lib/payload': await stub('payload-client'),
        'next/cache': await stub('next-cache'),
        'next/headers': await stub('next-headers'),
        react: await stub('react'),
      });

      const revalidate = await path('src/lib/revalidate.ts', { 'next/cache': await stub('next-cache') });
      const hooks = await load<Record<string, (args: unknown) => unknown>>('src/hooks/revalidate.ts', {
        '@/lib/cache-tags': cacheTags,
        '@/lib/revalidate': revalidate,
      });
      // The tags the hooks of the collections expire when a document is published.
      hookTags = (event, slug) => {
        globalThis.__recorder.revalidated.length = 0;
        const published = { slug, _status: 'published' };
        if (event === 'page') hooks.revalidatePage?.({ doc: published, req: { context: {} } });
        if (event === 'post') hooks.revalidatePost?.({ doc: published, req: { context: {} } });
        if (event === 'settings') hooks.revalidateSiteSettings?.({ doc: {}, req: { context: {} } });
        if (event === 'media') hooks.revalidateMedia?.({ doc: {}, operation: 'update', req: { context: {} } });
        return globalThis.__recorder.revalidated.map(([tag]) => tag);
      };
    });

    const tagsOfReads = () => globalThis.__recorder.calls.flatMap((call) => call.tags ?? []);

    test('every read is cached under tags that the hooks of its collection expire', async () => {
      await queries.getPage('about', false);
      const pageTags = [...tagsOfReads()];
      globalThis.__recorder.calls.length = 0;
      await queries.getPost('about', false);
      const postTags = [...tagsOfReads()];
      globalThis.__recorder.calls.length = 0;
      await queries.getPublishedPosts();
      const postsListTags = [...tagsOfReads()];
      globalThis.__recorder.calls.length = 0;
      await queries.getSiteSettings();
      const settingsTags = [...tagsOfReads()];
      globalThis.__recorder.calls.length = 0;
      await queries.getSitemapEntries();
      const sitemapTags = [...tagsOfReads()];

      expect(pageTags).toEqual([tags.page('about'), tags.media]);
      expect(hookTags('page', 'about')).toContain(pageTags[0] as string);
      expect(postTags).toEqual([tags.post('about'), tags.media]);
      expect(hookTags('post', 'about')).toContain(postTags[0] as string);
      expect(postsListTags).toEqual([tags.posts, tags.media]);
      expect(hookTags('post', 'about')).toContain(postsListTags[0] as string);
      // They embed media at depth 1, so editing or deleting an image expires them too.
      for (const embedding of [pageTags, postTags, postsListTags]) {
        expect(hookTags('media', 'about')).toContain(embedding[1] as string);
      }
      expect(settingsTags).toEqual([tags.siteSettings]);
      expect(hookTags('settings', 'about')).toContain(settingsTags[0] as string);
      // The sitemap lists both collections: a page or a post that is published expires it.
      expect(sitemapTags.sort()).toEqual([tags.pages, tags.posts].sort());
      expect(hookTags('page', 'about')).toContain(tags.pages);
      expect(hookTags('post', 'about')).toContain(tags.posts);
    });

    test('reads the published document with the access of an anonymous visitor, and keeps it', async () => {
      const page = await queries.getPage('about', false);

      expect(page).toEqual(PUBLISHED.about);
      expect(finds).toHaveLength(1);
      expect(finds[0]).toMatchObject({ collection: 'pages', draft: false, overrideAccess: false, where: { slug: { equals: 'about' } } });
      expect(authCalls).toBe(0);
      expect(globalThis.__recorder.store.size).toBe(1);
    });

    test('a slug with no document answers null and leaves nothing in the cache', async () => {
      globalThis.__payload.find = async (args) => {
        finds.push(args as unknown as FindCall);
        return { docs: [] };
      };

      expect(await queries.getPage('made-up', false)).toBeNull();
      expect(await queries.getPost('made-up', false)).toBeNull();
      expect(globalThis.__recorder.store.size).toBe(0);
    });

    test('asks for the same document once in a render', async () => {
      await Promise.all([queries.getPage('about', false), queries.getPage('about', false), queries.getPage('about', false)]);
      await queries.getSiteSettings();
      await queries.getSiteSettings();

      expect(finds).toHaveLength(1);
      expect(globalThis.__recorder.calls.filter((call) => call.tags?.[0] === tags.siteSettings)).toHaveLength(1);
    });

    test('a draft is read for a signed-in user with their access, and never cached', async () => {
      signedIn = { id: 7 };
      globalThis.__recorder.headers = { cookie: 'payload-token=abc' };

      await queries.getPage('about', true);

      expect(authCalls).toBe(1);
      expect(finds[0]).toMatchObject({ draft: true, overrideAccess: false, user: { id: 7 } });
      expect(globalThis.__recorder.calls).toHaveLength(0);
    });

    test('a draft cookie without a user reads the published document, and shows no draft', async () => {
      signedIn = null;

      await queries.getPost('about', true);

      expect(authCalls).toBe(1);
      expect(finds[0]).toMatchObject({ collection: 'posts', draft: false, overrideAccess: false, user: null });
    });

    test('the list of posts reads the fields of a card and the media fields it shows', async () => {
      await queries.getPublishedPosts();

      expect(finds[0]?.collection).toBe('posts');
      expect(Object.keys(finds[0]?.select ?? {}).sort()).toEqual(['cover', 'excerpt', 'publishedAt', 'slug', 'title']);
      expect(Object.keys(finds[0]?.populate?.media ?? {}).sort()).toEqual(['alt', 'focalX', 'focalY', 'height', 'url', 'width']);
      expect(finds[0]).toMatchObject({ overrideAccess: false });
    });

    test('the sitemap reads both collections at once, by their slug and date', async () => {
      const order: string[] = [];
      globalThis.__payload.find = async (args) => {
        const collection = (args as unknown as FindCall).collection;
        order.push(`start ${collection}`);
        await Bun.sleep(5);
        order.push(`end ${collection}`);
        return { docs: [{ slug: collection, updatedAt: 'now' }] };
      };

      const entries = await queries.getSitemapEntries();

      expect(entries).toEqual([
        { collection: 'pages', slug: 'pages', updatedAt: 'now' },
        { collection: 'posts', slug: 'posts', updatedAt: 'now' },
      ]);
      expect(order.slice(0, 2)).toEqual(['start pages', 'start posts']);
    });
  });

  describe('the collections', () => {
    interface Users {
      Users: { hooks: { beforeDelete: ((args: unknown) => Promise<void>)[] } };
    }
    interface MediaModule {
      MEDIA_CACHE_CONTROL: string;
      Media: {
        hooks: {
          afterChange: ((args: unknown) => unknown)[];
          afterDelete: ((args: unknown) => unknown)[];
          beforeChange: ((args: unknown) => unknown)[];
        };
        upload: { modifyResponseHeaders: (args: { headers: Headers }) => void; crop: boolean; focalPoint: boolean };
      };
    }

    test('the last user cannot be deleted, any other can', async () => {
      const access = await path('src/access/index.ts');
      const { Users } = await load<Users>('src/collections/Users.ts', { '@/access': access, payload: await stub('payload') });
      const [beforeDelete] = Users.hooks.beforeDelete;
      const deleting = (totalDocs: number) => beforeDelete?.({ req: { payload: { count: async () => ({ totalDocs }) } } });

      await expect(deleting(1)).rejects.toMatchObject({ message: 'The last user cannot be deleted', status: 403 });
      await expect(deleting(2)).resolves.toBeUndefined();
    });

    describe('media', () => {
      let media: MediaModule;
      let maxBytes: number;

      beforeAll(async () => {
        const limits = await path('src/lib/upload-limits.ts');
        maxBytes = ((await import(limits)) as { MAX_UPLOAD_BYTES: number }).MAX_UPLOAD_BYTES;
        const cacheTags = await path('src/lib/cache-tags.ts');
        const revalidate = await path('src/lib/revalidate.ts', { 'next/cache': await stub('next-cache') });
        media = await load<MediaModule>('src/collections/Media.ts', {
          '@/access': await path('src/access/index.ts'),
          '@/hooks/revalidate': await path('src/hooks/revalidate.ts', {
            '@/lib/cache-tags': cacheTags,
            '@/lib/revalidate': revalidate,
          }),
          '@/lib/upload-limits': limits,
          payload: await stub('payload'),
        });
      });

      test('refuses a file over the limit that skipped the multipart parser, and keeps one at the limit', () => {
        const [refuse] = media.Media.hooks.beforeChange;
        // Payload hands the hook the bytes, and leaves `size` undefined once it has read the image.
        const read = (bytes: number) => ({ data: Buffer.alloc(bytes), size: undefined });

        expect(() => refuse?.({ data: {}, req: { file: read(maxBytes + 1) } })).toThrow('The file is larger than 20 MB');
        expect(refuse?.({ data: { alt: 'x' }, req: { file: read(maxBytes) } })).toEqual({ alt: 'x' });
        expect(refuse?.({ data: { alt: 'x' }, req: {} })).toEqual({ alt: 'x' });
      });

      test('refuses a file kept in a temporary file, which has a size and no bytes', () => {
        const [refuse] = media.Media.hooks.beforeChange;

        // Payload passes an empty buffer next to the real size when it keeps the upload in a temporary file.
        const kept = (size: number) => ({ data: Buffer.alloc(0), size });

        expect(() => refuse?.({ data: {}, req: { file: kept(maxBytes + 1) } })).toThrow('The file is larger than 20 MB');
        expect(refuse?.({ data: { alt: 'x' }, req: { file: kept(maxBytes) } })).toEqual({ alt: 'x' });
      });

      test('expires the reads that embed an image when it is edited or deleted', () => {
        const [afterChange] = media.Media.hooks.afterChange;
        const [afterDelete] = media.Media.hooks.afterDelete;

        afterChange?.({ doc: { id: 1 }, operation: 'update', req: { context: {} } });
        afterDelete?.({ doc: { id: 1 }, req: { context: {} } });

        expect(globalThis.__recorder.revalidated.map(([tag]) => tag)).toEqual(['media', 'media']);
      });

      test('turns the controls off that need sharp', () => {
        expect(media.Media.upload.crop).toBe(false);
        expect(media.Media.upload.focalPoint).toBe(false);
      });

      test('serves a file with a cache header', () => {
        const headers = new Headers({ 'Content-Type': 'image/png' });

        media.Media.upload.modifyResponseHeaders({ headers });

        expect(headers.get('Cache-Control')).toBe(media.MEDIA_CACHE_CONTROL);
        expect(headers.get('Cache-Control')).toContain('max-age=');
        expect(headers.get('Content-Type')).toBe('image/png');
      });
    });
  });

  describe('the OpenNext cache', () => {
    interface OpenNextConfig {
      incrementalCache: {
        name: string;
        get: (key: string, type: string) => Promise<unknown>;
        set: (key: string, value: unknown, type: string) => Promise<void>;
      };
      tagCache: { name: string };
    }
    let config: OpenNextConfig;
    let writes: unknown[][];

    beforeAll(async () => {
      const r2 = await stub('opennext-r2-cache');
      config = (await load<{ default: OpenNextConfig }>('open-next.config.ts', {
        '@opennextjs/cloudflare': await stub('opennext-config'),
        '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache': r2,
        '@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache': await stub('opennext-tag-cache'),
      })).default;
      writes = ((await import(r2)) as { default: { writes: unknown[][] } }).default.writes;
    });

    beforeEach(() => {
      writes.length = 0;
    });

    test('keeps the name of the R2 cache, which OpenNext reads to fill it', () => {
      expect(config.incrementalCache.name).toBe('cf-r2-incremental-cache');
    });

    test('does not write a page that answers 404, so a made-up URL leaves no object', async () => {
      await config.incrementalCache.set('/made-up', { type: 'app', html: '', meta: { status: 404 } }, 'cache');

      expect(writes).toEqual([]);
    });

    test('writes the other pages, routes and fetches', async () => {
      await config.incrementalCache.set('/about', { type: 'app', html: '', meta: { status: 200 } }, 'cache');
      await config.incrementalCache.set('/about', { type: 'app', html: '', meta: {} }, 'cache');
      await config.incrementalCache.set('/api', { type: 'route', body: '', meta: { status: 404 } }, 'cache');
      await config.incrementalCache.set('fetch-key', { kind: 'FETCH' }, 'fetch');

      expect(writes.map(([key]) => key)).toEqual(['/about', '/about', '/api', 'fetch-key']);
    });
  });

  describe('next.config.ts', () => {
    test('keeps the admin out of the frames of other sites', async () => {
      const { default: config } = await load<{
        default: { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
      }>('next.config.ts', {
        '@opennextjs/cloudflare': await stub('opennext-dev'),
        '@payloadcms/next/withPayload': await stub('opennext-with-payload'),
      });

      const rules = await config.headers();

      expect(rules).toEqual([
        { source: '/admin/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }] },
      ]);
    });
  });

  describe('the preview secret', () => {
    test('is compared whatever the lengths, and only equal secrets match', async () => {
      const { sameSecret } = await load<{ sameSecret: (given: string, expected: string) => boolean }>('src/lib/same-secret.ts', {});

      expect(sameSecret('secret', 'secret')).toBe(true);
      expect(sameSecret('secret', 'secreT')).toBe(false);
      expect(sameSecret('', 'secret')).toBe(false);
      expect(sameSecret('secret-and-more', 'secret')).toBe(false);
    });
  });

  describe('the admin credentials', () => {
    interface Credentials {
      adminCredentials: (env: Record<string, string | undefined>, file: string) => { email?: string; password?: string; error?: string };
    }
    let credentials: Credentials;

    beforeAll(async () => {
      credentials = await import(web('scripts/admin-credentials.ts'));
    });

    test('takes the email and password of the environment', () => {
      expect(credentials.adminCredentials({ ADMIN_EMAIL: 'a@example.com', ADMIN_PASSWORD: 'password' }, '.env.admin')).toEqual({
        email: 'a@example.com',
        password: 'password',
      });
    });

    test.each([
      [{}, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env.admin'],
      [{ ADMIN_EMAIL: 'a@example.com' }, 'Set ADMIN_EMAIL and ADMIN_PASSWORD'],
      [{ ADMIN_PASSWORD: 'password' }, 'Set ADMIN_EMAIL and ADMIN_PASSWORD'],
      [{ ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }, 'Set ADMIN_EMAIL and ADMIN_PASSWORD'],
    ])('names the file when a credential is missing: %j', (env, message) => {
      expect(credentials.adminCredentials(env, '.env.admin').error).toContain(message);
    });

    test('refuses a password under 12 characters against the production database, and only there', () => {
      const env = { ADMIN_EMAIL: 'a@example.com', ADMIN_PASSWORD: 'short-pass-1' };

      expect(credentials.adminCredentials({ ...env, ADMIN_PASSWORD: 'x'.repeat(11), WRANGLER_REMOTE_BINDINGS: 'true' }, '.env.admin').error).toContain(
        'at least 12 characters',
      );
      expect(credentials.adminCredentials({ ...env, WRANGLER_REMOTE_BINDINGS: 'true' }, '.env.admin')).toEqual({
        email: 'a@example.com',
        password: 'short-pass-1',
      });
      expect(credentials.adminCredentials({ ...env, ADMIN_PASSWORD: 'x' }, '.env.admin').error).toBeUndefined();
    });
  });

  describe('the remote bindings runner', () => {
    interface RemoteConfig {
      remoteBindingsConfig: (config: unknown, bindings: string[]) => Record<string, unknown>;
      bindingsWithoutDatabaseId: (config: unknown) => string[];
    }
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
      const placeholder = {
        ...config,
        d1_databases: config.d1_databases.map((d1) => ({ ...d1, database_id: 'REPLACE_WITH_D1_DATABASE_ID' })),
      };

      expect(remote.bindingsWithoutDatabaseId(placeholder)).toEqual(['DB', 'NEXT_TAG_CACHE_D1']);
      expect(remote.bindingsWithoutDatabaseId(config)).toEqual([]);
    });
  });

  describe('the backup of the cron Worker', () => {
    interface StoredObject {
      body: string;
    }
    interface Manifest {
      prefix: string;
      tables: { name: string; objects: string[]; rows: number }[];
    }
    interface Backup {
      runBackup: (env: unknown, now?: Date) => Promise<Manifest>;
    }
    interface Cron {
      default: {
        fetch: (request: Request, env: unknown) => Promise<Response>;
        scheduled: (controller: unknown, env: unknown, ctx: { waitUntil: (promise: Promise<unknown>) => void }) => Promise<void>;
      };
    }

    // SQLite stands in for D1, and refuses the tables D1 refuses.
    function d1Over(database: Database) {
      const queries: string[] = [];
      return {
        queries,
        prepare(sql: string) {
          if (/_cf_/.test(sql)) throw new Error('D1_ERROR: access to _cf_KV is prohibited');
          queries.push(sql);
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
    let d1: ReturnType<typeof d1Over>;

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
      d1 = d1Over(database);
    });

    const env = (extra: Record<string, string> = {}) => ({ DB: d1, BACKUPS: r2Over(objects), ...extra });
    const lines = (key: string) =>
      (objects.get(key)?.body ?? '')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const days = () => new Set([...objects.keys()].map((key) => key.split('/')[1]));
    const NOW = new Date('2026-10-21T03:00:00.000Z');

    test('writes one NDJSON object per table with rows, a manifest, and nothing of the tables D1 owns', async () => {
      const manifest = await backup.runBackup(env(), NOW);

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

    test('reads a table of more rows than one query returns, and stops on a short page', async () => {
      database.run('WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4500) INSERT INTO "weird ""name""" (value) SELECT i FROM n');

      const manifest = await backup.runBackup(env(), NOW);

      const table = manifest.tables.find((entry) => entry.name === 'weird "name"');
      expect(table?.rows).toBe(4501);
      expect(table?.objects.map((key) => lines(key).length).reduce((sum, count) => sum + count, 0)).toBe(4501);
      expect(d1.queries.filter((sql) => sql.includes('"weird ""name"""'))).toHaveLength(3);
    });

    test('asks no extra question for a table that fits a page, or is empty', async () => {
      await backup.runBackup(env(), NOW);

      const rowQueries = d1.queries.filter((sql) => sql.startsWith('SELECT rowid'));
      expect(rowQueries).toHaveLength(4);
    });

    test('splits a large table into several objects', async () => {
      const large = 'x'.repeat(1_100_000);
      for (let row = 0; row < 9; row++) database.run('INSERT INTO "weird ""name""" (value) VALUES (?)', [large]);

      const manifest = await backup.runBackup(env(), NOW);

      const table = manifest.tables.find((entry) => entry.name === 'weird "name"');
      expect(table?.rows).toBe(10);
      expect(table?.objects.length).toBeGreaterThan(1);
      expect(table?.objects.map((key) => lines(key).length).reduce((sum, count) => sum + count, 0)).toBe(10);
    });

    describe('retention', () => {
      const keep = (day: string) => {
        objects.set(`backups/${day}/${day}T03-00-00Z/manifest.json`, { body: '{}' });
        objects.set(`backups/${day}/${day}T03-00-00Z/users/0001.ndjson`, { body: '' });
      };

      test('deletes the days older than the retention and keeps the others, the media and the page cache', async () => {
        for (const day of ['2026-09-01', '2026-09-25', '2026-10-20']) keep(day);
        objects.set('media.png', { body: 'image' });
        objects.set('incremental-cache/page', { body: 'page' });

        await backup.runBackup(env({ BACKUP_RETENTION_DAYS: '30' }), NOW);

        expect(days().has('2026-09-01')).toBe(false);
        expect([...days()]).toEqual(expect.arrayContaining(['2026-09-25', '2026-10-20', '2026-10-21']));
        expect(objects.has('media.png')).toBe(true);
        expect(objects.has('incremental-cache/page')).toBe(true);
      });

      test('keeps a day whose end is within the retention and deletes one whose end is exactly at it', async () => {
        keep('2026-09-20');
        keep('2026-09-21');

        await backup.runBackup(env({ BACKUP_RETENTION_DAYS: '30' }), new Date('2026-10-21T00:00:00.000Z'));

        expect(days().has('2026-09-20')).toBe(false);
        expect(days().has('2026-09-21')).toBe(true);
      });

      test('a retention of one day keeps yesterday and deletes the day before', async () => {
        keep('2026-10-19');
        keep('2026-10-20');

        await backup.runBackup(env({ BACKUP_RETENTION_DAYS: '1' }), NOW);

        expect(days().has('2026-10-19')).toBe(false);
        expect(days().has('2026-10-20')).toBe(true);
      });

      test.each(['0', '-3', 'abc', '1.5', ''])('refuses a retention of "%s" before it writes or deletes anything', async (retention) => {
        keep('2026-01-01');
        const before = [...objects.keys()];

        await expect(backup.runBackup(env({ BACKUP_RETENTION_DAYS: retention }), NOW)).rejects.toThrow('BACKUP_RETENTION_DAYS');

        expect([...objects.keys()]).toEqual(before);
        expect(d1.queries).toEqual([]);
      });

      test('never deletes the backup it just wrote', async () => {
        const manifest = await backup.runBackup(env({ BACKUP_RETENTION_DAYS: '1' }), NOW);

        expect(objects.has(`${manifest.prefix}manifest.json`)).toBe(true);
      });
    });

    describe('the Worker', () => {
      let cronWorker: Cron['default'];

      beforeAll(async () => {
        cronWorker = ((await import(cron('src/index.ts'))) as Cron).default;
      });

      const bindings = (token?: string) => ({ ...env(), BACKUP_TRIGGER_TOKEN: token });
      const call = (authorization: string | undefined, token: string | undefined) =>
        cronWorker.fetch(
          new Request('http://cron.test/backup/run', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }),
          bindings(token),
        );
      const backups = () => [...objects.keys()].filter((key) => key.endsWith('manifest.json'));

      test('runs the backup of the schedule inside the lifetime it hands to waitUntil', async () => {
        const pending: Promise<unknown>[] = [];

        await cronWorker.scheduled({}, bindings(), { waitUntil: (promise) => void pending.push(promise) });

        expect(pending).toHaveLength(1);
        await Promise.all(pending);
        expect(backups()).toHaveLength(1);
        expect(lines(backups()[0]?.replace('manifest.json', 'users/0001.ndjson') ?? '')).toHaveLength(2);
      });

      test('fails closed when no token is set, even for a request that sends an empty one', async () => {
        expect((await call(undefined, undefined)).status).toBe(503);
        expect((await call('Bearer ', undefined)).status).toBe(503);
        expect(backups()).toEqual([]);
      });

      test('refuses a missing or wrong token', async () => {
        expect((await call(undefined, 'secret')).status).toBe(401);
        expect((await call('Bearer nope', 'secret')).status).toBe(401);
        expect((await call('Bearer secret-and-more', 'secret')).status).toBe(401);
        expect(backups()).toEqual([]);
      });

      test('runs a backup for the right token and says where it is', async () => {
        const response = await call('Bearer secret', 'secret');

        expect(response.status).toBe(200);
        const body = (await response.json()) as { ok: boolean; prefix: string; tables: number };
        expect(body).toMatchObject({ ok: true, tables: 4 });
        expect(backups()).toEqual([`${body.prefix}manifest.json`]);
        expect(lines(`${body.prefix}users/0001.ndjson`)).toEqual([
          { id: 1, email: 'a@example.com' },
          { id: 2, email: 'b@example.com' },
        ]);
      });
    });
  });
});
