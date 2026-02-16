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

  return packages;
}

function extractImportedPackages(content: string): Set<string> {
  const packages = new Set<string>();

  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
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

      packages.add(packageName);
    }
  }

  return packages;
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

      for (const pkg of imports) {
        if (!declaredPackages.has(pkg)) {
          undeclared.push({ file: relPath, pkg });
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

      for (let i = 0; i < lines.length; i++) {
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
