import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { META } from '@/__meta__';

const TEMPLATES_DIR = join(import.meta.dir, '../../templates');

function collectAllDeclaredPackages(): Set<string> {
  const packages = new Set<string>();

  const addDeps = (packageJson: Record<string, unknown> | undefined) => {
    if (!packageJson) return;
    for (const field of ['dependencies', 'devDependencies']) {
      const deps = packageJson[field] as Record<string, string> | undefined;
      if (deps) {
        for (const dep of Object.keys(deps)) packages.add(dep);
      }
    }
  };

  for (const stack of Object.values(META.stacks)) {
    addDeps(stack.packageJson);
  }

  for (const lib of Object.values(META.libraries)) {
    addDeps(lib.packageJson);
    if ('appPackageJson' in lib) addDeps(lib.appPackageJson as Record<string, unknown>);
  }

  for (const category of Object.values(META.project)) {
    for (const option of Object.values(category.options)) {
      addDeps(option.packageJson);
      if ('appPackageJson' in option) addDeps(option.appPackageJson as Record<string, unknown>);
    }
  }

  for (const blueprint of Object.values(META.blueprints)) {
    addDeps(blueprint.packageJson);
  }

  return packages;
}

interface ImportEntry {
  packageName: string;
  typeOnly: boolean;
}

function extractImportedPackages(content: string): ImportEntry[] {
  const entries: ImportEntry[] = [];

  const patterns = [
    { regex: /\bimport\s+type\b[^'"]*from\s+['"]([^'"]+)['"]/g, typeOnly: true },
    { regex: /\bimport\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/g, typeOnly: false },
    { regex: /\bimport\s+['"]([^'"]+)['"]/g, typeOnly: false },
  ];

  const seen = new Set<string>();

  for (const { regex, typeOnly } of patterns) {
    for (const match of content.matchAll(regex)) {
      const importPath = match[1];

      if (
        importPath.startsWith('.') ||
        importPath.startsWith('#') ||
        importPath.startsWith('@/') ||
        importPath.startsWith('@repo/') ||
        importPath.startsWith('node:') ||
        importPath.startsWith('bun:') ||
        importPath.includes('{{')
      ) {
        continue;
      }

      const packageName = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];

      const key = `${packageName}:${typeOnly}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({ packageName, typeOnly });
    }
  }

  return entries;
}

async function getAllTemplateFiles(): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.hbs')) {
      files.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return files;
}

describe('Template imports vs META dependencies', () => {
  test('all template imports are declared in META', async () => {
    const declaredPackages = collectAllDeclaredPackages();
    const templateFiles = await getAllTemplateFiles();

    const undeclared: { file: string; pkg: string }[] = [];

    for (const filePath of templateFiles) {
      const content = await readFile(filePath, 'utf-8');
      const imports = extractImportedPackages(content);
      const relPath = relative(TEMPLATES_DIR, filePath);

      for (const { packageName, typeOnly } of imports) {
        const hasPkg = declaredPackages.has(packageName);
        const hasTypes = declaredPackages.has(`@types/${packageName}`);

        if (!hasPkg && !(typeOnly && hasTypes)) {
          undeclared.push({ file: relPath, pkg: packageName });
        }
      }
    }

    expect(
      undeclared,
      `Undeclared imports:\n${undeclared.map(({ file, pkg }) => `  ${file} → ${pkg}`).join('\n')}`,
    ).toEqual([]);
  });

  test('no unescaped JSX double braces in templates', async () => {
    const templateFiles = await getAllTemplateFiles();
    const conflicts: { file: string; line: number; text: string }[] = [];
    const jsxBracesRegex = /=[{]{2}[^#/\\]/;

    for (const filePath of templateFiles) {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      let inRawBlock = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('{{{{raw}}}}')) inRawBlock = true;
        if (lines[i].includes('{{{{/raw}}}}')) { inRawBlock = false; continue; }
        if (inRawBlock) continue;
        if (jsxBracesRegex.test(lines[i])) {
          conflicts.push({ file: relative(TEMPLATES_DIR, filePath), line: i + 1, text: lines[i].trim() });
        }
      }
    }

    expect(
      conflicts,
      `JSX/Handlebars conflicts (use \\{{ to escape):\n${conflicts.map(({ file, line, text }) => `  ${file}:${line} → ${text}`).join('\n')}`,
    ).toEqual([]);
  });
});
