import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';
import { COMBINATIONS } from './workspace-combinations';

interface TsConfig {
  extends?: string;
  compilerOptions?: { lib?: string[]; types?: string[] };
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  name: string;
  dir: string;
  manifest: Manifest;
  tsconfig: TsConfig;
}

async function readWorkspacePackages(projectPath: string): Promise<WorkspacePackage[]> {
  const packagesDir = join(projectPath, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  const packages: WorkspacePackage[] = [];

  for (const entry of entries) {
    const dir = join(packagesDir, entry.name);
    if (!(await fileExists(join(dir, 'tsconfig.json')))) continue;
    packages.push({
      name: entry.name,
      dir,
      manifest: await readJsonFile<Manifest>(join(dir, 'package.json')),
      tsconfig: await readJsonFile<TsConfig>(join(dir, 'tsconfig.json')),
    });
  }

  return packages;
}

async function resolveLib(projectPath: string, dir: string, tsconfig: TsConfig): Promise<string[]> {
  if (tsconfig.compilerOptions?.lib) return tsconfig.compilerOptions.lib.map((lib) => lib.toLowerCase());
  if (!tsconfig.extends) return [];

  const parentPath = tsconfig.extends.startsWith('@repo/config/')
    ? join(projectPath, 'packages/config', tsconfig.extends.slice('@repo/config/'.length))
    : join(dir, tsconfig.extends);
  const parent = await readJsonFile<TsConfig>(parentPath);
  return resolveLib(projectPath, join(parentPath, '..'), parent);
}

async function sourceFiles(dir: string, pattern: string): Promise<string[]> {
  return Array.fromAsync(new Glob(pattern).scan({ cwd: join(dir, 'src'), absolute: true }));
}

function isInstalled(typesEntry: string, ...manifests: Manifest[]): boolean {
  const candidates = [typesEntry, `@types/${typesEntry}`];
  return manifests.some((manifest) =>
    candidates.some((name) => name in { ...manifest.dependencies, ...manifest.devDependencies }),
  );
}

describe.each(COMBINATIONS)('workspace package tsconfig: $name', ({ args }) => {
  let tempDir: string;
  let projectPath: string;
  let packages: WorkspacePackage[];
  let rootManifest: Manifest;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['tsconfig-test', ...args, '--no-install', '--no-git', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'tsconfig-test');
    packages = await readWorkspacePackages(projectPath);
    rootManifest = await readJsonFile<Manifest>(join(projectPath, 'package.json'));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('every type package a tsconfig lists is installed', () => {
    const notInstalled = packages.flatMap(({ name, manifest, tsconfig }) =>
      (tsconfig.compilerOptions?.types ?? [])
        .filter((entry) => !isInstalled(entry, manifest, rootManifest))
        .map((entry) => `${name}: ${entry}`),
    );

    expect(notInstalled).toEqual([]);
  });

  test('a package with React components has the DOM lib', async () => {
    const missingDom: string[] = [];

    for (const { name, dir, tsconfig } of packages) {
      if ((await sourceFiles(dir, '**/*.tsx')).length === 0) continue;
      const lib = await resolveLib(projectPath, dir, tsconfig);
      if (!lib.includes('dom')) missingDom.push(name);
    }

    expect(missingDom).toEqual([]);
  });

  async function compiledSources(pkg: WorkspacePackage): Promise<string> {
    const byName = new Map(packages.map((entry) => [`@repo/${entry.name}`, entry]));
    const reachable = new Set<WorkspacePackage>();
    const visit = (entry: WorkspacePackage) => {
      if (reachable.has(entry)) return;
      reachable.add(entry);
      for (const dependency of Object.keys(entry.manifest.dependencies ?? {})) {
        const workspaceDependency = byName.get(dependency);
        if (workspaceDependency) visit(workspaceDependency);
      }
    };
    visit(pkg);

    const files = await Promise.all([...reachable].map((entry) => sourceFiles(entry.dir, '**/*.ts')));
    return (await Promise.all(files.flat().map(readTextFile))).join('\n');
  }

  async function missingTypesFor(usage: RegExp, typesEntry: string): Promise<string[]> {
    const missing: string[] = [];

    for (const pkg of packages) {
      if (!usage.test(await compiledSources(pkg))) continue;
      const types = pkg.tsconfig.compilerOptions?.types ?? [];
      if (!types.includes(typesEntry) || !isInstalled(typesEntry, pkg.manifest, rootManifest)) missing.push(pkg.name);
    }

    return missing;
  }

  test('a package whose sources read process lists the node types', async () => {
    expect(await missingTypesFor(/\bprocess\./, 'node')).toEqual([]);
  });

  test('a package whose sources use a Workers binding type lists the Workers types', async () => {
    expect(await missingTypesFor(/\b(D1Database|Hyperdrive)\b/, '@cloudflare/workers-types')).toEqual([]);
  });
});
