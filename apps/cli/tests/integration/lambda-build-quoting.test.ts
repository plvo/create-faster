import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { cleanupTempDir, createTempDir, readJsonFile, runCli } from './helpers';

const LAMBDA_BLUEPRINTS = ['lambda-terraform-aws-hono', 'lambda-sst-hono'];
const NODE_PACKAGE_MANAGERS = ['npm', 'pnpm'];
const ESBUILD_BUILD = /^esbuild /;
const DEFINE_FLAG = '--define:process.env.NODE_ENV=';

/** The arguments `sh` hands to the command a package.json script starts, one per line. */
async function wordsAfterShellSplitting(command: string): Promise<string[]> {
  const { stdout } = await $`sh -c ${`printf '%s\\n' ${command}`}`.quiet();
  return stdout.toString().trimEnd().split('\n');
}

/** The same through Bun's shell, which runs the scripts of a bun project. */
async function wordsAfterBunShellSplitting(command: string): Promise<string[]> {
  const stdout = await $`${{ raw: `printf '%s\\n' ${command}` }}`.text();
  return stdout.trimEnd().split('\n');
}

describe('esbuild build scripts of the Lambda blueprints', () => {
  let tempDir: string;
  const builds: { project: string; pm: string; app: string; build: string }[] = [];

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of LAMBDA_BLUEPRINTS) {
      for (const pm of NODE_PACKAGE_MANAGERS) {
        const project = `${blueprint}-${pm}`;
        const result = await runCli(
          [project, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', pm],
          tempDir,
        );
        expect(result.exitCode).toBe(0);
        const appsDir = join(tempDir, project, 'apps');
        for (const app of await readdir(appsDir)) {
          const { scripts } = await readJsonFile<{ scripts: Record<string, string> }>(
            join(appsDir, app, 'package.json'),
          );
          if (ESBUILD_BUILD.test(scripts.build ?? '')) builds.push({ project, pm, app, build: scripts.build });
        }
      }
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('api, cron and worker of both blueprints are checked under npm and pnpm', () => {
    expect(builds.map(({ project }) => project)).toHaveLength(LAMBDA_BLUEPRINTS.length * NODE_PACKAGE_MANAGERS.length * 3);
  });

  for (const [shellName, split] of [
    ['sh', wordsAfterShellSplitting],
    ['the Bun shell', wordsAfterBunShellSplitting],
  ] as const) {
    test(`${shellName} passes the banner as one argument and the NODE_ENV define as a JSON string`, async () => {
      const failures: string[] = [];
      for (const { project, app, build } of builds) {
        const words = await split(build);
        const banner = words.filter((word) => word.startsWith('--banner:js='));
        const defines = words.filter((word) => word.startsWith(DEFINE_FLAG));
        const isBannerWhole = banner.length === 1 && banner[0].endsWith('createRequire(import.meta.url);');
        const defined = defines.map((word) => word.slice(DEFINE_FLAG.length));
        const isDefineString = defined.every((value) => value === '"production"');
        const needsDefine = project.startsWith('lambda-terraform-aws-hono');
        if (!isBannerWhole || !isDefineString || defined.length !== (needsDefine ? 1 : 0)) {
          failures.push(`${project}/${app}: ${JSON.stringify(words.slice(1))}`);
        }
      }

      expect(failures).toEqual([]);
    });
  }
});
