import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, printedScriptsMissingFrom, readTextFile, runCli } from './helpers';
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
    for (const file of ['docs/agents/cloudflare-deploy.md', 'docs/agents/data-layer.md']) {
      const notes = await readTextFile(join(projectPath, file));
      expect(notes).toContain(`cd packages/db && ${pm} run db:migrate:remote`);
    }
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
      `cd apps/<app> && ${pm} run deploy -- --secrets-file .prod.env`,
    );
  });
});
