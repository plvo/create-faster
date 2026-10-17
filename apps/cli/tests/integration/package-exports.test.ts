import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import { cleanupTempDir, createTempDir, fileExists, matchesExportKey, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';
import { COMBINATIONS } from './workspace-combinations';

setIntegrationTimeout();

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

async function missingExportTargets(packageDir: string): Promise<string[]> {
  const pkg = await readJsonFile<{ exports?: Record<string, unknown> }>(join(packageDir, 'package.json'));
  const missing: string[] = [];

  for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
    for (const target of exportTargets(value)) {
      const relative = target.replace(/^\.\//, '');
      const found = relative.includes('*')
        ? (await Array.fromAsync(new Glob(relative.replaceAll('*', '**/*')).scan({ cwd: packageDir }))).length > 0
        : await fileExists(join(packageDir, relative));
      if (!found) missing.push(`${subpath} -> ${target}`);
    }
  }

  return missing;
}

const WORKSPACE_IMPORT = /from\s+['"]@repo\/([\w-]+)(\/[^'"]*)?['"]/g;

async function unresolvedWorkspaceImports(projectPath: string): Promise<string[]> {
  const exportKeys = new Map<string, string[]>();
  const unresolved = new Set<string>();

  for await (const file of new Glob('{apps,packages}/**/*.{ts,tsx}').scan({ cwd: projectPath })) {
    const source = await readTextFile(join(projectPath, file));
    for (const [, packageName = '', rest = ''] of source.matchAll(WORKSPACE_IMPORT)) {
      if (!exportKeys.has(packageName)) {
        const manifest = join(projectPath, 'packages', packageName, 'package.json');
        const pkg = (await fileExists(manifest)) ? await readJsonFile<{ exports?: object }>(manifest) : {};
        exportKeys.set(packageName, Object.keys(pkg.exports ?? {}));
      }
      const subpath = `.${rest}`;
      if (!exportKeys.get(packageName)?.some((key) => matchesExportKey(key, subpath))) {
        unresolved.add(`${file}: @repo/${packageName}${rest}`);
      }
    }
  }

  return [...unresolved].sort();
}

describe.each(COMBINATIONS)('workspace package exports: $name', ({ name, args }) => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['exports-test', ...args, '--no-install', '--no-git', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'exports-test');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('every declared export resolves to a generated file', async () => {
    const packagesDir = join(projectPath, 'packages');
    const packages = (await readdir(packagesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());

    const missing: Record<string, string[]> = {};
    for (const entry of packages) {
      const unresolved = await missingExportTargets(join(packagesDir, entry.name));
      if (unresolved.length > 0) missing[entry.name] = unresolved;
    }

    expect(missing, name).toEqual({});
  });

  test('every @repo import in the apps and packages is covered by an export', async () => {
    expect(await unresolvedWorkspaceImports(projectPath), name).toEqual([]);
  });
});
