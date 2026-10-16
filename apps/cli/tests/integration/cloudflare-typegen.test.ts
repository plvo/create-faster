import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJsonShape {
  scripts: Record<string, string>;
}

describe('cloudflare binding types, first run', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('turborepo: every app generates its types on install, the root and README name cf-typegen', async () => {
    const result = await runCli(
      [
        'mono',
        '--app',
        'web:nextjs',
        '--app',
        'docs:tanstack-start',
        '--app',
        'api:hono',
        '--deployment',
        'cloudflare',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const root = join(tempDir, 'mono');

    for (const app of ['web', 'docs', 'api']) {
      const pkg = await readJsonFile<PackageJsonShape>(join(root, 'apps', app, 'package.json'));
      expect(pkg.scripts.postinstall, app).toStartWith(pkg.scripts['cf-typegen'] as string);
    }
    const rootPkg = await readJsonFile<PackageJsonShape>(join(root, 'package.json'));
    expect(rootPkg.scripts['cf-typegen']).toBe('turbo cf-typegen');
    expect(await readTextFile(join(root, 'turbo.json'))).toContain('"cf-typegen"');

    const readme = await readTextFile(join(root, 'README.md'));
    expect(readme).toContain('`bun run cf-typegen`');
    expect(readme.indexOf('cloudflare-env.d.ts')).toBeGreaterThan(readme.indexOf('bun install'));
  });

  test('a production install of a Worker app must pass --ignore-scripts: README and agent notes say so', async () => {
    const result = await runCli(
      ['worker-site', '--app', 'site:tanstack-start', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'npm'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    for (const file of ['README.md', 'AGENTS.md']) {
      const document = await readTextFile(join(tempDir, 'worker-site', file));
      expect(document, file).toContain('`--omit=dev`, `--production` or `--prod`');
      expect(document, file).toContain('`--ignore-scripts`');
    }
  });

  test('single repo: README names cf-typegen', async () => {
    const result = await runCli(
      ['site', '--app', 'site:tanstack-start', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'npm'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(await readTextFile(join(tempDir, 'site', 'README.md'))).toContain('`npm run cf-typegen`');
  });

  test('no cloudflare deployment: no typegen in the README, the scripts or turbo.json', async () => {
    const result = await runCli(
      ['plain', '--app', 'web:nextjs', '--app', 'api:hono', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const root = join(tempDir, 'plain');
    expect(await readTextFile(join(root, 'README.md'))).not.toContain('cf-typegen');
    expect(await readTextFile(join(root, 'README.md'))).not.toContain('--ignore-scripts');
    expect(await readTextFile(join(root, 'turbo.json'))).not.toContain('cf-typegen');
    expect((await readJsonFile<PackageJsonShape>(join(root, 'apps/api/package.json'))).scripts.postinstall).toBeUndefined();
  });
});
