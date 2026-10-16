import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import matter from 'gray-matter';
import { META } from '@/__meta__';
import type { InstallScripts, MetaAddon, ProjectCategoryName } from '@/types/meta';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  pnpmTest,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';

interface Manifest {
  allowScripts?: InstallScripts;
  trustedDependencies?: string[];
}

const CLOUDFLARE_NEXTJS = [
  '--app',
  'web:nextjs:posthog',
  '--database',
  'postgres',
  '--orm',
  'prisma',
  '--deployment',
  'cloudflare',
];

const TURBOREPO = ['--app', 'web:nextjs', '--app', 'api:hono'];

interface Selection {
  title: string;
  args: string[];
  rulings?: InstallScripts;
}

function projectAddonArgs(category: ProjectCategoryName, option: string, addon: MetaAddon): string[] {
  const requiredCategories = (META.project[category].require ?? []) as ProjectCategoryName[];
  const required = requiredCategories.flatMap((name) => {
    const [firstOption] = addon.require?.[name as 'database'] ?? Object.keys(META.project[name].options);
    return ['--' + name, firstOption ?? ''];
  });
  return [...required, `--${category}`, option];
}

/** One selection per META entry that rules on install scripts: the project made of that entry alone, with what it requires. */
function selectionsOfEntriesWithRulings(): (Selection & { rulings: InstallScripts })[] {
  const stacks: Selection[] = Object.entries(META.stacks).map(([name, stack]) => ({
    title: `stack ${name}`,
    args: ['--app', `app:${name}`],
    rulings: stack.installScripts,
  }));
  const libraries: Selection[] = Object.entries(META.libraries).map(([name, library]) => {
    const stack = Array.isArray(library.support?.stacks) ? library.support.stacks[0] : 'nextjs';
    return { title: `library ${name}`, args: ['--app', `app:${stack}:${name}`], rulings: library.installScripts };
  });
  const projectAddons: Selection[] = (Object.keys(META.project) as ProjectCategoryName[]).flatMap((category) =>
    Object.entries(META.project[category].options).map(([option, addon]) => ({
      title: `${category} ${option}`,
      args: ['--app', `app:${addon.require?.stacks?.[0] ?? 'nextjs'}`, ...projectAddonArgs(category, option, addon)],
      rulings: addon.installScripts,
    })),
  );
  const blueprints: Selection[] = Object.entries(META.blueprints).map(([name, blueprint]) => ({
    title: `blueprint ${name}`,
    args: ['--blueprint', name],
    rulings: blueprint.installScripts,
  }));

  return [...stacks, ...libraries, ...projectAddons, ...blueprints].filter(
    (selection): selection is Selection & { rulings: InstallScripts } => selection.rulings !== undefined,
  );
}

describe('install scripts of dependencies', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[], pm: string): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  }

  async function readWorkspaceFile(projectPath: string): Promise<Record<string, unknown>> {
    return matter(`---\n${await readTextFile(join(projectPath, 'pnpm-workspace.yaml'))}---\n`).data;
  }

  test.each(selectionsOfEntriesWithRulings())('npm lists the rulings of $title in allowScripts', async ({ title, args, rulings }) => {
    const projectPath = await generate(title.replace(' ', '-'), args, 'npm');
    const { allowScripts } = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(allowScripts).toMatchObject(rulings);
  });

  test('npm single repo lists the packages of every selected choice, sorted', async () => {
    const projectPath = await generate('npm-single', CLOUDFLARE_NEXTJS, 'npm');
    const { allowScripts } = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(allowScripts).toEqual({
      '@prisma/engines': true,
      'core-js': false,
      esbuild: false,
      fsevents: false,
      prisma: false,
      workerd: false,
    });
    expect(await fileExists(join(projectPath, 'pnpm-workspace.yaml'))).toBe(false);
  });

  test('npm turborepo declares allowScripts in the root only, where npm reads it', async () => {
    const projectPath = await generate('npm-turbo', TURBOREPO, 'npm');
    const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(root.allowScripts).toEqual({ esbuild: false, fsevents: false });
    for (const app of ['web', 'api']) {
      const manifest = await readJsonFile<Manifest>(join(projectPath, 'apps', app, 'package.json'));
      expect(manifest.allowScripts).toBeUndefined();
    }
  });

  test('a choice that brings no dependency with an install script adds nothing', async () => {
    const projectPath = await generate('npm-plain', ['--app', 'web:nextjs'], 'npm');
    const manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(manifest.allowScripts).toBeUndefined();
  });

  test.each(['single', 'turborepo'])('bun keeps its own trusted list in a %s repo', async (repo) => {
    const args = repo === 'single' ? CLOUDFLARE_NEXTJS : TURBOREPO;
    const projectPath = await generate(`bun-${repo}`, args, 'bun');
    const manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(manifest.allowScripts).toBeUndefined();
    expect(manifest.trustedDependencies).toBeUndefined();
  });

  pnpmTest('pnpm single repo declares allowBuilds in a workspace file, not in package.json', async () => {
    const projectPath = await generate('pnpm-single', CLOUDFLARE_NEXTJS, 'pnpm');
    const { packages, allowBuilds } = await readWorkspaceFile(projectPath);
    expect(packages).toEqual(['.']);
    expect(allowBuilds).toEqual({
      '@prisma/engines': true,
      'core-js': false,
      esbuild: false,
      fsevents: false,
      prisma: false,
      workerd: false,
    });
    const manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(manifest.allowScripts).toBeUndefined();
  });

  pnpmTest('pnpm turborepo adds allowBuilds to the workspace declaration, not to the root package.json', async () => {
    const projectPath = await generate('pnpm-turbo', TURBOREPO, 'pnpm');
    const { packages, linkWorkspacePackages, allowBuilds } = await readWorkspaceFile(projectPath);
    expect(packages).toEqual(['apps/*', 'packages/*']);
    expect(linkWorkspacePackages).toBe(true);
    expect(allowBuilds).toEqual({ esbuild: false, fsevents: false });
    const root = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(root.allowScripts).toBeUndefined();
  });

  pnpmTest('pnpm single repo with nothing to declare has no workspace file', async () => {
    const projectPath = await generate('pnpm-plain', ['--app', 'web:nextjs'], 'pnpm');
    expect(await fileExists(join(projectPath, 'pnpm-workspace.yaml'))).toBe(false);
  });
});
