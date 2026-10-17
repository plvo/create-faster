import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm'] as const;

interface Manifest {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(name: string, args: string[], pm: string): Promise<string> {
  const result = await runCli([name, ...args, '--no-install', '--no-git', '--pm', pm], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, name);
}

const manifestOf = (directory: string): Promise<Manifest> => readJsonFile<Manifest>(join(directory, 'package.json'));

const CLOUDFLARE_HONO = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];

describe.each([...PACKAGE_MANAGERS])('Hono app on cloudflare with %s', (pm) => {
  test('a single repo develops in Wrangler on the app port and has no Node or Bun server', async () => {
    const project = await generate(`hono-cf-single-${pm}`, ['--app', 'api:hono', ...CLOUDFLARE_HONO], pm);
    const { scripts, dependencies } = await manifestOf(project);

    expect(scripts.dev).toBe('wrangler dev --persist-to ./.wrangler');
    expect(scripts.preview).toBe('wrangler dev --persist-to ./.wrangler');
    expect(scripts.start).toBeUndefined();
    expect(dependencies?.['@hono/node-server']).toBeUndefined();
    expect(await fileExists(join(project, 'src/server.ts'))).toBe(false);
    expect(await readTextFile(join(project, 'wrangler.jsonc'))).toContain('"dev": { "port": 3000 }');
  });

  test('a turborepo app develops in Wrangler on its own port and shares the local state of the repo', async () => {
    const project = await generate(
      `hono-cf-mono-${pm}`,
      ['--app', 'web:nextjs', '--app', 'api:hono', ...CLOUDFLARE_HONO],
      pm,
    );
    const { scripts, dependencies, devDependencies } = await manifestOf(join(project, 'apps/api'));

    expect(scripts.dev).toBe('wrangler dev --port 3001 --persist-to ../../.wrangler');
    expect(scripts.start).toBeUndefined();
    expect(dependencies?.['@hono/node-server']).toBeUndefined();
    expect(devDependencies?.tsx).toBeUndefined();
    expect(await fileExists(join(project, 'apps/api/src/server.ts'))).toBe(false);
    expect(await readTextFile(join(project, 'apps/api/wrangler.jsonc'))).not.toContain('"dev"');
  });
});

test('a Worker without a database brings no tsx', async () => {
  const project = await generate('hono-cf-no-tsx', ['--app', 'api:hono', '--deployment', 'cloudflare'], 'npm');

  expect((await manifestOf(project)).devDependencies?.tsx).toBeUndefined();
});

describe('root start of a turborepo', () => {
  test('does not exist when the only app with a start script is a Worker', async () => {
    const project = await generate(
      'hono-cf-root-no-start',
      ['--app', 'web:nextjs', '--app', 'api:hono', ...CLOUDFLARE_HONO],
      'npm',
    );

    expect((await manifestOf(project)).scripts.start).toBeUndefined();
    expect(await readTextFile(join(project, 'turbo.json'))).not.toContain('"start"');
  });

  test('stays for an app that serves from Node next to a Worker', async () => {
    const project = await generate(
      'hono-cf-root-start',
      ['--app', 'api:hono', '--app', 'jobs:node', ...CLOUDFLARE_HONO],
      'npm',
    );

    expect((await manifestOf(project)).scripts.start).toBe('turbo start');
    expect((await manifestOf(join(project, 'apps/jobs'))).scripts.start).toBe('NODE_ENV=production tsx src/index.ts');
    expect((await manifestOf(join(project, 'apps/api'))).scripts.start).toBeUndefined();
  });
});

describe('Hono app on another deployment', () => {
  test.each([...PACKAGE_MANAGERS])('cloudflare-static keeps the Node or Bun scripts with %s', async (pm) => {
    const project = await generate(
      `hono-cfs-${pm}`,
      ['--app', 'web:nextjs', '--app', 'api:hono', '--deployment', 'cloudflare-static'],
      pm,
    );
    const { scripts, dependencies } = await manifestOf(join(project, 'apps/api'));

    if (pm === 'bun') {
      expect(scripts.dev).toBe('bun run --port 3001 --hot src/index.ts');
      expect(scripts.start).toBe('NODE_ENV=production bun run --port 3001 src/index.ts');
      expect(await fileExists(join(project, 'apps/api/src/server.ts'))).toBe(false);
    } else {
      expect(scripts.dev).toBe('tsx watch src/server.ts --port 3001');
      expect(scripts.start).toBe('NODE_ENV=production tsx src/server.ts --port 3001');
      expect(dependencies?.['@hono/node-server']).toBeDefined();
      expect(await fileExists(join(project, 'apps/api/src/server.ts'))).toBe(true);
    }
    expect(scripts.preview).toBeUndefined();
  });
});

describe('cloudflare-fullstack-nextjs', () => {
  test('the cron Worker develops in Wrangler and the root has no start', async () => {
    const project = await generate('hono-cf-fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs'], 'npm');
    const cron = await manifestOf(join(project, 'apps/cron'));

    expect(cron.scripts.dev).toBe('wrangler dev --port 3001 --persist-to ../../.wrangler');
    expect(cron.scripts.start).toBeUndefined();
    expect((await manifestOf(project)).scripts.start).toBeUndefined();
    expect(await readTextFile(join(project, 'turbo.json'))).not.toContain('"start"');
  });
});

describe('agent notes of a Hono app on cloudflare', () => {
  test('say dev runs Wrangler and name no Node or Bun server', async () => {
    const project = await generate('hono-cf-notes', ['--app', 'api:hono', ...CLOUDFLARE_HONO], 'npm');
    const notes = await readTextFile(join(project, 'AGENTS.md'));

    expect(notes).toContain('`dev` runs `wrangler dev` in the Workers runtime');
    expect(notes).not.toContain('tsx');
    expect(notes).not.toContain('@hono/node-server');
    expect(notes).not.toContain('runs without the Workers runtime');
  });
});
