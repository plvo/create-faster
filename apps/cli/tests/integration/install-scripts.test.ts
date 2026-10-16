import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import matter from 'gray-matter';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

const PNPM_AVAILABLE = Boolean(Bun.which('pnpm'));

function pnpmTest(title: string, run: () => Promise<void>): void {
  test.skipIf(!PNPM_AVAILABLE)(PNPM_AVAILABLE ? title : `${title} (skipped: pnpm is not installed)`, run);
}

interface Manifest {
  allowScripts?: Record<string, boolean>;
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

  test('npm single repo lists the packages of the selected choices in allowScripts', async () => {
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
    const projectPath = await generate('npm-turbo', ['--app', 'web:nextjs', '--app', 'api:hono'], 'npm');
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

  test('bun keeps its own trusted list', async () => {
    const projectPath = await generate('bun-single', CLOUDFLARE_NEXTJS, 'bun');
    const manifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(manifest.allowScripts).toBeUndefined();
    expect(manifest.trustedDependencies).toBeUndefined();
  });

  pnpmTest('pnpm single repo declares allowBuilds in a workspace file, not in package.json', async () => {
    const projectPath = await generate('pnpm-single', CLOUDFLARE_NEXTJS, 'pnpm');
    const { packages, allowBuilds } = matter(`---\n${await readTextFile(join(projectPath, 'pnpm-workspace.yaml'))}---\n`).data;
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

  pnpmTest('pnpm turborepo adds allowBuilds to the workspace declaration', async () => {
    const projectPath = await generate('pnpm-turbo', ['--app', 'web:nextjs', '--app', 'api:hono'], 'pnpm');
    const { packages, linkWorkspacePackages, allowBuilds } = matter(
      `---\n${await readTextFile(join(projectPath, 'pnpm-workspace.yaml'))}---\n`,
    ).data;
    expect(packages).toEqual(['apps/*', 'packages/*']);
    expect(linkWorkspacePackages).toBe(true);
    expect(allowBuilds).toEqual({ esbuild: false, fsevents: false });
  });

  pnpmTest('pnpm single repo with nothing to declare has no workspace file', async () => {
    const projectPath = await generate('pnpm-plain', ['--app', 'web:nextjs'], 'pnpm');
    expect(await fileExists(join(projectPath, 'pnpm-workspace.yaml'))).toBe(false);
  });

  test('a blueprint declares the packages its own dependencies bring', async () => {
    const projectPath = await generate('npm-blueprint', ['--blueprint', 'dapp-rainbowkit-nextjs'], 'npm');
    const { allowScripts } = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
    expect(allowScripts).toMatchObject({ bufferutil: false, keccak: false, 'utf-8-validate': false });
  });
});
