import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { META } from '@/__meta__';
import type { MetaBlueprint } from '@/types/meta';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  getFreePort,
  type RunningServer,
  runCli,
  runCommand,
  startServer,
} from './helpers';

/**
 * Generates the blueprint, installs it, follows the first-run steps and serves the production build in workerd under bun,
 * npm and pnpm. Everything runs on the local D1 and R2 state of the generated repository: nothing reaches a Cloudflare
 * account.
 *
 * Signing in is the one step that payloadcms/payload#18274 breaks on Cloudflare: Payload 3.90 and later hash passwords with
 * 600,000 PBKDF2 iterations, and the runtime of Cloudflare refuses more than 100,000. Open-source workerd, which runs the
 * preview here, overrides its PBKDF2 check (`worker-factory.c++`, `test-fixture.c++`) and accepts any count, so neither the
 * preview nor `wrangler dev` can show it (cloudflare/workerd#7550, unmerged, would raise the production limit to 1,000,000).
 * The Node processes that hash a password for the first time (`ensure-admin`, the seed, the migration) therefore run with
 * `pbkdf2-limit.mjs` preloaded, which refuses more than 100,000 iterations as Cloudflare does: creating the first admin
 * fails for a release that hashes above it, and this file stays red until a release that does not is pinned.
 * `E2E_PBKDF2_LIMIT=off` runs the same tests without the preload, to see what else passes. The proof for a pinned release
 * is a sign-in on a deployed Worker.
 */

const TIMEOUT_INSTALL = 400_000;
const TIMEOUT_COMMAND = 300_000;
const TIMEOUT_BUILD_CF = 600_000;
const TIMEOUT_PREVIEW = 180_000;

const PROJECT = 'payload-e2e';
const STRICT_PNPM_MAJOR = 11;
const FALLBACK_PNPM = ['env', 'pnpm_config_manage_package_manager_versions=false', 'npx', '--yes', 'pnpm@12'];

const PBKDF2_LIMIT_PRELOAD = pathToFileURL(resolve(import.meta.dir, 'pbkdf2-limit.mjs')).href;
/** The Node processes that hash a password run with the limit of Cloudflare, unless `E2E_PBKDF2_LIMIT=off`. */
const PBKDF2_LIMIT: Record<string, string> =
  process.env.E2E_PBKDF2_LIMIT === 'off' ? {} : { NODE_OPTIONS: `--import=${PBKDF2_LIMIT_PRELOAD}` };

/** Nothing here talks to an account: a token that no account accepts and no account id, in every command that could reach one. */
const NO_CLOUDFLARE_ACCOUNT: Record<string, string> = {
  CLOUDFLARE_ACCOUNT_ID: '',
  CLOUDFLARE_API_TOKEN: 'invalid-token-so-that-nothing-reaches-an-account',
};

const FIRST_RUN_SCRIPTS = ((META.blueprints['cloudflare-payload-nextjs'] as MetaBlueprint).firstRun ?? []).flatMap((step) =>
  step.commands.flatMap((command) => ('script' in command ? [command.script] : [])),
);

/** Run by `payload run`: the Local API takes a file without the multipart parser, so only the hook of the collection stops it. */
const LARGE_MEDIA_SCRIPT = `import { getPayloadClient } from '@/lib/payload';

const payload = await getPayloadClient();
const padding = ' '.repeat(21 * 1024 * 1024);
const data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--' + padding + '--></svg>');
try {
  await payload.create({
    collection: 'media',
    data: { alt: 'Too large' },
    file: { data, mimetype: 'image/svg+xml', name: 'local-api-large.svg', size: data.length },
  });
  console.log('STORED');
} catch (error) {
  console.log('REFUSED', (error as { status?: number }).status);
}
process.exit(0);
`;

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'password';
const PREVIEW_SECRET = 'e2e-preview-secret';
const BACKUP_TOKEN = 'e2e-backup-token';

/** A `pnpm` on PATH: the installed one from pnpm 11, else `pnpm@12` fetched through npx, as install-scripts.test.ts does. */
async function pnpmEnvironment(shimDir: string): Promise<Record<string, string>> {
  const installed = Bun.which('pnpm') ? Number.parseInt(Bun.spawnSync(['pnpm', '--version']).stdout.toString().trim(), 10) : 0;
  if (installed >= STRICT_PNPM_MAJOR) return {};
  await mkdir(shimDir, { recursive: true });
  const shim = join(shimDir, 'pnpm');
  await writeFile(shim, `#!/bin/sh\nexec ${FALLBACK_PNPM.join(' ')} "$@"\n`);
  await chmod(shim, 0o755);
  return { PATH: `${shimDir}:${process.env.PATH}` };
}

function localDatabase(projectDir: string): Database {
  const directory = join(projectDir, '.wrangler/v3/d1/miniflare-D1DatabaseObject');
  const files = Bun.spawnSync(['ls', directory]).stdout.toString().split('\n').filter((file) => file.endsWith('.sqlite'));
  const file = files.find((candidate) => !candidate.startsWith('metadata'));
  if (!file) throw new Error(`no local D1 database under ${directory}`);
  return new Database(join(directory, file), { readonly: true });
}

function count(projectDir: string, table: string): number {
  const database = localDatabase(projectDir);
  try {
    return (database.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    database.close();
  }
}

/** The keys of each local R2 bucket (one database file each) under the persisted state of the repository. */
function localBuckets(projectDir: string): Record<string, string[]> {
  const directory = join(projectDir, '.wrangler/v3/r2/miniflare-R2BucketObject');
  const buckets: Record<string, string[]> = {};
  for (const file of Bun.spawnSync(['ls', directory]).stdout.toString().split('\n').filter((name) => name.endsWith('.sqlite'))) {
    const database = new Database(join(directory, file), { readonly: true });
    try {
      if (!database.query("SELECT 1 FROM sqlite_master WHERE name = '_mf_objects'").get()) continue;
      buckets[file] = (database.query('SELECT key FROM _mf_objects').all() as { key: string }[]).map(({ key }) => key);
    } finally {
      database.close();
    }
  }
  return buckets;
}

/** Replaces the blank secrets of a copied `.env` the way the first-run steps tell a developer to. */
async function fillSecrets(file: string, values: Record<string, string>): Promise<void> {
  let content = await readFile(file, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    content = content.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`);
  }
  await writeFile(file, content);
}

describe.each(['bun', 'npm', 'pnpm'])('blueprint-cloudflare-payload-nextjs under %s', (pm) => {
  let tempDir: string;
  let projectDir: string;
  let webDir: string;
  let cronDir: string;
  let env: Record<string, string>;
  let port: number;
  let origin: string;
  let server: RunningServer | undefined;
  let token = '';
  let firstRunDone = false;
  const requireFirstRun = () => expect(firstRunDone, 'the first-run steps did not complete, so there is no admin and no content to serve').toBe(true);

  const run = (args: string[], cwd: string, extra: Record<string, string> = {}) => runCommand(args, cwd, { ...env, ...extra });
  const runScript = (script: string, cwd = projectDir, extra: Record<string, string> = {}) =>
    run([pm, 'run', script], cwd, extra);

  beforeAll(async () => {
    tempDir = await createTempDir();
    env = pm === 'pnpm' ? await pnpmEnvironment(join(tempDir, 'bin')) : {};
    const result = await runCli([PROJECT, '--blueprint', 'cloudflare-payload-nextjs', '--linter', 'biome', '--no-git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    projectDir = join(tempDir, PROJECT);
    webDir = join(projectDir, 'apps/web');
    cronDir = join(projectDir, 'apps/cron');
    port = await getFreePort();
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server?.stop();
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test('installs', async () => {
    const install = await run([pm, 'install'], projectDir);
    expect(install.exitCode, install.stderr + install.stdout).toBe(0);
  }, TIMEOUT_INSTALL);

  test('follows the first-run steps: env files, migrate, create the admin, seed', async () => {
    for (const [directory, example] of [
      [webDir, '.env.example'],
      [webDir, '.env.admin.example'],
      [cronDir, '.env.example'],
    ] as const) {
      await copyFile(join(directory, example), join(directory, example.replace('.example', '')));
    }
    await fillSecrets(join(webDir, '.env'), {
      PAYLOAD_SECRET: 'e2e-payload-secret-not-for-production',
      PREVIEW_SECRET,
      NEXT_PUBLIC_APP_URL: origin,
    });
    await fillSecrets(join(cronDir, '.env'), { BACKUP_TRIGGER_TOKEN: BACKUP_TOKEN });

    expect(FIRST_RUN_SCRIPTS.length).toBeGreaterThan(0);
    for (const script of FIRST_RUN_SCRIPTS) {
      const result = await runScript(script, projectDir, PBKDF2_LIMIT);
      expect(result.exitCode, `${script}\n${result.stderr}\n${result.stdout}`).toBe(0);
    }
    expect({
      users: count(projectDir, 'users'),
      pages: count(projectDir, 'pages'),
      posts: count(projectDir, 'posts'),
      media: count(projectDir, 'media'),
    }).toEqual({ users: 1, pages: 2, posts: 2, media: 1 });
    firstRunDone = true;
  }, TIMEOUT_COMMAND * 3);

  test('the first-run steps run again and change nothing', async () => {
    for (const script of FIRST_RUN_SCRIPTS) {
      const result = await runScript(script, projectDir, PBKDF2_LIMIT);
      expect(result.exitCode, `${script}\n${result.stderr}`).toBe(0);
    }
    expect({
      users: count(projectDir, 'users'),
      pages: count(projectDir, 'pages'),
      posts: count(projectDir, 'posts'),
      media: count(projectDir, 'media'),
    }).toEqual({ users: 1, pages: 2, posts: 2, media: 1 });
  }, TIMEOUT_COMMAND * FIRST_RUN_SCRIPTS.length);

  test('the revalidations table has the columns the installed OpenNext reads and writes', async () => {
    const populate = await readFile(
      Bun.spawnSync(['find', projectDir, '-path', '*@opennextjs/cloudflare/dist/cli/commands/populate-cache.js', '-not', '-path', '*/.bun/*/.bun/*'])
        .stdout.toString()
        .split('\n')
        .filter(Boolean)[0] ?? '',
      'utf8',
    );
    const create = populate.match(/CREATE TABLE IF NOT EXISTS revalidations \((.*)\);/)?.[1] ?? '';
    const expected = create
      .split(',')
      .map((column) => column.trim().split(/\s+/)[0] ?? '')
      .filter((name) => name !== '' && !name.startsWith('UNIQUE'));
    expect(expected).toEqual(['tag', 'revalidatedAt', 'stale', 'expire']);

    const database = localDatabase(projectDir);
    try {
      const columns = (database.query("SELECT name FROM pragma_table_info('revalidations')").all() as { name: string }[]).map((c) => c.name);
      expect(columns).toEqual(expected);
    } finally {
      database.close();
    }
  });

  test('the generated Payload files match what Payload writes (types, import map)', async () => {
    const files = ['src/payload-types.ts', 'src/app/(payload)/admin/importMap.js'];
    const before = await Promise.all(files.map((file) => readFile(join(webDir, file), 'utf8')));
    for (const script of ['generate:types', 'generate:importmap']) {
      const result = await runScript(script, webDir);
      expect(result.exitCode, `${script}\n${result.stderr}`).toBe(0);
    }
    const after = await Promise.all(files.map((file) => readFile(join(webDir, file), 'utf8')));
    expect(after).toEqual(before);
  }, TIMEOUT_COMMAND * 2);

  test('the committed migrations are in step with the collections: migrate:create adds none', async () => {
    const migrations = join(webDir, 'src/migrations');
    const before = await readdir(migrations);
    const result = await run([pm, 'run', 'migrate:create', ...(pm === 'npm' ? ['--'] : []), '--skip-empty'], webDir);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const added = (await readdir(migrations)).filter((file) => !before.includes(file) && file.endsWith('.ts'));
    const sources = await Promise.all(added.map((file) => readFile(join(migrations, file), 'utf8')));
    expect(added, sources.join('\n')).toEqual([]);
  }, TIMEOUT_COMMAND);

  test('the remote commands refuse to run while the database id is still the placeholder, and leave nothing behind', async () => {
    for (const script of ['db:migrate:remote', 'ensure-admin:remote']) {
      const result = await runScript(script, webDir);
      expect(result.exitCode, script).toBe(1);
      expect(result.stderr, script).toContain('is still the placeholder');
    }
    expect(await fileExists(join(webDir, '.wrangler/remote-bindings.jsonc'))).toBe(false);
  }, TIMEOUT_COMMAND);

  test('`dev` serves the seeded site and signs the admin in, over the local state', async () => {
    requireFirstRun();
    const devPort = await getFreePort();
    const dev = await startServer([pm, 'run', 'dev'], webDir, {
      port: devPort,
      readyTimeout: TIMEOUT_PREVIEW,
      env: { ...env, ...NO_CLOUDFLARE_ACCOUNT, PORT: String(devPort), NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${devPort}` },
    });
    try {
      const home = await fetch(new URL('/', dev.url));
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('A site you edit from an admin');
      expect((await fetch(new URL('/admin', dev.url))).status).toBe(200);

      const login = await fetch(new URL('/api/users/login', dev.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });
      expect(login.status).toBe(200);
    } finally {
      await dev.stop();
    }
  }, TIMEOUT_PREVIEW * 2);

  test('type-checks and lints before the build, with no warning', async () => {
    const typecheck = await runScript('typecheck');
    expect(typecheck.exitCode, typecheck.stderr + typecheck.stdout).toBe(0);
    const lint = await run([pm, 'run', 'lint', ...(pm === 'npm' ? ['--'] : []), '--error-on-warnings'], projectDir);
    expect(lint.exitCode, lint.stderr + lint.stdout).toBe(0);
  }, TIMEOUT_COMMAND * 2);

  test('builds the Worker for the origin it is served from', async () => {
    const build = await run([pm, 'run', 'build:cf'], webDir, { ...NO_CLOUDFLARE_ACCOUNT, NEXT_PUBLIC_APP_URL: origin });
    expect(build.exitCode, build.stderr + build.stdout).toBe(0);
    expect(await fileExists(join(webDir, '.open-next/worker.js'))).toBe(true);
  }, TIMEOUT_BUILD_CF);

  test('lints with no warning after the build too', async () => {
    const lint = await run([pm, 'run', 'lint', ...(pm === 'npm' ? ['--'] : []), '--error-on-warnings'], projectDir);
    expect(lint.exitCode, lint.stderr + lint.stdout).toBe(0);
  }, TIMEOUT_COMMAND);

  describe('the production build in workerd', () => {
    const get = (path: string, init?: RequestInit) => fetch(new URL(path, origin), { redirect: 'manual', ...init });
    const json = (path: string, init: RequestInit = {}) =>
      get(path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `JWT ${token}` } : {}), ...init.headers } });

    beforeAll(async () => {
      requireFirstRun();
      const inspectorPort = await getFreePort();
      server = await startServer([pm, 'run', 'preview', '--', '--ip', '127.0.0.1', '--inspector-port', String(inspectorPort)], webDir, {
        port,
        readyTimeout: TIMEOUT_PREVIEW,
        env: { ...env, ...NO_CLOUDFLARE_ACCOUNT, PORT: String(port) },
      });
    }, TIMEOUT_PREVIEW + 30_000);

    test('serves the home page, the posts and a post with their content', async () => {
      const home = await get('/');
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('A site you edit from an admin');

      const posts = await get('/posts');
      expect(posts.status).toBe(200);
      const postsHtml = await posts.text();
      expect(postsHtml).toContain('Hello, world');
      // The card's cover keeps the computed url through the populate select.
      expect(postsHtml).toContain('src="/api/media/file/sample-cover.svg"');

      const post = await get('/posts/hello-world');
      expect(post.status).toBe(200);
      const html = await post.text();
      expect(html).toContain('This is the first post');
      expect(html).toContain('src="/api/media/file/sample-cover.svg"');
    });

    test('serves a page from the cache after the first request', async () => {
      for (const path of ['/', '/about']) {
        await get(path);
        const second = await get(path);
        expect(second.headers.get('x-nextjs-cache'), path).toBe('HIT');
      }
    });

    const cachedPages = () =>
      Object.values(localBuckets(projectDir))
        .flat()
        .filter((key) => key.startsWith('incremental-cache/')).length;

    test('answers 404 for an unknown slug and an unknown path, and caches nothing for them', async () => {
      const before = cachedPages();
      expect(before).toBeGreaterThan(0);

      for (const path of ['/no-such-page', '/posts/no-such-post', '/no/such/path', '/made-up-1', '/made-up-2']) {
        expect((await get(path)).status, path).toBe(404);
      }
      await Bun.sleep(1000);
      expect(cachedPages()).toBe(before);
    });

    test('serves a robots.txt that disallows everything off the production origin, and a sitemap of the published content', async () => {
      const robots = await (await get('/robots.txt')).text();
      expect(robots).toContain('Disallow: /');
      expect(robots).not.toContain('Allow:');

      const sitemap = await (await get('/sitemap.xml')).text();
      expect(sitemap).toContain('/about</loc>');
      expect(sitemap).toContain('/posts/hello-world</loc>');
    });

    test('serves the admin and an image of the seed from R2', async () => {
      expect((await get('/admin')).status).toBe(200);
      const image = await get('/api/media/file/sample-cover.svg');
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toContain('image/svg+xml');
    });

    const expectRefused = async (response: Response) => {
      expect(response.status).toBe(403);
      const body = (await response.json()) as { errors?: { message?: string }[] };
      expect(body.errors?.[0]?.message).toBeTruthy();
    };
    const anonymousJson = (path: string, body: unknown) =>
      get(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    test('refuses an anonymous first-register once the admin exists', async () => {
      await expectRefused(
        await anonymousJson('/api/users/first-register', {
          email: 'intruder@example.com',
          password: 'intruder-password-1',
          'confirm-password': 'intruder-password-1',
        }),
      );
      expect(count(projectDir, 'users')).toBe(1);
    });

    test('refuses an anonymous request to read the users or to create a page', async () => {
      await expectRefused(await get('/api/users'));
      await expectRefused(await get('/api/users/1'));
      await expectRefused(await anonymousJson('/api/pages', { title: 'Anonymous page', _status: 'published' }));
      expect(count(projectDir, 'pages')).toBe(2);
    });

    test('refuses an anonymous upload and stores nothing', async () => {
      const form = new FormData();
      form.set('_payload', JSON.stringify({ alt: 'Anonymous' }));
      form.set('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'anonymous.svg');
      const before = count(projectDir, 'media');

      await expectRefused(await get('/api/media', { method: 'POST', body: form }));
      expect(count(projectDir, 'media')).toBe(before);
      expect((await get('/api/media/file/anonymous.svg')).status).toBe(404);
    });

    test('signs in with the seeded admin', async () => {
      const response = await json('/api/users/login', {
        method: 'POST',
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });
      const body = (await response.json()) as { token?: string };
      expect(response.status, JSON.stringify(body)).toBe(200);
      token = body.token ?? '';
      expect(token).not.toBe('');
    });

    test('shows a change published through the REST API without a rebuild', async () => {
      const title = `About edited ${Date.now()}`;
      const patch = await json('/api/pages/2', { method: 'PATCH', body: JSON.stringify({ meta: { title }, _status: 'published' }) });
      expect(patch.status, await patch.text()).toBe(200);

      const page = await get('/about');
      expect(await page.text()).toContain(`${title} | `);
    });

    test('shows a changed alt text on the pages and the list that embed the image', async () => {
      await get('/posts/hello-world');
      await get('/posts');
      const found = await json('/api/media?where[filename][equals]=sample-cover.svg&limit=1');
      const id = ((await found.json()) as { docs: { id: number }[] }).docs[0]?.id;
      expect(id, 'the seeded cover').toBeDefined();

      const alt = `Cover edited ${Date.now()}`;
      const patch = await json(`/api/media/${id}`, { method: 'PATCH', body: JSON.stringify({ alt }) });
      expect(patch.status, await patch.text()).toBe(200);

      expect(await (await get('/posts/hello-world')).text()).toContain(`alt="${alt}"`);
      expect(await (await get('/posts')).text()).toContain(`alt="${alt}"`);
    });

    test('shows a page created after a 404, and hides a draft', async () => {
      expect((await get('/fresh-page')).status).toBe(404);

      const body = (status: string, title: string) =>
        JSON.stringify({
          title,
          slug: title.toLowerCase().replaceAll(' ', '-'),
          _status: status,
          layout: [{ blockType: 'callToAction', heading: `${title} heading`, label: 'Go', href: '/' }],
        });
      const created = await json('/api/pages', { method: 'POST', body: body('published', 'Fresh page') });
      expect(created.status, await created.text()).toBe(201);
      const fresh = await get('/fresh-page');
      expect(fresh.status).toBe(200);
      expect(await fresh.text()).toContain('Fresh page heading');

      const draft = await json('/api/pages', { method: 'POST', body: body('draft', 'Draft only') });
      expect(draft.status, await draft.text()).toBe(201);
      expect((await get('/draft-only')).status).toBe(404);
    });

    const pageBody = (title: string, slug: string, status = 'published') =>
      JSON.stringify({ title, slug, _status: status, layout: [{ blockType: 'callToAction', heading: `${title} heading`, label: 'Go', href: '/' }] });
    const postBody = (title: string, slug: string) =>
      JSON.stringify({
        title,
        slug,
        _status: 'published',
        content: {
          root: {
            type: 'root',
            format: '',
            indent: 0,
            version: 1,
            direction: 'ltr',
            children: [
              {
                type: 'paragraph',
                format: '',
                indent: 0,
                version: 1,
                direction: 'ltr',
                children: [{ type: 'text', text: `${title} body`, version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
              },
            ],
          },
        },
      });

    test('lists the published pages to an anonymous reader and never a draft', async () => {
      const list = async (query: string) =>
        (await (await get(`/api/pages?${query}`)).json()) as { docs: { slug: string; _status?: string }[]; totalDocs: number };

      const everything = await list('limit=100&depth=0');
      expect(everything.docs.length).toBeGreaterThan(0);
      expect(everything.docs.every((doc) => doc._status === 'published')).toBe(true);
      expect(everything.docs.some((doc) => doc.slug === 'draft-only')).toBe(false);
      expect((await list('where[slug][equals]=draft-only')).totalDocs).toBe(0);
      expect((await list('draft=true&where[slug][equals]=draft-only')).totalDocs).toBe(0);
    });

    test('moves a page to its new address when the slug changes, and the old one answers 404', async () => {
      const created = await json('/api/pages', { method: 'POST', body: pageBody('Before rename', 'before-rename') });
      expect(created.status, await created.text()).toBe(201);
      expect((await get('/before-rename')).status).toBe(200);
      const id = ((await (await json('/api/pages?where[slug][equals]=before-rename')).json()) as { docs: { id: number }[] }).docs[0]?.id;

      const renamed = await json(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ slug: 'after-rename', _status: 'published' }) });
      expect(renamed.status, await renamed.text()).toBe(200);

      expect((await get('/before-rename')).status).toBe(404);
      expect((await get('/after-rename')).status).toBe(200);
      expect(await (await get('/sitemap.xml')).text()).toContain('/after-rename</loc>');
    });

    test('stops serving a page that is deleted, and drops it from the sitemap', async () => {
      const id = ((await (await json('/api/pages?where[slug][equals]=after-rename')).json()) as { docs: { id: number }[] }).docs[0]?.id;
      const deleted = await json(`/api/pages/${id}`, { method: 'DELETE' });
      expect(deleted.status, await deleted.text()).toBe(200);

      expect((await get('/after-rename')).status).toBe(404);
      expect(await (await get('/sitemap.xml')).text()).not.toContain('after-rename');
    });

    test('adds a new post to the list of posts and serves it', async () => {
      expect(await (await get('/posts')).text()).not.toContain('E2E post');

      const created = await json('/api/posts', { method: 'POST', body: postBody('E2E post', 'e2e-post') });
      expect(created.status, await created.text()).toBe(201);

      expect(await (await get('/posts')).text()).toContain('E2E post');
      const post = await get('/posts/e2e-post');
      expect(post.status).toBe(200);
      expect(await post.text()).toContain('E2E post body');
    });

    test('previews a draft for a signed-in editor who holds the preview secret, and for nobody else', async () => {
      const authorization = { Authorization: `JWT ${token}` };
      const preview = (secret: string, headers: Record<string, string> = authorization) =>
        get(`/next/preview?path=/draft-only&previewSecret=${secret}`, { headers });

      expect((await preview('wrong')).status).toBe(403);
      expect((await preview(PREVIEW_SECRET, {})).status).toBe(403);
      const hostile = await get(`/next/preview?path=https://evil.example/&previewSecret=${PREVIEW_SECRET}`, { headers: authorization });
      expect(hostile.status).toBeGreaterThanOrEqual(400);

      const allowed = await preview(PREVIEW_SECRET);
      expect(allowed.status).toBeGreaterThanOrEqual(300);
      expect(allowed.headers.get('location')).toContain('/draft-only');
      const cookies = (allowed.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(';')[0]).join('; ');
      expect(cookies).toContain('__prerender_bypass');

      // The draft cookie says that someone asked for a preview; the draft is shown to the signed-in editor only.
      expect((await get('/draft-only', { headers: { Cookie: cookies } })).status).toBe(404);
      const page = await get('/draft-only', { headers: { Cookie: cookies, ...authorization } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Draft only heading');
    });

    const upload = (bytes: Uint8Array, name: string) => {
      const form = new FormData();
      form.set('_payload', JSON.stringify({ alt: 'A test image' }));
      form.set('file', new Blob([bytes], { type: 'image/svg+xml' }), name);
      return get('/api/media', { method: 'POST', headers: { Authorization: `JWT ${token}` }, body: form });
    };

    test('uploads an image to R2 and serves it with a cache header', async () => {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
      const small = await upload(svg, 'e2e-small.svg');
      expect(small.status, await small.text()).toBe(201);

      const served = await get('/api/media/file/e2e-small.svg');
      expect(served.status).toBe(200);
      expect(served.headers.get('cache-control')).toContain('max-age=604800');
    });

    test('refuses an upload over the limit before storing it', async () => {
      const before = count(projectDir, 'media');
      const tooLarge = await upload(new Uint8Array(21 * 1024 * 1024), 'e2e-large.svg');
      expect(tooLarge.status).toBe(413);
      expect(count(projectDir, 'media')).toBe(before);
      expect((await get('/api/media/file/e2e-large.svg')).status).toBe(404);
    });

    test('refuses a file over the limit that the Local API receives, which skips the multipart parser', async () => {
      await writeFile(join(webDir, 'scripts/e2e-large-media.ts'), LARGE_MEDIA_SCRIPT);
      const before = count(projectDir, 'media');
      const result = await run([pm, 'run', 'payload', ...(pm === 'npm' ? ['--'] : []), 'run', 'scripts/e2e-large-media.ts'], webDir);
      await rm(join(webDir, 'scripts/e2e-large-media.ts'), { force: true });

      expect(result.stdout, result.stderr).toContain('REFUSED 413');
      expect(count(projectDir, 'media')).toBe(before);
    }, TIMEOUT_COMMAND);

    test('saves and reads an admin preference', async () => {
      const saved = await json('/api/payload-preferences/e2e-key', { method: 'POST', body: JSON.stringify({ value: { open: true } }) });
      expect(saved.status, await saved.text()).toBeLessThan(300);
      const read = await json('/api/payload-preferences/e2e-key');
      expect(((await read.json()) as { value?: { open?: boolean } }).value?.open).toBe(true);
    });
  });

  describe('the cron Worker', () => {
    let cron: RunningServer;
    let cronUrl: string;
    const backupManifests = () =>
      Object.values(localBuckets(projectDir))
        .flat()
        .filter((key) => /^backups\/.+\/manifest\.json$/.test(key));

    beforeAll(async () => {
      requireFirstRun();
      const cronPort = await getFreePort();
      const inspectorPort = await getFreePort();
      cron = await startServer([pm, 'run', 'dev', '--', '--ip', '127.0.0.1', '--inspector-port', String(inspectorPort)], cronDir, {
        port: cronPort,
        readyTimeout: TIMEOUT_PREVIEW,
        env: { ...env, ...NO_CLOUDFLARE_ACCOUNT, PORT: String(cronPort) },
      });
      cronUrl = `http://127.0.0.1:${cronPort}`;
    }, TIMEOUT_PREVIEW + 30_000);

    afterAll(async () => {
      await cron?.stop();
    });

    test('refuses a backup request without the token or with another', async () => {
      const url = `${cronUrl}/backup/run`;
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      expect((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer another-token' } })).status).toBe(401);
      expect(backupManifests()).toEqual([]);
    });

    test('writes a backup with a manifest to its own bucket when asked, away from the media', async () => {
      const response = await fetch(`${cronUrl}/backup/run`, { method: 'POST', headers: { Authorization: `Bearer ${BACKUP_TOKEN}` } });
      expect(response.status).toBe(200);
      const { prefix, tables } = (await response.json()) as { prefix: string; tables: number };
      expect(tables).toBeGreaterThan(10);

      const buckets = Object.values(localBuckets(projectDir));
      const withBackups = buckets.filter((keys) => keys.some((key) => key.startsWith('backups/')));
      expect(withBackups).toHaveLength(1);
      expect(withBackups[0]?.every((key) => key.startsWith('backups/'))).toBe(true);

      const manifest = await run(
        ['sh', '-c', `${pm === 'bun' ? 'bunx' : 'npx'} wrangler r2 object get ${PROJECT}-backups/${prefix}manifest.json --local --persist-to ../../.wrangler --pipe`],
        cronDir,
        NO_CLOUDFLARE_ACCOUNT,
      );
      expect(manifest.exitCode, manifest.stderr).toBe(0);
      const parsed = JSON.parse(manifest.stdout.slice(manifest.stdout.indexOf('{'))) as { tables: { name: string; rows: number }[] };
      const pages = parsed.tables.find((table) => table.name === 'pages');
      expect(pages?.rows).toBeGreaterThanOrEqual(2);
      expect(parsed.tables.some((table) => table.name.startsWith('_cf_') || table.name.startsWith('sqlite_'))).toBe(false);
    });

    test('runs the backup when the schedule fires', async () => {
      const before = backupManifests().length;
      expect(before).toBeGreaterThan(0);
      // A backup is named after the second it starts: wait for the next one, or the scheduled run would rewrite the last.
      await Bun.sleep(1100);

      const fired = await fetch(`${cronUrl}/cdn-cgi/local/explorer/api/local/scheduled?worker=${PROJECT}-cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron: '0 3 * * *' }),
      });
      expect(fired.status, await fired.text()).toBeLessThan(300);

      const deadline = Date.now() + 30_000;
      while (backupManifests().length === before && Date.now() < deadline) await Bun.sleep(500);
      expect(backupManifests()).toHaveLength(before + 1);
    }, TIMEOUT_PREVIEW);
  });
});
