import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * Signing in is the one step that payloadcms/payload#18274 breaks on Cloudflare (Payload 3.90 and later hash passwords with
 * 600,000 PBKDF2 iterations, and the runtime of Cloudflare refuses more than 100,000), but this test cannot see it:
 * open-source workerd, which runs here, overrides `checkPbkdfIterations()` to accept any count (cloudflare/workerd#7550).
 * It checks that the seeded admin signs in and that the tests after it get their token; the release check of the pinned
 * Payload version is a sign-in on a deployed Worker.
 */

const TIMEOUT_INSTALL = 400_000;
const TIMEOUT_COMMAND = 300_000;
const TIMEOUT_BUILD_CF = 600_000;
const TIMEOUT_PREVIEW = 180_000;

const PROJECT = 'payload-e2e';
const STRICT_PNPM_MAJOR = 11;
const FALLBACK_PNPM = ['env', 'pnpm_config_manage_package_manager_versions=false', 'npx', '--yes', 'pnpm@12'];

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

    for (const script of ['migrate', 'ensure-admin', 'db:seed']) {
      const result = await runScript(script);
      expect(result.exitCode, `${script}\n${result.stderr}\n${result.stdout}`).toBe(0);
    }
    expect({
      users: count(projectDir, 'users'),
      pages: count(projectDir, 'pages'),
      posts: count(projectDir, 'posts'),
      media: count(projectDir, 'media'),
    }).toEqual({ users: 1, pages: 2, posts: 2, media: 1 });
  }, TIMEOUT_COMMAND * 3);

  test('the admin script and the seed run again and change nothing', async () => {
    for (const script of ['ensure-admin', 'db:seed']) {
      const result = await runScript(script);
      expect(result.exitCode, `${script}\n${result.stderr}`).toBe(0);
    }
    expect({
      users: count(projectDir, 'users'),
      pages: count(projectDir, 'pages'),
      posts: count(projectDir, 'posts'),
      media: count(projectDir, 'media'),
    }).toEqual({ users: 1, pages: 2, posts: 2, media: 1 });
  }, TIMEOUT_COMMAND * 2);

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

  test('the remote commands refuse to run while the database id is still the placeholder, and leave nothing behind', async () => {
    for (const script of ['db:migrate:remote', 'ensure-admin:remote']) {
      const result = await runScript(script, webDir);
      expect(result.exitCode, script).toBe(1);
      expect(result.stderr, script).toContain('is still the placeholder');
    }
    expect(await fileExists(join(webDir, '.wrangler/remote-bindings.jsonc'))).toBe(false);
  }, TIMEOUT_COMMAND);

  test('`dev` serves the seeded site and signs the admin in, over the local state', async () => {
    const devPort = await getFreePort();
    const dev = await startServer([pm, 'run', 'dev'], webDir, {
      port: devPort,
      readyTimeout: TIMEOUT_PREVIEW,
      env: { ...env, PORT: String(devPort), NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${devPort}` },
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
    const build = await run([pm, 'run', 'build:cf'], webDir, { NEXT_PUBLIC_APP_URL: origin });
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
      const inspectorPort = await getFreePort();
      server = await startServer([pm, 'run', 'preview', '--', '--ip', '127.0.0.1', '--inspector-port', String(inspectorPort)], webDir, {
        port,
        readyTimeout: TIMEOUT_PREVIEW,
        env: { ...env, PORT: String(port) },
      });
    }, TIMEOUT_PREVIEW + 30_000);

    test('serves the home page, the posts and a post with their content', async () => {
      const home = await get('/');
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('A site you edit from an admin');

      const posts = await get('/posts');
      expect(posts.status).toBe(200);
      expect(await posts.text()).toContain('Hello, world');

      const post = await get('/posts/hello-world');
      expect(post.status).toBe(200);
      const html = await post.text();
      expect(html).toContain('This is the first post');
      expect(html).toContain('src="/api/media/file/sample-cover.svg"');
    });

    test('serves a page from the cache after the first request', async () => {
      await get('/about');
      const second = await get('/about');
      expect(second.headers.get('x-nextjs-cache')).toBe('HIT');
    });

    test('answers 404 for an unknown slug and an unknown path', async () => {
      expect((await get('/no-such-page')).status).toBe(404);
      expect((await get('/posts/no-such-post')).status).toBe(404);
      expect((await get('/no/such/path')).status).toBe(404);
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

    test('refuses an anonymous first-register once the admin exists', async () => {
      const response = await json('/api/users/first-register', {
        method: 'POST',
        body: JSON.stringify({ email: 'intruder@example.com', password: 'intruder-password-1', 'confirm-password': 'intruder-password-1' }),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(count(projectDir, 'users')).toBe(1);
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

      const page = await get('/draft-only', { headers: { Cookie: cookies } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Draft only heading');
    });

    test('uploads an image, refuses one over the limit before storing it, and saves admin preferences', async () => {
      const upload = (bytes: Uint8Array, name: string) => {
        const form = new FormData();
        form.set('_payload', JSON.stringify({ alt: 'A test image' }));
        form.set('file', new Blob([bytes], { type: 'image/svg+xml' }), name);
        return get('/api/media', { method: 'POST', headers: { Authorization: `JWT ${token}` }, body: form });
      };
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
      const small = await upload(svg, 'e2e-small.svg');
      expect(small.status, await small.text()).toBe(201);
      expect((await get('/api/media/file/e2e-small.svg')).status).toBe(200);

      const before = count(projectDir, 'media');
      const tooLarge = await upload(new Uint8Array(21 * 1024 * 1024), 'e2e-large.svg');
      expect(tooLarge.status).toBe(413);
      expect(count(projectDir, 'media')).toBe(before);
      expect((await get('/api/media/file/e2e-large.svg')).status).toBe(404);

      const saved = await json('/api/payload-preferences/e2e-key', { method: 'POST', body: JSON.stringify({ value: { open: true } }) });
      expect(saved.status, await saved.text()).toBeLessThan(300);
      const read = await json('/api/payload-preferences/e2e-key');
      expect(((await read.json()) as { value?: { open?: boolean } }).value?.open).toBe(true);
    });
  });

  describe('the cron Worker', () => {
    test('writes a backup with a manifest to the local bucket when asked, and refuses a request without the token', async () => {
      const cronPort = await getFreePort();
      const inspectorPort = await getFreePort();
      const cron = await startServer([pm, 'run', 'dev', '--', '--ip', '127.0.0.1', '--inspector-port', String(inspectorPort)], cronDir, {
        port: cronPort,
        readyTimeout: TIMEOUT_PREVIEW,
        env: { ...env, PORT: String(cronPort) },
      });
      try {
        const url = `http://127.0.0.1:${cronPort}/backup/run`;
        expect((await fetch(url, { method: 'POST' })).status).toBe(401);

        const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${BACKUP_TOKEN}` } });
        expect(response.status).toBe(200);
        const { prefix, tables } = (await response.json()) as { prefix: string; tables: number };
        expect(tables).toBeGreaterThan(10);

        const manifest = await run(
          ['sh', '-c', `${pm === 'bun' ? 'bunx' : 'npx'} wrangler r2 object get ${PROJECT}-storage/${prefix}manifest.json --local --persist-to ../../.wrangler --pipe`],
          cronDir,
        );
        expect(manifest.exitCode, manifest.stderr).toBe(0);
        const parsed = JSON.parse(manifest.stdout.slice(manifest.stdout.indexOf('{'))) as { tables: { name: string; rows: number }[] };
        const pages = parsed.tables.find((table) => table.name === 'pages');
        expect(pages?.rows).toBeGreaterThanOrEqual(2);
        expect(parsed.tables.some((table) => table.name.startsWith('_cf_') || table.name.startsWith('sqlite_'))).toBe(false);
      } finally {
        await cron.stop();
      }
    }, TIMEOUT_PREVIEW * 2);
  });

  test('the generated files left out of git by the linters are the ones Payload writes', async () => {
    const ignored = await readFile(join(projectDir, 'biome.json'), 'utf8');
    for (const path of ['importMap.js', 'payload-types.ts', 'src/migrations']) expect(ignored).toContain(path);
    expect((await readdir(join(webDir, 'src/migrations'))).some((file) => file.endsWith('.json'))).toBe(true);
  });
});
