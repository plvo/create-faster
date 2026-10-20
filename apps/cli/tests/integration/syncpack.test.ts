import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { $, Glob } from 'bun';
import { META } from '@/__meta__';
import { groupChoices, toCliArgs } from '../e2e/install-scripts-projects';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const SYNCPACK_PACKAGE = Bun.resolveSync('syncpack/package.json', import.meta.dir);
const SYNCPACK_ENTRY = join(dirname(SYNCPACK_PACKAGE), 'index.cjs');
const majorOf = (version: string) => version.replace(/^\D+/, '').split('.')[0];

interface Project {
  name: string;
  args: string[];
  pm: string;
}

const SCENARIOS = [
  {
    name: 'a turborepo with Expo and NativeWind next to Next.js and Hono',
    args: [
      '--app',
      'web:nextjs:shadcn,better-auth,trpc,tanstack-query',
      '--app',
      'api:hono',
      '--app',
      'mobile:expo:nativewind,jest-expo',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
      '--linter',
      'eslint-prettier',
      '--tooling',
      'husky',
      '--git',
    ],
  },
  {
    name: 'a turborepo without Expo',
    args: ['--app', 'svc:hono', '--app', 'jobs:node', '--linter', 'oxc'],
  },
].flatMap(({ name, args }) => ['bun', 'npm', 'pnpm'].map((pm): Project => ({ name: `${name} on ${pm}`, args, pm })));

/** A turborepo needs two apps: a project of the choices that holds one gets a Node app beside it. */
const CHOICE_PROJECTS: Project[] = groupChoices().map((project, index) => ({
  name: `the choices of META, project ${index + 1}`,
  args: [...toCliArgs(project), ...(project.apps.size < 2 ? ['--app', 'tools:node'] : [])],
  pm: 'npm',
}));

const BLUEPRINT_PROJECTS: Project[] = Object.entries(META.blueprints)
  .filter(([, blueprint]) => blueprint.context.apps.length > 1)
  .map(([name]) => ({ name: `blueprint ${name}`, args: ['--blueprint', name], pm: 'npm' }));

async function readManifests(projectPath: string): Promise<Map<string, string>> {
  const manifests = new Map<string, string>();
  for await (const file of new Glob('{package.json,apps/*/package.json,packages/*/package.json}').scan(projectPath)) {
    manifests.set(file, await readTextFile(join(projectPath, file)));
  }
  return manifests;
}

async function runSyncpack(command: 'lint' | 'fix', cwd: string): Promise<{ exitCode: number; output: string }> {
  const result = await $`${process.execPath} ${SYNCPACK_ENTRY} ${command}`.cwd(cwd).quiet().nothrow();
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

describe('syncpack on a fresh turborepo', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each([...SCENARIOS, ...CHOICE_PROJECTS, ...BLUEPRINT_PROJECTS])(
    'versions:list passes and versions:fix moves nothing in $name',
    async ({ name, args, pm }) => {
      const projectName = name.replace(/\W+/g, '-').toLowerCase();
      const result = await runCli([projectName, ...args, '--no-install', '--pm', pm], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
      const projectPath = join(tempDir, projectName);

      const { scripts, devDependencies } = await readJsonFile<{
        scripts: Record<string, string>;
        devDependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      const { version } = await readJsonFile<{ version: string }>(SYNCPACK_PACKAGE);
      expect(majorOf(devDependencies.syncpack ?? ''), 'the syncpack the test runs is the major the project installs').toBe(
        majorOf(version),
      );
      expect(scripts['versions:list']).toBe('syncpack lint');
      expect(scripts['versions:fix']).toBe('syncpack fix');

      const before = await readManifests(projectPath);
      const lint = await runSyncpack('lint', projectPath);
      expect(lint.output).not.toContain('✘');
      expect(lint.exitCode).toBe(0);

      expect((await runSyncpack('fix', projectPath)).exitCode).toBe(0);
      expect(await readManifests(projectPath)).toEqual(before);
    },
  );
});
