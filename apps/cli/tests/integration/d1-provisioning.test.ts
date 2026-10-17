import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cleanupTempDir,
  createTempDir,
  PNPM_AVAILABLE,
  printedScriptsMissingFrom,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BINARY_RUNNER = { bun: 'bunx', npm: 'npx', pnpm: 'pnpm exec' } as const;
const WRANGLER_COMMAND = /(?:cd ([\w/.<>-]+) && )?(?:bunx|npx|pnpm exec) wrangler\b/g;

type PackageManager = keyof typeof BINARY_RUNNER;
type Repo = 'single' | 'turborepo';

const REPO_APPS: Record<Repo, string[]> = {
  single: ['--app', 'web:nextjs'],
  turborepo: ['--app', 'web:nextjs', '--app', 'api:hono'],
};

function expectInOrder(text: string, markers: string[]): void {
  let from = 0;
  for (const marker of markers) {
    const at = text.indexOf(marker, from);
    expect(at, `"${marker}" after offset ${from}`).toBeGreaterThanOrEqual(0);
    from = at + marker.length;
  }
}

async function wranglerCommandsRunFromADirectoryThatInstallsIt(projectPath: string, document: string): Promise<string[]> {
  const lacking: string[] = [];
  for (const [call, placeholderDirectory = '.'] of document.matchAll(WRANGLER_COMMAND)) {
    const directory = placeholderDirectory.replace('<app>', 'web');
    const pkg = await readJsonFile<{ dependencies?: object; devDependencies?: object }>(
      join(projectPath, directory, 'package.json'),
    );
    if (!('wrangler' in { ...pkg.dependencies, ...pkg.devDependencies })) lacking.push(call);
  }
  return lacking;
}

describe.each(Object.keys(BINARY_RUNNER) as PackageManager[])('D1 provisioning docs with %s', (pm) => {
  describe.skipIf(pm === 'pnpm' && !PNPM_AVAILABLE)('generated projects', () => {
    let tempDir: string;
    const runner = BINARY_RUNNER[pm];

    beforeAll(async () => {
      tempDir = await createTempDir();
      for (const repo of Object.keys(REPO_APPS) as Repo[]) {
        const result = await runCli(
          [
            `d1-docs-${repo}`,
            ...REPO_APPS[repo],
            '--database',
            'd1',
            '--orm',
            'drizzle',
            '--deployment',
            'cloudflare',
            '--no-git',
            '--no-install',
            '--pm',
            pm,
          ],
          tempDir,
        );
        expect(result.exitCode).toBe(0);
      }
    });

    afterAll(async () => {
      await cleanupTempDir(tempDir);
    });

    const steps: Record<Repo, (name: string) => string[]> = {
      single: (name) => [
        `${runner} wrangler d1 create ${name}-db --no-update-config`,
        'REPLACE_WITH_D1_DATABASE_ID',
        `${pm} run db:migrate\n`,
        `${pm} run db:migrate:remote\n`,
        `${pm} run build:cf`,
        `${pm} run deploy`,
      ],
      turborepo: (name) => [
        `(cd packages/db && ${runner} wrangler d1 create ${name}-db --no-update-config)`,
        'REPLACE_WITH_D1_DATABASE_ID',
        `${pm} run db:migrate\n`,
        `(cd packages/db && ${pm} run db:migrate:remote)`,
        `(cd apps/web && ${pm} run build:cf)`,
        `(cd apps/web && ${pm} run deploy)`,
        `(cd apps/api && ${pm} run deploy)`,
      ],
    };

    describe.each(['single', 'turborepo'] as Repo[])('%s repo', (repo) => {
      const name = `d1-docs-${repo}`;
      const projectFile = (file: string) => readTextFile(join(tempDir, name, file));

      test.each(['AGENTS.md', 'README.md'])('%s: create, paste, migrate locally, migrate remotely, deploy, in this order', async (file) => {
        expectInOrder(await projectFile(file), steps[repo](name));
      });

      test.each(['AGENTS.md', 'README.md'])('%s: declines the offer that adds a second binding and warns about the local reset', async (file) => {
        const doc = await projectFile(file);
        expect(doc).toContain('second binding');
        expect(doc).toMatch(/keyed by the `database_id`/);
      });

      test.each(['AGENTS.md', 'README.md'])('%s: runs Wrangler from a directory that installs it, never through pnpm dlx', async (file) => {
        const doc = await projectFile(file);
        expect(doc).not.toContain('pnpm dlx wrangler');
        expect(await wranglerCommandsRunFromADirectoryThatInstallsIt(join(tempDir, name), doc)).toEqual([]);
      });

      test.each(['AGENTS.md', 'README.md'])('%s: every printed script exists in the directory it is run from', async (file) => {
        expect(await printedScriptsMissingFrom(join(tempDir, name), await projectFile(file))).toEqual([]);
      });
    });
  });
});
