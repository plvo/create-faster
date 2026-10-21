import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { cleanupTempDir, createTempDir, filesUnder, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const PROJECTS: { name: string; args: string[] }[] = [
  { name: 'shadcn-turborepo', args: ['--app', 'web:nextjs:shadcn', '--app', 'api:hono'] },
  { name: 'shadcn-single', args: ['--app', 'web:nextjs:shadcn'] },
  { name: 'org-dashboard-nextjs', args: ['--blueprint', 'org-dashboard-nextjs'] },
  { name: 'org-dashboard-tanstack-start', args: ['--blueprint', 'org-dashboard-tanstack-start'] },
  { name: 'multitenant-saas-nextjs', args: ['--blueprint', 'multitenant-saas-nextjs'] },
  { name: 'cloudflare-fullstack-nextjs', args: ['--blueprint', 'cloudflare-fullstack-nextjs'] },
];

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SOURCE_FILE = /\.(ts|tsx)$/;

// The directory of the closest package.json above a file.
function workspaceOf(file: string, files: string[]): string {
  let directory = dirname(file);
  while (!files.includes(join(directory, 'package.json'))) directory = dirname(directory);
  return directory;
}

describe('dependencies a generated workspace declares for a component it ships', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(PROJECTS)('$name: cmdk is declared where a source imports it, and only there', async ({ name, args }) => {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const projectPath = join(tempDir, name);
    const files = await filesUnder(projectPath, ['node_modules']);

    const unused: string[] = [];
    for (const manifestPath of files.filter((file) => file.endsWith('/package.json'))) {
      const manifest = await readJsonFile<Manifest>(manifestPath);
      if (!manifest.dependencies?.cmdk && !manifest.devDependencies?.cmdk) continue;
      const workspace = dirname(manifestPath);
      const sources = files.filter((file) => file.startsWith(`${workspace}/`) && SOURCE_FILE.test(file));
      const contents = await Promise.all(sources.map((file) => readTextFile(file)));
      if (!contents.some((source) => /from ['"]cmdk['"]/.test(source))) unused.push(workspace.slice(projectPath.length));
    }

    expect(unused, 'declared and imported by no source').toEqual([]);

    const undeclared: string[] = [];
    for (const file of files.filter((candidate) => SOURCE_FILE.test(candidate))) {
      if (!/from ['"]cmdk['"]/.test(await readTextFile(file))) continue;
      const workspace = workspaceOf(file, files);
      const manifest = await readJsonFile<Manifest>(join(workspace, 'package.json'));
      if (!manifest.dependencies?.cmdk && !manifest.devDependencies?.cmdk) undeclared.push(file.slice(projectPath.length));
    }
    expect(undeclared, 'imported and declared by no package.json').toEqual([]);
  });
});
