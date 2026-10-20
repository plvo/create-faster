import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, join, relative } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, fileExists, filesUnder, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const PROJECT = 'site';
const NOT_FOUND_TITLE = "title: 'Page not found'";
// SidebarInset renders the main landmark of a dashboard.
const MAIN_LANDMARK = /<(main|SidebarInset)[\s>]/g;
const CATCH_ALL_PAGE = /(^|\/)\[\.\.\.[^\]/]+\]\/page\.tsx$/;

const countMains = (source: string): number => source.match(MAIN_LANDMARK)?.length ?? 0;

const nextjsBlueprints = Object.entries(META.blueprints)
  .filter(([, blueprint]) => blueprint.context.apps.some((app) => app.stackName === 'nextjs'))
  .map(([name, blueprint]) => ({
    title: name,
    args: ['--blueprint', name],
    appNames: blueprint.context.apps.filter((app) => app.stackName === 'nextjs').map((app) => app.appName),
  }));

const PROJECTS = [
  { title: 'a plain Next.js app', args: ['--app', `${PROJECT}:nextjs`], appNames: [PROJECT] },
  ...nextjsBlueprints,
];

describe.each(PROJECTS)('$title 404', ({ args, appNames }) => {
  let tempDir: string;
  let appDirectories: string[];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([PROJECT, ...args, '--no-install', '--no-git'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const projectDirectory = join(tempDir, PROJECT);
    appDirectories = [];
    for (const appName of appNames) {
      const inTurborepo = join(projectDirectory, 'apps', appName);
      appDirectories.push((await fileExists(inTurborepo)) ? inTurborepo : projectDirectory);
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  // The 404 an unknown URL reaches: the not found page of the group whose catch-all page answers it, inside that
  // group's layout, else the root one.
  async function reachedNotFound(appDirectory: string) {
    const appRoot = join(appDirectory, 'src/app');
    const catchAll = (await filesUnder(appRoot)).map((file) => relative(appRoot, file)).find((file) => CATCH_ALL_PAGE.test(file));
    const groupDirectory = catchAll ? dirname(dirname(catchAll)) : '.';
    const layouts = [join(appRoot, 'layout.tsx')];
    if (groupDirectory !== '.') layouts.push(join(appRoot, groupDirectory, 'layout.tsx'));
    const notFoundFile = join(appRoot, groupDirectory, 'not-found.tsx');
    const titleSource = catchAll ? join(appRoot, catchAll) : notFoundFile;
    return { layouts, notFoundFile, titleSource };
  }

  test('lists the Next.js apps of the project', () => {
    expect(appDirectories.length).toBeGreaterThan(0);
  });

  test('renders exactly one main landmark, counting the layouts around it', async () => {
    for (const appDirectory of appDirectories) {
      const { layouts, notFoundFile } = await reachedNotFound(appDirectory);
      let mains = countMains(await readTextFile(notFoundFile));
      for (const layout of layouts) mains += countMains(await readTextFile(layout));
      expect(mains, `${notFoundFile} with ${layouts.join(', ')}`).toBe(1);
    }
  });

  test('has its own title', async () => {
    for (const appDirectory of appDirectories) {
      const { titleSource } = await reachedNotFound(appDirectory);
      expect(await readTextFile(titleSource), titleSource).toContain(NOT_FOUND_TITLE);
    }
  });
});
