import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, printedScriptsMissingFrom, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm'] as const;
const NOTE_FILES = ['README.md', 'AGENTS.md', 'docs/agents/cloudflare-deploy.md', 'docs/agents/data-layer.md'];

describe.each([...PACKAGE_MANAGERS])('cloudflare-fullstack-nextjs notes with %s', (pm) => {
  const projectName = `fullstack-${pm}`;
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, projectName);
    const result = await runCli(
      [projectName, '--blueprint', 'cloudflare-fullstack-nextjs', '--no-install', '--no-git', '--pm', pm],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(NOTE_FILES)('%s: every printed script exists in the directory it is run from', async (file) => {
    const notes = await readTextFile(join(projectPath, file));

    expect(await printedScriptsMissingFrom(projectPath, notes)).toEqual([]);
  });

  test('the deploy notes run the web app scripts from apps/web', async () => {
    const notes = await readTextFile(join(projectPath, 'docs/agents/cloudflare-deploy.md'));

    for (const script of ['build:cf', 'deploy', 'preview']) {
      expect(notes).toContain(`cd apps/web && ${pm} run ${script}`);
    }
  });

  test('remote migrations run from packages/db, in the deploy and data layer notes', async () => {
    const deployNotes = await readTextFile(join(projectPath, 'docs/agents/cloudflare-deploy.md'));
    expect(deployNotes).toContain(`${pm} run db:migrate:remote`);
    expect(await readTextFile(join(projectPath, 'docs/agents/data-layer.md'))).toContain(`${pm} run db:migrate:remote`);
    const root = await readJsonFile<{ scripts: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(root.scripts['db:migrate:remote']).toBe(`cd packages/db && ${pm} run db:migrate:remote`);
  });

  test('the provisioning notes create D1 and R2 with the project Wrangler, declining the duplicate binding', async () => {
    const runner = { bun: 'bunx', npm: 'npx', pnpm: 'pnpm exec' }[pm];
    const notes = await readTextFile(join(projectPath, 'docs/agents/cloudflare-deploy.md'));

    expect(notes).toContain(`(cd apps/web && ${runner} wrangler d1 create ${projectName}-db --no-update-config)`);
    expect(notes).toContain(`(cd apps/web && ${runner} wrangler r2 bucket create ${projectName}-storage --no-update-config)`);
    expect(notes).not.toMatch(/(?<!bunx |npx |pnpm exec )wrangler (d1 create|r2 bucket create)/);
    expect(notes).not.toContain('pnpm dlx');
  });

  test('the notes create the production bucket only: dev and preview run on a local one', async () => {
    const notes = await readTextFile(join(projectPath, 'docs/agents/cloudflare-deploy.md'));

    expect(notes.match(/r2 bucket create/g)).toHaveLength(1);
    expect(notes).toContain('`dev` and `preview` keep their files in a local bucket');
  });

  test('no note prints a package manager filter form', async () => {
    for (const file of NOTE_FILES) {
      expect(await readTextFile(join(projectPath, file))).not.toContain('--filter');
    }
  });

  test('--secrets-file reaches the deploy script: npm swallows a flag that follows the script name without --', async () => {
    for (const file of NOTE_FILES) {
      expect(await readTextFile(join(projectPath, file))).not.toMatch(/run deploy --secrets-file/);
    }
    expect(await readTextFile(join(projectPath, 'AGENTS.md'))).toContain(
      `(cd apps/<app> && ${pm} run deploy -- --secrets-file .prod.env)`,
    );
  });
});
