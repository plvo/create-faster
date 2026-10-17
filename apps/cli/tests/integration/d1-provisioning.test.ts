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

    const steps: Record<Repo, (name: string, scripts: string) => string[]> = {
      single: (name, scripts) => [
        `${runner} wrangler d1 create ${name}-db --no-update-config`,
        'REPLACE_WITH_D1_DATABASE_ID',
        `${pm} run db:migrate\n`,
        `${pm} run db:migrate:remote\n`,
        'secrets.required',
        `listed under **${scripts}**`,
      ],
      turborepo: (name, scripts) => [
        `(cd apps/web && ${runner} wrangler d1 create ${name}-db --no-update-config)`,
        'REPLACE_WITH_D1_DATABASE_ID',
        `${pm} run db:migrate\n`,
        `${pm} run db:migrate:remote\n`,
        'secrets.required',
        `listed under **${scripts}**`,
      ],
    };

    describe.each(['single', 'turborepo'] as Repo[])('%s repo', (repo) => {
      const name = `d1-docs-${repo}`;
      const projectFile = (file: string) => readTextFile(join(tempDir, name, file));

      test.each([
        ['AGENTS.md', 'Scripts'],
        ['README.md', repo === 'single' ? 'Production' : 'Available Scripts'],
      ])('%s: create, paste, migrate locally, migrate remotely, deploy, in this order', async (file, scripts) => {
        const doc = await projectFile(file);
        expectInOrder(doc, steps[repo](name, scripts));
        expect(doc).toContain(`
## ${scripts}
`);
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

describe('D1 provisioning docs list the secrets a deploy needs', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<void> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
  }

  const projectFile = (name: string, file: string) => readTextFile(join(tempDir, name, file));

  test.each([
    ['single repo', 'secrets-single', ['--app', 'web:nextjs:better-auth']],
    ['turborepo', 'secrets-mono', ['--app', 'web:nextjs:better-auth', '--app', 'api:hono']],
  ])('%s with better-auth: the secrets come before the deploy step, in README and AGENTS.md', async (_, name, apps) => {
    await generate(name, [...apps, '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare']);

    for (const file of ['README.md', 'AGENTS.md']) {
      expectInOrder(await projectFile(name, file), [
        'bun run db:migrate:remote',
        'every name under `secrets.required`',
        '`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`',
        'Create every other resource',
        'except `preview`',
      ]);
    }
  });

  test('a project without a secret lists none', async () => {
    await generate('secrets-none', ['--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare']);

    expect(await projectFile('secrets-none', 'README.md')).not.toContain('BETTER_AUTH');
  });

  test('cloudflare-fullstack-nextjs: AGENTS.md lists the web secrets before the deploy step, and the deploy notes the R2 bucket and secrets', async () => {
    await generate('secrets-fullstack', ['--blueprint', 'cloudflare-fullstack-nextjs']);

    expectInOrder(await projectFile('secrets-fullstack', 'AGENTS.md'), [
      'bun run db:migrate:remote',
      '`web`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`',
      'Create every other resource',
      'except `preview`',
    ]);
    expectInOrder(await projectFile('secrets-fullstack', 'docs/agents/cloudflare-deploy.md'), [
      'wrangler d1 create',
      'bun run db:migrate:remote',
      'wrangler r2 bucket create',
      '`secrets.required`',
      '## Build & deploy',
    ]);
  });
});

describe('D1 provisioning docs run Wrangler from the app that holds the D1 config', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [
        'expo-first',
        '--app',
        'mobile:expo',
        '--app',
        'web:nextjs',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
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
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(['README.md', 'AGENTS.md'])('%s: d1 create runs in the app the migrate scripts point at, not the first app', async (file) => {
    const doc = await readTextFile(join(tempDir, 'expo-first', file));
    const migrate = (await readJsonFile<{ scripts: Record<string, string> }>(join(tempDir, 'expo-first/packages/db/package.json')))
      .scripts['db:migrate:remote'];
    expect(migrate).toContain('--config ../../apps/web/wrangler.jsonc');
    expect(doc).toContain('(cd apps/web && bunx wrangler d1 create expo-first-db --no-update-config)');
    expect(doc).not.toContain('apps/mobile && bunx');
  });

  test.each(['README.md', 'AGENTS.md'])('%s: every command that changes directory is a subshell', async (file) => {
    const doc = await readTextFile(join(tempDir, 'expo-first', file));
    expect(doc).toContain('(cd apps/');
    expect(doc).not.toMatch(/(?<!\()cd (apps|packages)\/[\w<>-]+ &&/);
  });
});
