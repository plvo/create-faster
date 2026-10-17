import { chmod, mkdir, writeFile } from 'node:fs/promises';
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
let stubBin: string;

beforeAll(async () => {
  tempDir = await createTempDir();
  stubBin = join(tempDir, 'stub-bin');
  await mkdir(stubBin);
  await writeFile(join(stubBin, 'wrangler'), '#!/bin/sh\necho "$@"\n');
  await chmod(join(stubBin, 'wrangler'), 0o755);
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

// Runs a package.json script the way a package manager does (through sh, the arguments of `npm run dev -- ...` appended),
// with a `wrangler` that prints its arguments.
async function wranglerArgumentsOf(script: string, env: Record<string, string> = {}, extraArguments = ''): Promise<string> {
  const { PORT: _inherited, ...inherited } = process.env;
  const proc = Bun.spawn(['sh', '-c', `${script} ${extraArguments}`], {
    env: { ...inherited, ...env, PATH: `${stubBin}:${process.env.PATH}` },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(await proc.exited, stderr).toBe(0);
  return stdout.trim();
}

const CLOUDFLARE_HONO = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];

describe.each([...PACKAGE_MANAGERS])('Hono app on cloudflare with %s', (pm) => {
  test('a single repo develops in Wrangler on the default app port and has no Node or Bun server', async () => {
    const project = await generate(`hono-cf-single-${pm}`, ['--app', 'api:hono', ...CLOUDFLARE_HONO], pm);
    const { scripts, dependencies } = await manifestOf(project);

    expect(scripts.dev).toBe(`sh -c 'wrangler dev --port=\${PORT:-3000} --persist-to ./.wrangler "$@"' sh`);
    expect(scripts.preview).toBe('wrangler dev --persist-to ./.wrangler');
    expect(scripts.start).toBeUndefined();
    expect(dependencies?.['@hono/node-server']).toBeUndefined();
    expect(await fileExists(join(project, 'src/server.ts'))).toBe(false);

    expect(await wranglerArgumentsOf(scripts.dev as string)).toBe('dev --port=3000 --persist-to ./.wrangler');
    expect(await wranglerArgumentsOf(scripts.dev as string, { PORT: '4321' })).toBe(
      'dev --port=4321 --persist-to ./.wrangler',
    );
    expect(await wranglerArgumentsOf(scripts.dev as string, {}, '--ip 127.0.0.1')).toBe(
      'dev --port=3000 --persist-to ./.wrangler --ip 127.0.0.1',
    );
  });

  test('a turborepo app develops in Wrangler on its own port and shares the local state of the repo', async () => {
    const project = await generate(
      `hono-cf-mono-${pm}`,
      ['--app', 'web:nextjs', '--app', 'api:hono', ...CLOUDFLARE_HONO],
      pm,
    );
    const { scripts, dependencies, devDependencies } = await manifestOf(join(project, 'apps/api'));

    expect(scripts.dev).toBe(`sh -c 'wrangler dev --port=\${PORT:-3001} --persist-to ../../.wrangler "$@"' sh`);
    expect(scripts.start).toBeUndefined();
    expect(dependencies?.['@hono/node-server']).toBeUndefined();
    expect(devDependencies?.tsx).toBeUndefined();
    expect(await fileExists(join(project, 'apps/api/src/server.ts'))).toBe(false);

    expect(await wranglerArgumentsOf(scripts.dev as string)).toBe('dev --port=3001 --persist-to ../../.wrangler');
    expect(await wranglerArgumentsOf(scripts.dev as string, { PORT: '4321' })).toBe(
      'dev --port=4321 --persist-to ../../.wrangler',
    );
    expect(await wranglerArgumentsOf(scripts.dev as string, {}, '--ip 127.0.0.1')).toBe(
      'dev --port=3001 --persist-to ../../.wrangler --ip 127.0.0.1',
    );
  });
});

test('a Worker without a database brings no tsx', async () => {
  const project = await generate('hono-cf-no-tsx', ['--app', 'api:hono', '--deployment', 'cloudflare'], 'npm');

  expect((await manifestOf(project)).devDependencies?.tsx).toBeUndefined();
});

describe('portless with a Hono Worker', () => {
  test('hands the port down through PORT, which the dev script expands', async () => {
    const project = await generate(
      'hono-cf-portless',
      ['--app', 'web:nextjs', '--app', 'api:hono', '--tooling', 'portless', ...CLOUDFLARE_HONO],
      'npm',
    );
    const { scripts } = await manifestOf(join(project, 'apps/api'));

    expect(scripts.dev).toBe(
      `portless run sh -c 'wrangler dev --port=\${PORT:-3001} --persist-to ../../.wrangler "$@"' sh`,
    );
    expect(await wranglerArgumentsOf((scripts.dev as string).replace('portless run ', ''), { PORT: '4321' })).toBe(
      'dev --port=4321 --persist-to ../../.wrangler',
    );
    expect(await readTextFile(join(project, 'apps/api/AGENTS.md'))).toContain(
      'The `PORT` environment variable overrides it, which is how portless reaches it.',
    );
  });
});

describe('root start of a turborepo', () => {
  test('does not exist, nor its turbo task, when the only app with a start script is a Worker', async () => {
    const project = await generate(
      'hono-cf-root-no-start',
      ['--app', 'web:nextjs', '--app', 'api:hono', ...CLOUDFLARE_HONO],
      'npm',
    );

    expect((await manifestOf(project)).scripts.start).toBeUndefined();
    const turbo = await readJsonFile<{ tasks: Record<string, unknown> }>(join(project, 'turbo.json'));
    expect(turbo.tasks.start).toBeUndefined();
  });

  test('stays, with its turbo task, for an app that serves from Node next to a Worker', async () => {
    const project = await generate(
      'hono-cf-root-start',
      ['--app', 'api:hono', '--app', 'jobs:node', ...CLOUDFLARE_HONO],
      'npm',
    );

    expect((await manifestOf(project)).scripts.start).toBe('turbo start');
    expect((await manifestOf(join(project, 'apps/jobs'))).scripts.start).toBe('NODE_ENV=production tsx src/index.ts');
    expect((await manifestOf(join(project, 'apps/api'))).scripts.start).toBeUndefined();
    const turbo = await readJsonFile<{ tasks: Record<string, unknown> }>(join(project, 'turbo.json'));
    expect(turbo.tasks.start).toEqual({ cache: false, persistent: true });
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

    expect(cron.scripts.dev).toBe(`sh -c 'wrangler dev --port=\${PORT:-3001} --persist-to ../../.wrangler "$@"' sh`);
    expect(cron.scripts.start).toBeUndefined();
    expect((await manifestOf(project)).scripts.start).toBeUndefined();
    const turbo = await readJsonFile<{ tasks: Record<string, unknown> }>(join(project, 'turbo.json'));
    expect(turbo.tasks.start).toBeUndefined();
  });

  test('the deploy notes fire the cron through the Wrangler explorer of the running dev', async () => {
    const project = await generate('hono-cf-fullstack-notes', ['--blueprint', 'cloudflare-fullstack-nextjs'], 'npm');
    const notes = await readTextFile(join(project, 'docs/agents/cloudflare-deploy.md'));

    expect(notes).toContain('runs next to it under `wrangler dev` on port 3001');
    expect(notes).toContain(
      'curl -X POST "http://localhost:3001/cdn-cgi/local/explorer/api/local/scheduled?worker=hono-cf-fullstack-notes-cron"',
    );
    expect(notes).not.toContain('--test-scheduled');
  });
});

describe('agent notes of a Hono app on cloudflare', () => {
  test('say dev runs Wrangler on the app port and name no Node or Bun server', async () => {
    const single = await generate('hono-cf-notes', ['--app', 'api:hono', ...CLOUDFLARE_HONO], 'npm');
    const notes = await readTextFile(join(single, 'AGENTS.md'));

    expect(notes).toContain('The app is a Worker: `dev` runs `wrangler dev` in the Workers runtime');
    expect(notes).toContain('It listens on port 3000. The `PORT` environment variable overrides it');
    expect(notes).toContain(
      '- `npm run dev` — `wrangler dev` on the app port (`PORT` overrides it), so the app runs in the Workers runtime',
    );
    expect(notes).toContain(
      "- `npm run preview` — `wrangler dev` without `--port`: the same runtime and local state as `dev`, on Wrangler's default port",
    );
    expect(notes).not.toContain('@hono/node-server');
    expect(notes).not.toContain('`start`, `src/server.ts`');
  });

  test('state the port of the app in a turborepo', async () => {
    const mono = await generate(
      'hono-cf-notes-mono',
      ['--app', 'web:nextjs', '--app', 'api:hono', ...CLOUDFLARE_HONO],
      'npm',
    );

    expect(await readTextFile(join(mono, 'apps/api/AGENTS.md'))).toContain('It listens on port 3001.');
  });
});
