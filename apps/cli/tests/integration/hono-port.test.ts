import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface PackageJson {
  scripts: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function appScripts(projectName: string, appDir: string | null, args: string[]): Promise<Record<string, string>> {
  const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  const root = appDir ? join(tempDir, projectName, 'apps', appDir) : join(tempDir, projectName);
  return (await readJsonFile<PackageJson>(join(root, 'package.json'))).scripts;
}

describe('Hono app port', () => {
  test('a turborepo Hono app binds the port of its index, after the apps that precede it', async () => {
    const scripts = await appScripts('hono-port-mono', 'api', [
      '--app',
      'web:tanstack-start',
      '--app',
      'site:nextjs',
      '--app',
      'api:hono',
    ]);
    expect(scripts.dev).toBe('bun run --port 3002 --hot src/index.ts');
    expect(scripts.start).toBe('NODE_ENV=production bun run --port 3002 src/index.ts');
  });

  test('a single-repo Hono app keeps the runtime default of 3000', async () => {
    const scripts = await appScripts('hono-port-single', null, ['--app', 'api:hono']);
    expect(scripts.dev).toBe('bun run --hot src/index.ts');
    expect(scripts.start).toBe('NODE_ENV=production bun run src/index.ts');
  });

  test('portless owns the port: it strips the flag from the dev and start:portless wrappers', async () => {
    const scripts = await appScripts('hono-port-portless', 'api', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--tooling',
      'portless',
    ]);
    expect(scripts.dev).toBe('portless run bun run --hot src/index.ts');
    expect(scripts['start:portless']).toBe('NODE_ENV=production portless run bun run src/index.ts');
    expect(scripts.start).toBe('NODE_ENV=production bun run --port 3001 src/index.ts');
  });

  test('the cloudflare-fullstack-nextjs cron app does not take the port of the web app', async () => {
    const scripts = await appScripts('hono-port-cron', 'cron', ['--blueprint', 'cloudflare-fullstack-nextjs']);
    expect(scripts.dev).toBe(
      `sh -c 'wrangler dev --port=\${PORT:-3001} --persist-to ../../.wrangler "$@"' sh`,
    );
  });

  test('the generated agent context states the port the app listens on', async () => {
    await appScripts('hono-port-agents-mono', 'api', ['--app', 'web:nextjs', '--app', 'api:hono']);
    const mono = await readTextFile(join(tempDir, 'hono-port-agents-mono', 'apps/api/AGENTS.md'));
    expect(mono).toContain('listen on port 3001. The `PORT` environment variable overrides it.');
    expect(await readTextFile(join(tempDir, 'hono-port-agents-mono', 'AGENTS.md'))).toContain('hono (http://localhost:3001)');

    await appScripts('hono-port-agents-single', null, ['--app', 'api:hono']);
    const single = await readTextFile(join(tempDir, 'hono-port-agents-single', 'AGENTS.md'));
    expect(single).toContain('listen on port 3000. The `PORT` environment variable overrides it.');
  });
});
