import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectiveAtRisk } from '../triple-slash-directives';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const VITE_CLIENT_TYPES = '/// <reference types="vite/client" />';

interface Project {
  name: string;
  args: string[];
  startApps: string[];
}

const PROJECTS: Project[] = [
  {
    name: 'single repo Start with libraries that import in the root route',
    args: ['--app', 'web:tanstack-start:tanstack-query,trpc,tanstack-devtools,posthog,mdx'],
    startApps: ['.'],
  },
  {
    name: 'turborepo of two Start apps',
    args: ['--app', 'web:tanstack-start:tanstack-query,trpc', '--app', 'docs:tanstack-start:mdx'],
    startApps: ['apps/web', 'apps/docs'],
  },
  {
    name: 'blueprint org-dashboard-tanstack-start',
    args: ['--blueprint', 'org-dashboard-tanstack-start'],
    startApps: ['apps/web'],
  },
  {
    name: 'Next.js and Expo apps on SST with NativeWind',
    args: ['--app', 'web:nextjs:tanstack-query', '--app', 'mobile:expo:nativewind', '--deployment', 'sst'],
    startApps: [],
  },
];

async function sourceFiles(projectPath: string): Promise<string[]> {
  const entries = await readdir(projectPath, { recursive: true });
  return entries.filter((entry) => SOURCE_FILE.test(entry) && !entry.split('/').includes('node_modules'));
}

// The unit test checks every template; this checks the files a generation assembles, which can take imports from partials.
describe.each(PROJECTS)('triple-slash directives: $name', ({ args, startApps }) => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['directives', ...args, '--linter', 'oxc', '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'directives');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('no generated source holds a directive next to imports a formatter could reorder', async () => {
    const files = await sourceFiles(projectPath);
    const sources = await Promise.all(files.map(async (file) => [file, await readTextFile(join(projectPath, file))] as const));
    const offenders = sources.filter(([, source]) => isDirectiveAtRisk(source)).map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  if (startApps.length > 0) {
    test('every Start app declares the Vite client types in a file of its own', async () => {
      for (const appDir of startApps) {
        const declaration = join(projectPath, appDir, 'src/vite-env.d.ts');
        expect(await fileExists(declaration)).toBe(true);
        expect((await readTextFile(declaration)).trim()).toBe(VITE_CLIENT_TYPES);

        const { include } = await readJsonFile<{ include: string[] }>(join(projectPath, appDir, 'tsconfig.json'));
        expect(include.some((entry) => entry === 'src' || entry.startsWith('src/'))).toBe(true);
      }
    });
  }
});
